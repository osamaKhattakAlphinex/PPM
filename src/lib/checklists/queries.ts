import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  assetsRepository,
  checklistRunsRepository,
  checklistsRepository,
  connectToDatabase,
  mapPage,
  ppmSchedulesRepository,
  prefixFilter,
  toObjectId,
  workOrdersRepository,
  type ChecklistRunDocument,
  type Page,
  type TenantScope,
} from "@/lib/db";
import type { ChecklistJobType } from "@/lib/domain/checklists";
import {
  toChecklistRunSummary,
  toChecklistSummary,
  type ChecklistRunSummary,
  type ChecklistSummary,
} from "./dto";
import {
  listChecklistRunsSchema,
  listChecklistsSchema,
  type ListChecklistRunsInput,
  type ListChecklistsInput,
} from "./schemas";

/**
 * The read side of checklists.
 *
 * Server Components call these directly (CLAUDE.md prefers Server Components
 * for reads); the list actions in `actions.ts` are thin wrappers over the same
 * functions, so a page load and a client-side page change cannot diverge in
 * what they are allowed to return.
 *
 * Every exported entry point starts with `requireRole()`, which is also the
 * only way to obtain the `TenantScope` the repositories need — so "checked the
 * caller" and "scoped the query" are one step and cannot come apart.
 */

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

/**
 * Every STAFF role reads the library, and CLIENT does not.
 *
 * This is the same list `nav/modules.ts` gives the route, and that is not a
 * coincidence to be maintained by hand: a route open to a role whose queries
 * the DAL would refuse is a 500, not a security boundary. Neither `Checklist`
 * nor `ChecklistRun` has a `clientId`, so both repositories refuse a
 * client-scoped session outright rather than widening it to the organization —
 * and a provider's method statements are its own working documents, not
 * something a customer browses.
 */
export const CHECKLIST_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
];

/**
 * Who writes the procedures.
 *
 * SUPERVISOR is included for the reason `nav/modules.ts` gives in its note on
 * AMC — "a supervisor schedules work; they do not price it". Writing the method
 * statement for a quarterly service is squarely scheduling work, and the
 * supervisor is the person who knows what the site actually needs.
 *
 * TECHNICIAN is excluded, and that is the line that matters: the people who
 * CARRY OUT a procedure must not be the people who decide what it contains. A
 * technician who could edit a template could delete the step they would rather
 * not do, and the run would still come back green.
 */
export const CHECKLIST_MANAGERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
];

/**
 * Who attaches a checklist to a job and ticks it off.
 *
 * Every reader, because the person holding the phone in the plant room is the
 * technician. As on preventive and corrective, the assignment on the job is
 * advisory rather than enforced: a `Technician` record is not a `User` (most
 * never sign in), so "is this my job?" cannot be answered from the session
 * alone. When a technician's own account is reliably linked, this narrows to
 * "the assignee, or a supervisor" — until then, a rule that pretended to check
 * it would be theatre.
 */
export const CHECKLIST_RUNNERS: readonly [Role, ...Role[]] = CHECKLIST_READERS;

export function canManageChecklists(role: Role): boolean {
  return (CHECKLIST_MANAGERS as readonly Role[]).includes(role);
}

export function canRunChecklists(role: Role): boolean {
  return (CHECKLIST_RUNNERS as readonly Role[]).includes(role);
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

/**
 * The scope-taking half. Exported so `actions.ts` can reuse it with the scope
 * `defineAction` already resolved, instead of authenticating a second time —
 * one implementation, so a page load and a client-side page change can never
 * return different things.
 */
export async function listChecklistsForScope(
  scope: TenantScope,
  params: ListChecklistsInput = {},
): Promise<Page<ChecklistSummary>> {
  const { page, pageSize, category, q } = listChecklistsSchema.parse(params);

  await connectToDatabase();

  const result = await checklistsRepository.forScope(scope).paginate({
    page,
    pageSize,
    /**
     * The category is an untrusted value and goes in `filter`, which the DAL
     * sanitizes and rejects operators from. The search term is the one input
     * that must become a query OPERATOR, so it goes through `prefixFilter` into
     * the TRUSTED `where` channel — escaped and anchored there, which is the
     * only way a user string is allowed near a `$regex` in this codebase. The
     * scope keys are applied after both and always win.
     */
    filter: category ? { category } : {},
    ...(q ? { where: prefixFilter("name", q) } : {}),
    /**
     * Alphabetical. Deliberately NOT by `lastUsedAt`, tempting as it is: a
     * library that reorders itself as people use it is one where the row you
     * reached for last week has moved. The sort key is in
     * `{ organizationId, name }` and `{ organizationId, category, name }`, so
     * both the plain and the filtered list are a walk of an index rather than
     * an in-memory sort, and the anchored prefix search rides the same one.
     */
    sort: { name: 1 },
  });

  return mapPage(result, toChecklistSummary);
}

export async function listChecklists(
  params: ListChecklistsInput = {},
): Promise<Page<ChecklistSummary>> {
  const { scope } = await requireRole(...CHECKLIST_READERS);
  return listChecklistsForScope(scope, params);
}

// ---------------------------------------------------------------------------
// Job labels
// ---------------------------------------------------------------------------

/**
 * Resolve a human name for the job behind each run on one page.
 *
 * Second SCOPED reads rather than a `populate()`, for the reason the DAL's own
 * header gives: a join is reached under MongoDB's rules rather than ours and
 * would cross into a collection nothing had scoped. The ids here came out of a
 * query that was already scoped, and the lookups are scoped again on the way
 * back — so the `$in` fragment is genuinely code-authored even though the ids
 * are data.
 *
 * Three reads at most, and their shape is dictated by the polymorphism:
 *
 *  - PPM runs point at a `PpmSchedule`, which has no name of its own. What a
 *    person calls that visit is the asset it maintains, so the schedules are
 *    read for their `assetId` and the assets for their `name` — two hops.
 *  - WORK_ORDER runs point at a `WorkOrder`, whose `issue` text IS the label a
 *    person uses. One hop.
 *
 * The two asset lookups are merged into one `$in`, because a tenant running
 * checklists against both kinds of job will usually be running them against
 * overlapping equipment.
 *
 * A missing job yields a null label rather than an error. A run OUTLIVES its
 * job by design — everything it needs to be read as a record was snapshot onto
 * it — so "the visit was deleted" must render as a run with no job name, not as
 * a broken page.
 */
async function jobLabelsFor(
  scope: TenantScope,
  documents: readonly ChecklistRunDocument[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();

  // Deduplicated by hex string, collected as ObjectIds. Mongoose would cast the
  // strings for us, but handing the driver the type the field actually stores
  // keeps the `$in` a plain index lookup with nothing left to infer. The id type
  // is derived from the document rather than imported from mongoose: feature
  // code must not reach the driver, and the DAL-boundary lint rule enforces that
  // for type imports too.
  type JobId = ChecklistRunDocument["jobId"];
  const scheduleIds = new Map<string, JobId>();
  const workOrderIds = new Map<string, JobId>();

  for (const document of documents) {
    const bucket = document.jobType === "PPM" ? scheduleIds : workOrderIds;
    bucket.set(document.jobId.toHexString(), document.jobId);
  }

  const [schedules, workOrders] = await Promise.all([
    scheduleIds.size === 0
      ? Promise.resolve([])
      : ppmSchedulesRepository.forScope(scope).find(undefined, {
          where: { _id: { $in: [...scheduleIds.values()] } },
          select: ["_id", "assetId"],
          limit: scheduleIds.size,
        }),
    workOrderIds.size === 0
      ? Promise.resolve([])
      : workOrdersRepository.forScope(scope).find(undefined, {
          where: { _id: { $in: [...workOrderIds.values()] } },
          select: ["_id", "issue"],
          limit: workOrderIds.size,
        }),
  ]);

  // A work order says what it is in its own words.
  for (const workOrder of workOrders) {
    labels.set(workOrder._id.toHexString(), workOrder.issue);
  }

  if (schedules.length > 0) {
    const assetIds = new Map<string, (typeof schedules)[number]["assetId"]>();
    for (const schedule of schedules) {
      assetIds.set(schedule.assetId.toHexString(), schedule.assetId);
    }

    const assets = await assetsRepository.forScope(scope).find(undefined, {
      where: { _id: { $in: [...assetIds.values()] } },
      select: ["_id", "name"],
      limit: assetIds.size,
    });

    const assetNames = new Map(assets.map((asset) => [asset._id.toHexString(), asset.name]));

    for (const schedule of schedules) {
      const name = assetNames.get(schedule.assetId.toHexString());
      if (name) labels.set(schedule._id.toHexString(), name);
    }
  }

  return labels;
}

// ---------------------------------------------------------------------------
// The runs
// ---------------------------------------------------------------------------

export async function listChecklistRunsForScope(
  scope: TenantScope,
  params: ListChecklistRunsInput = {},
): Promise<Page<ChecklistRunSummary>> {
  const { page, pageSize, checklistId, status, jobType, jobId } =
    listChecklistRunsSchema.parse(params);

  // The schema guarantees 24 hex characters, so these cannot fail — but the
  // filter takes an ObjectId, and coercing here rather than casting keeps the
  // "an unparseable id matches nothing" behaviour the rest of the DAL has.
  const checklistFilter = checklistId ? toObjectId(checklistId) : null;
  const jobFilter = jobId ? toObjectId(jobId) : null;

  await connectToDatabase();

  const result = await checklistRunsRepository.forScope(scope).paginate({
    page,
    pageSize,
    /**
     * Everything is an untrusted value and everything goes in `filter`, which
     * the DAL sanitizes and rejects operators from. Nothing needs a
     * code-authored fragment here: no status on a run is derived from the
     * clock, so every filter is a plain equality on a stored value.
     *
     * `jobType` and `jobId` are applied together or not at all — the schema's
     * refinement has already refused the half-specified case, so there is no
     * partial filter to guard against here.
     */
    filter: {
      ...(checklistFilter ? { checklistId: checklistFilter } : {}),
      ...(status ? { status } : {}),
      ...(jobType ? { jobType } : {}),
      ...(jobFilter ? { jobId: jobFilter } : {}),
    },
    /**
     * Newest first — a run list is a log, and the useful end of a log is the
     * recent one. The sort key is in `{ organizationId, status, createdAt }`
     * and `{ organizationId, checklistId, createdAt }`, so the filtered lists
     * are a walk of an index rather than an in-memory sort.
     */
    sort: { createdAt: -1 },
  });

  const labels = await jobLabelsFor(scope, result.items);

  return mapPage(result, (document) =>
    toChecklistRunSummary(document, labels.get(document.jobId.toHexString()) ?? null),
  );
}

export async function listChecklistRuns(
  params: ListChecklistRunsInput = {},
): Promise<Page<ChecklistRunSummary>> {
  const { scope } = await requireRole(...CHECKLIST_READERS);
  return listChecklistRunsForScope(scope, params);
}

/**
 * Every checklist attached to one job.
 *
 * Exported for the preventive and corrective screens, which will show their
 * attached checklists inline rather than sending a technician to another
 * module. It is a thin wrapper on purpose: those screens get the same scoping,
 * the same role gate and the same DTO as this one, so a run cannot mean
 * something different depending on where it is read.
 *
 * The role list is CHECKLIST_READERS rather than each caller's own, and the
 * distinction is real: a CLIENT may read a work order, but must not read the
 * runs attached to it. A caller that forwarded its own gate would open exactly
 * that hole. Callers should therefore not render this section for a client
 * session — the DAL would refuse the read anyway, which is the fail-closed
 * backstop rather than the plan.
 */
export async function listChecklistRunsForJob(
  jobType: ChecklistJobType,
  jobId: string,
): Promise<Page<ChecklistRunSummary>> {
  const { scope } = await requireRole(...CHECKLIST_READERS);
  return listChecklistRunsForScope(scope, { jobType, jobId, pageSize: 20 });
}

/**
 * One run, resolved the same way a list row is.
 *
 * Used by the actions to return the run they just changed, so the sheet
 * re-renders from exactly the shape the list would have produced.
 */
export async function toRunSummaryForScope(
  scope: TenantScope,
  document: ChecklistRunDocument,
): Promise<ChecklistRunSummary> {
  const labels = await jobLabelsFor(scope, [document]);
  return toChecklistRunSummary(document, labels.get(document.jobId.toHexString()) ?? null);
}
