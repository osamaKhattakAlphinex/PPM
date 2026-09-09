"use server";

import { revalidatePath } from "next/cache";

import {
  approvalsRepository,
  connectToDatabase,
  ppmSchedulesRepository,
  requireObjectId,
  workOrdersRepository,
  type ApprovalDocument,
  type ApprovalHistoryEntry,
  type Page,
  type TenantScope,
} from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import {
  canActOnStage,
  canTransitionTo,
  isOpen,
  isTerminalStage,
  nextStage,
  type ApprovalStage,
} from "@/lib/domain/approvals";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { toApprovalSummary, type ApprovalSummary, type ApprovalTotals } from "./dto";
import {
  APPROVAL_COMPLETERS,
  APPROVAL_DECIDERS,
  APPROVAL_READERS,
  APPROVAL_REQUESTERS,
  listApprovalsForScope,
  summariseApprovalsForScope,
} from "./queries";
import { markApprovalInvoiced } from "./complete";
import {
  completeApprovalSchema,
  createApprovalSchema,
  decideApprovalSchema,
  getApprovalSchema,
  listApprovalsSchema,
  summariseApprovalsSchema,
} from "./schemas";

/**
 * The approval state machine, server-side.
 *
 * Everything above the business rule comes from `defineAction`: authenticate,
 * check the role, resolve the tenant scope, rate limit, parse with zod — in that
 * order, once, for all of them. What is left here is the machine itself, and it
 * is three rules:
 *
 *  1. A decision may only be taken by the role standing at the desk the row is
 *     ACTUALLY at, read back from the database, never from the request.
 *  2. An approval advances EXACTLY one stage. There is no payload field that
 *     names a destination, and `canTransitionTo` re-checks the step anyway.
 *  3. Every decision appends to `history[]` and nothing ever rewrites it.
 *
 * The role list on `decideApproval` is wide on purpose (see `APPROVAL_DECIDERS`
 * in `queries.ts`): the narrowing that matters is per-row, and doing it per-row
 * is what makes it correct as stages change.
 */

const REVALIDATE_PATH = "/[locale]/app/approvals";

async function requireApprovalInScope(
  scope: TenantScope,
  id: string,
): Promise<ApprovalDocument> {
  const approval = await approvalsRepository.forScope(scope).findById(id);
  if (!approval) throw new NotFoundError(`approval ${id} not in scope`);
  return approval;
}

/**
 * Resolve the counterparty for a new chain by reading the referenced document
 * back through ITS OWN scoped repository.
 *
 * This is the only place `clientId` is ever set on an approval, and it is set
 * from data the caller cannot influence: the id in the request is used as a
 * FILTER TERM, with organizationId layered on top by the DAL, so a reference to
 * another tenant's work order matches nothing and fails here — rather than
 * raising a chain that quietly names another customer.
 *
 * A `PM_REPORT` reference points at a PPM schedule, which has no `clientId` of
 * its own (see `ppm-schedule.ts`: preventive is provider-internal), so its
 * chains have no counterparty and stop at the CLIENT desk. An `INVOICE`
 * reference is not resolvable here at all — invoices are raised FROM approvals,
 * so a chain about one is raised by the invoicing module with the client already
 * in hand, and this path refuses it to avoid inventing a link.
 */
async function resolveReference(
  scope: TenantScope,
  refType: "WORK_ORDER" | "PM_REPORT" | "INVOICE",
  refId: string,
): Promise<{ clientId: ApprovalDocument["clientId"] }> {
  if (refType === "WORK_ORDER") {
    const workOrder = await workOrdersRepository
      .forScope(scope)
      .findById(refId, { select: ["_id", "clientId"] });
    if (!workOrder) {
      throw new ValidationError(`work order ${refId} is outside the actor's scope`, {
        refId: "Unknown work order.",
      });
    }
    return { clientId: workOrder.clientId ?? null };
  }

  if (refType === "PM_REPORT") {
    const schedule = await ppmSchedulesRepository
      .forScope(scope)
      .findById(refId, { select: ["_id"] });
    if (!schedule) {
      throw new ValidationError(`ppm schedule ${refId} is outside the actor's scope`, {
        refId: "Unknown maintenance schedule.",
      });
    }
    // Preventive is provider-internal and carries no counterparty.
    return { clientId: null };
  }

  throw new ValidationError("an invoice approval is raised by the invoicing module", {
    refType: "This kind of approval cannot be raised here.",
  });
}

/** The DTO for one row, from the perspective of the person who just acted. */
function summariseOne(document: ApprovalDocument, user: SessionUser): ApprovalSummary {
  return toApprovalSummary(document, {
    canDecide: isOpen(document.status) && canActOnStage(user.role, document.currentStage),
  });
}

function historyEntry(
  stage: ApprovalStage,
  action: "SUBMITTED" | "APPROVED" | "REJECTED",
  user: SessionUser,
  at: Date,
  reason?: string,
): ApprovalHistoryEntry {
  return {
    stage,
    action,
    // The schema guarantees 24 hex characters on a session id, so this cannot
    // throw — but casting through the DAL's helper keeps the one definition of
    // "how a hex string becomes an id" in the layer that owns it.
    actorId: requireObjectId(user.id),
    actorRole: user.role,
    reason: reason ?? null,
    at,
  };
}

// ---------------------------------------------------------------------------
// Raising a chain
// ---------------------------------------------------------------------------

const runCreateApproval = defineAction({
  name: "createApproval",
  roles: APPROVAL_REQUESTERS,
  input: createApprovalSchema,
  async handler({ input, scope, user }): Promise<ApprovalSummary> {
    await connectToDatabase();

    const { clientId } = await resolveReference(scope, input.refType, input.refId);

    /**
     * One open chain per thing.
     *
     * Two chains on the same work order would mean two audit trails and two
     * answers to "has this been signed off?", and the invoicing module keys off
     * the approved one — so the second would be either a duplicate invoice or a
     * silently ignored signature. A DECIDED chain does not block a new one: work
     * that was rejected, redone and resubmitted is a genuinely new request.
     */
    const existing = await approvalsRepository.forScope(scope).findOne({
      refType: input.refType,
      refId: requireObjectId(input.refId),
      status: "PENDING",
    });
    if (existing) {
      throw new ValidationError(`approval already open for ${input.refType} ${input.refId}`, {
        refId: "This item is already waiting for approval.",
      });
    }

    const now = new Date();

    const created = await approvalsRepository.forScope(scope).create({
      refType: input.refType,
      refId: input.refId,
      refLabel: input.refLabel,
      // From the referenced document, never from the request.
      clientId,
      requestedBy: user.id,
      currentStage: "TECHNICIAN",
      status: "PENDING",
      // The trail opens with who asked, so the history answers that question
      // without the reader having to know `requestedBy` exists.
      history: [historyEntry("TECHNICIAN", "SUBMITTED", user, now)],
    });

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(created, user);
  },
});

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

const runDecideApproval = defineAction({
  name: "decideApproval",
  roles: APPROVAL_DECIDERS,
  input: decideApprovalSchema,
  async handler({ input, scope, user }): Promise<ApprovalSummary> {
    await connectToDatabase();

    const current = await requireApprovalInScope(scope, input.id);

    /**
     * Decided items are final. Re-deciding one would put a second,
     * contradictory signature under the same trail — and for a REJECTED chain
     * would silently resurrect work that was refused.
     */
    if (!isOpen(current.status)) {
      throw new ValidationError(`approval ${input.id} is ${current.status}`, {
        id: "This item has already been decided.",
      });
    }

    /**
     * THE stage guard.
     *
     * `current.currentStage` came out of the database a line ago; nothing the
     * caller sent contributes to it. So this is a check on the pair (where the
     * row is, who is asking) and it is the reason a SUPERVISOR cannot approve
     * an item sitting at the FM desk — the exact test the product asks for.
     */
    if (!canActOnStage(user.role, current.currentStage)) {
      throw new ValidationError(
        `role ${user.role} cannot act at stage ${current.currentStage}`,
        { id: "This is waiting on someone else." },
      );
    }

    const now = new Date();
    const repository = approvalsRepository.forScope(scope);

    if (input.action === "REJECTED") {
      /**
       * A rejection stops the chain WHERE IT STANDS. The stage is not moved
       * back and not moved forward: the record has to say which desk refused
       * it, and moving the stage would erase that.
       */
      const updated = await repository.update(input.id, {
        status: "REJECTED",
        rejectionReason: input.reason ?? null,
        history: [
          ...current.history,
          historyEntry(current.currentStage, "REJECTED", user, now, input.reason),
        ],
      });
      if (!updated) throw new NotFoundError(`approval ${input.id} not in scope`);

      revalidatePath(REVALIDATE_PATH, "page");
      return summariseOne(updated, user);
    }

    /**
     * An approval advances exactly one stage.
     *
     * `nextStage` computes the destination and `canTransitionTo` re-checks it.
     * That looks redundant and is not: the second call is what makes the
     * "cannot skip a stage" property hold as a checkable invariant rather than
     * as a consequence of one array index, and it is the assertion the tests
     * exercise directly.
     */
    const destination = nextStage(current.currentStage);
    if (!destination || !canTransitionTo(current.currentStage, destination)) {
      throw new ValidationError(
        `approval ${input.id} cannot advance from ${current.currentStage}`,
        { id: "This item cannot move any further." },
      );
    }

    const arrived = isTerminalStage(destination);

    const updated = await repository.update(input.id, {
      currentStage: destination,
      /**
       * Reaching INVOICE_TRIGGER is what "ready to invoice" means. The status
       * moves to APPROVED and `approvedAt` is stamped by the server from the
       * decision it just authorised; both are what the invoicing module reads.
       * Short of that the chain is still PENDING — someone still owes it an
       * answer.
       */
      ...(arrived ? { status: "APPROVED" as const, approvedAt: now } : {}),
      history: [
        ...current.history,
        historyEntry(current.currentStage, "APPROVED", user, now),
      ],
    });
    if (!updated) throw new NotFoundError(`approval ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(updated, user);
  },
});

// ---------------------------------------------------------------------------
// Marking a chain billed
// ---------------------------------------------------------------------------

const runCompleteApproval = defineAction({
  name: "completeApproval",
  roles: APPROVAL_COMPLETERS,
  input: completeApprovalSchema,
  async handler({ input, scope, user }): Promise<ApprovalSummary> {
    await connectToDatabase();
    const updated = await markApprovalInvoiced(scope, input.id, input.invoiceId);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(updated, user);
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const runListApprovals = defineAction({
  name: "listApprovals",
  roles: APPROVAL_READERS,
  input: listApprovalsSchema,
  // A read behind a session. The mutation limiter exists to bound writes.
  rateLimit: null,
  async handler({ input, scope, user }): Promise<Page<ApprovalSummary>> {
    await connectToDatabase();
    return listApprovalsForScope(scope, user.role, input);
  },
});

const runSummariseApprovals = defineAction({
  name: "summariseApprovals",
  roles: APPROVAL_READERS,
  input: summariseApprovalsSchema,
  rateLimit: null,
  async handler({ scope }): Promise<ApprovalTotals> {
    await connectToDatabase();
    return summariseApprovalsForScope(scope);
  },
});

const runGetApproval = defineAction({
  name: "getApproval",
  roles: APPROVAL_READERS,
  input: getApprovalSchema,
  rateLimit: null,
  async handler({ input, scope, user }): Promise<ApprovalSummary> {
    await connectToDatabase();
    const document = await requireApprovalInScope(scope, input.id);
    return summariseOne(document, user);
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
//
// `defineAction` returns a value, and a "use server" module may only export
// async functions — so the wrappers are assigned to module consts above and
// re-exported as real async functions here.

export async function createApprovalAction(
  payload: unknown,
): Promise<ActionResult<ApprovalSummary>> {
  return runCreateApproval(payload);
}

export async function decideApprovalAction(
  payload: unknown,
): Promise<ActionResult<ApprovalSummary>> {
  return runDecideApproval(payload);
}

export async function completeApprovalAction(
  payload: unknown,
): Promise<ActionResult<ApprovalSummary>> {
  return runCompleteApproval(payload);
}

export async function listApprovalsAction(
  payload: unknown,
): Promise<ActionResult<Page<ApprovalSummary>>> {
  return runListApprovals(payload);
}

export async function summariseApprovalsAction(
  payload: unknown,
): Promise<ActionResult<ApprovalTotals>> {
  return runSummariseApprovals(payload);
}

export async function getApprovalAction(
  payload: unknown,
): Promise<ActionResult<ApprovalSummary>> {
  return runGetApproval(payload);
}
