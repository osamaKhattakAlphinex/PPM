import { describe, expect, it } from "vitest";

import { MAX_SKILLS, SKILL_MAX_LENGTH, TRADES } from "@/lib/domain/technicians";
import {
  createTechnicianSchema,
  deleteTechnicianSchema,
  listTechniciansSchema,
  updateTechnicianSchema,
} from "../schemas";

/**
 * The validation rules, tested without a database.
 *
 * These schemas are derived from `technicianInputSchema`, so most of what is
 * asserted here is really an assertion that the derivation kept the constraint
 * — a bound or an enum that stops applying to an action payload is a hole
 * nothing else in the stack would notice, because the DAL sanitizes SHAPES
 * rather than values.
 */

const ID = "0123456789abcdef01234567";

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
    ["createTechnician", createTechnicianSchema, { name: "Ahmed Nasser", trade: "HVAC" }],
    ["updateTechnician", updateTechnicianSchema, { id: ID, name: "Ahmed Nasser" }],
    ["deleteTechnician", deleteTechnicianSchema, { id: ID }],
    ["listTechnicians", listTechniciansSchema, {}],
  ])("%s", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);

    // The tenant key is the one that must never be accepted from a payload.
    expect(schema.safeParse({ ...valid, organizationId: ID }).success).toBe(false);
    expect(schema.safeParse({ ...valid, sneaky: true }).success).toBe(false);
    // A `$`-prefixed key would be caught by `defineAction` too; a strict object
    // is the layer that stops it reaching a schema-shaped payload at all.
    expect(schema.safeParse({ ...valid, $where: "1" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

describe("ids", () => {
  it.each([
    ["too short", "abc"],
    ["not hex", "zzzzzzzzzzzzzzzzzzzzzzzz"],
    ["25 characters", `${ID}0`],
    ["empty", ""],
  ])("rejects an id that is %s", (_label, id) => {
    expect(deleteTechnicianSchema.safeParse({ id }).success).toBe(false);
    expect(updateTechnicianSchema.safeParse({ id }).success).toBe(false);
  });

  it("accepts a 24-character hex id", () => {
    expect(deleteTechnicianSchema.safeParse({ id: ID }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

describe("trade", () => {
  it.each(TRADES)("accepts %s", (trade) => {
    expect(createTechnicianSchema.safeParse({ name: "Ahmed", trade }).success).toBe(true);
  });

  it("is required on create", () => {
    expect(createTechnicianSchema.safeParse({ name: "Ahmed" }).success).toBe(false);
  });

  /** Stored values are keys, not labels — the display strings are in messages. */
  it.each(["Plumbing", "hvac", "GENERAL", ""])("rejects %o", (trade) => {
    expect(createTechnicianSchema.safeParse({ name: "Ahmed", trade }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

describe("skills", () => {
  function parseSkills(skills: unknown): string[] | undefined {
    const result = createTechnicianSchema.safeParse({ name: "Ahmed", trade: "HVAC", skills });
    return result.success ? result.data.skills : undefined;
  }

  it("defaults to absent rather than inventing an empty list", () => {
    const result = createTechnicianSchema.safeParse({ name: "Ahmed", trade: "HVAC" });
    expect(result.success).toBe(true);
    // The model supplies `[]`; the payload schema stays quiet about a field the
    // caller did not send, so an update cannot blank a list by omitting it.
    expect(result.success && result.data.skills).toBeUndefined();
  });

  it("trims each entry", () => {
    expect(parseSkills(["  brazing  "])).toEqual(["brazing"]);
  });

  it("drops case-insensitive duplicates, keeping the first spelling", () => {
    expect(parseSkills(["Brazing", "brazing", "BRAZING"])).toEqual(["Brazing"]);
  });

  it("rejects an empty or whitespace-only skill rather than storing a blank chip", () => {
    expect(parseSkills([""])).toBeUndefined();
    expect(parseSkills(["   "])).toBeUndefined();
  });

  it(`rejects a skill longer than ${SKILL_MAX_LENGTH} characters`, () => {
    expect(parseSkills(["a".repeat(SKILL_MAX_LENGTH)])).toHaveLength(1);
    expect(parseSkills(["a".repeat(SKILL_MAX_LENGTH + 1)])).toBeUndefined();
  });

  it(`rejects more than ${MAX_SKILLS} skills`, () => {
    const withinCap = Array.from({ length: MAX_SKILLS }, (_, index) => `skill-${index}`);
    expect(parseSkills(withinCap)).toHaveLength(MAX_SKILLS);
    expect(parseSkills([...withinCap, "one-too-many"])).toBeUndefined();
  });

  it("rejects a non-array, so a comma-separated string cannot slip through", () => {
    expect(parseSkills("brazing,welding")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The account link
// ---------------------------------------------------------------------------

describe("userId", () => {
  /**
   * The three states have to survive parsing distinctly, because the action
   * gives each a different meaning: absent leaves the link alone, null unlinks,
   * an id links. A schema that collapsed null into undefined would make
   * unlinking impossible.
   */
  it("distinguishes absent from null from an id", () => {
    const absent = updateTechnicianSchema.parse({ id: ID });
    expect("userId" in absent && absent.userId !== undefined).toBe(false);

    expect(updateTechnicianSchema.parse({ id: ID, userId: null }).userId).toBeNull();
    expect(updateTechnicianSchema.parse({ id: ID, userId: ID }).userId).toBe(ID);
  });

  it("rejects a malformed account id", () => {
    expect(updateTechnicianSchema.safeParse({ id: ID, userId: "nope" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The list payload
// ---------------------------------------------------------------------------

describe("listTechnicians", () => {
  it("defaults to the first page", () => {
    const parsed = listTechniciansSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBeGreaterThan(0);
  });

  it("coerces the page numbers a query string carries as text", () => {
    expect(listTechniciansSchema.parse({ page: "3" }).page).toBe(3);
  });

  it("refuses a page size beyond the DAL's cap, so a list cannot be a dump", () => {
    expect(listTechniciansSchema.safeParse({ pageSize: 1000 }).success).toBe(false);
    expect(listTechniciansSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it("caps the search term, because it becomes an anchored regex", () => {
    expect(listTechniciansSchema.safeParse({ q: "a".repeat(64) }).success).toBe(true);
    expect(listTechniciansSchema.safeParse({ q: "a".repeat(65) }).success).toBe(false);
  });

  it("accepts a skill filter no longer than a storable skill", () => {
    expect(listTechniciansSchema.safeParse({ skill: "brazing" }).success).toBe(true);
    expect(
      listTechniciansSchema.safeParse({ skill: "a".repeat(SKILL_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("rejects an unknown trade or status filter", () => {
    expect(listTechniciansSchema.safeParse({ trade: "GENERAL" }).success).toBe(false);
    expect(listTechniciansSchema.safeParse({ status: "RETIRED" }).success).toBe(false);
  });
});
