import { z } from "zod";

import { coordinatesSchema } from "../../domain/attendance";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One technician, one day: when they started, when they stopped, and — only
 * with consent — where they were when they did.
 *
 * ## One record per technician per day
 *
 * Enforced by a partial unique index, not by convention. A second row for the
 * same day would mean two answers to "is this person on site?", and the check-in
 * action reads the day's record before it writes — so without the index a race
 * between two taps on a flaky connection produces two open shifts and no way to
 * close either.
 *
 * ## No clientId
 *
 * Deliberate, and the fail-closed direction. `techniciansRepository` has no
 * `clientId` either: the workforce is the provider's, not the customer's. Both
 * collections therefore REFUSE a client-scoped session outright rather than
 * widening it to the organization — a customer must not be able to enumerate
 * which of their provider's staff were on site and when.
 *
 * ## Location is nullable and consent is a stored fact
 *
 * CLAUDE.md's rule for this module is "never track without consent", and the
 * shape is what makes that auditable rather than promised. `consentGiven` is a
 * stored boolean on the record, written from the same request that carried the
 * coordinates, so a row with a position and no consent is a row that could not
 * have been created by the action — and a reviewer can tell the difference
 * years later without reading the code that wrote it.
 */
export const attendanceInputSchema = entity({
  /** Whose shift. The technician RECORD, not the user account — see below. */
  technicianId: objectId("Technician"),

  /**
   * The user account that pressed the button, when there was one.
   *
   * Kept alongside `technicianId` rather than instead of it because the two
   * genuinely differ: a technician may exist in the directory without a login
   * (`Technician.userId` is nullable), and a supervisor may one day check
   * somebody in from the office. Storing who ACTED is what makes that second
   * case honest rather than indistinguishable from self-service.
   */
  userId: objectId("User").nullable().optional(),

  /**
   * The day, at UTC midnight. See `attendanceDayOf()` for why it is normalised
   * and what that costs a night shift.
   */
  day: z.coerce.date(),

  /**
   * The two stamps. Both are server clock values, written from the request the
   * server just authorised — never proposed by the caller. A timestamp a phone
   * could choose is not evidence that anybody was anywhere.
   *
   * `checkInAt` is nullable rather than required so the two paths share one
   * schema; in practice a record is never created without it.
   */
  checkInAt: z.coerce.date().nullable().optional(),
  checkOutAt: z.coerce.date().nullable().optional(),

  /**
   * Where, if the person agreed to share it. Null is the ordinary case.
   *
   * A nested object rather than two loose fields, so a latitude can never be
   * stored without its longitude — the pairing is the datum.
   */
  checkInLocation: coordinatesSchema.nullable().optional(),
  checkOutLocation: coordinatesSchema.nullable().optional(),

  /**
   * Whether the person consented to location capture on this record.
   *
   * Stored, defaulting to FALSE, and written only by the action that also
   * received the coordinates. It is the audit trail for the consent rule: the
   * absence of a position is ambiguous (declined? no signal? indoors?), and
   * this field is what disambiguates it.
   */
  consentGiven: z.boolean().default(false),

  /**
   * What the technician wants to say about the shift — "site access delayed
   * 40 minutes", "left early, called out". Bounded at 280 characters: long
   * enough for the sentence that explains an anomaly, short enough that it
   * cannot become the report.
   */
  note: mongo(z.string().max(280), { trim: true }).nullable().optional(),
});

export type AttendanceDocument = DocumentOf<typeof attendanceInputSchema>;

export const Attendance = defineModel("Attendance", attendanceInputSchema, {
  collection: "attendance",
  indexes: [
    /**
     * The uniqueness that makes "one record per technician per day" real.
     *
     * Partial on `deletedAt: null`, so a soft-deleted correction does not
     * reserve the day forever — the same pattern `Client.code` and
     * `Contract.contractNumber` use.
     */
    {
      fields: { organizationId: 1, technicianId: 1, day: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },

    /**
     * "Who is on site today?" — the supervisor's question, and the one the
     * attendance board asks. Tenant first, then the day, which is an equality;
     * the technician is read off the index entry itself.
     */
    { fields: { organizationId: 1, day: -1 } },
  ],
});
