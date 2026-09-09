import { z } from "zod";

import {
  approvalActionSchema,
  approvalRefTypeSchema,
  approvalStageSchema,
  approvalStatusSchema,
  REJECTION_REASON_MAX_LENGTH,
} from "../../domain/approvals";
import { roleSchema } from "../../auth/roles";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One item making its way up the approval chain, plus everything that happened
 * to it on the way.
 *
 * The chain itself — the stage order, who may act at each desk, what counts as
 * a legal move — is in `src/lib/domain/approvals.ts`, not here. This file is
 * only the shape of the record.
 *
 * ## clientId is present and NULLABLE
 *
 * The same shape as `WorkOrder`, and for a sharper reason. The CLIENT desk is a
 * stage in the chain, so a customer has to be able to open this module and see
 * the items waiting on them — which means the collection must be
 * client-partitioned, or the DAL would refuse a client session outright.
 *
 * Nullable, because not every chain belongs to a customer: a PM report on the
 * provider's own depot has no counterparty, and `clientId: null` is the honest
 * record of that. Such a chain simply never has anything to show at the CLIENT
 * desk — and `advanceStage` skips no stages, so it stops there and waits, which
 * is a real operational state a manager can see and act on rather than a silent
 * hole.
 *
 * The value is COPIED from whatever the approval points at, by the action that
 * raises it, and is never accepted from a request. It is also not patchable:
 * `clientId` is in the DAL's `RESERVED_FIELDS`.
 *
 * ## history[] is append-only
 *
 * Nothing in this module updates a history entry, and nothing deletes one. The
 * only write is a `$push`-shaped whole-array replacement in `decideApproval`,
 * which reads the current array and writes it back with one entry added. That
 * is the audit trail the product asks for, and its value is entirely in the
 * fact that it is never rewritten.
 */

/**
 * One thing a person did.
 *
 * `actorRole` is SNAPSHOT rather than resolved from the user at read time, and
 * that is the same decision `ChecklistRun` makes about its item labels: the
 * record has to say what was true when it happened. A supervisor promoted to FM
 * manager next year must not retroactively become the person who signed off as
 * FM manager, and a user later deleted must not take their half of the trail
 * with them.
 */
export const approvalHistoryEntrySchema = z.strictObject({
  /** The desk this happened at. */
  stage: approvalStageSchema,
  action: approvalActionSchema,

  /** Who. An id, so the trail survives a rename. */
  actorId: objectId("User"),

  /** The role they held AT THE TIME. Snapshot — see the header. */
  actorRole: roleSchema,

  /**
   * Why, for a rejection. Nullable rather than absent so the path always
   * exists; `requiresReason()` is what makes it mandatory on the one action
   * that needs it, and the payload schema enforces that before this is written.
   */
  reason: mongo(z.string().max(REJECTION_REASON_MAX_LENGTH), { trim: true })
    .nullable()
    .optional(),

  /** Stamped by the server from the request it just authorised. */
  at: z.coerce.date(),
});

export type ApprovalHistoryEntry = z.infer<typeof approvalHistoryEntrySchema>;

export const approvalInputSchema = entity({
  /**
   * What is being approved: a discriminator and an id.
   *
   * Not a `ref`, deliberately — the id points into one of three collections
   * depending on `refType`, and a single `ref` would be a lie to `populate()`
   * (which the DAL forbids anyway). Every read that needs the referenced row
   * fetches it through that collection's own SCOPED repository.
   */
  refType: approvalRefTypeSchema,
  refId: objectId(),

  /**
   * A human-readable handle for the thing — "WO-1183", "PPM-4471".
   *
   * Snapshot, like `ChecklistRun.checklistName`: the queue has to be readable
   * without four cross-collection reads per row, and the record has to survive
   * the referenced document being soft-deleted.
   */
  refLabel: mongo(z.string().min(1).max(120), { trim: true }),

  /** The counterparty, or null for the provider's own work. See the header. */
  clientId: objectId("Client").nullable().optional(),

  /** Who raised the chain. Also recorded as the first `history[]` entry. */
  requestedBy: objectId("User"),

  /** Which desk it is on right now. Moved only by `decideApproval`. */
  currentStage: approvalStageSchema.default("TECHNICIAN"),

  /** Where the chain as a whole stands. See `domain/approvals.ts`. */
  status: approvalStatusSchema.default("PENDING"),

  /**
   * The reason the chain stopped, copied up from the rejecting history entry.
   *
   * Denormalised on purpose: the queue shows it on the row, and digging the
   * last entry out of `history[]` for every rejected row would mean shipping
   * the whole trail to the browser to render one sentence.
   */
  rejectionReason: mongo(z.string().max(REJECTION_REASON_MAX_LENGTH), { trim: true })
    .nullable()
    .optional(),

  /**
   * When it reached INVOICE_TRIGGER. Null until it does.
   *
   * This is the field Invoicing keys off, together with `status === "APPROVED"`.
   * A timestamp rather than a boolean because "ready to invoice, and has been
   * for eleven days" is the useful question.
   */
  approvedAt: z.coerce.date().nullable().optional(),

  /**
   * The invoice that was actually raised from it, and when.
   *
   * Written by the invoicing module through `completeApproval`, which is the
   * only thing that moves the status to COMPLETED. Keeping the link here as
   * well as on the invoice means "was this billed?" is answerable from the
   * approval alone, which is the direction the approvals queue asks it in.
   */
  invoiceId: objectId("Invoice").nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),

  /**
   * The trail. Append-only — see the header.
   *
   * Capped so a pathological loop cannot grow a document without bound. The
   * chain is five stages, so a legitimate trail is at most six entries
   * (submission plus five decisions); fifty is room for a redesign and still
   * far short of the 16MB document limit.
   */
  history: z.array(approvalHistoryEntrySchema).max(50).default([]),
});

export type ApprovalDocument = DocumentOf<typeof approvalInputSchema>;

export const Approval = defineModel("Approval", approvalInputSchema, {
  collection: "approvals",
  indexes: [
    /**
     * The pending queue, which is the screen: "what is sitting at MY desk?".
     * Tenant first, then the two equality terms the query always carries, then
     * the sort key. An equality/equality/range shape is exactly what a compound
     * index serves without touching a non-matching document.
     */
    { fields: { organizationId: 1, status: 1, currentStage: 1, createdAt: -1 } },

    /**
     * The CLIENT-narrowed queue. `{ organizationId, clientId }` would be a
     * strict prefix of this, so this one index serves that read too — a second
     * declaration would be an index entry written on every insert for no read
     * that needs it.
     */
    { fields: { organizationId: 1, clientId: 1, status: 1, currentStage: 1 } },

    /**
     * "Is there already a chain on this work order?" — asked by
     * `createApproval` before it raises a second one, and by every screen that
     * shows an approval state beside the thing being approved.
     */
    { fields: { organizationId: 1, refType: 1, refId: 1 } },

    /**
     * What Invoicing reads: everything approved and not yet billed, oldest
     * first. `approvedAt` is null for every other row, and MongoDB indexes
     * nulls, so this stays a narrow range walk rather than a scan.
     */
    { fields: { organizationId: 1, status: 1, approvedAt: 1 } },
  ],
});
