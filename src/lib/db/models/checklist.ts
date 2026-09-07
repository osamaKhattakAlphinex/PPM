import { z } from "zod";

import {
  checklistCategorySchema,
  ITEM_LABEL_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
  MIN_CHECKLIST_ITEMS,
} from "../../domain/checklists";
import { defineModel } from "../define-model";
import { entity, mongo, type DocumentOf } from "../zod-mongoose";

/**
 * A reusable procedure: the list of things to check, in the order to check
 * them.
 *
 * This is a TEMPLATE, and the distinction from `ChecklistRun` is the whole
 * design. A template is edited over its life — a line is reworded, a step is
 * added after an incident, the order changes when someone realises the
 * isolation step belongs first. A run is a record of what one person confirmed
 * on one job on one day, and must never change afterwards. Keeping them in one
 * collection would mean either freezing the template (so it could never be
 * improved) or rewriting history (so last quarter's signed-off run would
 * silently claim the technician checked a line that did not exist yet).
 *
 * There is NO `clientId` path, and that absence is doing real work — the same
 * reasoning as `Technician` and `PpmSchedule`. `createRepository()` reads the
 * presence of the path to decide whether a collection can be narrowed to one
 * customer; with none, it refuses a CLIENT session outright rather than
 * widening it to the whole organization. That agrees with
 * `src/lib/nav/modules.ts`, where `checklists` is STAFF and CLIENT is absent,
 * and the two must not drift: a route open to a role whose queries the DAL
 * would refuse is a 500, not a security boundary. A provider's method
 * statements are its own working documents, not something a customer browses.
 *
 * The category vocabulary and the bounds on the item array live in
 * `src/lib/domain/checklists.ts`, not here, because the library list, its
 * filters and the item builder are Client Components and need them as VALUES —
 * importing them from this file would pull Mongoose into the browser bundle.
 */

/**
 * One line of the procedure.
 *
 * A nested object rather than a parallel pair of arrays, because the two facts
 * belong to each other: a `labels[]` and a `required[]` that fall out of step by
 * one entry is a checklist that marks the wrong line mandatory, and nothing
 * would report it.
 *
 * `entity()` is not used here — it is for top-level documents, and the base
 * plugin would otherwise be tempted onto a subdocument. `z.strictObject` gives
 * the same rejection of unknown keys, and `buildSchema` compiles nested objects
 * into real subdocument schemas with no `_id` of their own (see
 * `subSchema` in `zod-mongoose.ts`). No `_id` per item is deliberate: an item's
 * identity is its POSITION, which is what makes reordering a whole-array write
 * rather than a set of per-row position updates to keep consistent.
 */
export const checklistItemSchema = z.strictObject({
  /**
   * What to do, in one line.
   *
   * Bounded at both ends. The minimum of 1 is really enforced upstream — the
   * action schema sanitises the label first and then re-checks `min(1)`, so a
   * line of invisible characters fails validation rather than arriving here as
   * an empty string. See `sanitizeItemLabel`.
   */
  label: mongo(z.string().min(1).max(ITEM_LABEL_MAX_LENGTH), { trim: true }),

  /**
   * Must this line be ticked before the run can be completed?
   *
   * Defaults to `true`, and the direction of that default matters. A checklist
   * exists to make sure things get done, so a line added without a thought
   * about it should hold the run open, not wave it through. Making optional the
   * default would mean the failure mode of carelessness is a procedure that
   * signs itself off.
   */
  required: z.boolean().default(true),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistInputSchema = entity({
  name: mongo(z.string().min(2).max(120), { trim: true }),

  category: checklistCategorySchema,

  /**
   * The procedure, in order.
   *
   * ORDER IS DATA. The array's own order is the display order and the run
   * order, and there is deliberately no `position` field beside it: a stored
   * ordinal is a second representation of the same fact, and the two only have
   * to disagree once — after a failed partial write, say — for a checklist to
   * render in an order nobody chose. Reordering in the builder therefore
   * rewrites the whole array, which is one atomic `$set` rather than N updates
   * that could half-apply.
   *
   * Capped at `MAX_CHECKLIST_ITEMS`. The cap is enforced again in the action
   * schema, where it produces a 400 a person can read; here it is the storage
   * half of the same bound.
   *
   * The LOWER bound needs its own machinery — see the path validator below.
   * Mongoose has no `minlength` for arrays, and its `required` validator does
   * NOT mean non-empty for one: an empty array is a present value and passes.
   */
  items: z.array(checklistItemSchema).max(MAX_CHECKLIST_ITEMS),

  /**
   * When this template was last attached to a job.
   *
   * Stamped by `startChecklistRun`, never by a form — a "last used" a caller
   * could set is not evidence that anything was used. Nullable rather than
   * absent so the path always exists and can be projected, sorted and indexed;
   * `null` means "written but never run", which is exactly what a library
   * wants to be able to show.
   *
   * It is DERIVED but not recomputable from this collection alone (the runs
   * live elsewhere), so it is stored rather than aggregated: the alternative is
   * a `$lookup` per row of the library list, which crosses a collection
   * boundary the DAL deliberately will not cross.
   */
  lastUsedAt: z.coerce.date().nullable().optional(),
});

export type ChecklistInput = z.input<typeof checklistInputSchema>;
export type ChecklistDocument = DocumentOf<typeof checklistInputSchema>;

export const Checklist = defineModel("Checklist", checklistInputSchema, {
  collection: "checklists",

  /**
   * A PATH validator, and the distinction from a document hook is the whole
   * reason this is safe to rely on.
   *
   * `ppm-schedule.ts`, `work-order.ts` and `checklist-run.ts` each explain why
   * they register NO `refine` hook: a `pre("validate")` DOCUMENT hook runs on
   * `save()` and therefore on `create()`, but not on the `findOneAndUpdate` the
   * DAL's `update()` issues, so it would guard creation and miss every edit.
   * That argument is about document middleware specifically.
   *
   * A per-path validator is the other thing `refine` can register, and update
   * validators DO run it — `mongoose-setup.ts` sets `runValidators` globally,
   * and the DAL passes it explicitly on `update()` and `updateMany()` as well.
   * So this covers create and edit alike, which is exactly the property the
   * document hook could not offer.
   *
   * What it enforces: a checklist has at least one step. A zero-step procedure
   * would attach to a job and report itself complete having asked nobody to do
   * anything. `src/lib/checklists/schemas.ts` refuses it first, with a message
   * a person can read; this is the layer beneath, so a caller that somehow
   * reached the repository directly still cannot store one.
   */
  refine: (schema) => {
    schema
      .path("items")
      .validate(
        (items: unknown) => Array.isArray(items) && items.length >= MIN_CHECKLIST_ITEMS,
        `A checklist needs at least ${MIN_CHECKLIST_ITEMS} step.`,
      );
  },

  indexes: [
    /**
     * Uniqueness of a name is per-organization, and per-organization only: two
     * tenants may both keep a "Monthly chiller service" without colliding.
     *
     * Partial on `deletedAt: null`, like `Client.code`, so a soft-deleted
     * template does not reserve its name forever — a checklist retired and then
     * rewritten under the same name is an ordinary thing to want.
     *
     * A duplicate surfaces as a Mongo 11000, which `normaliseError` in
     * `src/lib/security/errors.ts` already maps to a CONFLICT envelope, so the
     * action needs no pre-flight existence check that a concurrent write could
     * race past anyway.
     *
     * This index doubles as the default list order (`name` ascending) and as
     * what the anchored `^name` prefix search rides.
     */
    {
      fields: { organizationId: 1, name: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },

    // The filtered library: one category, in list order. Tenant-first, as every
    // index on a tenant-scoped collection must be.
    { fields: { organizationId: 1, category: 1, name: 1 } },

    /**
     * "What do we actually use?" — the library sorted by recency of use, which
     * is the order that matters once a tenant has fifty templates and reaches
     * for the same six. The sort key is in the index, so it is a walk rather
     * than an in-memory sort of the tenant's whole library.
     */
    { fields: { organizationId: 1, lastUsedAt: -1 } },
  ],
});
