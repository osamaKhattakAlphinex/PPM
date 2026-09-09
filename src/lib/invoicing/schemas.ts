import { z } from "zod";

import { invoiceInputSchema } from "@/lib/db";
import { sarInputSchema } from "@/lib/domain/currency";
import { invoiceDisplayStatusSchema } from "@/lib/domain/invoicing";
import { objectIdString, pageParams } from "@/lib/validation/primitives";

/**
 * Every payload that reaches an invoicing action is parsed here first.
 *
 * Derived from `invoiceInputSchema`, which is the point of the zod-first
 * pattern in CLAUDE.md: the model is the single source of truth, so a bound that
 * changes there changes here too.
 *
 * What the derivation deliberately changes, and this list IS the security model
 * of the module:
 *
 *  - `organizationId` is never a field. It comes from the session's scope.
 *  - `vat`, `total` and `vatRate` are never fields, on any schema, anywhere.
 *    They are computed by `computeInvoiceTotals` inside the action. There is no
 *    client total to trust and therefore none to validate — the strongest form
 *    of "never trust client totals" is to have no wire representation for them
 *    at all.
 *  - `status` is never a field. It is moved only by `settleInvoice`, which
 *    stamps `paidAt` from the server's clock.
 *  - `paidAt` is never a field. A timestamp a caller could choose is not
 *    evidence that money arrived.
 *  - `clientId` is on the DIRECT create path only, as a hex string re-checked
 *    against the caller's organization in the action. On the approval path it
 *    is not accepted at all: it is copied from the approval, which had copied it
 *    from the work order.
 *  - `invoiceNumber` is create-only. It goes on a bank transfer.
 */

/** The one field not derived from the model: a person types RIYALS. */
const moneyField = sarInputSchema;

/**
 * Raising an invoice from an approved chain — the ordinary path.
 *
 * There is no `clientId` here and that is the interesting absence: everything
 * about who is being billed comes from the approval, which the action reads back
 * through the SCOPED repository and checks has actually reached
 * INVOICE_TRIGGER. A caller can name the chain and the money and nothing else.
 */
export const createInvoiceFromApprovalSchema = z.strictObject({
  approvalId: objectIdString,
  invoiceNumber: invoiceInputSchema.shape.invoiceNumber,
  amount: moneyField,
  /** Defaults to today, and to today + the standard term, inside the action. */
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Raising one directly, without a chain.
 *
 * Gated on a NARROWER role list than the approval path (`INVOICE_RAISERS`,
 * management only) because this is the path with no signatures behind it — a
 * mobilisation fee or an AMC instalment, raised by the person who is
 * commercially accountable for it. `workRef` is required here precisely because
 * nothing else says what the money is for.
 */
export const createInvoiceSchema = z.strictObject({
  clientId: objectIdString,
  invoiceNumber: invoiceInputSchema.shape.invoiceNumber,
  workRef: invoiceInputSchema.shape.workRef,
  contractId: objectIdString.optional(),
  amount: moneyField,
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Correcting one before it is settled.
 *
 * `amount` may be corrected and the VAT is RECOMPUTED from it by the action —
 * never patched alongside it, which is what stops a corrected invoice carrying
 * the old tax.
 */
export const updateInvoiceSchema = z
  .strictObject({
    id: objectIdString,
    workRef: invoiceInputSchema.shape.workRef.optional(),
    amount: moneyField.optional(),
    issueDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((input, ctx) => {
    /**
     * A term is a PAIR, and this layer only ever sees the payload — so a patch
     * that moves one end and not the other cannot be checked here at all.
     * Refusing the half-payload keeps ONE rule: every write that touches the
     * term carries the WHOLE term, and the whole term is checked right here.
     * The same argument `src/lib/amc/schemas.ts` sets out in full.
     */
    const hasIssue = input.issueDate !== undefined;
    const hasDue = input.dueDate !== undefined;

    if (hasIssue !== hasDue) {
      ctx.addIssue({
        code: "custom",
        path: [hasIssue ? "dueDate" : "issueDate"],
        message: "Change both dates together, or neither.",
      });
      return;
    }

    if (input.issueDate && input.dueDate && input.dueDate < input.issueDate) {
      ctx.addIssue({
        code: "custom",
        // Reported on the DUE date: it is the one the person just typed and the
        // one they can fix without rethinking the invoice.
        path: ["dueDate"],
        message: "The due date cannot be before the issue date.",
      });
    }
  });

/** Marking an invoice settled, or reversing that. One schema, one rule. */
export const settleInvoiceSchema = z.strictObject({
  id: objectIdString,
  paid: z.coerce.boolean(),
});

export const deleteInvoiceSchema = z.strictObject({ id: objectIdString });

export const listInvoicesSchema = z.strictObject({
  ...pageParams,
  /**
   * The DISPLAY vocabulary, not the stored one. A person filters for "overdue",
   * which is not a value any row holds; the name selects a branch of
   * `invoiceStatusQueryFragment`, which returns a code-authored fragment for the
   * DAL's TRUSTED `where` channel. The name itself never reaches a query.
   */
  status: invoiceDisplayStatusSchema.optional(),
  clientId: objectIdString.optional(),
});

export const summariseInvoicesSchema = z.strictObject({});

export const invoiceableApprovalsSchema = z.strictObject({});

export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;
export type CreateInvoiceFromApprovalInput = z.input<typeof createInvoiceFromApprovalSchema>;
export type UpdateInvoiceInput = z.input<typeof updateInvoiceSchema>;
export type ListInvoicesInput = z.input<typeof listInvoicesSchema>;
