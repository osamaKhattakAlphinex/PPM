import { z } from "zod";

import { ppmScheduleInputSchema } from "@/lib/db";
import { ppmDisplayStatusSchema, ppmFrequencySchema } from "@/lib/domain/preventive";
import { objectIdString, pageParams } from "@/lib/validation/primitives";

/**
 * Every payload that reaches a preventive-maintenance action is parsed here
 * first.
 *
 * DERIVED from `ppmScheduleInputSchema` rather than restated beside it, which is
 * the point of the zod-first pattern in CLAUDE.md: the model is the single
 * source of truth, so a bound or a coercion that changes there changes here too,
 * and the two cannot drift into a state where the database accepts something the
 * form rejects — or, far worse, the reverse.
 *
 * What the derivation deliberately changes:
 *
 *  - `organizationId` is never a field. It comes from the session's scope, and a
 *    payload that could name a tenant would defeat data isolation entirely.
 *  - `status` is never a field on create or update. It is moved only by the
 *    transition actions, which read the current value first; a patchable status
 *    would let a client jump straight from SCHEDULED to COMPLETED and skip the
 *    state machine the module exists to enforce.
 *  - `startedAt` and `completedAt` are never fields either. A timestamp a client
 *    could choose is not evidence that anything happened.
 *  - ids arrive as 24-character hex strings, because that is what a URL and a
 *    JSON body carry. The DAL converts them, and treats them as filter terms
 *    that the scope is still layered on top of.
 *
 * `entity()` builds a `z.strictObject`, and `pick`/`partial`/`extend` preserve
 * that, so an unknown key is still rejected everywhere below.
 */

/**
 * The fields a person actually fills in. `assetId` and `technicianId` are
 * extended rather than picked because the model stores them as ObjectIds and a
 * request carries hex strings; both are re-checked against the caller's
 * organization in the action before they are written.
 */
const scheduleFields = { type: true, dueDate: true } as const;

export const createPpmScheduleSchema = ppmScheduleInputSchema.pick(scheduleFields).extend({
  assetId: objectIdString,
  technicianId: objectIdString,
});

/**
 * Everything on a schedule is correctable: a visit gets rebooked, reassigned,
 * or was filed against the wrong asset. The one thing an update cannot do is
 * move `status` — see the header.
 */
export const updatePpmScheduleSchema = ppmScheduleInputSchema
  .pick(scheduleFields)
  .partial()
  .extend({
    id: objectIdString,
    assetId: objectIdString.optional(),
    technicianId: objectIdString.optional(),
  });

export const deletePpmScheduleSchema = z.strictObject({ id: objectIdString });

/**
 * The two transitions. Both take nothing but an id: what they set is decided by
 * the server from the row's current state, not proposed by the caller.
 */
export const startPpmScheduleSchema = z.strictObject({ id: objectIdString });
export const completePpmScheduleSchema = z.strictObject({ id: objectIdString });

export const listPpmSchedulesSchema = z.strictObject({
  ...pageParams,
  type: ppmFrequencySchema.optional(),
  /**
   * The DISPLAY vocabulary, not the stored one — a person filters for "overdue",
   * which is not a value any row holds. `listPpmSchedulesForScope` translates it
   * into a code-authored fragment over `status` and `dueDate`; the value itself
   * is only ever used to look up that fragment in a literal map, never
   * interpolated into a query.
   */
  status: ppmDisplayStatusSchema.optional(),
  assetId: objectIdString.optional(),
  technicianId: objectIdString.optional(),
});

export const summarisePpmSchedulesSchema = z.strictObject({});

export type CreatePpmScheduleInput = z.input<typeof createPpmScheduleSchema>;
export type UpdatePpmScheduleInput = z.input<typeof updatePpmScheduleSchema>;
export type ListPpmSchedulesInput = z.input<typeof listPpmSchedulesSchema>;
