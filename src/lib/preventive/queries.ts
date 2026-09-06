import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  assetsRepository,
  connectToDatabase,
  countPpmSchedulesByType,
  mapPage,
  ppmSchedulesRepository,
  techniciansRepository,
  toObjectId,
  type AssetDocument,
  type Page,
  type PpmScheduleDocument,
  type PpmTypeCount,
  type TechnicianDocument,
  type TenantScope,
} from "@/lib/db";
import { statusQueryFragment } from "@/lib/domain/preventive";
import { toPpmScheduleSummary, type PpmScheduleSummary } from "./dto";
import { listPpmSchedulesSchema, type ListPpmSchedulesInput } from "./schemas";

/**
 * The read side of preventive maintenance.
 *
 * Server Components call these directly (CLAUDE.md prefers Server Components for
 * reads); the list action in `actions.ts` is a thin wrapper over the same
 * function, so a page load and a client-side page change cannot diverge in what
 * they are allowed to return.
 *
 * Every exported entry point starts with `requireRole()`, which is also the only
 * way to obtain the `TenantScope` the repository needs — so "checked the caller"
 * and "scoped the query" are one step and cannot come apart.
 */

/**
 * Every STAFF role may read the schedule, and CLIENT may not.
 *
 * This is the same list `nav/modules.ts` gives the route, and that is not a
 * coincidence to be maintained by hand: a route open to a role whose queries the
 * DAL would refuse is a 500, not a security boundary. `PpmSchedule` has no
 * `clientId`, so `ppmSchedulesRepository` refuses a client-scoped session
 * outright rather than widening it to the organization — and a customer must not
 * be handed its provider's whole maintenance plan.
 */
export const PPM_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
];

/**
 * Who plans the work.
 *
 * SUPERVISOR is included, unlike on assets or technicians, and `nav/modules.ts`
 * already gives the reason in its note on AMC: "a supervisor schedules work;
 * they do not price it". Scheduling a visit is the supervisor's job.
 */
export const PPM_MANAGERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER", "SUPERVISOR"];

/**
 * Who moves a visit through its states.
 *
 * Every reader, because the person who presses Start is the technician standing
 * in the plant room. The assignment on the row is advisory rather than enforced:
 * a `Technician` record is not a `User` (most never sign in), so "is this my
 * job?" cannot be answered from the session alone. When a technician's own
 * account is reliably linked, this narrows to "the assignee, or a supervisor" —
 * until then, a rule that pretended to check it would be theatre.
 */
export const PPM_EXECUTORS: readonly [Role, ...Role[]] = PPM_READERS;

export function canManagePpm(role: Role): boolean {
  return (PPM_MANAGERS as readonly Role[]).includes(role);
}

export function canExecutePpm(role: Role): boolean {
  return (PPM_EXECUTORS as readonly Role[]).includes(role);
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the asset and technician names for one page of schedules.
 *
 * Two second SCOPED reads rather than a `populate()`: the DAL refuses populate on
 * purpose, because a join is reached under MongoDB's rules rather than ours and
 * would cross into a collection nothing had scoped. The ids here came out of a
 * query that was already scoped, and the lookup is scoped again on the way back
 * — so the fragment is genuinely code-authored even though the ids are data.
 *
 * The technician half goes through `techniciansRepository` rather than
 * `listTechnicians()`, and that is deliberate. `TECHNICIAN_READERS` excludes the
 * TECHNICIAN role — a technician may not enumerate the workforce directory — so
 * calling it here would 403 the very people this screen is for. This is the
 * "narrower read that gets its own function" that `technicians/queries.ts`
 * anticipates: ids that came out of an already-scoped query, scoped again, with
 * two fields projected and nothing else reachable.
 */
async function namesFor(
  scope: TenantScope,
  documents: readonly PpmScheduleDocument[],
): Promise<{ assets: Map<string, string>; technicians: Map<string, string> }> {
  const assets = new Map<string, string>();
  const technicians = new Map<string, string>();

  // Deduplicated by hex string, collected as ObjectIds. Mongoose would cast the
  // strings for us, but handing the driver the type the field actually stores
  // keeps the `$in` a plain index lookup with nothing left to infer. The id type
  // is derived from the document rather than imported from mongoose: feature
  // code must not reach the driver, and the DAL-boundary lint rule enforces that
  // for type imports too.
  const assetIds = new Map<string, PpmScheduleDocument["assetId"]>();
  const technicianIds = new Map<string, PpmScheduleDocument["technicianId"]>();

  for (const document of documents) {
    assetIds.set(document.assetId.toHexString(), document.assetId);
    technicianIds.set(document.technicianId.toHexString(), document.technicianId);
  }

  const [assetDocuments, technicianDocuments] = await Promise.all([
    assetIds.size === 0
      ? Promise.resolve<AssetDocument[]>([])
      : assetsRepository.forScope(scope).find(undefined, {
          where: { _id: { $in: [...assetIds.values()] } },
          select: ["_id", "name"],
          limit: assetIds.size,
        }),
    technicianIds.size === 0
      ? Promise.resolve<TechnicianDocument[]>([])
      : techniciansRepository.forScope(scope).find(undefined, {
          where: { _id: { $in: [...technicianIds.values()] } },
          select: ["_id", "name"],
          limit: technicianIds.size,
        }),
  ]);

  for (const asset of assetDocuments) assets.set(asset._id.toHexString(), asset.name);
  for (const person of technicianDocuments) {
    technicians.set(person._id.toHexString(), person.name);
  }

  return { assets, technicians };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * The scope-taking half. Exported so `actions.ts` can reuse it with the scope
 * `defineAction` already resolved, instead of authenticating a second time — one
 * implementation, so a page load and a client-side page change can never return
 * different things.
 *
 * `now` is threaded through rather than read twice: the same instant decides
 * which rows the `UPCOMING`/`OVERDUE` filter matches AND which badge each row
 * gets, so a page cannot come back holding a row its own filter excludes.
 */
export async function listPpmSchedulesForScope(
  scope: TenantScope,
  params: ListPpmSchedulesInput = {},
  now: Date = new Date(),
): Promise<Page<PpmScheduleSummary>> {
  const { page, pageSize, type, status, assetId, technicianId } =
    listPpmSchedulesSchema.parse(params);

  // The schema guarantees 24 hex characters, so these cannot fail — but the
  // filter takes an ObjectId, and coercing here rather than casting keeps the
  // "an unparseable id matches nothing" behaviour the rest of the DAL has.
  const assetFilter = assetId ? toObjectId(assetId) : null;
  const technicianFilter = technicianId ? toObjectId(technicianId) : null;

  await connectToDatabase();

  const result = await ppmSchedulesRepository.forScope(scope).paginate({
    page,
    pageSize,
    // Untrusted values go in `filter`, which is sanitized and rejected for
    // operators. Only the code-authored status fragment goes in `where`.
    filter: {
      ...(type ? { type } : {}),
      ...(assetFilter ? { assetId: assetFilter } : {}),
      ...(technicianFilter ? { technicianId: technicianFilter } : {}),
    },
    where: status ? statusQueryFragment(status, now) : undefined,
    // Soonest first: the top of this list is the work that is late, then the
    // work that is next. The sort key is in the index, so this is a walk of it.
    sort: { dueDate: 1 },
  });

  const { assets, technicians } = await namesFor(scope, result.items);

  return mapPage(result, (document) =>
    toPpmScheduleSummary(
      document,
      assets.get(document.assetId.toHexString()) ?? null,
      technicians.get(document.technicianId.toHexString()) ?? null,
      now,
    ),
  );
}

export async function listPpmSchedules(
  params: ListPpmSchedulesInput = {},
): Promise<Page<PpmScheduleSummary>> {
  const { scope } = await requireRole(...PPM_READERS);
  return listPpmSchedulesForScope(scope, params);
}

// ---------------------------------------------------------------------------
// The frequency tiles
// ---------------------------------------------------------------------------

/**
 * How much open work there is of each frequency, and how much of it is late.
 *
 * One aggregation for all six tiles, built inside the DAL from a `$match` that
 * layer had already scoped. See `countPpmSchedulesByType`.
 */
export async function summarisePpmSchedulesForScope(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<PpmTypeCount[]> {
  await connectToDatabase();
  return countPpmSchedulesByType(scope, now);
}

export async function summarisePpmSchedules(): Promise<PpmTypeCount[]> {
  const { scope } = await requireRole(...PPM_READERS);
  return summarisePpmSchedulesForScope(scope);
}
