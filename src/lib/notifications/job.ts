import "server-only";

import type { Role } from "@/lib/auth/roles";
import {
  connectToDatabase,
  contractsRepository,
  listActiveOrganizationIds,
  notificationsRepository,
  ppmSchedulesRepository,
  systemScopeForOrganization,
  type TenantScope,
} from "@/lib/db";
import { addUtcDays, startOfUtcDay } from "@/lib/domain/dates";
import { CONTRACT_NOTICE_DAYS, dedupeKeyFor } from "@/lib/domain/notifications";

/**
 * The nightly job: overdue planned visits, and contracts about to run out.
 *
 * ## Each organisation is processed under its own scope
 *
 * This is the property that matters and it is structural rather than careful.
 * The job's ONE unscoped read is `listActiveOrganizationIds()`, which returns
 * ids and nothing else. Every read and write after that goes through the
 * ordinary repositories under a `TenantScope` built for one organisation at a
 * time — so there is no query anywhere in this file that could see two tenants,
 * and no notification that could be written into the wrong one.
 *
 * The per-organisation loop is also the error boundary: one tenant with a
 * malformed row must not stop the other four hundred from being processed, so
 * each iteration catches and records rather than throwing.
 *
 * ## It is safe to run twice
 *
 * Every notification carries a `dedupeKey` (`kind:refId:bucket`) and the
 * collection has a partial unique index on `{ organizationId, dedupeKey }`. A
 * duplicate insert is refused by the DATABASE, not by a read-then-write this
 * job performs — which is what makes two concurrent runs, or a retry after a
 * timeout, produce one row rather than two.
 */

/** How many rows of each kind one tenant may produce in a single run. */
const PER_TENANT_LIMIT = 200;

/** Who each kind of notification is for. */
const PPM_AUDIENCE: readonly Role[] = ["ADMIN", "FM_MANAGER", "SUPERVISOR"];

/**
 * Contract expiry goes to management AND to the customer.
 *
 * The customer is included deliberately: a contract quietly lapsing is worse
 * for them than for the provider, and the notification carries the contract's
 * own `clientId`, so the DAL shows it to that customer and to nobody else.
 */
const CONTRACT_AUDIENCE: readonly Role[] = ["ADMIN", "FM_MANAGER", "CLIENT"];

export interface JobResult {
  /** Organisations that were looked at. */
  organizations: number;
  /** Notifications actually created — duplicates are not counted. */
  created: number;
  /** Duplicates the unique index refused. Expected, and not an error. */
  skipped: number;
  /** Organisations that failed. Named by id, so a run can be re-tried. */
  failed: string[];
}

/**
 * Create one notification, tolerating the duplicate the index refuses.
 *
 * The duplicate is the ORDINARY path on every run after the first, so it is
 * caught and counted rather than logged as a failure. Any other error is
 * re-thrown to the per-organisation boundary.
 */
async function createOnce(
  scope: TenantScope,
  input: Parameters<ReturnType<typeof notificationsRepository.forScope>["create"]>[0],
): Promise<"created" | "skipped"> {
  try {
    await notificationsRepository.forScope(scope).create(input);
    return "created";
  } catch (error) {
    // MongoServerError code 11000 — the partial unique index doing its job.
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return "skipped";
    }
    throw error;
  }
}

/** One organisation's overdue planned visits. */
async function notifyOverduePpm(
  scope: TenantScope,
  today: Date,
): Promise<{ created: number; skipped: number }> {
  const overdue = await ppmSchedulesRepository.forScope(scope).find(undefined, {
    // Code-authored: overdue is due before today and not completed.
    where: { dueDate: { $lt: today }, status: { $ne: "COMPLETED" } },
    sort: { dueDate: 1 },
    limit: PER_TENANT_LIMIT,
    select: ["_id", "assetId", "type", "dueDate"],
  });

  let created = 0;
  let skipped = 0;

  for (const visit of overdue) {
    const outcome = await createOnce(scope, {
      kind: "PPM_OVERDUE",
      // Urgent: a missed planned visit is the thing an AMC is measured on.
      severity: "URGENT",
      roles: PPM_AUDIENCE,
      // Preventive is provider-internal, so no counterparty. See the model.
      clientId: null,
      titleKey: "ppmOverdue",
      params: {
        frequency: visit.type,
        dueOn: visit.dueDate.toISOString().slice(0, 10),
      },
      refType: "PPM_SCHEDULE",
      refId: visit._id,
      // Bucketed by the DUE DATE, so one late visit notifies once however long
      // it stays late.
      dedupeKey: dedupeKeyFor("PPM_OVERDUE", visit._id.toHexString(), visit.dueDate),
    });

    if (outcome === "created") created += 1;
    else skipped += 1;
  }

  return { created, skipped };
}

/** One organisation's contracts inside the notice window. */
async function notifyExpiringContracts(
  scope: TenantScope,
  today: Date,
): Promise<{ created: number; skipped: number }> {
  const horizon = addUtcDays(today, CONTRACT_NOTICE_DAYS);

  const expiring = await contractsRepository.forScope(scope).find(
    { status: "ACTIVE" },
    {
      // The same window the AMC screen calls EXPIRING, so a bell can never fire
      // for a contract the screen still shows as healthy.
      where: { endDate: { $gte: today, $lt: horizon } },
      sort: { endDate: 1 },
      limit: PER_TENANT_LIMIT,
      select: ["_id", "clientId", "contractNumber", "title", "endDate"],
    },
  );

  let created = 0;
  let skipped = 0;

  for (const contract of expiring) {
    const daysLeft = Math.round(
      (startOfUtcDay(contract.endDate).getTime() - today.getTime()) / 86_400_000,
    );

    const outcome = await createOnce(scope, {
      kind: "CONTRACT_EXPIRING",
      // Not urgent: sixty days is exactly enough runway to re-quote and sign,
      // which is why the window is sixty days.
      severity: "INFO",
      roles: CONTRACT_AUDIENCE,
      // Carried from the contract, so the customer sees their own and no other.
      clientId: contract.clientId,
      titleKey: "contractExpiring",
      params: {
        contractNumber: contract.contractNumber,
        title: contract.title,
        days: daysLeft,
      },
      refType: "CONTRACT",
      refId: contract._id,
      // Bucketed by the END DATE: a renewed contract has a new one and is
      // therefore a new fact, which should notify again.
      dedupeKey: dedupeKeyFor(
        "CONTRACT_EXPIRING",
        contract._id.toHexString(),
        contract.endDate,
      ),
    });

    if (outcome === "created") created += 1;
    else skipped += 1;
  }

  return { created, skipped };
}

/**
 * Run the job across every active organisation.
 *
 * The scope for each is built by hand — `{ organizationId }` with no client —
 * which is the one place in the product outside `getScope()` that constructs
 * one. It is safe here for the reason the header gives: the id came from the
 * single unscoped read, and every query below it is scoped to exactly that one
 * tenant.
 */
export async function runNotificationJob(now: Date = new Date()): Promise<JobResult> {
  await connectToDatabase();

  const today = startOfUtcDay(now);
  /**
   * The one unscoped read in the whole job, and it returns ids and nothing
   * else. The type is inferred rather than annotated with `Types.ObjectId`: the
   * DAL-boundary lint rule forbids importing mongoose outside `src/lib/db/**`,
   * and that applies to a type import too — feature code that needed the driver
   * for a type would be feature code one step from needing it for a query.
   */
  const organizationIds = await listActiveOrganizationIds();

  const result: JobResult = {
    organizations: organizationIds.length,
    created: 0,
    skipped: 0,
    failed: [],
  };

  for (const organizationId of organizationIds) {
    /**
     * A staff-shaped scope for exactly this tenant. `systemScopeForOrganization`
     * is the one constructor of a scope without a session, and it takes a single
     * organisation id — so a job holding it can still only see one tenant, and
     * there is no "all organisations" scope for it to widen into.
     */
    const scope: TenantScope = systemScopeForOrganization(organizationId);

    try {
      const [ppm, contracts] = [
        await notifyOverduePpm(scope, today),
        await notifyExpiringContracts(scope, today),
      ];

      result.created += ppm.created + contracts.created;
      result.skipped += ppm.skipped + contracts.skipped;
    } catch (error) {
      /**
       * One tenant's failure must not stop the rest. Logged with the id so a
       * run can be re-tried for that tenant alone, and reported in the result
       * so a scheduler's success is not a lie.
       */
      console.error(`[notifications] org ${organizationId.toHexString()} failed`, error);
      result.failed.push(organizationId.toHexString());
    }
  }

  return result;
}
