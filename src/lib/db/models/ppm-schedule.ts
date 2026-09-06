import { z } from "zod";

import { ppmFrequencySchema, ppmScheduleStatusSchema } from "../../domain/preventive";
import { defineModel } from "../define-model";
import { entity, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One planned maintenance visit: this asset, at this frequency, due on this
 * day, assigned to this technician.
 *
 * A row is an OCCURRENCE, not a rule. "Quarterly chiller service" is not stored
 * once with a recurrence expression evaluated at read time — it is stored as
 * the visit due on 14 March, and completing it is what would generate the visit
 * due on 14 June (see `planNextOccurrence` in `src/lib/domain/preventive.ts`).
 * Occurrences are what a technician works from, what a supervisor assigns, and
 * what an audit asks about a year later; a rule cannot carry "who did it, and
 * when", and rewriting the rule would rewrite history.
 *
 * There is NO `clientId` path, and that absence is doing real work.
 * `createRepository()` reads the presence of the path to decide whether a
 * collection can be narrowed to one customer; with none, it refuses a CLIENT
 * session outright rather than widening it to the whole organization — the
 * fail-closed direction, and the same reasoning as `Technician`. That agrees
 * with `src/lib/nav/modules.ts`, where `preventive` is STAFF and CLIENT is
 * absent. The two must not drift: a route open to a role whose queries the DAL
 * would refuse is a 500, not a security boundary.
 *
 * The frequency and status vocabularies live in `src/lib/domain/preventive.ts`,
 * not here, because the schedule list, its filters and its tiles are Client
 * Components and need them as VALUES — importing them from this file would pull
 * Mongoose into the browser bundle.
 */
export const ppmScheduleInputSchema = entity({
  /**
   * The thing being maintained. REQUIRED: a PPM visit with no asset is a
   * calendar entry, not maintenance.
   *
   * Re-checked against the caller's organization in the action before it is
   * used — an id that arrived in a request is never trusted to be in scope.
   *
   * Deliberately NOT `{ index: true }`. A field-level hint builds a bare
   * `{ assetId: 1 }` index, which is not tenant-first: the planner may choose it
   * and then scan across every organization's schedules for that asset before
   * the organizationId term filters them out. The compound below covers the same
   * query with the tenant in front, so the single-field index would be a second
   * index to write on every insert and no read that needs it.
   */
  assetId: objectId("Asset"),

  /** How often this visit recurs. Named `type` because that is the domain's word for it. */
  type: ppmFrequencySchema,

  /**
   * The day the visit is due. A DAY, not a moment — normalised to UTC midnight
   * on the way in, so that `dueDate < today` means the same thing for a
   * supervisor in Riyadh and a server in another region. See `startOfUtcDay`.
   */
  dueDate: z.coerce.date(),

  /**
   * Who is going to do it. REQUIRED, unlike the optional `Technician.userId`:
   * the create sheet has a technician picker, and an unassigned visit is not a
   * state this module has a screen for yet. Re-checked in scope like `assetId`.
   */
  technicianId: objectId("Technician"),

  /**
   * The STORED lifecycle state — three values, moved only by a person.
   * `UPCOMING` and `OVERDUE` are not stored; they are derived from `dueDate` by
   * `effectiveStatus()`, because a stored value for them would be wrong the
   * moment the clock passed midnight and nothing runs to correct it.
   */
  status: ppmScheduleStatusSchema.default("SCHEDULED"),

  /**
   * When someone pressed Start, and when they finished.
   *
   * Nullable rather than absent so the paths always exist and can be projected
   * and indexed later. They are stamped by the transition actions, never by a
   * form: a timestamp a client could set is not evidence of anything.
   */
  startedAt: z.coerce.date().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
});

export type PpmScheduleInput = z.input<typeof ppmScheduleInputSchema>;
export type PpmScheduleDocument = DocumentOf<typeof ppmScheduleInputSchema>;

/**
 * No `refine` hook, deliberately.
 *
 * The tempting invariants here — COMPLETED implies completedAt, IN_PROGRESS
 * implies startedAt — cannot be enforced at this layer. `refine` registers a
 * `pre("validate")` document hook, which runs on `save()` and therefore on
 * `create()`, but NOT on the `findOneAndUpdate` the DAL's `update()` issues:
 * `runValidators` runs per-path validators, not document middleware. A hook
 * here would guard the one path that never violates the rule and miss the two
 * that could, which is worse than no hook because it reads as protection.
 *
 * The state machine is enforced in `src/lib/preventive/actions.ts`, where the
 * transitions actually happen and the current status is read first.
 */
export const PpmSchedule = defineModel("PpmSchedule", ppmScheduleInputSchema, {
  collection: "ppm_schedules",
  indexes: [
    /**
     * The list, and every derived-status filter.
     *
     * Tenant-first, as every index on a tenant-scoped collection must be. The
     * status/dueDate pair is what makes "overdue" cheap: the filter is
     * `{ status: "SCHEDULED", dueDate: { $lt: today } }`, an equality on the
     * second key and a range on the third, which is exactly the shape a
     * compound index serves without touching a document that does not match.
     */
    { fields: { organizationId: 1, status: 1, dueDate: 1 } },

    // Every visit planned for one asset: the drill-down from the register, and
    // the read a future asset-history view will run constantly.
    { fields: { organizationId: 1, assetId: 1 } },

    // One person's workload, soonest first — the technician filter on the list,
    // and the "my jobs" view a mobile app will want.
    { fields: { organizationId: 1, technicianId: 1, dueDate: 1 } },

    // The default list order, unfiltered. The sort key is in the index so the
    // list is served by a scan of it rather than an in-memory sort of the whole
    // tenant's schedules.
    { fields: { organizationId: 1, dueDate: 1 } },

    // The frequency tiles: both the `$group` behind their counts and the
    // filtered list a tile drills down into.
    { fields: { organizationId: 1, type: 1, dueDate: 1 } },
  ],
});
