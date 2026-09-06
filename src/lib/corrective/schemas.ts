import { z } from "zod";

import { workOrderInputSchema } from "@/lib/db";
import { workOrderPrioritySchema, workOrderStatusSchema } from "@/lib/domain/corrective";
import { objectIdString, pageParams } from "@/lib/validation/primitives";

/**
 * Every payload that reaches a corrective-maintenance action is parsed here
 * first.
 *
 * DERIVED from `workOrderInputSchema` rather than restated beside it, which is
 * the point of the zod-first pattern in CLAUDE.md: the model is the single
 * source of truth, so a bound or a coercion that changes there changes here
 * too, and the two cannot drift into a state where the database accepts
 * something the form rejects — or, far worse, the reverse.
 *
 * What the derivation deliberately changes:
 *
 *  - `organizationId` is never a field. It comes from the session's scope, and
 *    a payload that could name a tenant would defeat data isolation entirely.
 *  - `clientId` is never a field either, and this module is the one where that
 *    matters most. It is DERIVED from the asset's own client, and a client id a
 *    caller could name would let a staff user file another customer's fault
 *    against a customer who would then see it. The DAL keeps it in
 *    `RESERVED_FIELDS` independently; this is the outer half of the same rule.
 *  - `status` is never a field on create or update. It is moved only by the
 *    transition actions, which read the current value first and check it
 *    against `WORK_ORDER_TRANSITIONS`; a patchable status would let a caller
 *    jump straight from OPEN to CLOSED and skip the state machine the module
 *    exists to enforce.
 *  - `technicianId` is never a field on create or update either. Assignment is
 *    its own action with its own role list — a technician may move a ticket
 *    they hold, but only a supervisor decides who holds it.
 *  - `assignedAt`, `startedAt` and `closedAt` are never fields. A timestamp a
 *    client could choose is not evidence that anything happened.
 *  - ids arrive as 24-character hex strings, because that is what a URL and a
 *    JSON body carry. The DAL converts them, and treats them as filter terms
 *    that the scope is still layered on top of.
 *
 * `entity()` builds a `z.strictObject`, and `pick`/`partial`/`extend` preserve
 * that, so an unknown key is still rejected everywhere below.
 */

/**
 * The fields a person actually fills in. `assetId` is extended rather than
 * picked because the model stores it as an ObjectId and a request carries a hex
 * string; it is re-checked against the caller's organization in the action
 * before it is written — and, for a CLIENT, against their own partition, which
 * the scoped repository does on its own.
 */
const ticketFields = { issue: true, priority: true } as const;

export const createWorkOrderSchema = workOrderInputSchema.pick(ticketFields).extend({
  assetId: objectIdString,
});

/**
 * What can be corrected after the fact: the description, the severity, and the
 * asset it was filed against. Not the status, not the assignee — both have
 * their own actions and their own role lists.
 */
export const updateWorkOrderSchema = workOrderInputSchema
  .pick(ticketFields)
  .partial()
  .extend({
    id: objectIdString,
    assetId: objectIdString.optional(),
  });

export const deleteWorkOrderSchema = z.strictObject({ id: objectIdString });

/**
 * Assignment, which is the one transition that carries a payload.
 *
 * It is separate from `transitionWorkOrderSchema` because it needs a
 * technician: `-> ASSIGNED` cannot be expressed as "move this row to that
 * status" without also saying whose it now is, and an ASSIGNED row with a null
 * assignee is the exact state the status exists to rule out.
 */
export const assignWorkOrderSchema = z.strictObject({
  id: objectIdString,
  technicianId: objectIdString,
});

/**
 * Every other move: start, hold, resume, close, unassign.
 *
 * One schema and one action rather than five, because the rule they all share —
 * `canTransition(current, to)` — is the thing being enforced, and five handlers
 * would be five places for it to be forgotten. `to` is validated against the
 * status enum here, but that only proves it NAMES a status; whether it is
 * reachable from where the row actually is can only be decided by the action,
 * which reads the row first.
 */
export const transitionWorkOrderSchema = z.strictObject({
  id: objectIdString,
  to: workOrderStatusSchema,
});

export const listWorkOrdersSchema = z.strictObject({
  ...pageParams,
  /**
   * Plain equality on a stored value, unlike the preventive list's status
   * filter. Nothing here is derived from the clock, so there is no display
   * vocabulary to translate and the value can go straight into the DAL's
   * untrusted `filter` channel, which sanitizes it and rejects operators.
   */
  status: workOrderStatusSchema.optional(),
  priority: workOrderPrioritySchema.optional(),
  assetId: objectIdString.optional(),
  technicianId: objectIdString.optional(),
});

export const summariseWorkOrdersSchema = z.strictObject({});

export type CreateWorkOrderInput = z.input<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.input<typeof updateWorkOrderSchema>;
export type AssignWorkOrderInput = z.input<typeof assignWorkOrderSchema>;
export type TransitionWorkOrderInput = z.input<typeof transitionWorkOrderSchema>;
export type ListWorkOrdersInput = z.input<typeof listWorkOrdersSchema>;
