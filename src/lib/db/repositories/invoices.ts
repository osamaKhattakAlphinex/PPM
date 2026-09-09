import type { Types } from "mongoose";

import { startOfUtcDay } from "../../domain/dates";
import type { InvoiceStatus } from "../../domain/invoicing";
import { Invoice, type InvoiceDocument } from "../models/invoice";
import { createRepository } from "../repository";
import type { TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach invoices.
 *
 * Client-partitioned, which follows from the model rather than from an option
 * here: `Invoice` has a required `clientId`, so `createRepository()` narrows a
 * CLIENT session to its own documents. That agrees with `src/lib/nav/modules.ts`,
 * where `invoicing` is open to management and CLIENT — a customer is entitled to
 * their own bills and to nothing else in the ledger.
 */

/**
 * What a caller may supply. `organizationId` comes from the scope, never here.
 *
 * `vat` and `total` are accepted because the ACTION computes and passes them,
 * but they are not on any payload schema: nothing above the action can name
 * them. See `computeInvoiceTotals`.
 */
export interface InvoiceCreateInput {
  clientId: Types.ObjectId | string;
  invoiceNumber: string;
  workRef: string;
  approvalId?: Types.ObjectId | string | null;
  contractId?: Types.ObjectId | string | null;
  amount: number;
  vatRate: number;
  vat: number;
  total: number;
  issueDate: Date;
  dueDate: Date;
  status?: InvoiceStatus;
  notes?: string | null;
}

/**
 * Patchable fields.
 *
 * No `clientId` (it is in the DAL's `RESERVED_FIELDS` anyway), no
 * `invoiceNumber`, no `approvalId`. An issued invoice addressed to a different
 * customer, or renumbered, is a different document — and the one it replaces has
 * to survive as the record of what was sent.
 */
export interface InvoiceUpdateInput {
  workRef?: string;
  amount?: number;
  vatRate?: number;
  vat?: number;
  total?: number;
  issueDate?: Date;
  dueDate?: Date;
  status?: InvoiceStatus;
  paidAt?: Date | null;
  notes?: string | null;
  contractId?: Types.ObjectId | string | null;
}

export const invoicesRepository = createRepository<
  InvoiceDocument,
  InvoiceCreateInput,
  InvoiceUpdateInput
>(Invoice);

// ---------------------------------------------------------------------------
// The KPI header
// ---------------------------------------------------------------------------

/** The four figures at the top of the invoicing screen, and the counts behind them. */
export interface InvoiceSummaryTotals {
  readonly count: number;
  readonly paidCount: number;
  readonly pendingCount: number;
  readonly overdueCount: number;

  /** All halalas. Summed by MongoDB over integers, converted once at the DTO. */
  readonly invoicedMinor: number;
  readonly paidMinor: number;
  readonly pendingMinor: number;
  readonly overdueMinor: number;
}

const EMPTY_SUMMARY: InvoiceSummaryTotals = Object.freeze({
  count: 0,
  paidCount: 0,
  pendingCount: 0,
  overdueCount: 0,
  invoicedMinor: 0,
  paidMinor: 0,
  pendingMinor: 0,
  overdueMinor: 0,
});

/**
 * The invoicing header, in one round trip.
 *
 * Inside `src/lib/db/**` because it is an aggregation, and the DAL-boundary lint
 * rule forbids `Model.aggregate` anywhere else — a pipeline is reached under
 * MongoDB's rules rather than ours, so the one place it may be written is the
 * layer that can prove the first stage is scoped. And it is proven: the `$match`
 * is `matchStage()`, the very filter `find()` and `paginate()` build, with
 * `organizationId` (and `clientId` for a client session) applied last where
 * nothing can displace it, and `deletedAt: null` already in place. The base
 * plugin does NOT filter aggregations, so that last part is doing real work —
 * without it a soft-deleted invoice would keep moving all four figures.
 *
 * Every figure sums `total` — the GROSS — because that is what a client pays and
 * what a bank statement shows. A KPI header that quietly reported net would
 * disagree with every document beneath it by exactly the VAT.
 *
 * `today` is passed in rather than read as `$$NOW` so that a tile and the badge
 * on the row beneath it are answering with the same midnight.
 */
export async function summariseInvoices(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<InvoiceSummaryTotals> {
  const today = startOfUtcDay(now);

  /**
   * The three predicates, which partition the ledger exactly: paid, pending and
   * not yet due, pending and past due. Every literal is code-authored; nothing
   * from a request reaches this pipeline.
   */
  const isPaid = { $eq: ["$status", "PAID"] };
  const isOverdue = { $and: [{ $eq: ["$status", "PENDING"] }, { $lt: ["$dueDate", today] }] };
  const isPending = { $and: [{ $eq: ["$status", "PENDING"] }, { $gte: ["$dueDate", today] }] };

  const rows = await Invoice.aggregate<InvoiceSummaryTotals & { _id: null }>([
    { $match: invoicesRepository.forScope(scope).matchStage() },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        paidCount: { $sum: { $cond: [isPaid, 1, 0] } },
        pendingCount: { $sum: { $cond: [isPending, 1, 0] } },
        overdueCount: { $sum: { $cond: [isOverdue, 1, 0] } },

        // "Total invoiced" is everything ever raised, paid or not: it is the
        // revenue figure, and a number that fell when a client paid would be
        // unreadable as one.
        invoicedMinor: { $sum: "$total" },
        paidMinor: { $sum: { $cond: [isPaid, "$total", 0] } },
        pendingMinor: { $sum: { $cond: [isPending, "$total", 0] } },
        overdueMinor: { $sum: { $cond: [isOverdue, "$total", 0] } },
      },
    },
  ]).exec();

  /**
   * Zero rows, not a row of zeroes: `$group` with `_id: null` over an empty
   * `$match` emits NO document at all, so a brand-new tenant lands here.
   * Returning the constant is what stops the header rendering `NaN` on the
   * emptiest possible screen.
   */
  const row = rows[0];
  if (!row) return EMPTY_SUMMARY;

  /**
   * `_id` is stripped rather than spread through: `$group` always emits it, and
   * it is the literal `null` this pipeline grouped on — not part of the header
   * and not something any caller should have to ignore.
   */
  const { _id: _groupKey, ...totals } = row;
  void _groupKey;
  return totals;
}
