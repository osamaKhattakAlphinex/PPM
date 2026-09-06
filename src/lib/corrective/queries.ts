import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  assetsRepository,
  connectToDatabase,
  countWorkOrdersByPriority,
  isClientScope,
  mapPage,
  techniciansRepository,
  toObjectId,
  workOrdersRepository,
  type AssetDocument,
  type Page,
  type TechnicianDocument,
  type TenantScope,
  type WorkOrderDocument,
  type WorkOrderPriorityCount,
} from "@/lib/db";
import { toWorkOrderSummary, type WorkOrderSummary } from "./dto";
import { listWorkOrdersSchema, type ListWorkOrdersInput } from "./schemas";

/**
 * The read side of corrective maintenance.
 *
 * Server Components call these directly (CLAUDE.md prefers Server Components
 * for reads); the list action in `actions.ts` is a thin wrapper over the same
 * function, so a page load and a client-side page change cannot diverge in what
 * they are allowed to return.
 *
 * Every exported entry point starts with `requireRole()`, which is also the only
 * way to obtain the `TenantScope` the repository needs — so "checked the caller"
 * and "scoped the query" are one step and cannot come apart.
 */

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

/**
 * Everyone reads the ticket list, CLIENT included — the one operational
 * collection where that is true.
 *
 * This is the same list `nav/modules.ts` gives the route, and that is not a
 * coincidence to be maintained by hand: a route open to a role whose queries
 * the DAL would refuse is a 500, not a security boundary. Here the two agree
 * for the opposite reason to preventive's: `WorkOrder` HAS a `clientId`, so
 * `workOrdersRepository` narrows a client-scoped session to its own faults
 * rather than refusing it.
 */
export const WORK_ORDER_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
  "CLIENT",
];

/**
 * Who may raise a ticket — everyone, and the CLIENT inclusion is the point of
 * the module.
 *
 * `nav/modules.ts` says it plainly: "Reactive work orders — the one thing a
 * client raises directly." A customer who can see faults but not report one has
 * to phone somebody, and the ticket that gets typed up afterwards is filed
 * against the wrong asset by a person who was not there.
 *
 * A client cannot choose the asset freely: `assetsRepository` is
 * client-partitioned, so the picker on their screen and the re-check in the
 * action both see only their own equipment.
 */
export const WORK_ORDER_RAISERS: readonly [Role, ...Role[]] = WORK_ORDER_READERS;

/**
 * Who decides whose job it is.
 *
 * Identical to `TECHNICIAN_READERS`, and it has to be: assigning means picking
 * from the workforce directory, and a role that may assign but may not
 * enumerate technicians would get an authorization error from the picker on the
 * very screen it needs. SUPERVISOR is in for the reason `nav/modules.ts` gives
 * about AMC — "a supervisor schedules work; they do not price it".
 */
export const WORK_ORDER_ASSIGNERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
];

/**
 * Who moves a ticket through the rest of its states.
 *
 * Every staff role, because the person who presses Start is the technician
 * standing in the plant room. CLIENT is excluded and this is the one place the
 * role split really bites: a customer raises the fault and watches it, but does
 * not get to declare it fixed — closing is the provider's assertion about work
 * the provider did, and it is what an AMC gets measured on.
 *
 * As on preventive, the assignment on the row is advisory rather than enforced:
 * a `Technician` record is not a `User` (most never sign in), so "is this my
 * job?" cannot be answered from the session alone. When a technician's own
 * account is reliably linked, this narrows to "the assignee, or a supervisor" —
 * until then, a rule that pretended to check it would be theatre.
 */
export const WORK_ORDER_EXECUTORS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
];

/**
 * Who may rewrite or remove a ticket.
 *
 * Narrower than everything above, and narrower than preventive's equivalent.
 * Editing the issue text or the priority after the fact changes what the record
 * SAYS happened, and deleting removes it from the count an AMC is measured on —
 * neither is a supervisor's call, and certainly not the raiser's.
 */
export const WORK_ORDER_MANAGERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

export function canRaiseWorkOrders(role: Role): boolean {
  return (WORK_ORDER_RAISERS as readonly Role[]).includes(role);
}

export function canAssignWorkOrders(role: Role): boolean {
  return (WORK_ORDER_ASSIGNERS as readonly Role[]).includes(role);
}

export function canExecuteWorkOrders(role: Role): boolean {
  return (WORK_ORDER_EXECUTORS as readonly Role[]).includes(role);
}

export function canManageWorkOrders(role: Role): boolean {
  return (WORK_ORDER_MANAGERS as readonly Role[]).includes(role);
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the asset and technician names for one page of work orders.
 *
 * Two second SCOPED reads rather than a `populate()`: the DAL refuses populate
 * on purpose, because a join is reached under MongoDB's rules rather than ours
 * and would cross into a collection nothing had scoped. The ids here came out
 * of a query that was already scoped, and the lookup is scoped again on the way
 * back — so the fragment is genuinely code-authored even though the ids are
 * data.
 *
 * Two differences from the preventive version, both load-bearing:
 *
 *  1. `technicianId` is NULLABLE here, so unassigned rows contribute no id and
 *     the `$in` is skipped entirely when nothing is assigned yet.
 *  2. A CLIENT scope must not touch `techniciansRepository` AT ALL. That
 *     collection has no `clientId` and is not `sharedWithClients`, so the DAL
 *     refuses a client-scoped read of it with a `ScopeResolutionError` — which
 *     would surface as a 500 on the one screen a customer is guaranteed to
 *     open. Skipping the lookup is the fail-closed answer, and the UI then
 *     renders no technician column rather than a column of blanks.
 *
 * The technician half goes through `techniciansRepository` rather than
 * `listTechnicians()` for the reason preventive's does: `TECHNICIAN_READERS`
 * excludes the TECHNICIAN role, so calling it here would 403 the very people
 * this screen is for.
 */
async function namesFor(
  scope: TenantScope,
  documents: readonly WorkOrderDocument[],
): Promise<{ assets: Map<string, string>; technicians: Map<string, string> }> {
  const assets = new Map<string, string>();
  const technicians = new Map<string, string>();

  // Deduplicated by hex string, collected as ObjectIds. Mongoose would cast the
  // strings for us, but handing the driver the type the field actually stores
  // keeps the `$in` a plain index lookup with nothing left to infer. The id type
  // is derived from the document rather than imported from mongoose: feature
  // code must not reach the driver, and the DAL-boundary lint rule enforces that
  // for type imports too.
  const assetIds = new Map<string, WorkOrderDocument["assetId"]>();
  const technicianIds = new Map<string, NonNullable<WorkOrderDocument["technicianId"]>>();

  for (const document of documents) {
    assetIds.set(document.assetId.toHexString(), document.assetId);
    if (document.technicianId) {
      technicianIds.set(document.technicianId.toHexString(), document.technicianId);
    }
  }

  const skipTechnicians = isClientScope(scope) || technicianIds.size === 0;

  const [assetDocuments, technicianDocuments] = await Promise.all([
    assetIds.size === 0
      ? Promise.resolve<AssetDocument[]>([])
      : assetsRepository.forScope(scope).find(undefined, {
          where: { _id: { $in: [...assetIds.values()] } },
          select: ["_id", "name"],
          limit: assetIds.size,
        }),
    skipTechnicians
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
 * `defineAction` already resolved, instead of authenticating a second time —
 * one implementation, so a page load and a client-side page change can never
 * return different things.
 */
export async function listWorkOrdersForScope(
  scope: TenantScope,
  params: ListWorkOrdersInput = {},
): Promise<Page<WorkOrderSummary>> {
  const { page, pageSize, status, priority, assetId, technicianId } =
    listWorkOrdersSchema.parse(params);

  // The schema guarantees 24 hex characters, so these cannot fail — but the
  // filter takes an ObjectId, and coercing here rather than casting keeps the
  // "an unparseable id matches nothing" behaviour the rest of the DAL has.
  const assetFilter = assetId ? toObjectId(assetId) : null;
  const technicianFilter = technicianId ? toObjectId(technicianId) : null;

  await connectToDatabase();

  const result = await workOrdersRepository.forScope(scope).paginate({
    page,
    pageSize,
    /**
     * Everything is an untrusted value and everything goes in `filter`, which
     * the DAL sanitizes and rejects operators from. Nothing goes in `where`:
     * unlike preventive, no filter on this screen needs a code-authored
     * fragment, because no status here is derived from the clock.
     */
    filter: {
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(assetFilter ? { assetId: assetFilter } : {}),
      ...(technicianFilter ? { technicianId: technicianFilter } : {}),
    },
    /**
     * Newest first. Deliberately NOT by priority: the stored values are enum
     * NAMES, so a database sort would order them CRITICAL, HIGH, LOW, MEDIUM —
     * alphabetical, and wrong in the one position that matters. Ordering by
     * urgency is what the priority tiles are for; they filter to one severity
     * and the list then reads newest-first within it, which is the order a
     * person actually triages in. Making the database sort correctly would mean
     * storing a numeric rank beside the name, and a second representation of
     * the same fact is a thing to keep in step for a sort nobody asked for.
     *
     * The sort key is in `{ organizationId, status, createdAt }` and
     * `{ organizationId, priority, createdAt }`, so the filtered lists are a
     * walk of an index rather than an in-memory sort.
     */
    sort: { createdAt: -1 },
  });

  const { assets, technicians } = await namesFor(scope, result.items);

  return mapPage(result, (document) =>
    toWorkOrderSummary(
      document,
      assets.get(document.assetId.toHexString()) ?? null,
      document.technicianId
        ? (technicians.get(document.technicianId.toHexString()) ?? null)
        : null,
    ),
  );
}

export async function listWorkOrders(
  params: ListWorkOrdersInput = {},
): Promise<Page<WorkOrderSummary>> {
  const { scope } = await requireRole(...WORK_ORDER_READERS);
  return listWorkOrdersForScope(scope, params);
}

// ---------------------------------------------------------------------------
// The priority tiles
// ---------------------------------------------------------------------------

/**
 * How much unfinished work sits at each priority, and how much of it nobody
 * owns yet.
 *
 * One aggregation for all four tiles, built inside the DAL from a `$match` that
 * layer had already scoped. See `countWorkOrdersByPriority`.
 */
export async function summariseWorkOrdersForScope(
  scope: TenantScope,
): Promise<WorkOrderPriorityCount[]> {
  await connectToDatabase();
  return countWorkOrdersByPriority(scope);
}

export async function summariseWorkOrders(): Promise<WorkOrderPriorityCount[]> {
  const { scope } = await requireRole(...WORK_ORDER_READERS);
  return summariseWorkOrdersForScope(scope);
}
