import type { Types } from "mongoose";

import {
  EXPIRING_WINDOW_DAYS,
  type AmcContractType,
  type ContractStatus,
} from "../../domain/amc";
import { addUtcDays, startOfUtcDay } from "../../domain/dates";
import { Contract, type ContractDocument } from "../models/contract";
import { createRepository } from "../repository";
import type { TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach AMC contracts.
 *
 * Client-partitioned, and that follows from the model rather than from an option
 * here: `Contract` has a `clientId` path, so `createRepository()` narrows a
 * CLIENT session to its own contracts instead of refusing it the way
 * `ppmSchedulesRepository` does. That agrees with `src/lib/nav/modules.ts`,
 * where `amc` is open to CLIENT — "commercial, so management and the client
 * whose contract it is".
 *
 * Not `sharedWithClients`, which would be the opposite mistake: it would hand
 * every customer the provider's whole book, including what other customers pay.
 */

/**
 * What a caller may supply. `organizationId` comes from the scope, never here.
 *
 * `status`, `suspendedAt` and `cancelledAt` are accepted because the transition
 * action sets them, but they are not on the create payload schema: a new
 * contract is always `ACTIVE`, and a timestamp a client could choose is not
 * evidence that anything happened.
 *
 * `value` is in HALALAS. Nothing in this layer converts — the payload schema in
 * `src/lib/amc/schemas.ts` is where riyals become minor units, because that is
 * the boundary where both representations are in scope.
 */
export interface ContractCreateInput {
  clientId: Types.ObjectId | string;
  contractNumber: string;
  title: string;
  type: AmcContractType;
  value: number;
  startDate: Date;
  endDate: Date;
  compliance?: number;
  status?: ContractStatus;
}

/**
 * Patchable fields.
 *
 * No `clientId`: it is in the DAL's `RESERVED_FIELDS` and `update()` strips it
 * anyway, but its absence here says the intent — moving a contract between
 * customers is a new contract, not an edit. No `contractNumber` either, for the
 * reason the model gives: it goes on invoices.
 */
export interface ContractUpdateInput {
  title?: string;
  type?: AmcContractType;
  value?: number;
  startDate?: Date;
  endDate?: Date;
  compliance?: number;
  status?: ContractStatus;
  suspendedAt?: Date | null;
  cancelledAt?: Date | null;
}

export const contractsRepository = createRepository<
  ContractDocument,
  ContractCreateInput,
  ContractUpdateInput
>(Contract);

// ---------------------------------------------------------------------------
// The KPI header
// ---------------------------------------------------------------------------

/** The four figures at the top of the AMC screen, plus the counts behind them. */
export interface ContractSummaryTotals {
  /** Every contract in scope, whatever state it is in. */
  readonly total: number;

  /**
   * The six DERIVED statuses. Computed against a `today` passed in by the
   * caller, never `$$NOW`, so a tile and the badge on the row beneath it are
   * answering with the same midnight. They partition `total` exactly, and
   * `contracts.test.ts` asserts it.
   */
  readonly upcoming: number;
  readonly active: number;
  readonly expiring: number;
  readonly expired: number;
  readonly suspended: number;
  readonly cancelled: number;

  /** Halalas — see the note on the pipeline for which contracts are in it. */
  readonly totalValueMinor: number;

  /**
   * 0–100, rounded. NULL when there is nothing to average, which is not the same
   * as zero and must not be rendered as it: "0% compliant" and "no contracts
   * being delivered" are opposite statements about a provider.
   */
  readonly averageCompliance: number | null;
}

/**
 * What an empty scope gets. A frozen constant rather than a literal built at the
 * call site, so every caller agrees on what "nothing" looks like.
 */
const EMPTY_SUMMARY: ContractSummaryTotals = Object.freeze({
  total: 0,
  upcoming: 0,
  active: 0,
  expiring: 0,
  expired: 0,
  suspended: 0,
  cancelled: 0,
  totalValueMinor: 0,
  averageCompliance: null,
});

interface ContractSummaryRow extends Omit<ContractSummaryTotals, "averageCompliance"> {
  _id: null;
  /** `$avg` yields null when no input to it was numeric. */
  averageCompliance: number | null;
}

/**
 * The AMC header, in one round trip.
 *
 * This lives INSIDE `src/lib/db/**` rather than in the feature module because it
 * is an aggregation, and the DAL-boundary lint rule forbids `Model.aggregate`
 * anywhere else — for the reason the repository's own header gives: a pipeline
 * is reached under MongoDB's rules rather than ours, so the one place it may be
 * written is the layer that can prove the first stage is scoped.
 *
 * And it is proven, not asserted. The `$match` is `matchStage()` — the very
 * filter `find()` and `paginate()` build, with `organizationId` (and `clientId`
 * for a client session) applied last where nothing can displace it, and
 * `deletedAt: null` already in place. The base plugin does NOT filter
 * aggregations, so that last part is doing real work: without it a soft-deleted
 * contract would keep moving all four figures.
 *
 * Returns ONE object rather than a per-enum array, unlike
 * `countPpmSchedulesByType` and `countWorkOrdersByPriority`. Those return arrays
 * because their tiles ARE the enum — one per frequency, one per priority — and
 * the array guarantees an empty tile still renders so the grid does not reflow.
 * This header is not that: it is four unlike figures, two of which are not
 * counts at all, and an array of `{ key, value }` would force every consumer to
 * `.find()` for a field it knows the name of and would make
 * `averageCompliance: null` indistinguishable from `0`.
 */
export async function summariseContracts(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<ContractSummaryTotals> {
  const today = startOfUtcDay(now);
  const horizon = addUtcDays(today, EXPIRING_WINDOW_DAYS);

  /**
   * The predicates, named once and reused, because each is one branch of
   * `effectiveContractStatus` rewritten for the pipeline — and in the same
   * order.
   *
   * `isLive` guards every date test: a SUSPENDED contract whose end date passed
   * in January is SUSPENDED, not EXPIRED, because a person moved it there and
   * the clock does not get to overrule them. Drop that guard and the six counts
   * stop summing to `total`, which is the invariant the test asserts.
   *
   * Every literal below — the two status names, the two dates — is code-authored.
   * Nothing from a request reaches this pipeline.
   */
  const isLive = { $eq: ["$status", "ACTIVE"] };
  const hasStarted = { $lte: ["$startDate", today] };

  /**
   * The subset the money figure is over: NOT cancelled, and NOT already ended.
   *
   * "Total contract value" is the book the tenant is holding, so:
   *  - CANCELLED is out. It is revenue that will never be invoiced, and
   *    including it overstates the book by exactly the amount someone walked
   *    away from.
   *  - EXPIRED is out. It was earned and it is finished; a tile that keeps
   *    counting a contract that ended in 2019 only ever grows, and a number that
   *    only grows is not a KPI.
   *  - SUSPENDED is IN. A suspension is temporary and the money is still owed —
   *    and a tile that dropped by SAR 4m the moment a client was put on hold for
   *    a payment dispute would hide the figure precisely when it is wanted.
   *  - UPCOMING is IN. It is signed. A portfolio value that ignored a contract
   *    until its start date would be wrong on the day of signature, which is the
   *    day someone screenshots it.
   */
  const inForce = { $and: [{ $ne: ["$status", "CANCELLED"] }, { $gte: ["$endDate", today] }] };

  /**
   * The subset the compliance average is over: derived ACTIVE ∪ EXPIRING — live,
   * begun, not yet ended. Deliberately TIGHTER than the money subset, and the
   * difference is the point: money is what is on the books, compliance is what
   * is being worked this morning.
   *
   *  - UPCOMING is excluded. No work has fallen due, so its stored compliance is
   *    whatever the form defaulted to, and that default would prop the fleet
   *    average up on the day a contract is signed and every day until it starts.
   *  - EXPIRED is excluded. A finished contract's compliance is a historical
   *    fact that belongs in a report, not in "how are we doing right now".
   *  - SUSPENDED is excluded. Nobody is delivering it, so counting it as
   *    underperformance blames the provider for a decision to stop.
   */
  const beingDelivered = { $and: [isLive, hasStarted, { $gte: ["$endDate", today] }] };

  const rows = await Contract.aggregate<ContractSummaryRow>([
    { $match: contractsRepository.forScope(scope).matchStage() },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },

        suspended: { $sum: { $cond: [{ $eq: ["$status", "SUSPENDED"] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },

        upcoming: {
          $sum: { $cond: [{ $and: [isLive, { $gt: ["$startDate", today] }] }, 1, 0] },
        },
        expired: {
          $sum: { $cond: [{ $and: [isLive, hasStarted, { $lt: ["$endDate", today] }] }, 1, 0] },
        },
        expiring: {
          $sum: {
            $cond: [
              {
                $and: [
                  isLive,
                  hasStarted,
                  { $gte: ["$endDate", today] },
                  { $lt: ["$endDate", horizon] },
                ],
              },
              1,
              0,
            ],
          },
        },
        active: {
          $sum: {
            $cond: [{ $and: [isLive, hasStarted, { $gte: ["$endDate", horizon] }] }, 1, 0],
          },
        },

        totalValueMinor: { $sum: { $cond: [inForce, "$value", 0] } },

        /**
         * `null`, not `0`, for the rows outside the subset. `$avg` IGNORES
         * non-numeric inputs, so a null is genuinely excluded from both the sum
         * and the divisor — whereas a `0` would be averaged in and would drag
         * the figure toward zero in proportion to how many expired contracts the
         * tenant happens to have kept.
         */
        averageCompliance: { $avg: { $cond: [beingDelivered, "$compliance", null] } },
      },
    },
  ]).exec();

  /**
   * Zero rows, not a row of zeroes.
   *
   * `$group` with `_id: null` over an empty `$match` emits NO document at all —
   * so a brand-new tenant, or a client whose provider has not raised a contract
   * yet, lands here. Returning the constant is what stops the header rendering
   * `NaN` and `undefined` on the emptiest possible screen.
   */
  const row = rows[0];
  if (!row) return EMPTY_SUMMARY;

  return {
    ...row,
    /**
     * `$avg` also returns null when the subset was empty but the collection was
     * not — every contract cancelled, say. Rounded here rather than in the DTO
     * so that "compliance is an integer 0–100" holds on both sides of the
     * server/client boundary.
     */
    averageCompliance:
      typeof row.averageCompliance === "number" ? Math.round(row.averageCompliance) : null,
  };
}
