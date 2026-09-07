import { z } from "zod";

import { checklistInputSchema } from "@/lib/db";
import {
  checklistCategorySchema,
  checklistJobTypeSchema,
  checklistRunStatusSchema,
  ITEM_LABEL_MAX_LENGTH,
  ITEM_NOTE_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
  MIN_CHECKLIST_ITEMS,
  sanitizeItemLabel,
} from "@/lib/domain/checklists";
import { objectIdString, pageParams, searchTerm } from "@/lib/validation/primitives";

/**
 * Every payload that reaches a checklist action is parsed here first.
 *
 * DERIVED from `checklistInputSchema` rather than restated beside it, which is
 * the point of the zod-first pattern in CLAUDE.md: the model is the single
 * source of truth, so a bound that changes there changes here too, and the two
 * cannot drift into a state where the database accepts something the form
 * rejects — or, far worse, the reverse.
 *
 * What the derivation deliberately changes:
 *
 *  - `organizationId` is never a field. It comes from the session's scope, and
 *    a payload that could name a tenant would defeat data isolation entirely.
 *  - `lastUsedAt` is never a field. It is stamped by `startChecklistRun` from
 *    the server clock; a "last used" a caller could set is not evidence that
 *    anything was used.
 *  - `items` is RE-DECLARED rather than picked, because the wire form needs a
 *    normalisation the stored form does not. See below — this is the part of
 *    the module the brief singles out.
 *  - ids arrive as 24-character hex strings, because that is what a URL and a
 *    JSON body carry. The DAL converts them, and treats them as filter terms
 *    that the scope is still layered on top of.
 *
 * `entity()` builds a `z.strictObject`, and `pick`/`partial`/`extend` preserve
 * that, so an unknown key is still rejected everywhere below.
 */

// ---------------------------------------------------------------------------
// The item array
// ---------------------------------------------------------------------------

/**
 * One line of a procedure, as it arrives from the builder.
 *
 * The label goes through three stages, and the ORDER of them is the design:
 *
 *  1. `max(ITEM_LABEL_MAX_LENGTH)` on the RAW string, before anything else.
 *     Sanitising is a linear walk, so a caller must not be able to hand us a
 *     megabyte to walk. Sanitising only ever shortens a string, so applying the
 *     same bound before and after costs nothing and closes the window.
 *  2. `sanitizeItemLabel` — folds whitespace to single spaces and removes
 *     control, zero-width and bidi-override characters. The reasoning for each
 *     class, and for the ones deliberately kept, is on the function itself in
 *     `src/lib/domain/checklists.ts`. The short version: this app lays out RTL,
 *     and an unterminated override in a stored label reverses text the author
 *     never wrote, on a screen that is a compliance record.
 *  3. `.pipe(...)` back through `min(1).max(...)`. Step 2 can EMPTY a string —
 *     a label of nothing but zero-width spaces sanitises to "" — and an empty
 *     line stored in a checklist is a line nobody can tick. Piping means that
 *     case is a 400 naming the field, not a silently blank row.
 *
 * Sanitising here rather than in the builder is the whole point: the builder is
 * not the only caller, and a rule enforced in a form is a rule a JSON body
 * skips.
 */
const checklistItemInput = z.strictObject({
  label: z
    .string()
    .max(ITEM_LABEL_MAX_LENGTH)
    .transform(sanitizeItemLabel)
    .pipe(z.string().min(1).max(ITEM_LABEL_MAX_LENGTH)),

  /**
   * Defaults to `true`, matching the model. A line added without a thought
   * about it should hold the run open rather than wave it through.
   */
  required: z.boolean().default(true),
});

/**
 * The procedure, in order.
 *
 * Bounded at BOTH ends, and both bounds are load-bearing:
 *
 *  - `min(MIN_CHECKLIST_ITEMS)` — a checklist with no items would attach to a
 *    job and report itself complete having asked nobody to do anything.
 *  - `max(MAX_CHECKLIST_ITEMS)` — the cap the brief asks for, and a storage
 *    bound rather than an editorial one: this array is COPIED onto every run,
 *    so an unbounded template is an unbounded write amplification. The same
 *    constant caps the model, so the form stops where the database would have.
 *
 * NOT deduplicated, unlike a technician's skills. Two identically-worded lines
 * in a procedure are unusual but legitimate ("Torque bolt", once per side), and
 * — decisively — a run addresses its lines by POSITION, not by label, so a
 * duplicate is never ambiguous to the thing that has to tick it.
 */
const checklistItems = z
  .array(checklistItemInput)
  .min(MIN_CHECKLIST_ITEMS)
  .max(MAX_CHECKLIST_ITEMS);

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

const templateFields = { name: true, category: true } as const;

export const createChecklistSchema = checklistInputSchema
  .pick(templateFields)
  .extend({ items: checklistItems });

/**
 * Editing a template.
 *
 * `items` is optional but, when present, is the WHOLE array. There is no
 * "insert an item" or "move item 3 to position 1" payload, and that is
 * deliberate: order is data (see the model), so a reorder is a rewrite of the
 * sequence. One atomic `$set` cannot half-apply the way a set of per-row
 * position updates could.
 */
export const updateChecklistSchema = checklistInputSchema
  .pick(templateFields)
  .partial()
  .extend({
    id: objectIdString,
    items: checklistItems.optional(),
  });

export const deleteChecklistSchema = z.strictObject({ id: objectIdString });

export const listChecklistsSchema = z.strictObject({
  ...pageParams,
  category: checklistCategorySchema.optional(),
  /** Anchored prefix match on the name. See `prefixFilter` in the DAL. */
  q: searchTerm.optional(),
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Attaching a checklist to a job.
 *
 * `jobType` and `jobId` travel together and neither means anything alone: the
 * type says WHICH COLLECTION the id lives in, so the action reads the job back
 * through the repository this value names — scoped, like every other id that
 * arrived in a request. A caller cannot point a run at a job in another tenant,
 * because the re-read simply matches nothing.
 *
 * Nothing about the CONTENT of the run is accepted here. The items, the name
 * and the category are snapshot from the template by the action; a caller who
 * could supply them could file a record claiming a technician confirmed lines
 * that were never in the procedure.
 */
export const startChecklistRunSchema = z.strictObject({
  checklistId: objectIdString,
  jobType: checklistJobTypeSchema,
  jobId: objectIdString,
});

/**
 * Ticking one line, and what the technician wants to say about it.
 *
 * The line is addressed by INDEX, which is safe here in a way it would not be
 * on a template: a run's item array is snapshot at attachment and only ever
 * mutated in place, so index 3 is the same line for the life of the run. The
 * bound is the array cap, and the action re-checks the index against the run's
 * ACTUAL length — a well-formed index that is past the end of this particular
 * run is a 400, not an out-of-bounds write.
 *
 * `note` is `nullish`, and the two cases differ: absent leaves the existing
 * note alone, `null` clears it. That distinction is what lets the tick control
 * and the note field be separate interactions on the same line.
 */
export const setChecklistRunItemSchema = z.strictObject({
  runId: objectIdString,
  index: z.coerce.number().int().min(0).max(MAX_CHECKLIST_ITEMS - 1),
  done: z.boolean(),
  note: z.string().max(ITEM_NOTE_MAX_LENGTH).trim().nullish(),
});

/**
 * Signing the run off.
 *
 * Carries nothing but the id. Whether it is ALLOWED is a property of the run's
 * current contents — every required line ticked — which only the database
 * knows, so it is checked in the action against `canCompleteRun()`, the same
 * predicate the sheet builds its button from. A payload that could assert
 * completeness would be the caller marking its own homework.
 */
export const completeChecklistRunSchema = z.strictObject({ runId: objectIdString });

export const deleteChecklistRunSchema = z.strictObject({ runId: objectIdString });

/**
 * Listing runs — the recent-completions table, and the per-job read the
 * preventive and corrective screens will make.
 *
 * The job filter needs BOTH halves, which is what the refinement enforces. An
 * id without its collection is ambiguous by construction here: `jobId` points
 * into one of two collections depending on `jobType`, so a lone `jobId` would
 * match runs of the other kind that happen to carry the same id. Unlikely, and
 * exactly the sort of unlikely that shows up once in production as a checklist
 * appearing on a job it was never attached to.
 *
 * Refined rather than split into two schemas because the pair is ONE rule, and
 * two schemas would be two places to forget it.
 */
export const listChecklistRunsSchema = z
  .strictObject({
    ...pageParams,
    checklistId: objectIdString.optional(),
    status: checklistRunStatusSchema.optional(),
    jobType: checklistJobTypeSchema.optional(),
    jobId: objectIdString.optional(),
  })
  .superRefine((value, context) => {
    if ((value.jobId === undefined) === (value.jobType === undefined)) return;

    context.addIssue({
      code: "custom",
      path: [value.jobId === undefined ? "jobId" : "jobType"],
      message: "A job filter needs both jobType and jobId.",
    });
  });

export type CreateChecklistInput = z.input<typeof createChecklistSchema>;
export type UpdateChecklistInput = z.input<typeof updateChecklistSchema>;
export type ListChecklistsInput = z.input<typeof listChecklistsSchema>;
export type StartChecklistRunInput = z.input<typeof startChecklistRunSchema>;
export type SetChecklistRunItemInput = z.input<typeof setChecklistRunItemSchema>;
export type ListChecklistRunsInput = z.input<typeof listChecklistRunsSchema>;
