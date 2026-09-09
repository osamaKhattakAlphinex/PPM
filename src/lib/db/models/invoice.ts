import { z } from "zod";

import { minorUnitsSchema } from "../../domain/currency";
import {
  invoiceStatusSchema,
  vatRateBasisPointsSchema,
  VAT_RATE_BASIS_POINTS,
} from "../../domain/invoicing";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One invoice: this client, this work, this much, due on this day.
 *
 * ## Every money field is a whole number of halalas
 *
 * The convention `Contract.value` set, and here it matters three times over
 * rather than once: `amount`, `vat` and `total` have to add up on a document
 * somebody pays against. See `computeInvoiceTotals` in
 * `src/lib/domain/invoicing.ts` for the arithmetic and why the total is derived
 * from the ROUNDED vat rather than computed independently.
 *
 * `vat` and `total` are STORED rather than computed on read. That is
 * denormalisation, and it is the right kind: an invoice is a document that was
 * issued, and what it said when it was issued does not change because a rate
 * changed or a rounding rule was tidied. `vatRate` is stored beside them for the
 * same reason — the figure has to be defensible years later, not merely
 * reproducible today.
 *
 * Nothing above this layer may write them. The payload schemas carry `amount`
 * and nothing else; the action computes the other three.
 *
 * ## clientId is REQUIRED
 *
 * The same inversion as `Contract`, and the same reasoning. An invoice is a
 * demand for payment FROM somebody, so `clientId: null` would describe an
 * invoice addressed to nobody. It is also load-bearing for visibility: the
 * filter the DAL builds for a CLIENT session is `clientId: <theirs>`, which
 * matches no `null`, so a nullable path would create invoices no customer could
 * ever see on a module built to be seen by the customer.
 */
export const invoiceInputSchema = entity({
  /**
   * The counterparty.
   *
   * Re-checked against the caller's organization in the action before it is
   * used — or, on the approval path, copied from the approval, which had itself
   * copied it from the work order. An id that arrived in a request is never
   * trusted to be in scope.
   *
   * Deliberately NOT `{ index: true }`: a field-level hint builds a bare
   * `{ clientId: 1 }` index, which is not tenant-first. The compound below
   * covers the same query with the tenant in front.
   */
  clientId: objectId("Client"),

  /**
   * The commercial reference. Unique inside the organization, and fixed once
   * saved — it goes on a bank transfer, and a reference that changes is a
   * reference that reconciles against nothing.
   */
  invoiceNumber: mongo(
    z
      .string()
      .min(2)
      .max(32)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens"),
    { trim: true, lowercase: true },
  ),

  /**
   * What the invoice is FOR, in the words the client would recognise — "WO-1183
   * · chiller 2 compressor replacement".
   *
   * Snapshot, like `ChecklistRun.checklistName`: the document has to be readable
   * on its own, years later, after the work order it names has been archived.
   */
  workRef: mongo(z.string().min(2).max(160), { trim: true }),

  /**
   * The approval chain this was raised from, when there was one.
   *
   * Nullable because an invoice may also be raised directly by a manager — a
   * mobilisation fee, an AMC instalment, anything that is not the end of a job.
   * When it IS set, the chain is guaranteed by `markApprovalInvoiced` to have
   * reached INVOICE_TRIGGER, and that function refuses to set it twice.
   */
  approvalId: objectId("Approval").nullable().optional(),

  /** The AMC this bills against, when it bills against one. */
  contractId: objectId("Contract").nullable().optional(),

  /** The net, in HALALAS. The only money figure a caller supplies. */
  amount: minorUnitsSchema,

  /**
   * The rate this document was raised at, in basis points. Stored, not assumed
   * — see the header.
   */
  vatRate: vatRateBasisPointsSchema.default(VAT_RATE_BASIS_POINTS),

  /** The tax and the gross, both in halalas. Computed by the server. */
  vat: minorUnitsSchema,
  total: minorUnitsSchema,

  /**
   * The term. Both are DAYS, not moments — normalised to UTC midnight by the
   * action, so that "due yesterday" means the same thing to a manager in Riyadh
   * and a server in another region.
   */
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),

  /**
   * The STORED lifecycle state — two values. `OVERDUE` is derived from
   * `dueDate` by `effectiveInvoiceStatus()`, because a stored value for it would
   * be wrong the moment the clock passed midnight and nothing runs to correct
   * it.
   */
  status: invoiceStatusSchema.default("PENDING"),

  /**
   * When it was settled. Stamped by the server from the transition it just
   * authorised, and cleared if the payment is reversed — a `paidAt` on a PENDING
   * row would be a timestamp for something that did not happen.
   */
  paidAt: z.coerce.date().nullable().optional(),

  /** Free-text terms printed on the document. */
  notes: mongo(z.string().max(500), { trim: true }).nullable().optional(),
});

export type InvoiceDocument = DocumentOf<typeof invoiceInputSchema>;

/**
 * No `refine` hook, deliberately, and for the reason `contract.ts` sets out at
 * length: `refine` registers a `pre("validate")` DOCUMENT hook, which runs on
 * `create()` but NOT on the `findOneAndUpdate` the DAL's `update()` issues. A
 * hook here would guard the path that rarely gets a term backwards and miss the
 * one that could.
 *
 * The `dueDate >= issueDate` rule is enforced in `src/lib/invoicing/schemas.ts`,
 * on the action payload, where both dates are in hand and the error can be
 * routed to the field the person just typed.
 */
export const Invoice = defineModel("Invoice", invoiceInputSchema, {
  collection: "invoices",
  indexes: [
    /**
     * The ledger, and the two derived-status filters.
     *
     * Tenant-first, as every index on a tenant-scoped collection must be. The
     * status/dueDate pair is what makes "overdue" cheap: the filter is
     * `{ status: "PENDING", dueDate: { $lt: today } }` — an equality on the
     * second key and a range on the third, exactly the shape a compound index
     * serves without touching a document that does not match.
     */
    { fields: { organizationId: 1, status: 1, dueDate: 1 } },

    // The default list order with no filter: most recently issued first.
    { fields: { organizationId: 1, issueDate: -1 } },

    /**
     * The CLIENT-narrowed ledger, in list order. `{ organizationId, clientId }`
     * would be a strict prefix of this, so this one index serves that read too
     * — a second declaration would be an index entry written on every insert
     * for no read that needs it.
     */
    { fields: { organizationId: 1, clientId: 1, status: 1, dueDate: 1 } },

    /**
     * "Has this approval already been billed?"
     *
     * Sparse, because `approvalId` is null on every directly-raised invoice and
     * a null-heavy index is mostly wasted entries. Deliberately NOT unique: the
     * guarantee that one approval yields one invoice is enforced by
     * `markApprovalInvoiced`, which refuses a chain that already carries an
     * `invoiceId`, and a partial unique index here would additionally forbid a
     * credit note pointing at the same chain.
     */
    { fields: { organizationId: 1, approvalId: 1 }, options: { sparse: true } },

    // Per-organization uniqueness of the invoice number. Partial, so a
    // soft-deleted row does not reserve a number forever.
    {
      fields: { organizationId: 1, invoiceNumber: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },
  ],
});
