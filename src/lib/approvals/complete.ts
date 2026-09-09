import "server-only";

import {
  approvalsRepository,
  type ApprovalDocument,
  type TenantScope,
} from "@/lib/db";
import { isTerminalStage } from "@/lib/domain/approvals";
import { NotFoundError, ValidationError } from "@/lib/security/errors";

/**
 * Move an APPROVED chain to COMPLETED and link the invoice raised from it.
 *
 * This lives OUTSIDE `actions.ts`, and the reason is a security one rather than
 * a tidiness one. Every export of a `"use server"` module becomes a callable
 * endpoint, so a function taking a `TenantScope` argument would be a function
 * any browser could call with a scope of its own choosing — the exact opposite
 * of "scope comes from the session, never from input". Here it is an ordinary
 * `server-only` function: the invoicing module calls it in-process with a scope
 * `defineAction` already resolved, and there is no wire format for it at all.
 *
 * The rule it states once, for both callers: an invoice may only be raised from
 * a chain that actually reached INVOICE_TRIGGER, and only once.
 */
export async function markApprovalInvoiced(
  scope: TenantScope,
  approvalId: string,
  invoiceId: string,
): Promise<ApprovalDocument> {
  const repository = approvalsRepository.forScope(scope);

  const current = await repository.findById(approvalId);
  if (!current) throw new NotFoundError(`approval ${approvalId} not in scope`);

  if (current.status !== "APPROVED" || !isTerminalStage(current.currentStage)) {
    throw new ValidationError(
      `approval ${approvalId} is not ready to invoice (${current.status}/${current.currentStage})`,
      { approvalId: "This item has not been fully approved yet." },
    );
  }

  if (current.invoiceId) {
    throw new ValidationError(`approval ${approvalId} has already been invoiced`, {
      approvalId: "An invoice has already been raised for this item.",
    });
  }

  const updated = await repository.update(approvalId, {
    status: "COMPLETED",
    invoiceId,
    completedAt: new Date(),
  });
  if (!updated) throw new NotFoundError(`approval ${approvalId} not in scope`);

  return updated;
}
