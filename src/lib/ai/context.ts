import "server-only";

import {
  assetNamesFor,
  assetsByCategory,
  assetsRepository,
  connectToDatabase,
  countWorkOrdersByStatus,
  maintenanceTrend,
  ppmByFrequency,
  ppmSchedulesRepository,
  summariseAssets,
  summarisePpmCompliance,
  workOrdersRepository,
  type TenantScope,
} from "@/lib/db";
import { WORK_ORDER_STATUSES } from "@/lib/domain/corrective";
import { startOfUtcDay } from "@/lib/domain/dates";
import type { AiAnalysis } from "./analyses";

/**
 * The data an analysis is allowed to see.
 *
 * This module is the security boundary of the whole AI feature, and it has one
 * job: assemble a SMALL, in-scope, non-identifying snapshot of the caller's own
 * tenant, so that what leaves this server is bounded and inspectable.
 *
 * Four rules, each of which is a decision rather than an implementation detail:
 *
 *  1. **Everything comes from a scoped repository or a scoped aggregation.**
 *     There is no raw model access here and no parameter by which a caller
 *     could widen the read — the `TenantScope` is resolved by the route from
 *     the session before this is called.
 *  2. **Aggregates before rows.** Every analysis is answered mostly from counts
 *     and averages; individual documents are included only where the question
 *     genuinely needs them (which asset, which fault), and then capped.
 *  3. **No free text from a person leaves the tenant.** Work-order `issue`
 *     text is the one field a human types that would be useful here, and it is
 *     deliberately TRUNCATED and never used as an instruction — see the
 *     `MAX_ISSUE_CHARS` note.
 *  4. **No client names, no user names, no money.** A failure-risk analysis
 *     does not need to know who the customer is or what they pay, so none of
 *     it is sent. What cannot leave cannot leak.
 */

/**
 * How many individual rows any analysis may include.
 *
 * A hard cap on the size of what is sent, as CLAUDE.md's AI section requires.
 * It is small on purpose: the analyses are about patterns, and forty rows show
 * a pattern as well as four hundred while costing a tenth as much and keeping
 * the payload something a person could read in full before approving it.
 */
export const MAX_ROWS = 40;

/**
 * How much of a technician's fault description travels.
 *
 * Truncated rather than omitted, because "compressor tripping on high head
 * pressure" is the single most useful signal for a breakdown-pattern analysis
 * and a category alone loses it. Truncated because the field allows 2,000
 * characters, forty of those is 80KB, and a long field is also where an
 * attempted instruction would live — a fragment is useless as one.
 */
export const MAX_ISSUE_CHARS = 160;

/** The snapshot handed to the prompt builder. Plain JSON, no ids of people. */
export interface InsightContext {
  readonly generatedAt: string;
  readonly assets: {
    total: number;
    active: number;
    inMaintenance: number;
    averageHealth: number | null;
    byCategory: { category: string; total: number; averageHealth: number | null }[];
  };
  readonly workOrders: {
    byStatus: { status: string; count: number }[];
    /** Capped, truncated, and free of client identity. */
    recent: {
      asset: string | null;
      category: string | null;
      priority: string;
      status: string;
      issue: string;
      raisedOn: string;
    }[];
  };
  readonly preventive: {
    compliance: number | null;
    due: number;
    completed: number;
    upcoming: number;
    byFrequency: { frequency: string; total: number; completed: number; overdue: number }[];
  };
  readonly trend: { month: string; preventive: number; corrective: number }[];
  /** Assets in the worst condition — the failure-risk analysis's raw material. */
  readonly weakest: { name: string; category: string; health: number; status: string }[];
}

/** One character-bounded, newline-flattened line of somebody's free text. */
function safeIssueText(issue: string): string {
  // Newlines flattened as well as truncated: the snapshot is embedded in the
  // prompt as JSON, and a multi-line value is where a "### new instructions"
  // block would try to live. It is still DATA either way — the system prompt
  // says so explicitly — but a single line is harder to mistake for structure.
  return issue.replace(/\s+/g, " ").slice(0, MAX_ISSUE_CHARS);
}

/**
 * Gather the snapshot for one analysis.
 *
 * The reads differ by analysis only in EMPHASIS, not in scope: every branch is
 * a subset of the same scoped sources, so there is no analysis that can see
 * more than another. Keeping one function means there is one place to audit
 * what leaves.
 */
export async function buildInsightContext(
  scope: TenantScope,
  analysis: AiAnalysis,
  now: Date = new Date(),
): Promise<InsightContext> {
  await connectToDatabase();

  const today = startOfUtcDay(now);

  const [assetSummary, byCategory, byStatus, compliance, byFrequency, trend, weakestRows] =
    await Promise.all([
      summariseAssets(scope),
      assetsByCategory(scope),
      countWorkOrdersByStatus(scope, WORK_ORDER_STATUSES),
      summarisePpmCompliance(scope, now),
      ppmByFrequency(scope, now),
      maintenanceTrend(scope, now),
      assetsRepository.forScope(scope).find(undefined, {
        where: { status: { $ne: "INACTIVE" } },
        sort: { health: 1 },
        limit: MAX_ROWS,
        select: ["_id", "name", "category", "health", "status"],
      }),
    ]);

  /**
   * The recent faults, for the two analyses that reason about them.
   *
   * Not fetched for the other two: a spare-parts forecast and a PM-schedule
   * review are answered from the aggregates, and sending forty fault
   * descriptions to a question that does not use them would be spending tokens
   * and widening the payload for nothing.
   */
  const wantsFaults = analysis === "BREAKDOWN_PATTERNS" || analysis === "SPARE_PARTS";

  const faultRows = wantsFaults
    ? await workOrdersRepository.forScope(scope).find(undefined, {
        // The last quarter, newest first — a pattern older than that is history
        // rather than a live problem.
        where: { createdAt: { $gte: new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000) } },
        sort: { createdAt: -1 },
        limit: MAX_ROWS,
        select: ["_id", "assetId", "issue", "priority", "status", "createdAt"],
      })
    : [];

  const faultAssetNames = await assetNamesFor(
    scope,
    faultRows.map((row) => row.assetId),
  );

  /**
   * The category of each fault's asset, resolved from the SAME scoped read the
   * weakest list came from where possible. A fault on an asset outside that
   * list simply reports a null category rather than triggering a second query
   * per row — the analysis is about patterns, and a missing category on a few
   * rows changes nothing.
   */
  const categoryByAsset = new Map(
    weakestRows.map((asset) => [asset._id.toHexString(), asset.category]),
  );

  return {
    generatedAt: now.toISOString(),
    assets: {
      total: assetSummary.total,
      active: assetSummary.active,
      inMaintenance: assetSummary.inMaintenance,
      averageHealth: assetSummary.averageHealth,
      byCategory: byCategory.map((row) => ({
        category: row.category,
        total: row.total,
        averageHealth: row.averageHealth,
      })),
    },
    workOrders: {
      byStatus: byStatus.map((row) => ({ status: row.status, count: row.count })),
      recent: faultRows.map((row) => ({
        asset: faultAssetNames.get(row.assetId.toHexString()) ?? null,
        category: categoryByAsset.get(row.assetId.toHexString()) ?? null,
        priority: row.priority,
        status: row.status,
        issue: safeIssueText(row.issue),
        raisedOn: row.createdAt.toISOString().slice(0, 10),
      })),
    },
    preventive: {
      compliance: compliance.compliance,
      due: compliance.due,
      completed: compliance.completed,
      upcoming: compliance.upcoming,
      byFrequency: byFrequency.map((row) => ({
        frequency: row.frequency,
        total: row.total,
        completed: row.completed,
        overdue: row.overdue,
      })),
    },
    trend: trend.map((point) => ({ ...point })),
    weakest: weakestRows.slice(0, MAX_ROWS).map((asset) => ({
      name: asset.name,
      category: asset.category,
      health: asset.health,
      status: asset.status,
    })),
  };
}

/**
 * The upcoming preventive plan, for the schedule-optimisation analysis only.
 *
 * Split out rather than folded into the snapshot because it is the one read
 * that a CLIENT scope cannot make at all — `ppmSchedulesRepository` refuses one
 * — and because the other three analyses do not use it. Callers that do not
 * need it do not pay for it.
 */
export async function upcomingPlanFor(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<{ asset: string | null; frequency: string; dueOn: string }[]> {
  const today = startOfUtcDay(now);

  const rows = await ppmSchedulesRepository.forScope(scope).find(undefined, {
    where: { dueDate: { $gte: today }, status: { $ne: "COMPLETED" } },
    sort: { dueDate: 1 },
    limit: MAX_ROWS,
    select: ["_id", "assetId", "type", "dueDate"],
  });

  const names = await assetNamesFor(
    scope,
    rows.map((row) => row.assetId),
  );

  return rows.map((row) => ({
    asset: names.get(row.assetId.toHexString()) ?? null,
    frequency: row.type,
    dueOn: row.dueDate.toISOString().slice(0, 10),
  }));
}
