import { z } from "zod";

import { approvalInputSchema } from "@/lib/db";
import {
  approvalRefTypeSchema,
  approvalStageSchema,
  approvalStatusSchema,
  REJECTION_REASON_MAX_LENGTH,
} from "@/lib/domain/approvals";
import { objectIdString, pageParams } from "@/lib/validation/primitives";

/**
 * Every payload that reaches an approvals action is parsed here first.
 *
 * Derived from `approvalInputSchema` where a field exists on the model, which is
 * the point of the zod-first pattern in CLAUDE.md: the model is the single
 * source of truth, so a bound that changes there changes here too.
 *
 * What the derivation deliberately changes:
 *
 *  - `organizationId` is never a field. It comes from the session's scope.
 *  - `clientId` is never a field. It is COPIED from the thing being approved by
 *    the action, which reads that thing back through its own scoped repository
 *    first. A caller-supplied counterparty would let someone route a chain into
 *    another customer's queue.
 *  - `requestedBy` is never a field. It is the session's own user id.
 *  - `currentStage` and `status` are never fields. They are moved only by
 *    `decideApproval`, which reads the row first and consults
 *    `canActOnStage` and `canTransitionTo`.
 *  - `history` is never a field. The server writes it from the decision it just
 *    authorised; an audit trail a caller could compose is not an audit trail.
 */

/**
 * Raising a chain.
 *
 * `refLabel` is accepted from the caller rather than derived, and that is worth
 * defending: the label is what the queue renders, and the only place that knows
 * a good one is the screen that raised the request — "WO-1183 · Chiller 2 not
 * cooling" reads better than anything this module could assemble from an id. It
 * is a display string with no query meaning, capped and trimmed by the model
 * schema it is derived from.
 */
export const createApprovalSchema = z.strictObject({
  refType: approvalRefTypeSchema,
  refId: objectIdString,
  refLabel: approvalInputSchema.shape.refLabel,
});

/**
 * Approve or reject, in ONE schema and one action.
 *
 * Two handlers would be two places for the stage guard to be forgotten, and the
 * guard is the whole module. `action` selects the branch; every check that
 * matters — may this role act at this desk, is the chain still open, does a
 * rejection carry a reason — runs before the branch is taken.
 */
export const decideApprovalSchema = z
  .strictObject({
    id: objectIdString,
    action: z.enum(["APPROVED", "REJECTED"]),
    /**
     * Mandatory on a rejection, refused on an approval.
     *
     * Refused rather than ignored on approval, because a "reason" stored
     * against an approval would read, later, as a caveat on a sign-off that
     * nobody actually caveated.
     */
    reason: z.string().trim().min(1).max(REJECTION_REASON_MAX_LENGTH).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.action === "REJECTED" && !input.reason) {
      ctx.addIssue({
        code: "custom",
        // Keyed to the field so `fieldErrorsFrom()` can route it to the input
        // the person is looking at; an issue with an empty path lands under `_`
        // where the form has nowhere to render it.
        path: ["reason"],
        message: "Say why this is being rejected.",
      });
    }

    if (input.action === "APPROVED" && input.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "An approval does not carry a reason.",
      });
    }
  });

/**
 * Marking a chain billed.
 *
 * Called by the INVOICING module, never by a screen in this one, which is why
 * it is a separate schema and a separate action with a different role list.
 */
export const completeApprovalSchema = z.strictObject({
  id: objectIdString,
  invoiceId: objectIdString,
});

export const listApprovalsSchema = z.strictObject({
  ...pageParams,
  status: approvalStatusSchema.optional(),
  stage: approvalStageSchema.optional(),
  refType: approvalRefTypeSchema.optional(),
  /**
   * "Only what is waiting on me."
   *
   * A boolean rather than a stage, because the stage it resolves to is a
   * property of the SESSION's role and must not be nameable by the caller —
   * `mine=true` from a supervisor means SUPERVISOR whatever they type.
   */
  mine: z.coerce.boolean().optional(),
});

export const summariseApprovalsSchema = z.strictObject({});

export const getApprovalSchema = z.strictObject({ id: objectIdString });

export type CreateApprovalInput = z.input<typeof createApprovalSchema>;
export type DecideApprovalInput = z.input<typeof decideApprovalSchema>;
export type CompleteApprovalInput = z.input<typeof completeApprovalSchema>;
export type ListApprovalsInput = z.input<typeof listApprovalsSchema>;
