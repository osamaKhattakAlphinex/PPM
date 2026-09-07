import { describe, expect, it } from "vitest";

import { checklistInputSchema, MAX_PAGE_SIZE } from "@/lib/db";
import {
  ITEM_LABEL_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
  sanitizeItemLabel,
} from "@/lib/domain/checklists";
import {
  completeChecklistRunSchema,
  createChecklistSchema,
  deleteChecklistSchema,
  listChecklistRunsSchema,
  listChecklistsSchema,
  setChecklistRunItemSchema,
  startChecklistRunSchema,
  updateChecklistSchema,
} from "../schemas";

/**
 * The validation rules, tested without a database.
 *
 * These schemas are derived from `checklistInputSchema`, so much of what is
 * asserted here is really an assertion that the derivation kept the constraint
 * — a bound that stops applying to an action payload is a hole nothing else in
 * the stack would notice, because the DAL sanitizes SHAPES rather than VALUES.
 *
 * The label suite is the exception and is the reason this file is long. Label
 * sanitisation is the one place in the module where a value that passes every
 * structural check can still be hostile, and the characters involved are
 * invisible — so they are constructed here from code points rather than pasted,
 * which is also the only way the test stays reviewable.
 */

const CHECKLIST_ID = "0123456789abcdef01234567";
const JOB_ID = "0123456789abcdef01234568";
const RUN_ID = "0123456789abcdef01234569";

const validCreate = {
  name: "Monthly chiller service",
  category: "HVAC",
  items: [
    { label: "Isolate the supply", required: true },
    { label: "Check refrigerant pressures", required: true },
  ],
};

/** Invisible characters, built rather than pasted. */
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const PDF = String.fromCodePoint(0x202c); // pop directional formatting
const RLI = String.fromCodePoint(0x2066); // left-to-right isolate
const ZWSP = String.fromCodePoint(0x200b); // zero-width space
const ZWNJ = String.fromCodePoint(0x200c); // zero-width non-joiner (Arabic!)
const NUL = String.fromCodePoint(0x00);
const BELL = String.fromCodePoint(0x07);

// ---------------------------------------------------------------------------
// Unknown keys
// ---------------------------------------------------------------------------

describe("every payload schema rejects unknown fields", () => {
  /**
   * CLAUDE.md requires rejection, not stripping. The difference matters: a
   * stripped `organizationId` is silently ignored and the caller believes it
   * worked, while a rejected one is a 400 that says so.
   */
  it.each([
    ["createChecklist", createChecklistSchema, validCreate],
    ["updateChecklist", updateChecklistSchema, { id: CHECKLIST_ID, name: "Renamed" }],
    ["deleteChecklist", deleteChecklistSchema, { id: CHECKLIST_ID }],
    ["listChecklists", listChecklistsSchema, {}],
    [
      "startChecklistRun",
      startChecklistRunSchema,
      { checklistId: CHECKLIST_ID, jobType: "PPM", jobId: JOB_ID },
    ],
    ["setChecklistRunItem", setChecklistRunItemSchema, { runId: RUN_ID, index: 0, done: true }],
    ["completeChecklistRun", completeChecklistRunSchema, { runId: RUN_ID }],
    ["listChecklistRuns", listChecklistRunsSchema, {}],
  ])("%s", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);

    // The tenant key is the one that must never be accepted from a payload.
    expect(schema.safeParse({ ...valid, organizationId: CHECKLIST_ID }).success).toBe(false);
    expect(schema.safeParse({ ...valid, sneaky: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fields a caller must never set
// ---------------------------------------------------------------------------

describe("lastUsedAt is never a payload field", () => {
  /**
   * It is stamped by `startChecklistRun` from the server clock. A caller who
   * could set it could make a procedure that has never been run look current,
   * which is precisely the signal the library column exists to give.
   */
  it("is rejected on create and on update", () => {
    const when = new Date().toISOString();
    expect(createChecklistSchema.safeParse({ ...validCreate, lastUsedAt: when }).success).toBe(
      false,
    );
    expect(
      updateChecklistSchema.safeParse({ id: CHECKLIST_ID, lastUsedAt: when }).success,
    ).toBe(false);
  });

  it("is on the model, so the omission above is a derivation and not an oversight", () => {
    expect(Object.keys(checklistInputSchema.shape)).toContain("lastUsedAt");
  });
});

describe("a run's content is never supplied by the caller", () => {
  /**
   * The snapshot is copied from the template the SERVER read. A caller able to
   * supply items, a name or a status could file a record claiming a technician
   * confirmed lines that were never in the procedure — which is the whole thing
   * the run exists to prove.
   */
  it.each([
    ["items", { items: [{ label: "Anything", required: false, done: true }] }],
    ["checklistName", { checklistName: "Something else" }],
    ["status", { status: "COMPLETED" }],
    ["completedByUserId", { completedByUserId: CHECKLIST_ID }],
  ])("rejects %s on startChecklistRun", (_field, extra) => {
    const valid = { checklistId: CHECKLIST_ID, jobType: "PPM", jobId: JOB_ID };
    expect(startChecklistRunSchema.safeParse(valid).success).toBe(true);
    expect(startChecklistRunSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });

  it("rejects a claim of completeness on completeChecklistRun", () => {
    // Whether a run MAY be completed is a property of the stored row, checked
    // in the action against `canCompleteRun`. A payload asserting it would be
    // the caller marking its own homework.
    expect(
      completeChecklistRunSchema.safeParse({ runId: RUN_ID, complete: true }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The item array
// ---------------------------------------------------------------------------

function itemsOfLength(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    label: `Step ${index + 1}`,
    required: true,
  }));
}

describe("the item array is capped in both directions", () => {
  it("accepts exactly MAX_CHECKLIST_ITEMS and refuses one more", () => {
    const at = { ...validCreate, items: itemsOfLength(MAX_CHECKLIST_ITEMS) };
    const over = { ...validCreate, items: itemsOfLength(MAX_CHECKLIST_ITEMS + 1) };

    expect(createChecklistSchema.safeParse(at).success).toBe(true);
    expect(createChecklistSchema.safeParse(over).success).toBe(false);
    // The same bound on the update path. A cap enforced on create alone is a
    // cap you get past by creating one item and then editing.
    expect(
      updateChecklistSchema.safeParse({ id: CHECKLIST_ID, items: over.items }).success,
    ).toBe(false);
  });

  it("refuses an empty checklist", () => {
    // One that attached to a job would report itself complete having asked
    // nobody to do anything.
    expect(createChecklistSchema.safeParse({ ...validCreate, items: [] }).success).toBe(false);
    expect(
      updateChecklistSchema.safeParse({ id: CHECKLIST_ID, items: [] }).success,
    ).toBe(false);
  });

  it("defaults an item to required", () => {
    const parsed = createChecklistSchema.parse({
      ...validCreate,
      items: [{ label: "Check the strainer" }],
    });

    // The direction of the default is the point: a step added without a thought
    // about it should hold the run open, not wave it through.
    expect(parsed.items[0].required).toBe(true);
  });

  it("rejects an unknown key inside an item", () => {
    expect(
      createChecklistSchema.safeParse({
        ...validCreate,
        items: [{ label: "Check the strainer", required: true, done: true }],
      }).success,
    ).toBe(false);
  });

  it("keeps the order it was given", () => {
    // Order IS data: "isolate the supply" after "open the panel" is a different
    // and more dangerous procedure. Nothing may sort this array.
    const labels = ["Third", "First", "Second"];
    const parsed = createChecklistSchema.parse({
      ...validCreate,
      items: labels.map((label) => ({ label, required: true })),
    });

    expect(parsed.items.map((item) => item.label)).toEqual(labels);
  });

  it("keeps duplicate labels, unlike a technician's skills", () => {
    // Legitimate ("Torque bolt", once per side), and unambiguous because a run
    // addresses its lines by POSITION rather than by label.
    const parsed = createChecklistSchema.parse({
      ...validCreate,
      items: [
        { label: "Torque bolt", required: true },
        { label: "Torque bolt", required: true },
      ],
    });

    expect(parsed.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Label sanitisation
// ---------------------------------------------------------------------------

/** Parse one label through the real create schema and hand back what was stored. */
function labelAfterParse(label: string): string | undefined {
  const result = createChecklistSchema.safeParse({
    ...validCreate,
    items: [{ label, required: true }],
  });
  return result.success ? result.data.items[0].label : undefined;
}

describe("sanitizeItemLabel folds whitespace before stripping anything", () => {
  /**
   * The ORDER is the only subtle thing in the function, and getting it backwards
   * is a silent corruption rather than a visible one: stripping controls first
   * would turn a line broken across two lines into one run-together word.
   */
  it("turns a newline into a space rather than deleting it", () => {
    expect(sanitizeItemLabel("Check oil\nlevel")).toBe("Check oil level");
    expect(sanitizeItemLabel("Check oil\tlevel")).toBe("Check oil level");
  });

  it("collapses runs of whitespace and trims the ends", () => {
    expect(sanitizeItemLabel("  Check   the    strainer  ")).toBe("Check the strainer");
  });
});

describe("sanitizeItemLabel removes what must not be stored", () => {
  it.each([
    ["a bidi override", `Isolate breaker${RLO}rekaerb etalosI`],
    ["an unterminated embedding", `Isolate breaker${RLO}`],
    ["a bidi isolate", `Isolate${RLI} breaker`],
    ["a pop-directional mark", `Isolate${PDF} breaker`],
    ["a zero-width space", `Isolate${ZWSP}breaker`],
    ["a NUL", `Isolate${NUL}breaker`],
    ["a BEL", `Isolate${BELL}breaker`],
  ])("strips %s", (_name, input) => {
    const cleaned = sanitizeItemLabel(input);

    for (const forbidden of [RLO, RLI, PDF, ZWSP, NUL, BELL]) {
      expect(cleaned.includes(forbidden)).toBe(false);
    }
  });

  /**
   * The counterpart assertion, and the one that stops the rule being written as
   * "remove anything invisible". ZWNJ controls letter joining in Arabic and
   * Persian, so stripping it would silently corrupt correctly-typed Arabic —
   * a worse failure than the one being defended against, and in a product whose
   * second language is Arabic.
   */
  it("keeps a zero-width non-joiner, which is meaningful in Arabic", () => {
    const label = `مروحة${ZWNJ}هواء`;
    expect(sanitizeItemLabel(label)).toContain(ZWNJ);
  });

  it("keeps ordinary Arabic text untouched", () => {
    const label = "فحص المروحة";
    expect(sanitizeItemLabel(label)).toBe(label);
  });
});

describe("the schema applies sanitisation and then re-checks the result", () => {
  it("stores the cleaned label, not the raw one", () => {
    expect(labelAfterParse(`Isolate${ZWSP}  the   supply `)).toBe("Isolate the supply");
  });

  /**
   * Sanitising can EMPTY a string, and an empty line stored in a checklist is a
   * line nobody can tick. Piping the output back through `min(1)` is what turns
   * that into a 400 naming the field instead of a silently blank row.
   */
  it.each([
    ["only whitespace", "   "],
    ["only zero-width spaces", `${ZWSP}${ZWSP}`],
    ["only bidi controls", `${RLO}${PDF}`],
    ["empty", ""],
  ])("refuses a label that is %s", (_name, label) => {
    expect(labelAfterParse(label)).toBeUndefined();
  });

  it("caps the RAW string before sanitising it", () => {
    // Sanitising is a linear walk, so an over-long label must be refused before
    // the walk rather than after it.
    const tooLong = "x".repeat(ITEM_LABEL_MAX_LENGTH + 1);
    expect(labelAfterParse(tooLong)).toBeUndefined();
    expect(labelAfterParse("x".repeat(ITEM_LABEL_MAX_LENGTH))).toHaveLength(
      ITEM_LABEL_MAX_LENGTH,
    );
  });
});

// ---------------------------------------------------------------------------
// Run payloads
// ---------------------------------------------------------------------------

describe("setChecklistRunItem bounds the index", () => {
  it("refuses a negative or non-integer index", () => {
    const base = { runId: RUN_ID, done: true };
    expect(setChecklistRunItemSchema.safeParse({ ...base, index: -1 }).success).toBe(false);
    expect(setChecklistRunItemSchema.safeParse({ ...base, index: 1.5 }).success).toBe(false);
  });

  it("refuses an index past the array cap", () => {
    // The schema can only check against the CAP; the action re-checks against
    // the run's actual length, which is the bound that matters.
    const base = { runId: RUN_ID, done: true };
    expect(
      setChecklistRunItemSchema.safeParse({ ...base, index: MAX_CHECKLIST_ITEMS - 1 }).success,
    ).toBe(true);
    expect(
      setChecklistRunItemSchema.safeParse({ ...base, index: MAX_CHECKLIST_ITEMS }).success,
    ).toBe(false);
  });

  it("distinguishes an absent note from a null one", () => {
    // Absent leaves the existing note alone; null clears it. The tick control
    // and the note field are separate interactions on the same line, and the
    // first must not wipe what the second wrote.
    const absent = setChecklistRunItemSchema.parse({ runId: RUN_ID, index: 0, done: true });
    const cleared = setChecklistRunItemSchema.parse({
      runId: RUN_ID,
      index: 0,
      done: true,
      note: null,
    });

    expect(absent.note).toBeUndefined();
    expect(cleared.note).toBeNull();
  });
});

describe("the run list refuses a half-specified job filter", () => {
  /**
   * `jobId` points into one of two collections depending on `jobType`, so a
   * lone `jobId` would match runs of the other kind that happen to carry the
   * same id.
   */
  it("accepts both halves or neither", () => {
    expect(listChecklistRunsSchema.safeParse({}).success).toBe(true);
    expect(
      listChecklistRunsSchema.safeParse({ jobType: "PPM", jobId: JOB_ID }).success,
    ).toBe(true);
  });

  it("refuses one half without the other", () => {
    expect(listChecklistRunsSchema.safeParse({ jobId: JOB_ID }).success).toBe(false);
    expect(listChecklistRunsSchema.safeParse({ jobType: "PPM" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pagination and enums
// ---------------------------------------------------------------------------

describe("list schemas are bounded and typed", () => {
  it("clamps pageSize to the DAL's maximum", () => {
    expect(listChecklistsSchema.safeParse({ pageSize: MAX_PAGE_SIZE }).success).toBe(true);
    expect(listChecklistsSchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success).toBe(false);
  });

  it("refuses a category outside the vocabulary", () => {
    expect(listChecklistsSchema.safeParse({ category: "HVAC" }).success).toBe(true);
    expect(listChecklistsSchema.safeParse({ category: "PLUMBINGX" }).success).toBe(false);
    expect(createChecklistSchema.safeParse({ ...validCreate, category: "OTHER" }).success).toBe(
      false,
    );
  });

  it("refuses a job type outside the vocabulary", () => {
    expect(
      startChecklistRunSchema.safeParse({
        checklistId: CHECKLIST_ID,
        jobType: "INVOICE",
        jobId: JOB_ID,
      }).success,
    ).toBe(false);
  });

  it("refuses an id that is not 24 hex characters", () => {
    expect(deleteChecklistSchema.safeParse({ id: "not-an-id" }).success).toBe(false);
    expect(deleteChecklistSchema.safeParse({ id: CHECKLIST_ID.slice(0, 23) }).success).toBe(false);
  });
});
