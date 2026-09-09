import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  assetNamesFor,
  connectToDatabase,
  countWorkOrdersByStatus,
  maintenanceTrend,
  ppmSchedulesRepository,
  summariseAssets,
  summarisePpmCompliance,
  workOrdersRepository,
  type MaintenanceTrendPoint,
  type TenantScope,
  type WorkOrderStatusCount,
} from "@/lib/db";
import { isOpenStatus, WORK_ORDER_STATUSES } from "@/lib/domain/corrective";
import { addUtcDays, startOfUtcDay } from "@/lib/domain/dates";
import { effectiveStatus, UPCOMING_WINDOW_DAYS } from "@/lib/domain/preventive";
import type { PpmDisplayStatus } from "@/lib/domain/preventive";

/**
 * The dashboard's reads.
 *
 * Every figure on the screen comes from a SCOPED aggregation — see
 * `src/lib/db/repositories/analytics.ts` for the pipelines and why each `$match`
 * is provably tenant-scoped. Nothing here filters anything itself; it composes
 * the pieces and shapes them for the browser.
 *
 * `requireRole()` is the only way to obtain the `TenantScope` these take, so
 * "checked the caller" and "scoped the query" are one step.
 */

/**
 * Who may open the staff dashboard.
 *
 * The four staff roles, and NOT client — the same list `src/lib/nav/modules.ts`
 * gives `/app`, which sends a CLIENT session to `/app/portal` instead through
 * `clientHref`. That redirect is not cosmetic: this screen aggregates preventive
 * maintenance, and `ppmSchedulesRepository` refuses a client scope outright.
 */
export const DASHBOARD_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
];

/** The four KPI figures, ready for the browser. */
export interface DashboardKpis {
  totalAssets: number;
  activeAssets: number;
  /** 0–100. NULL when nothing has fallen due — not the same as zero. */
  ppmCompliance: number | null;
  ppmDue: number;
  ppmCompleted: number;
  openWorkOrders: number;
  criticalWorkOrders: number;
  /** Visits due inside the next seven days. */
  upcomingPpm: number;
  /** 0–100. NULL when the tenant has no assets. */
  averageHealth: number | null;
}

/** One row of the "what is coming up" list. */
export interface UpcomingVisit {
  id: string;
  assetId: string;
  assetName: string | null;
  type: string;
  /** ISO 8601. A Date does not survive the boundary. */
  dueDate: string;
  /** Computed on the SERVER, so the badge cannot disagree with the row. */
  displayStatus: PpmDisplayStatus;
}

export interface DashboardData {
  kpis: DashboardKpis;
  workOrdersByStatus: { status: string; count: number }[];
  trend: MaintenanceTrendPoint[];
  upcoming: UpcomingVisit[];
  /** How many rows the AI strip should say are worth a look. */
  alerts: { overduePpm: number; criticalOpen: number };
}

/**
 * Everything the dashboard needs, in one pass.
 *
 * Issued together with `Promise.all` rather than sequentially: they are
 * independent reads against different collections, and the page cannot paint
 * until the slowest one lands either way. Seven round trips in parallel is one
 * round trip of wall-clock.
 *
 * `now` is threaded through every call rather than read seven times, so the
 * "overdue" a KPI counts and the badge on a row in the list beneath it are
 * answering with the same midnight.
 */
export async function loadDashboardForScope(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<DashboardData> {
  await connectToDatabase();

  const today = startOfUtcDay(now);
  const horizon = addUtcDays(today, UPCOMING_WINDOW_DAYS);

  const [assets, ppm, byStatus, trend, openCount, criticalCount, overdueCount, upcomingRows] =
    await Promise.all([
      summariseAssets(scope),
      summarisePpmCompliance(scope, now, UPCOMING_WINDOW_DAYS),
      countWorkOrdersByStatus(scope, WORK_ORDER_STATUSES),
      maintenanceTrend(scope, now),

      /**
       * "Open" is every status that is not CLOSED, which is what `isOpenStatus`
       * means — counted with a code-authored `$in` in the TRUSTED `where`
       * channel rather than four separate counts.
       */
      workOrdersRepository.forScope(scope).count(undefined, {
        where: { status: { $in: WORK_ORDER_STATUSES.filter(isOpenStatus) } },
      }),

      workOrdersRepository.forScope(scope).count(
        { priority: "CRITICAL" },
        { where: { status: { $in: WORK_ORDER_STATUSES.filter(isOpenStatus) } } },
      ),

      ppmSchedulesRepository.forScope(scope).count(undefined, {
        // Overdue: due before today and not completed. Both terms are
        // code-authored; `today` was computed above.
        where: { dueDate: { $lt: today }, status: { $ne: "COMPLETED" } },
      }),

      /**
       * The next seven days of planned work, soonest first.
       *
       * Capped at eight rows: this is a summary strip on a dashboard, and the
       * full list is one click away at /app/preventive. An uncapped read here
       * would be an unbounded query on the busiest screen in the product.
       */
      ppmSchedulesRepository.forScope(scope).find(undefined, {
        where: { dueDate: { $gte: today, $lt: horizon }, status: { $ne: "COMPLETED" } },
        sort: { dueDate: 1 },
        limit: 8,
        select: ["_id", "assetId", "type", "dueDate", "status"],
      }),
    ]);

  const assetNames = await assetNamesFor(
    scope,
    upcomingRows.map((row) => row.assetId),
  );

  return {
    kpis: {
      totalAssets: assets.total,
      activeAssets: assets.active,
      ppmCompliance: ppm.compliance,
      ppmDue: ppm.due,
      ppmCompleted: ppm.completed,
      openWorkOrders: openCount,
      criticalWorkOrders: criticalCount,
      upcomingPpm: ppm.upcoming,
      averageHealth: assets.averageHealth,
    },
    workOrdersByStatus: byStatus.map((entry: WorkOrderStatusCount) => ({
      status: entry.status,
      count: entry.count,
    })),
    trend,
    upcoming: upcomingRows.map((row) => ({
      id: row._id.toHexString(),
      assetId: row.assetId.toHexString(),
      assetName: assetNames.get(row.assetId.toHexString()) ?? null,
      type: row.type,
      dueDate: row.dueDate.toISOString(),
      // Derived on the SERVER and shipped as data: a browser whose clock is a
      // day out would otherwise render a different badge than the server did.
      displayStatus: effectiveStatus(row.status, row.dueDate, now),
    })),
    alerts: { overduePpm: overdueCount, criticalOpen: criticalCount },
  };
}

export async function loadDashboard(): Promise<DashboardData> {
  const { scope } = await requireRole(...DASHBOARD_READERS);
  return loadDashboardForScope(scope);
}

// ---------------------------------------------------------------------------
// The client portal's figures
// ---------------------------------------------------------------------------

/**
 * What a CLIENT session sees on its own home screen.
 *
 * A DIFFERENT function rather than the staff one with a flag, and the difference
 * is the point: a client's figures are drawn only from the collections a client
 * scope can legally reach. Preventive maintenance is absent entirely — the
 * repository refuses a client scope, because a PPM plan is the provider's
 * internal schedule — so there is no compliance figure here to accidentally
 * widen.
 *
 * Every read below goes through the same DAL that appends `clientId` to the
 * filter last, so the narrowing is the repository's, not this function's.
 */
export interface PortalKpis {
  assets: number;
  openWorkOrders: number;
  criticalWorkOrders: number;
  averageHealth: number | null;
  trend: MaintenanceTrendPoint[];
  workOrdersByStatus: { status: string; count: number }[];
}

export async function loadPortalKpisForScope(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<PortalKpis> {
  await connectToDatabase();

  const [assets, byStatus, trend, openCount, criticalCount] = await Promise.all([
    summariseAssets(scope),
    countWorkOrdersByStatus(scope, WORK_ORDER_STATUSES),
    maintenanceTrend(scope, now),
    workOrdersRepository.forScope(scope).count(undefined, {
      where: { status: { $in: WORK_ORDER_STATUSES.filter(isOpenStatus) } },
    }),
    workOrdersRepository.forScope(scope).count(
      { priority: "CRITICAL" },
      { where: { status: { $in: WORK_ORDER_STATUSES.filter(isOpenStatus) } } },
    ),
  ]);

  return {
    assets: assets.total,
    openWorkOrders: openCount,
    criticalWorkOrders: criticalCount,
    averageHealth: assets.averageHealth,
    trend,
    workOrdersByStatus: byStatus.map((entry) => ({ status: entry.status, count: entry.count })),
  };
}

export async function loadPortalKpis(): Promise<PortalKpis> {
  const { scope } = await requireRole("CLIENT");
  return loadPortalKpisForScope(scope);
}
