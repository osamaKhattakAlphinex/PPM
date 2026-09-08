import type { ContractDocument } from "@/lib/db";
import {
  effectiveContractStatus,
  type AmcContractType,
  type ContractDisplayStatus,
  type ContractStatus,
} from "@/lib/domain/amc";
import { halalasToSar } from "@/lib/domain/currency";

/**
 * The shape that crosses the server/client boundary.
 *
 * Two reasons this layer exists rather than handing a lean document straight to
 * a Client Component:
 *
 *  1. React cannot serialise an `ObjectId` or a `Date` into a client payload.
 *     Mapping here means the failure is a type error at build time instead of a
 *     runtime "Only plain objects can be passed" in a page nobody opened yet.
 *  2. It is an explicit answer to "what does the browser get?". A document
 *     forwarded wholesale ships whatever field is added to the model next.
 *     Nothing reaches the client unless it is named below.
 */

export interface ContractSummary {
  id: string;
  clientId: string;
  /** Resolved through a second SCOPED read, never a populate. */
  clientName: string | null;
  contractNumber: string;
  title: string;
  type: AmcContractType;

  /**
   * The contract's value in RIYALS — major units, ready for
   * `format.number(value, "currency")`, the format declared once in
   * `src/lib/i18n/request.ts`, which expects major units.
   *
   * The database stores halalas. The division happens HERE, on the server, in
   * the same layer that already turns an ObjectId into a string and a Date into
   * an ISO string — so the browser never holds a minor-unit figure and therefore
   * cannot forget to divide one. A DTO that shipped `valueMinor` and relied on
   * every call site to divide would fail in the direction that does not throw: a
   * contract worth SAR 1.2m rendered as SAR 120m, in a screenshotted KPI header,
   * with no stack trace.
   *
   * The cost of that choice, stated so it is not rediscovered: this is a FLOAT.
   * Nothing may add two of these. The one aggregate on this screen — total
   * contract value — is summed by MongoDB over halalas and converted once, at
   * the edge of `toContractTotals()`, for exactly that reason.
   */
  value: number;

  /** ISO 8601. A Date does not survive the boundary. */
  startDate: string;
  endDate: string;
  compliance: number;

  /** What is actually stored: ACTIVE, SUSPENDED or CANCELLED. */
  status: ContractStatus;

  /**
   * What to SHOW — the stored value with ACTIVE split four ways by where today
   * falls in the term.
   *
   * Computed HERE, on the server, and shipped as data. The client must not
   * derive it: a browser whose clock is a day out would render a different badge
   * than the server did, which React reports as a hydration mismatch and a user
   * reports as "my phone says it expired".
   */
  displayStatus: ContractDisplayStatus;

  suspendedAt: string | null;
  cancelledAt: string | null;
}

export function toContractSummary(
  document: ContractDocument,
  clientName: string | null,
  now: Date = new Date(),
): ContractSummary {
  return {
    id: document._id.toHexString(),
    clientId: document.clientId.toHexString(),
    clientName,
    contractNumber: document.contractNumber,
    title: document.title,
    type: document.type,
    value: halalasToSar(document.value),
    startDate: document.startDate.toISOString(),
    endDate: document.endDate.toISOString(),
    compliance: document.compliance,
    status: document.status,
    displayStatus: effectiveContractStatus(
      document.status,
      document.startDate,
      document.endDate,
      now,
    ),
    suspendedAt: document.suspendedAt ? document.suspendedAt.toISOString() : null,
    cancelledAt: document.cancelledAt ? document.cancelledAt.toISOString() : null,
  };
}

/**
 * The KPI header, converted for the browser.
 *
 * The only field that changes shape is the money one: the aggregation sums
 * halalas — integers, which add exactly — and the division to riyals happens
 * once, here, at the last possible moment. `averageCompliance` stays `number |
 * null`, because `null` means "nothing is being delivered" and the header
 * renders a dash for it rather than a zero.
 */
export interface ContractTotals {
  total: number;
  upcoming: number;
  active: number;
  expiring: number;
  expired: number;
  suspended: number;
  cancelled: number;
  /** Riyals — major units, for `format.number(value, "currency")`. */
  totalValue: number;
  averageCompliance: number | null;
}

export function toContractTotals(totals: {
  total: number;
  upcoming: number;
  active: number;
  expiring: number;
  expired: number;
  suspended: number;
  cancelled: number;
  totalValueMinor: number;
  averageCompliance: number | null;
}): ContractTotals {
  const { totalValueMinor, ...counts } = totals;
  return { ...counts, totalValue: halalasToSar(totalValueMinor) };
}
