import { Types } from "mongoose";

import { addUtcDays, startOfUtcDay } from "../../domain/dates";
import type { WorkOrderStatus } from "../../domain/corrective";
import { Asset } from "../models/asset";
import { PpmSchedule } from "../models/ppm-schedule";
import { WorkOrder } from "../models/work-order";
import { assetsRepository } from "./assets";
import { ppmSchedulesRepository } from "./ppm-schedules";
import { workOrdersRepository } from "./work-orders";
import { isClientScope, type TenantScope } from "../scope";

/**
 * The cross-collection aggregations the dashboard and the reports are built on.
 *
 * They live INSIDE `src/lib/db/**` for the reason the DAL's own header gives:
 * `Model.aggregate` is forbidden anywhere else, because a pipeline is reached
 * under MongoDB's rules rather than ours, so the one place it may be written is
 * the layer that can prove the first stage is scoped.
 *
 * And every pipeline here is proven, not asserted. Each `$match` is a
 * `matchStage()` from the collection's own repository — the same filter `find()`
 * builds, with `organizationId` (and `clientId` for a client session) applied
 * last where nothing can displace it, and `deletedAt: null` already in place.
 * The base plugin does NOT filter aggregations, so that last part is doing real
 * work: without it a soft-deleted asset would keep moving the KPI.
 *
 * There is no `$lookup` anywhere in this file, deliberately. A join is the one
 * thing that would cross a collection boundary under MongoDB's rules rather
 * than ours — the joined collection's own scope would never be applied. Where
 * two collections are needed the answer is two scoped pipelines and arithmetic
 * in TypeScript, which is what `ppmComplianceFor` does.
 */

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface AssetHealthSummary {
  readonly total: number;
  readonly active: number;
  readonly inMaintenance: number;
  /** 0–100, rounded. NULL when there are no assets — not the same as zero. */
  readonly averageHealth: number | null;
}

const EMPTY_ASSET_SUMMARY: AssetHealthSummary = Object.freeze({
  total: 0,
  active: 0,
  inMaintenance: 0,
  averageHealth: null,
});

export async function summariseAssets(scope: TenantScope): Promise<AssetHealthSummary> {
  const rows = await Asset.aggregate<AssetHealthSummary & { _id: null }>([
    { $match: assetsRepository.forScope(scope).matchStage() },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] } },
        inMaintenance: { $sum: { $cond: [{ $eq: ["$status", "MAINTENANCE"] }, 1, 0] } },
        averageHealth: { $avg: "$health" },
      },
    },
  ]).exec();

  const row = rows[0];
  if (!row) return EMPTY_ASSET_SUMMARY;

  return {
    total: row.total,
    active: row.active,
    inMaintenance: row.inMaintenance,
    averageHealth: typeof row.averageHealth === "number" ? Math.round(row.averageHealth) : null,
  };
}

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

export interface WorkOrderStatusCount {
  readonly status: WorkOrderStatus;
  readonly count: number;
}

/**
 * How many work orders sit in each status — the donut.
 *
 * Returns a row per status INCLUDING the empty ones, so the chart's legend and
 * its colour assignment stay stable as work moves. A donut whose slices
 * renumber themselves when a category empties is a donut nobody can read twice.
 */
export async function countWorkOrdersByStatus(
  scope: TenantScope,
  statuses: readonly WorkOrderStatus[],
): Promise<WorkOrderStatusCount[]> {
  const rows = await WorkOrder.aggregate<{ _id: WorkOrderStatus; count: number }>([
    { $match: workOrdersRepository.forScope(scope).matchStage() },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).exec();

  const counts = new Map(rows.map((row) => [row._id, row.count]));
  return statuses.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

// ---------------------------------------------------------------------------
// PM compliance
// ---------------------------------------------------------------------------

export interface PpmComplianceSummary {
  /** Visits whose due date has passed: the denominator. */
  readonly due: number;
  /** Of those, the ones actually completed. */
  readonly completed: number;
  /** Of those, the ones still not done. `due - completed`. */
  readonly missed: number;
  /** completed / due as a percentage, rounded. NULL when nothing was due. */
  readonly compliance: number | null;
  /** Scheduled inside the next `windowDays`, for the "upcoming" KPI. */
  readonly upcoming: number;
}

const EMPTY_PPM_SUMMARY: PpmComplianceSummary = Object.freeze({
  due: 0,
  completed: 0,
  missed: 0,
  compliance: null,
  upcoming: 0,
});

/**
 * PM compliance: of the visits that have fallen due, how many were done.
 *
 * The definition is the argument, so it is stated here rather than left to the
 * reader:
 *
 *  - The DENOMINATOR is visits whose `dueDate` has passed. A visit due next
 *    Tuesday is not a compliance failure this morning, and counting it as one
 *    would make the figure fall every time somebody schedules work — which is
 *    the opposite of what the number is for.
 *  - The NUMERATOR is those that are COMPLETED. `IN_PROGRESS` counts as not
 *    done: a visit somebody started three weeks ago and never finished is
 *    exactly the case an FM contract penalises.
 *  - `upcoming` is a separate figure over a separate window and is deliberately
 *    NOT part of the ratio.
 *
 * A CLIENT scope must never reach this: `ppmSchedulesRepository` has no
 * `clientId` and is not `sharedWithClients`, so `matchStage()` would throw a
 * `ScopeResolutionError` — the fail-closed direction. The guard is explicit
 * rather than inherited so the failure is a clear empty summary on a screen
 * rather than a 500 three layers down.
 */
export async function summarisePpmCompliance(
  scope: TenantScope,
  now: Date = new Date(),
  windowDays = 7,
): Promise<PpmComplianceSummary> {
  if (isClientScope(scope)) return EMPTY_PPM_SUMMARY;

  const today = startOfUtcDay(now);
  const horizon = addUtcDays(today, windowDays);

  const isDue = { $lt: ["$dueDate", today] };
  const isCompleted = { $eq: ["$status", "COMPLETED"] };

  const rows = await PpmSchedule.aggregate<{
    _id: null;
    due: number;
    completed: number;
    upcoming: number;
  }>([
    { $match: ppmSchedulesRepository.forScope(scope).matchStage() },
    {
      $group: {
        _id: null,
        due: { $sum: { $cond: [isDue, 1, 0] } },
        completed: { $sum: { $cond: [{ $and: [isDue, isCompleted] }, 1, 0] } },
        upcoming: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$status", "COMPLETED"] },
                  { $gte: ["$dueDate", today] },
                  { $lt: ["$dueDate", horizon] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]).exec();

  const row = rows[0];
  if (!row) return EMPTY_PPM_SUMMARY;

  return {
    due: row.due,
    completed: row.completed,
    missed: row.due - row.completed,
    // NULL, not 100: "nothing has fallen due yet" and "everything due was done"
    // are different statements, and a new tenant must not be shown a perfect
    // score it has not earned.
    compliance: row.due === 0 ? null : Math.round((row.completed / row.due) * 100),
    upcoming: row.upcoming,
  };
}

// ---------------------------------------------------------------------------
// The six-month trend
// ---------------------------------------------------------------------------

/** One month of the trend: how much planned work and how much reactive. */
export interface MaintenanceTrendPoint {
  /** `YYYY-MM`, UTC. A month is a bucket, not an instant. */
  readonly month: string;
  readonly preventive: number;
  readonly corrective: number;
}

/**
 * The first day, UTC, of the month `monthsBack` months before `now`.
 *
 * Written with `Date.UTC` rather than `setUTCMonth`, which OVERFLOWS: 31 March
 * minus one month becomes 3 March. Only the year and month are used here, so
 * the day is pinned to 1 and the overflow cannot arise.
 */
function startOfUtcMonth(now: Date, monthsBack: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Planned versus reactive work, month by month, for the last `months` months
 * including the current one.
 *
 * TWO pipelines rather than one, and no `$lookup` between them: they are
 * different collections with different scoping rules — work orders are
 * client-partitioned and PPM schedules are provider-internal — so joining them
 * would mean reaching one of them under the other's scope. They are summed
 * separately, each from its own `matchStage()`, and combined in TypeScript.
 *
 * The buckets are built from the CLOCK, not from the data, so a month with no
 * work of either kind still appears as a zero. A trend line that silently skips
 * an empty month is a trend line that lies about its own slope.
 *
 * A CLIENT scope gets corrective counts only; the preventive series is all
 * zeroes rather than an error, for the same fail-closed reason
 * `summarisePpmCompliance` returns an empty summary.
 */
export async function maintenanceTrend(
  scope: TenantScope,
  now: Date = new Date(),
  months = 6,
): Promise<MaintenanceTrendPoint[]> {
  const from = startOfUtcMonth(now, months - 1);

  /**
   * The bucket keys, in order, built from the clock.
   */
  const keys: string[] = [];
  for (let index = months - 1; index >= 0; index -= 1) {
    keys.push(monthKey(startOfUtcMonth(now, index)));
  }

  /**
   * `$dateToString` on the driver rather than `$year`/`$month` and a join in
   * JavaScript: one string key per document, formatted the same way
   * `monthKey()` formats the bucket, so the two cannot disagree about
   * zero-padding. `timezone` is pinned to UTC because every date in this system
   * is a UTC day (see `src/lib/domain/dates.ts`); leaving it to the server's
   * locale would put a job created at 21:00 in Riyadh into the wrong month.
   */
  const groupByMonth = (field: string) => [
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: field, timezone: "UTC" } },
        count: { $sum: 1 },
      },
    },
  ];

  const correctiveRows = await WorkOrder.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        // Scope first, then the window. `matchStage()` applies organizationId
        // last within itself, and spreading it here cannot displace that: the
        // only key added is `createdAt`, which the scope never sets.
        ...workOrdersRepository.forScope(scope).matchStage(),
        createdAt: { $gte: from },
      },
    },
    ...groupByMonth("$createdAt"),
  ]).exec();

  const preventiveRows = isClientScope(scope)
    ? []
    : await PpmSchedule.aggregate<{ _id: string; count: number }>([
        {
          $match: {
            ...ppmSchedulesRepository.forScope(scope).matchStage(),
            dueDate: { $gte: from },
          },
        },
        // Bucketed by DUE date rather than creation date: a PPM plan is
        // typically created a year in advance, so bucketing by `createdAt`
        // would draw twelve months of work as one spike in January.
        ...groupByMonth("$dueDate"),
      ]).exec();

  const corrective = new Map(correctiveRows.map((row) => [row._id, row.count]));
  const preventive = new Map(preventiveRows.map((row) => [row._id, row.count]));

  return keys.map((month) => ({
    month,
    preventive: preventive.get(month) ?? 0,
    corrective: corrective.get(month) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Asset names, for the lists that need them
// ---------------------------------------------------------------------------

/**
 * Resolve asset names for a set of ids, through the SCOPED repository.
 *
 * A second scoped read rather than a `$lookup`, for the reason at the top of
 * this file. The ids come out of a query that was already scoped and the lookup
 * is scoped again on the way back, so an id that somehow named another tenant's
 * asset would resolve to nothing rather than to a name.
 */
export async function assetNamesFor(
  scope: TenantScope,
  ids: readonly Types.ObjectId[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;

  const unique = new Map<string, Types.ObjectId>();
  for (const id of ids) unique.set(id.toHexString(), id);

  const assets = await assetsRepository.forScope(scope).find(undefined, {
    where: { _id: { $in: [...unique.values()] } },
    select: ["_id", "name"],
    limit: unique.size,
  });

  for (const asset of assets) names.set(asset._id.toHexString(), asset.name);
  return names;
}
