import { z } from "zod";

import { startOfUtcDay } from "./dates";

/**
 * The invoicing vocabulary, the VAT arithmetic, and the one function that turns
 * a due date into something a person can act on.
 *
 * This lives outside `src/lib/db` for the reason every other domain module
 * gives: the invoice list, its filters, its KPI header and its status badge are
 * Client Components, and anything a Client Component imports as a VALUE ends up
 * in the browser bundle — so a status list re-exported from `@/lib/db` would
 * drag Mongoose (and `fs`, `net`, `tls`) into it and fail the build.
 *
 * Pure: zod and the calendar helper, nothing else.
 */

// ---------------------------------------------------------------------------
// VAT
// ---------------------------------------------------------------------------

/**
 * Saudi VAT, in BASIS POINTS — 1500 = 15%.
 *
 * An integer, not `0.15`, and that is the whole point: every number below this
 * layer is a whole count of halalas, and multiplying a halala figure by a float
 * reintroduces exactly the representation error the minor-unit convention
 * exists to avoid. Basis points keep the multiplication in integers until the
 * single, explicit rounding step in `computeInvoiceTotals`.
 *
 * Stored per invoice as well (see `Invoice.vatRate`), so a document raised at
 * 15% still says 15% after a rate change. A constant read at render time would
 * silently restate history.
 */
export const VAT_RATE_BASIS_POINTS = 1500;

export const BASIS_POINTS_PER_UNIT = 10_000;

/**
 * A rate a caller may name. Bounded at 100% — a VAT rate above that is a typo,
 * and one below zero is a refund pretending to be a rate.
 */
export const vatRateBasisPointsSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(BASIS_POINTS_PER_UNIT);

/** What the server computed, and the only numbers that are ever stored. */
export interface InvoiceTotals {
  /** The net amount, in halalas. */
  readonly amount: number;
  /** The rate this invoice was raised at, in basis points. */
  readonly vatRate: number;
  /** The tax, in halalas. Rounded once, here. */
  readonly vat: number;
  /** amount + vat, in halalas. Never rounded again. */
  readonly total: number;
}

/**
 * The one place VAT is calculated, for every caller.
 *
 * Three properties this has to hold, and they are the reasons it is a named
 * pure function rather than two lines inside the create action:
 *
 *  1. **Integer in, integer out.** `amount` is halalas and so is the result.
 *     `amount * rate` is a product of two integers, so nothing is lost before
 *     the division; the single `Math.round` is the only place a fraction of a
 *     halala can exist, and it is resolved half-up, which is what a tax
 *     authority and every accounting package expect.
 *  2. **total is derived, never re-derived.** `total = amount + vat` uses the
 *     rounded VAT figure, so the three numbers on the document always add up.
 *     Computing the total independently — `round(amount * 1.15)` — can differ
 *     from `amount + round(amount * 0.15)` by one halala, and an invoice whose
 *     own lines do not sum is an invoice a client refuses to pay.
 *  3. **It never sees the client's numbers.** The caller supplies `amount`.
 *     `vat` and `total` are not fields on any payload schema anywhere, so there
 *     is nothing to trust and nothing to check.
 */
export function computeInvoiceTotals(
  amount: number,
  vatRate: number = VAT_RATE_BASIS_POINTS,
): InvoiceTotals {
  const vat = Math.round((amount * vatRate) / BASIS_POINTS_PER_UNIT);
  return { amount, vatRate, vat, total: amount + vat };
}

// ---------------------------------------------------------------------------
// Status — stored vs displayed
// ---------------------------------------------------------------------------

/**
 * What is actually STORED on an invoice. Two values, moved only by a person.
 *
 * `OVERDUE` is deliberately NOT here. It is a function of the clock, not a fact
 * about the row: an invoice stored as "overdue" is wrong the morning its due
 * date passes and nothing would be running to correct it — there is no
 * scheduler in the product yet. Storing it would mean a ledger that is accurate
 * only until midnight. The same decision `Contract` makes about EXPIRING, and
 * for the same reason.
 */
export const INVOICE_STATUSES = ["PENDING", "PAID"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);

/**
 * What a person SEES — the stored two, with `PENDING` split by where today
 * falls against the due date.
 *
 * A superset of the stored vocabulary, so a display value is never a legal
 * thing to write: `invoiceStatusSchema` guards writes and this guards reads and
 * filters.
 */
export const INVOICE_DISPLAY_STATUSES = ["PENDING", "OVERDUE", "PAID"] as const;

export type InvoiceDisplayStatus = (typeof INVOICE_DISPLAY_STATUSES)[number];

export const invoiceDisplayStatusSchema = z.enum(INVOICE_DISPLAY_STATUSES);

/**
 * What to show for one invoice, against a given clock.
 *
 * A paid invoice is PAID whatever the dates say — paying late does not make a
 * settled document overdue, and a ledger that said so would send someone
 * chasing money that has arrived.
 *
 * "Overdue" is `dueDate` STRICTLY before today: an invoice due today is due
 * today, not late. Both sides are normalised to UTC midnight so that a manager
 * in Riyadh and a server in another region agree about which day it is.
 */
export function effectiveInvoiceStatus(
  status: InvoiceStatus,
  dueDate: Date,
  now: Date = new Date(),
): InvoiceDisplayStatus {
  if (status === "PAID") return "PAID";
  return startOfUtcDay(dueDate) < startOfUtcDay(now) ? "OVERDUE" : "PENDING";
}

/**
 * The filter fragment for a display status, for the DAL's TRUSTED `where`
 * channel.
 *
 * The name a person picked selects a BRANCH here; the name itself never reaches
 * a query. Every value in the returned fragment is either a code-authored
 * literal or a Date this function computed.
 */
export function invoiceStatusQueryFragment(
  status: InvoiceDisplayStatus,
  now: Date = new Date(),
): Record<string, unknown> {
  const today = startOfUtcDay(now);

  switch (status) {
    case "PAID":
      return { status: "PAID" };
    case "OVERDUE":
      return { status: "PENDING", dueDate: { $lt: today } };
    case "PENDING":
      return { status: "PENDING", dueDate: { $gte: today } };
  }
}

/**
 * How many days an invoice is given to be paid, from the day it is issued.
 *
 * Thirty, the ordinary Gulf FM term, and it is only a DEFAULT: the create
 * payload accepts an explicit due date, because payment terms are negotiated
 * per contract and a constant that could not be overridden would be a constant
 * somebody works around by back-dating the issue date.
 */
export const DEFAULT_PAYMENT_TERM_DAYS = 30;

// ---------------------------------------------------------------------------
// The invoice number
// ---------------------------------------------------------------------------

/**
 * The shape of an invoice reference: lowercase, digits and single hyphens.
 *
 * The same shape as `Client.code` and `Contract.contractNumber`, deliberately —
 * a reference that reconciles against nothing is not a reference, and three
 * different shapes in one system is three ways for a bank statement to fail to
 * match.
 */
export const invoiceNumberSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens");
