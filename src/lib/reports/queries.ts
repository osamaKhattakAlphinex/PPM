import "server-only";

import { AuthorizationError, requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  assetNamesFor,
  assetsByCategory,
  assetsRepository,
  connectToDatabase,
  countWorkOrdersByStatus,
  findOwnClientForScope,
  getOrganizationForScope,
  isClientScope,
  maintenanceTrend,
  ppmByFrequency,
  ppmSchedulesRepository,
  summariseAssets,
  summariseContracts,
  summariseInvoices,
  summarisePpmCompliance,
  workOrdersRepository,
  type AssetCategoryRow,
  type MaintenanceTrendPoint,
  type PpmFrequencyRow,
  type TenantScope,
} from "@/lib/db";
import { isOpenStatus, WORK_ORDER_STATUSES } from "@/lib/domain/corrective";
import { halalasToSar } from "@/lib/domain/currency";
import { startOfUtcDay } from "@/lib/domain/dates";
import type { ReportKind } from "./kinds";
import { canRunReport as canRunReportFor, REPORT_ROLES as REPORT_ROLE_LISTS } from "./roles";

/**
 * The three reports: preventive maintenance, assets, and money.
 *
 * Each is ONE scoped read set, rendered twice — once as a printable page and
 * once as a PDF — from the same function, so the document somebody files and the
 * page they looked at cannot disagree. Nothing here filters anything itself:
 * every figure comes from an aggregation in
 * `src/lib/db/repositories/analytics.ts` whose `$match` is a repository
 * `matchStage()`, or from a scoped repository read.
 *
 * `requireRole()` is the only way to obtain the `TenantScope` these take, so
 * "checked the caller" and "scoped the query" are one step and cannot come
 * apart.
 */

/**
 * The role policy lives in `./roles.ts`, which is PURE — the report picker is a
 * Client Component and a unit test is neither server nor client, and neither
 * could import it from here. Re-exported so a server-side caller has one import.
 */
export { canRunReport, REPORT_ROLES, reportsForRole } from "./roles";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** What every report carries, whatever its body. */
export interface ReportEnvelope {
  kind: ReportKind;
  /** ISO 8601 — when the figures were taken. Printed on the document. */
  generatedAt: string;
  organizationName: string;
  organizationVatNumber: string | null;
  /** The client this is narrowed to, for a customer's own copy. */
  clientName: string | null;
}

export interface PmReport extends ReportEnvelope {
  kind: "PM";
  compliance: number | null;
  due: number;
  completed: number;
  missed: number;
  upcoming: number;
  byFrequency: PpmFrequencyRow[];
  /** The visits that are late, worst first. Capped — see the note below. */
  overdue: { id: string; assetName: string | null; type: string; dueDate: string }[];
}

export interface AssetReport extends ReportEnvelope {
  kind: "ASSET";
  total: number;
  active: number;
  inMaintenance: number;
  averageHealth: number | null;
  byCategory: AssetCategoryRow[];
  /** The equipment in the worst condition, worst first. */
  worst: { id: string; name: string; category: string; health: number; status: string }[];
  openWorkOrders: number;
}

export interface FinancialReport extends ReportEnvelope {
  kind: "FINANCIAL";
  /** Riyals — major units, converted once at this boundary. */
  invoiced: number;
  paid: number;
  pending: number;
  overdue: number;
  invoiceCount: number;
  overdueCount: number;
  contractValue: number;
  activeContracts: number;
  expiringContracts: number;
  averageCompliance: number | null;
  trend: MaintenanceTrendPoint[];
}

export type Report = PmReport | AssetReport | FinancialReport;

/**
 * How many rows a report's detail list may hold.
 *
 * A cap rather than everything, and it is a real limit rather than a rounding:
 * a report is a summary somebody reads, and a tenant with four thousand overdue
 * visits needs the module's own filtered list, not a forty-page PDF. The cap
 * also stops an unbounded read from a route anyone signed in can call.
 */
const DETAIL_ROWS = 25;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function envelopeFor(
  scope: TenantScope,
  kind: ReportKind,
  now: Date,
): Promise<ReportEnvelope> {
  const [organization, ownClient] = await Promise.all([
    getOrganizationForScope(scope),
    isClientScope(scope) ? findOwnClientForScope(scope) : Promise.resolve(null),
  ]);

  return {
    kind,
    generatedAt: now.toISOString(),
    organizationName: organization?.name ?? "—",
    organizationVatNumber: organization?.vatNumber ?? null,
    clientName: ownClient?.name ?? null,
  };
}

export async function buildPmReport(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<PmReport> {
  await connectToDatabase();

  const today = startOfUtcDay(now);

  const [envelope, compliance, byFrequency, overdueRows] = await Promise.all([
    envelopeFor(scope, "PM", now),
    summarisePpmCompliance(scope, now),
    ppmByFrequency(scope, now),
    ppmSchedulesRepository.forScope(scope).find(undefined, {
      // Code-authored: overdue is "due before today and not completed".
      where: { dueDate: { $lt: today }, status: { $ne: "COMPLETED" } },
      // Worst first — the visit that has been late longest is the one the
      // report exists to surface.
      sort: { dueDate: 1 },
      limit: DETAIL_ROWS,
      select: ["_id", "assetId", "type", "dueDate"],
    }),
  ]);

  const names = await assetNamesFor(
    scope,
    overdueRows.map((row) => row.assetId),
  );

  return {
    ...envelope,
    kind: "PM",
    compliance: compliance.compliance,
    due: compliance.due,
    completed: compliance.completed,
    missed: compliance.missed,
    upcoming: compliance.upcoming,
    byFrequency,
    overdue: overdueRows.map((row) => ({
      id: row._id.toHexString(),
      assetName: names.get(row.assetId.toHexString()) ?? null,
      type: row.type,
      dueDate: row.dueDate.toISOString(),
    })),
  };
}

export async function buildAssetReport(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<AssetReport> {
  await connectToDatabase();

  const [envelope, summary, byCategory, worstRows, openWorkOrders] = await Promise.all([
    envelopeFor(scope, "ASSET", now),
    summariseAssets(scope),
    assetsByCategory(scope),
    assetsRepository.forScope(scope).find(undefined, {
      // Worst condition first. A decommissioned asset is excluded: its health is
      // a historical fact, not a maintenance problem.
      where: { status: { $ne: "INACTIVE" } },
      sort: { health: 1 },
      limit: DETAIL_ROWS,
      select: ["_id", "name", "category", "health", "status"],
    }),
    workOrdersRepository.forScope(scope).count(undefined, {
      where: { status: { $in: WORK_ORDER_STATUSES.filter(isOpenStatus) } },
    }),
  ]);

  return {
    ...envelope,
    kind: "ASSET",
    total: summary.total,
    active: summary.active,
    inMaintenance: summary.inMaintenance,
    averageHealth: summary.averageHealth,
    byCategory,
    worst: worstRows.map((row) => ({
      id: row._id.toHexString(),
      name: row.name,
      category: row.category,
      health: row.health,
      status: row.status,
    })),
    openWorkOrders,
  };
}

export async function buildFinancialReport(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<FinancialReport> {
  await connectToDatabase();

  const [envelope, invoices, contracts, trend] = await Promise.all([
    envelopeFor(scope, "FINANCIAL", now),
    summariseInvoices(scope, now),
    summariseContracts(scope, now),
    maintenanceTrend(scope, now),
  ]);

  /**
   * Every money figure is summed by MongoDB over HALALAS — integers, which add
   * exactly — and divided to riyals once, here, at the last possible moment.
   * Adding two of the resulting floats anywhere downstream would reintroduce
   * exactly the error the minor-unit convention exists to avoid.
   */
  return {
    ...envelope,
    kind: "FINANCIAL",
    invoiced: halalasToSar(invoices.invoicedMinor),
    paid: halalasToSar(invoices.paidMinor),
    pending: halalasToSar(invoices.pendingMinor),
    overdue: halalasToSar(invoices.overdueMinor),
    invoiceCount: invoices.count,
    overdueCount: invoices.overdueCount,
    contractValue: halalasToSar(contracts.totalValueMinor),
    activeContracts: contracts.active,
    expiringContracts: contracts.expiring,
    averageCompliance: contracts.averageCompliance,
    trend,
  };
}

/**
 * Build whichever report was asked for.
 *
 * The role check happens BEFORE the switch, against the per-report list, so a
 * supervisor asking for the financial report is refused rather than served a
 * document their role list would not have offered them. The kind is a parsed
 * enum by the time it arrives, so the switch is total and there is no default
 * branch to fall through.
 */
export async function buildReportForScope(
  scope: TenantScope,
  role: Role,
  kind: ReportKind,
  now: Date = new Date(),
): Promise<Report> {
  if (!canRunReportFor(role, kind)) {
    // Thrown rather than returned: a caller that ignored the return value would
    // otherwise render an empty report instead of a 403.
    throw new AuthorizationError(`role ${role} may not run the ${kind} report`);
  }

  switch (kind) {
    case "PM":
      return buildPmReport(scope, now);
    case "ASSET":
      return buildAssetReport(scope, now);
    case "FINANCIAL":
      return buildFinancialReport(scope, now);
  }
}

/** The authenticating entry point, for a Server Component. */
export async function buildReport(kind: ReportKind): Promise<Report> {
  const { scope, user } = await requireRole(...REPORT_ROLE_LISTS[kind]);
  return buildReportForScope(scope, user.role, kind);
}

/**
 * The work-order status split, for the asset report's chart.
 *
 * Exported separately rather than folded into `buildAssetReport` because the
 * printable view uses it and the PDF does not — a donut is a screen object, and
 * a table of the same numbers is what belongs on paper.
 */
export async function workStatusForScope(scope: TenantScope) {
  await connectToDatabase();
  return countWorkOrdersByStatus(scope, WORK_ORDER_STATUSES);
}
