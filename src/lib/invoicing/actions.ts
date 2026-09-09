"use server";

import { revalidatePath } from "next/cache";

import {
  approvalsRepository,
  clientExistsInScope,
  clientsRepository,
  connectToDatabase,
  contractsRepository,
  invoicesRepository,
  isClientScope,
  type InvoiceDocument,
  type Page,
  type TenantScope,
} from "@/lib/db";
import { markApprovalInvoiced } from "@/lib/approvals/complete";
import { isReadyToInvoice } from "@/lib/domain/approvals";
import { addUtcDays, startOfUtcDay } from "@/lib/domain/dates";
import {
  computeInvoiceTotals,
  DEFAULT_PAYMENT_TERM_DAYS,
  VAT_RATE_BASIS_POINTS,
} from "@/lib/domain/invoicing";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { toInvoiceSummary, type InvoiceSummary, type InvoiceTotalsView } from "./dto";
import {
  INVOICE_RAISERS,
  INVOICE_READERS,
  listInvoicesForScope,
  summariseInvoicesForScope,
} from "./queries";
import {
  createInvoiceFromApprovalSchema,
  createInvoiceSchema,
  deleteInvoiceSchema,
  listInvoicesSchema,
  settleInvoiceSchema,
  summariseInvoicesSchema,
  updateInvoiceSchema,
} from "./schemas";

/**
 * Invoicing, server-side.
 *
 * Everything above the business rule comes from `defineAction`: authenticate,
 * check the role, resolve the tenant scope, rate limit, parse with zod. What is
 * left here is three things that are specific to money:
 *
 *  1. **The totals are computed here and only here.** `computeInvoiceTotals`
 *     takes the net and returns the VAT and the gross. No payload schema has a
 *     `vat` or `total` field, so there is no client figure to trust and none to
 *     check — the strongest form of "never trust client totals" is to give them
 *     no wire representation at all.
 *  2. **A chain must have finished before it can be billed.** The approval path
 *     reads the chain back through the SCOPED repository and refuses anything
 *     that has not reached INVOICE_TRIGGER, then hands the linking to
 *     `markApprovalInvoiced`, which additionally refuses a second invoice on the
 *     same chain.
 *  3. **A settled invoice is a record.** It cannot be edited, only reversed and
 *     then corrected, so that what was sent to a customer is never quietly
 *     rewritten.
 *
 * Every write is gated on `INVOICE_RAISERS`, so a CLIENT session is refused by
 * `requireRole` before its payload is even parsed.
 */

const REVALIDATE_PATH = "/[locale]/app/invoicing";

async function requireInvoiceInScope(scope: TenantScope, id: string): Promise<InvoiceDocument> {
  const invoice = await invoicesRepository.forScope(scope).findById(id);
  if (!invoice) throw new NotFoundError(`invoice ${id} not in scope`);
  return invoice;
}

/**
 * Read a client back through the SCOPED repository.
 *
 * A `clientId` that arrived in a request is never trusted to live inside the
 * caller's tenant: `clientExistsInScope` treats the id as a filter term with
 * organizationId layered on top, so one from another organization matches
 * nothing and fails here with a field message rather than being written as the
 * addressee of an invoice the caller cannot see.
 */
async function requireClientInScope(scope: TenantScope, clientId: string): Promise<void> {
  if (!(await clientExistsInScope(scope, clientId))) {
    throw new ValidationError(`clientId ${clientId} is outside the actor's organization`, {
      clientId: "Unknown client.",
    });
  }
}

/** Resolve the client name for one row, for the response the sheet renders. */
async function summariseOne(
  scope: TenantScope,
  document: InvoiceDocument,
): Promise<InvoiceSummary> {
  if (isClientScope(scope)) return toInvoiceSummary(document, null);

  const client = await clientsRepository
    .forScope(scope)
    .findById(document.clientId, { select: ["_id", "name"] });

  return toInvoiceSummary(document, client?.name ?? null);
}

/**
 * The term, normalised to whole UTC days.
 *
 * Both ends default rather than only the due date: an invoice with an issue date
 * and no term is an invoice nobody has to pay, and one with a term measured from
 * an un-normalised instant is one whose "overdue" flips at a different moment
 * for every tenant. `DEFAULT_PAYMENT_TERM_DAYS` is a default and not a rule —
 * payment terms are negotiated per contract, and a constant that could not be
 * overridden is a constant somebody works around by back-dating.
 */
function resolveTerm(issueDate: Date | undefined, dueDate: Date | undefined, now: Date) {
  const issued = startOfUtcDay(issueDate ?? now);
  const due = dueDate ? startOfUtcDay(dueDate) : addUtcDays(issued, DEFAULT_PAYMENT_TERM_DAYS);

  if (due < issued) {
    throw new ValidationError("dueDate is before issueDate", {
      dueDate: "The due date cannot be before the issue date.",
    });
  }

  return { issued, due };
}

// ---------------------------------------------------------------------------
// Raising
// ---------------------------------------------------------------------------

const runCreateInvoiceFromApproval = defineAction({
  name: "createInvoiceFromApproval",
  roles: INVOICE_RAISERS,
  input: createInvoiceFromApprovalSchema,
  async handler({ input, scope }): Promise<InvoiceSummary> {
    await connectToDatabase();

    /**
     * The chain, read back through the SCOPED repository. An approval id from
     * another tenant is a filter term that matches nothing, so it 404s here
     * rather than being billed.
     */
    const approval = await approvalsRepository.forScope(scope).findById(input.approvalId);
    if (!approval) {
      throw new ValidationError(`approval ${input.approvalId} is outside the actor's scope`, {
        approvalId: "Unknown approval.",
      });
    }

    /**
     * THE gate the product asks for: an invoice may only be generated from an
     * approval that reached INVOICE_TRIGGER. `isReadyToInvoice` is the same
     * predicate the approvals module exposes, so the two cannot drift.
     */
    if (!isReadyToInvoice(approval.status, approval.currentStage)) {
      throw new ValidationError(
        `approval ${input.approvalId} is ${approval.status}/${approval.currentStage}`,
        { approvalId: "This item has not been fully approved yet." },
      );
    }

    /**
     * A chain with no counterparty has nobody to bill. That is a real state —
     * preventive work on the provider's own depot — and the honest answer is to
     * refuse rather than to invent an addressee.
     */
    if (!approval.clientId) {
      throw new ValidationError(`approval ${input.approvalId} has no client`, {
        approvalId: "This work was not done for a client, so it cannot be invoiced.",
      });
    }

    const now = new Date();
    const { issued, due } = resolveTerm(input.issueDate, input.dueDate, now);

    // The whole of the money arithmetic, in one call, from the net alone.
    const totals = computeInvoiceTotals(input.amount, VAT_RATE_BASIS_POINTS);

    const created = await invoicesRepository.forScope(scope).create({
      // Copied from the approval, which had copied it from the work order.
      // Never from the request.
      clientId: approval.clientId,
      invoiceNumber: input.invoiceNumber,
      // Snapshot of what the work was, so the document reads on its own later.
      workRef: approval.refLabel,
      approvalId: approval._id,
      amount: totals.amount,
      vatRate: totals.vatRate,
      vat: totals.vat,
      total: totals.total,
      issueDate: issued,
      dueDate: due,
      status: "PENDING",
      notes: input.notes ?? null,
    });

    /**
     * Link the chain LAST, and through the approvals module's own function.
     *
     * It re-reads the approval and refuses one that already carries an
     * `invoiceId`, so two managers racing to bill the same chain produce one
     * invoice and one clear error rather than two documents. The order matters:
     * if this throws, the invoice above exists but is unlinked, which a person
     * can see and void — whereas linking first and failing to create would mark
     * a chain billed with no invoice behind it.
     */
    await markApprovalInvoiced(scope, approval._id.toHexString(), created._id.toHexString());

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, created);
  },
});

const runCreateInvoice = defineAction({
  name: "createInvoice",
  roles: INVOICE_RAISERS,
  input: createInvoiceSchema,
  async handler({ input, scope }): Promise<InvoiceSummary> {
    await connectToDatabase();

    await requireClientInScope(scope, input.clientId);

    /**
     * The contract, if one was named, re-read through the SCOPED repository —
     * and additionally checked to belong to the SAME client. Without that
     * second check an invoice could cite another customer's contract number,
     * which is a disclosure as well as a mistake.
     */
    if (input.contractId) {
      const contract = await contractsRepository
        .forScope(scope)
        .findById(input.contractId, { select: ["_id", "clientId"] });

      if (!contract || contract.clientId.toHexString() !== input.clientId) {
        throw new ValidationError(`contract ${input.contractId} is not this client's`, {
          contractId: "Unknown contract for this client.",
        });
      }
    }

    const now = new Date();
    const { issued, due } = resolveTerm(input.issueDate, input.dueDate, now);
    const totals = computeInvoiceTotals(input.amount, VAT_RATE_BASIS_POINTS);

    const created = await invoicesRepository.forScope(scope).create({
      clientId: input.clientId,
      invoiceNumber: input.invoiceNumber,
      workRef: input.workRef,
      contractId: input.contractId ?? null,
      amount: totals.amount,
      vatRate: totals.vatRate,
      vat: totals.vat,
      total: totals.total,
      issueDate: issued,
      dueDate: due,
      status: "PENDING",
      notes: input.notes ?? null,
    });

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, created);
  },
});

// ---------------------------------------------------------------------------
// Correcting and settling
// ---------------------------------------------------------------------------

const runUpdateInvoice = defineAction({
  name: "updateInvoice",
  roles: INVOICE_RAISERS,
  input: updateInvoiceSchema,
  async handler({ input, scope }): Promise<InvoiceSummary> {
    await connectToDatabase();

    const { id, ...patch } = input;
    const current = await requireInvoiceInScope(scope, id);

    /**
     * A settled invoice is a record of money that arrived against a stated
     * amount. Editing it would change what the record says was owed, which is
     * the one thing an audit trail must not permit. Reverse the payment first if
     * the document was genuinely wrong.
     */
    if (current.status === "PAID") {
      throw new ValidationError(`invoice ${id} is paid and cannot be edited`, {
        id: "A paid invoice cannot be changed. Reverse the payment first.",
      });
    }

    /**
     * The VAT is RECOMPUTED whenever the amount moves, from the rate the
     * document was raised at — not from the current constant, so a rate change
     * does not silently restate an old invoice. Nothing patches `vat` or `total`
     * on their own, so the three figures cannot come apart.
     */
    const money =
      patch.amount === undefined
        ? {}
        : (() => {
            const totals = computeInvoiceTotals(patch.amount, current.vatRate);
            return { amount: totals.amount, vat: totals.vat, total: totals.total };
          })();

    const term =
      patch.issueDate && patch.dueDate
        ? (() => {
            const { issued, due } = resolveTerm(patch.issueDate, patch.dueDate, new Date());
            return { issueDate: issued, dueDate: due };
          })()
        : {};

    const updated = await invoicesRepository.forScope(scope).update(id, {
      ...(patch.workRef !== undefined ? { workRef: patch.workRef } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...money,
      ...term,
    });

    if (!updated) throw new NotFoundError(`invoice ${id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

const runSettleInvoice = defineAction({
  name: "settleInvoice",
  roles: INVOICE_RAISERS,
  input: settleInvoiceSchema,
  async handler({ input, scope }): Promise<InvoiceSummary> {
    await connectToDatabase();

    const current = await requireInvoiceInScope(scope, input.id);
    const target = input.paid ? "PAID" : "PENDING";

    if (current.status === target) {
      /**
       * A field error on `id`, which the client treats as "the row moved under
       * you": two managers pressing "mark paid" at once should leave one
       * success and one instruction to reload, not two writes.
       */
      throw new ValidationError(`invoice ${input.id} is already ${target}`, {
        id: "This invoice has already moved on.",
      });
    }

    const updated = await invoicesRepository.forScope(scope).update(input.id, {
      status: target,
      // Stamped by the server from the transition it just authorised, and
      // CLEARED on reversal — a `paidAt` on a pending row would be a timestamp
      // for something that did not happen.
      paidAt: input.paid ? new Date() : null,
    });

    if (!updated) throw new NotFoundError(`invoice ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

const runDeleteInvoice = defineAction({
  name: "deleteInvoice",
  roles: INVOICE_RAISERS,
  input: deleteInvoiceSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    const current = await requireInvoiceInScope(scope, input.id);

    // A paid invoice is the counterpart of money that arrived. Withdrawing it
    // would leave a payment with nothing to have paid for.
    if (current.status === "PAID") {
      throw new ValidationError(`invoice ${input.id} is paid and cannot be withdrawn`, {
        id: "A paid invoice cannot be withdrawn.",
      });
    }

    const deleted = await invoicesRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`invoice ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const runListInvoices = defineAction({
  name: "listInvoices",
  roles: INVOICE_READERS,
  input: listInvoicesSchema,
  // A read behind a session. The mutation limiter exists to bound writes.
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<InvoiceSummary>> {
    await connectToDatabase();
    return listInvoicesForScope(scope, input);
  },
});

const runSummariseInvoices = defineAction({
  name: "summariseInvoices",
  roles: INVOICE_READERS,
  input: summariseInvoicesSchema,
  rateLimit: null,
  async handler({ scope }): Promise<InvoiceTotalsView> {
    await connectToDatabase();
    return summariseInvoicesForScope(scope);
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export async function createInvoiceAction(
  _previous: ActionResult<InvoiceSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<InvoiceSummary>> {
  return runCreateInvoice(payload);
}

export async function createInvoiceFromApprovalAction(
  _previous: ActionResult<InvoiceSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<InvoiceSummary>> {
  return runCreateInvoiceFromApproval(payload);
}

export async function updateInvoiceAction(
  _previous: ActionResult<InvoiceSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<InvoiceSummary>> {
  return runUpdateInvoice(payload);
}

export async function settleInvoiceAction(
  payload: unknown,
): Promise<ActionResult<InvoiceSummary>> {
  return runSettleInvoice(payload);
}

export async function deleteInvoiceAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  return runDeleteInvoice(payload);
}

export async function listInvoicesAction(
  payload: unknown,
): Promise<ActionResult<Page<InvoiceSummary>>> {
  return runListInvoices(payload);
}

export async function summariseInvoicesAction(
  payload: unknown,
): Promise<ActionResult<InvoiceTotalsView>> {
  return runSummariseInvoices(payload);
}
