import { z } from "zod";

import {
  checklistCategorySchema,
  checklistJobTypeSchema,
  checklistRunStatusSchema,
  ITEM_LABEL_MAX_LENGTH,
  ITEM_NOTE_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
  MIN_CHECKLIST_ITEMS,
} from "../../domain/checklists";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One checklist, carried out once, against one job.
 *
 * The counterpart to `Checklist`, and every difference between the two is the
 * same difference: a template is a living document, a run is evidence.
 *
 * ## The snapshot
 *
 * `items` here is a COPY of the template's items taken at the moment of
 * attachment, not a reference to them, and this is the single most important
 * decision in the module. A run says "this person confirmed these lines on this
 * date". If the lines were read live from the template, then rewording a step
 * next year would silently rewrite what a technician signed off, and deleting a
 * step would erase a check that was actually performed. Both are unacceptable
 * for a record an AMC audit reads. `checklistName` and `category` are snapshot
 * for the same reason — a run must be readable on its own, even after its
 * template is deleted.
 *
 * The cost is duplication, and it is bounded on purpose: `MAX_CHECKLIST_ITEMS`
 * caps the template at forty lines, so the copy is a few kilobytes at worst.
 * That cap is a storage decision as much as an editorial one, which is why it
 * is documented in `src/lib/domain/checklists.ts` rather than here.
 *
 * ## No clientId
 *
 * As on `Checklist`, and for the same reason: `src/lib/nav/modules.ts` gives
 * `checklists` to STAFF only, and without a `clientId` path the DAL refuses a
 * client-scoped session outright instead of widening it to the organization.
 * The fail-closed direction.
 *
 * That is worth stating plainly because a run CAN point at a work order, and a
 * work order does carry a `clientId`. A run of a safety checklist against a
 * fault at a customer's tower is still the provider's internal record of how
 * its own people worked, not a document the customer is entitled to browse; and
 * were that ever to change, the right move is to add the path here and derive
 * it from the job, exactly as `WorkOrder` derives its own from the asset — not
 * to open the route and hope.
 */

/**
 * One line of the run: what was asked, and what happened.
 *
 * The first two fields are the snapshot; the last three are what the technician
 * contributed. Splitting them into two arrays would break the pairing the same
 * way a parallel `labels[]`/`required[]` would — see `checklist.ts`.
 *
 * No `_id` per item, so identity is POSITION. That is safe here in a way it
 * would not be on a live template: the array is frozen at attachment and only
 * ever mutated in place, so index 3 is the same line for the life of the run.
 * `setChecklistRunItem` addresses a line by its index for exactly that reason.
 */
export const checklistRunItemSchema = z.strictObject({
  /** Copied from the template. Never edited — this is what was asked. */
  label: mongo(z.string().min(1).max(ITEM_LABEL_MAX_LENGTH), { trim: true }),

  /**
   * Copied from the template, and NOT re-read from it at completion time.
   *
   * A line that was optional when the work was done stays optional in the
   * record, even if the template later makes it mandatory. The alternative
   * would let a template edit retroactively invalidate a completed run.
   */
  required: z.boolean(),

  done: z.boolean().default(false),

  /**
   * What the technician wants to say about this line — "valve seized, raised
   * WO-1183", "reading 6.2 bar".
   *
   * Bounded at 280 characters: long enough for the sentence that explains an
   * anomaly, short enough that it cannot become the report. Nullable rather
   * than absent so the path always exists; `null` is "nothing to add", which is
   * the ordinary case and must not be confused with an empty string typed and
   * cleared.
   */
  note: mongo(z.string().max(ITEM_NOTE_MAX_LENGTH), { trim: true }).nullable().optional(),

  /**
   * When this line was ticked. Stamped by the server from the request it just
   * authorised, and cleared when the line is un-ticked — a `completedAt` on a
   * line nobody has ticked would be a timestamp for something that did not
   * happen.
   */
  completedAt: z.coerce.date().nullable().optional(),
});

export type ChecklistRunItem = z.infer<typeof checklistRunItemSchema>;

export const checklistRunInputSchema = entity({
  /**
   * The template this came from. Kept even though the items are snapshot,
   * because "how often is this procedure actually run" is a question the
   * library screen asks, and it is answered by an equality on this field rather
   * than by matching names.
   *
   * A dangling reference is a legitimate state: the template may be
   * soft-deleted later, and the run survives it intact because everything it
   * needs to be read was copied.
   */
  checklistId: objectId("Checklist"),

  /** Snapshot. The run is readable after its template is gone. */
  checklistName: mongo(z.string().min(1).max(120), { trim: true }),

  /** Snapshot, for the same reason, and so runs can be grouped by discipline. */
  category: checklistCategorySchema,

  /** PPM or WORK_ORDER. The discriminator that says which collection `jobId` is in. */
  jobType: checklistJobTypeSchema,

  /**
   * The job this run is evidence for.
   *
   * Deliberately NO `ref`. The target collection is a function of `jobType`, so
   * a single `ref` would be wrong for half the rows — and `populate()` is
   * refused by the DAL regardless, because a join is reached under MongoDB's
   * rules rather than ours. Every read of the job goes through the repository
   * `jobType` names, scoped, in `src/lib/checklists/actions.ts` and
   * `queries.ts`.
   *
   * Carries no `{ index: true }` either, for the reason `work-order.ts` gives
   * about `assetId`: a field-level hint builds a bare `{ jobId: 1 }` index,
   * which is not tenant-first, and the compound below covers the lookup with
   * the organization in front.
   */
  jobId: objectId(),

  /** The snapshot, and the record. See the note on the file. */
  items: z.array(checklistRunItemSchema).max(MAX_CHECKLIST_ITEMS),

  /**
   * IN_PROGRESS from attachment; COMPLETED once every required line is ticked
   * and a person says so. COMPLETED is terminal — see the vocabulary.
   */
  status: checklistRunStatusSchema.default("IN_PROGRESS"),

  completedAt: z.coerce.date().nullable().optional(),

  /**
   * Who signed it off — the USER from the session, not a `Technician` record.
   *
   * That choice is forced and worth stating: most technicians never sign in
   * (see `technician.ts`), so the person holding the phone is not reliably the
   * person named on the job. What we can prove is who was authenticated when
   * the button was pressed, and that is what an audit trail should say. Taken
   * from `scope.userId`, never from a payload.
   */
  completedByUserId: objectId("User").nullable().optional(),
});

export type ChecklistRunInput = z.input<typeof checklistRunInputSchema>;
export type ChecklistRunDocument = DocumentOf<typeof checklistRunInputSchema>;

/**
 * No DOCUMENT hook, deliberately — the same reasoning as `ppm-schedule.ts` and
 * `work-order.ts`.
 *
 * The invariant worth wanting here is "COMPLETED implies every required item is
 * done", and it cannot be enforced at this layer. A `pre("validate")` document
 * hook runs on `save()` and therefore on `create()`, but NOT on the
 * `findOneAndUpdate` the DAL's `update()` issues — `runValidators` runs
 * per-path validators, not document middleware. A hook here would guard
 * creation, which is always IN_PROGRESS with nothing ticked and cannot violate
 * the rule, and miss the completion path, which is the only one that could.
 * That is worse than no hook, because it reads as protection.
 *
 * And the deeper reason: completability is a property of the WHOLE array, and
 * the rule has to be checked against the row as it actually is before a status
 * is written. That is enforced in `src/lib/checklists/actions.ts`, which reads
 * the run back through the scoped repository and consults `canCompleteRun()` —
 * the same predicate the run sheet builds its button from.
 *
 * The path validator below is the other kind of `refine`, and it is here for
 * the one rule that IS a property of a single path: a run has at least one
 * step. Update validators do run per-path validators, so unlike a document
 * hook it covers the edit path as well as creation. See the longer note in
 * `checklist.ts`.
 */
export const ChecklistRun = defineModel("ChecklistRun", checklistRunInputSchema, {
  collection: "checklist_runs",

  refine: (schema) => {
    schema
      .path("items")
      .validate(
        (items: unknown) => Array.isArray(items) && items.length >= MIN_CHECKLIST_ITEMS,
        `A checklist run needs at least ${MIN_CHECKLIST_ITEMS} step.`,
      );
  },

  indexes: [
    /**
     * "What checklists are on this job, and how far through are they?"
     *
     * The read the preventive and corrective screens will make once they show
     * their attached checklists, and the one this module makes on every attach
     * to find an existing run rather than create a duplicate. Tenant-first,
     * then the discriminator, then the id — which is the exact shape of the
     * filter both build.
     */
    { fields: { organizationId: 1, jobType: 1, jobId: 1 } },

    /**
     * One template's history, newest first — "when was this last run, and did
     * it pass?". The sort key is in the index, so the run list under a
     * checklist is a walk of it.
     */
    { fields: { organizationId: 1, checklistId: 1, createdAt: -1 } },

    // The default list order and the status filter: what is still open across
    // the tenant, newest first.
    { fields: { organizationId: 1, status: 1, createdAt: -1 } },

    /**
     * One attachment per template per job.
     *
     * Pressing "Run" twice on the same job must not produce two half-ticked
     * copies of the same procedure — an auditor reading them cannot tell which
     * one happened. The action resolves this cooperatively (it returns the
     * existing run instead of creating a second), and this index is the
     * backstop for the concurrent case that check cannot see.
     *
     * Partial on `deletedAt: null` so a discarded run releases its slot: a run
     * completed in error is discarded and re-attached, which is the module's
     * only correction path and would otherwise be blocked by its own history.
     */
    {
      fields: { organizationId: 1, jobType: 1, jobId: 1, checklistId: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },
  ],
});
