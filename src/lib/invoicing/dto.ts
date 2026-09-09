import type { InvoiceDocument } from "@/lib/db";
import { halalasToSar } from "@/lib/domain/currency";
import {
  effectiveInvoiceStatus,
  type InvoiceDisplayStatus,
  type InvoiceStatus,
} from "@/lib/domain/invoicing";

/**
 * The shape that crosses the server/client boundary.
 *
 * React cannot serialise an `ObjectId` or a `Date`, and a document forwarded
 * wholesale ships whatever field is added to the model next. Nothing reaches the
 * browser unless it is named below.
 */

export interface InvoiceSummary {
  id: string;
  clientId: string;
  /** Resolved through a second SCOPED read, never a populate. */
  clientName: string | null;
  invoiceNumber: string;
  workRef: string;
  approvalId: string | null;
  contractId: string | null;

  /**
   * All three in RIYALS — major units, ready for
   * `format.number(value, "currency")`.
   *
   * The database stores halalas. The division happens HERE, on the server, so
   * the browser never holds a minor-unit figure and cannot forget to divide one.
   * The cost, stated so it is not rediscovered: these are FLOATS. Nothing may
   * add two of them — the KPI header is summed by MongoDB over halalas and
   * converted once, at the edge of `toInvoiceTotals`.
   */
  amount: number;
  vat: number;
  total: number;

  /** Basis points — 1500 is 15%. Shipped so the document can print its rate. */
  vatRate: number;

  /** ISO 8601. A Date does not survive the boundary. */
  issueDate: string;
  dueDate: string;
  paidAt: string | null;

  /** What is actually stored: PENDING or PAID. */
  status: InvoiceStatus;

  /**
   * What to SHOW — the stored value with PENDING split by the due date.
   *
   * Computed HERE, on the server, and shipped as data. The client must not
   * derive it: a browser whose clock is a day out would render a different badge
   * than the server did, which React reports as a hydration mismatch and a user
   * reports as "my phone says this is overdue".
   */
  displayStatus: InvoiceDisplayStatus;

  notes: string | null;
}

export function toInvoiceSummary(
  document: InvoiceDocument,
  clientName: string | null,
  now: Date = new Date(),
): InvoiceSummary {
  return {
    id: document._id.toHexString(),
    clientId: document.clientId.toHexString(),
    clientName,
    invoiceNumber: document.invoiceNumber,
    workRef: document.workRef,
    approvalId: document.approvalId ? document.approvalId.toHexString() : null,
    contractId: document.contractId ? document.contractId.toHexString() : null,
    amount: halalasToSar(document.amount),
    vat: halalasToSar(document.vat),
    total: halalasToSar(document.total),
    vatRate: document.vatRate,
    issueDate: document.issueDate.toISOString(),
    dueDate: document.dueDate.toISOString(),
    paidAt: document.paidAt ? document.paidAt.toISOString() : null,
    status: document.status,
    displayStatus: effectiveInvoiceStatus(document.status, document.dueDate, now),
    notes: document.notes ?? null,
  };
}

/**
 * The KPI header, converted for the browser.
 *
 * The money fields change shape and the counts do not: the aggregation sums
 * halalas — integers, which add exactly — and the division to riyals happens
 * once, here, at the last possible moment.
 */
export interface InvoiceTotalsView {
  count: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  /** Riyals — major units, for `format.number(value, "currency")`. */
  invoiced: number;
  paid: number;
  pending: number;
  overdue: number;
}

export function toInvoiceTotals(totals: {
  count: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  invoicedMinor: number;
  paidMinor: number;
  pendingMinor: number;
  overdueMinor: number;
}): InvoiceTotalsView {
  return {
    count: totals.count,
    paidCount: totals.paidCount,
    pendingCount: totals.pendingCount,
    overdueCount: totals.overdueCount,
    invoiced: halalasToSar(totals.invoicedMinor),
    paid: halalasToSar(totals.paidMinor),
    pending: halalasToSar(totals.pendingMinor),
    overdue: halalasToSar(totals.overdueMinor),
  };
}

/** One approval that is ready to be billed, for the "raise from" picker. */
export interface InvoiceableApproval {
  id: string;
  refLabel: string;
  clientId: string | null;
  clientName: string | null;
  approvedAt: string | null;
}
