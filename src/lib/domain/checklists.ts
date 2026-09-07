import { z } from "zod";

/**
 * The checklist vocabulary, the bounds on an item array, and the one function
 * that decides what a label is allowed to contain.
 *
 * This lives outside `src/lib/db` for the reason spelled out in `assets.ts`,
 * `technicians.ts`, `preventive.ts` and `corrective.ts`: it is domain
 * vocabulary, not a storage concern. The `Checklist` and `ChecklistRun` models
 * need it, and so do the library list, the item builder and the run sheet — and
 * every one of those is a Client Component. Anything a Client Component imports
 * as a VALUE ends up in the browser bundle, so a category list re-exported from
 * `@/lib/db` would drag Mongoose (and `fs`, `net`, `tls`) into it and fail the
 * build.
 *
 * Pure: zod and nothing else. Safe from a Client Component, a Server Component
 * and the Edge middleware alike.
 */

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

/**
 * What kind of work this checklist is for.
 *
 * The first five are the trades from `src/lib/domain/technicians.ts`, spelled
 * the same way on purpose — a "quarterly chiller service" checklist is HVAC
 * work, and a person filtering the library thinks in exactly those words.
 *
 * They are NOT imported from that file, and the duplication is deliberate. A
 * trade is a property of a PERSON, an asset category is a property of a THING,
 * and a checklist category is a property of a PROCEDURE; the three vocabularies
 * are free to diverge. The last two prove it already: SAFETY (permit to work,
 * isolation, confined space) and GENERAL (handover, site induction) are real
 * checklists belonging to no trade and no asset. Aliasing this to `TRADES`
 * would mean that the day someone adds a sixth trade, every tenant's checklist
 * library silently grows a category nobody wrote a checklist for.
 *
 * Stable uppercase keys rather than display strings, like every other enum in
 * the app: the product is bilingual, so "Safety" and its Arabic rendering are
 * two views of one stored value, and the moment a label IS the stored value an
 * Arabic-first tenant cannot filter on it. Labels live in
 * `messages/{en,ar}.json` under `checklists.category`.
 */
export const CHECKLIST_CATEGORIES = [
  "HVAC",
  "ELECTRICAL",
  "ELV",
  "PLUMBING",
  "CIVIL",
  "SAFETY",
  "GENERAL",
] as const;

export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

export const checklistCategorySchema = z.enum(CHECKLIST_CATEGORIES);

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * The bounds on an item array, shared by the model, the action schema and the
 * builder UI — so the form stops at the number the database would have refused
 * rather than discovering it after a submit.
 *
 * `MAX_CHECKLIST_ITEMS` is a security bound as much as an editorial one. An
 * unbounded array on a writable field is an unbounded document, and this array
 * is COPIED onto every run (see `checklist-run.ts`), so one 10,000-item
 * template would be re-stored in full for every job it was ever attached to.
 * Forty is comfortably more than a real Gulf FM procedure runs to — a quarterly
 * AHU service is about twenty lines — and small enough that the whole thing
 * renders as one tick list on a phone without virtualisation.
 *
 * The minimum is 1 for a plainer reason: a checklist with no items is not a
 * checklist, and one saved by accident would attach to a job and report itself
 * complete having asked nobody to do anything.
 */
export const MIN_CHECKLIST_ITEMS = 1;
export const MAX_CHECKLIST_ITEMS = 40;

/** One line of a procedure — "Check refrigerant pressures", not a paragraph. */
export const ITEM_LABEL_MAX_LENGTH = 160;

/** What a technician types against a line they ticked, or could not. */
export const ITEM_NOTE_MAX_LENGTH = 280;

// ---------------------------------------------------------------------------
// Label sanitisation
// ---------------------------------------------------------------------------

/**
 * Is this code point removed from a label outright?
 *
 * Written as a numeric predicate rather than a regex character class so the
 * ranges are readable as what they are — a class built from literal control and
 * invisible characters is, by construction, a line of source nobody can review.
 *
 * Four groups, and the third is why this function exists at all:
 *
 *  - C0 CONTROLS (U+0000-U+001F) and DEL/C1 (U+007F-U+009F). A NUL or a BEL in
 *    a label is never something a person typed; it arrives from a paste or a
 *    generated import and breaks whatever renders the list next.
 *  - ZERO-WIDTH SPACE (U+200B). Invisible, and enough of them make two
 *    different labels look identical in a library people search by eye.
 *  - BIDI EMBEDDINGS and OVERRIDES (U+202A-U+202E) and ISOLATES
 *    (U+2066-U+2069). This app is bilingual and lays out RTL, and an
 *    unterminated RLO in a checklist item does not merely look wrong — it
 *    reverses the visual order of everything after it, including text the
 *    author never wrote. A label reading "Isolate breaker" can be made to
 *    display as its own reverse, and a signed-off run is a compliance record. A
 *    free-text field is the one place a person could inject display-level
 *    nonsense into someone else's screen, so it is closed here.
 *
 * Deliberately absent, and each absence is a decision:
 *
 *  - U+200C ZWNJ and U+200D ZWJ are typographically MEANINGFUL in Arabic and
 *    Persian — they control joining behaviour between letters. Removing them
 *    would silently corrupt correctly-typed Arabic, which is a worse outcome
 *    than the invisible-character duplication they could theoretically enable.
 *  - U+200E LRM and U+200F RLM are direction MARKS, not overrides: each affects
 *    only the character beside it and cannot reach outside the label. An author
 *    writing a mixed Latin/Arabic label may legitimately need one to get a
 *    hyphen on the correct side.
 *  - U+FEFF is absent because JavaScript's own whitespace class already matches
 *    it, so the fold below has removed it before this predicate is reached.
 */
function isDisallowedLabelCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x200b ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/**
 * Turn whatever arrived into a single line of plain text.
 *
 * Order matters, and it is the only subtle thing here. Whitespace is folded
 * FIRST, so a tab or a newline becomes a space and a label broken across two
 * lines stays two words; stripping controls first would have joined them into
 * one — a silent corruption rather than a visible one. Only then are the
 * remaining invisible characters removed, and only then is the result trimmed.
 *
 * `Array.from` iterates by CODE POINT rather than by UTF-16 unit, so an
 * astral-plane character is never split into a surrogate pair that could
 * survive half-removed.
 *
 * Called by the action schema (`src/lib/checklists/schemas.ts`), not by the UI:
 * the builder is not the only caller, and a rule enforced in a form is a rule a
 * JSON body skips. The schema pipes the output back through a `min(1)`, so a
 * label that was ENTIRELY invisible characters fails validation rather than
 * being stored as an empty line.
 */
export function sanitizeItemLabel(raw: string): string {
  const folded = raw.replace(/\s+/gu, " ");

  let result = "";
  for (const character of Array.from(folded)) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isDisallowedLabelCodePoint(codePoint)) continue;
    result += character;
  }

  return result.trim();
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * The two kinds of job a checklist can be attached to.
 *
 * PPM is a planned visit (`PpmSchedule`), WORK_ORDER a reactive fault
 * (`WorkOrder`). Both, because both are jobs a person physically does and both
 * are what an AMC gets audited on — a quarterly service with no evidence of
 * what was checked is worth the same as no service at all.
 *
 * This is a discriminator over TWO COLLECTIONS, which is why `ChecklistRun.jobId`
 * carries no Mongoose `ref`: which collection the id lives in is a function of
 * this value, and a `ref` would be a lie for half the rows. Every read of a job
 * therefore goes through the repository this value names, scoped, in
 * `src/lib/checklists/actions.ts`.
 */
export const CHECKLIST_JOB_TYPES = ["PPM", "WORK_ORDER"] as const;

export type ChecklistJobType = (typeof CHECKLIST_JOB_TYPES)[number];

export const checklistJobTypeSchema = z.enum(CHECKLIST_JOB_TYPES);

/**
 * Where a run has got to.
 *
 * Two states, not five. A run is created the moment it is attached to a job and
 * is IN_PROGRESS from then on — there is no "not started", because an attached
 * checklist with nothing ticked IS a run nobody has started, and a separate
 * status for it would be a second representation of `done === 0` to keep in
 * step.
 *
 * COMPLETED is terminal, the same rule and the same reason as `CLOSED` on a
 * work order: a completed run is a signed statement about work that was done,
 * and reopening it would make `completedAt` a lie. A run completed in error is
 * discarded by a manager and re-attached, which leaves a trail; a run quietly
 * reopened leaves none.
 */
export const CHECKLIST_RUN_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;

export type ChecklistRunStatus = (typeof CHECKLIST_RUN_STATUSES)[number];

export const checklistRunStatusSchema = z.enum(CHECKLIST_RUN_STATUSES);

/** The shape both the progress bar and the completion rule read. */
export interface RunItemState {
  readonly required: boolean;
  readonly done: boolean;
}

export interface RunProgress {
  readonly total: number;
  readonly done: number;
  /** How many REQUIRED lines are still outstanding. Zero means completable. */
  readonly requiredOutstanding: number;
  /** 0-100, for the progress bar. 100 does not imply completable on its own. */
  readonly percent: number;
}

/**
 * How far through a run is.
 *
 * One function, called on the server for the DTO and on the client for the
 * optimistic bar, so a technician ticking a box sees the number the server
 * would have computed. Percent is over ALL lines while completability is over
 * the REQUIRED ones, which is the honest pair: a run can be 80% ticked and
 * finishable, or 95% ticked and blocked on the one line that mattered.
 */
export function runProgress(items: readonly RunItemState[]): RunProgress {
  let done = 0;
  let requiredOutstanding = 0;

  for (const item of items) {
    if (item.done) done += 1;
    else if (item.required) requiredOutstanding += 1;
  }

  return {
    total: items.length,
    done,
    requiredOutstanding,
    percent: items.length === 0 ? 0 : Math.round((done / items.length) * 100),
  };
}

/**
 * May this run be completed?
 *
 * Every REQUIRED line ticked; optional lines are genuinely optional. The single
 * predicate both sides consult — `completeChecklistRun` refuses what this
 * rejects and the run sheet disables its button on the same answer — which is
 * what stops a greyed-out button and a server rejection from ever disagreeing.
 */
export function canCompleteRun(items: readonly RunItemState[]): boolean {
  return runProgress(items).requiredOutstanding === 0;
}
