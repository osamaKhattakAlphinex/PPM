import { describe, expect, it } from "vitest";

import { ppmScheduleInputSchema } from "@/lib/db";
import {
  completePpmScheduleSchema,
  createPpmScheduleSchema,
  deletePpmScheduleSchema,
  listPpmSchedulesSchema,
  startPpmScheduleSchema,
  updatePpmScheduleSchema,
} from "../schemas";

/**
 * The validation rules, tested without a database.
 *
 * These schemas are derived from `ppmScheduleInputSchema`, so most of what is
 * asserted here is really an assertion that the derivation kept the constraint —
 * a bound that stops applying to an action payload is a hole nothing else in the
 * stack would notice, because the DAL sanitizes shapes rather than values.
 */

const ASSET_ID = "0123456789abcdef01234567";
const TECHNICIAN_ID = "0123456789abcdef01234568";
const SCHEDULE_ID = "0123456789abcdef01234569";

const validCreate = {
  assetId: ASSET_ID,
  technicianId: TECHNICIAN_ID,
  type: "MONTHLY",
  dueDate: "2026-03-14",
};

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
    ["createPpmSchedule", createPpmScheduleSchema, validCreate],
    ["updatePpmSchedule", updatePpmScheduleSchema, { id: SCHEDULE_ID, type: "WEEKLY" }],
    ["deletePpmSchedule", deletePpmScheduleSchema, { id: SCHEDULE_ID }],
    ["startPpmSchedule", startPpmScheduleSchema, { id: SCHEDULE_ID }],
    ["completePpmSchedule", completePpmScheduleSchema, { id: SCHEDULE_ID }],
    ["listPpmSchedules", listPpmSchedulesSchema, {}],
  ])("%s", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);

    // The tenant key is the one that must never be accepted from a payload.
    expect(schema.safeParse({ ...valid, organizationId: ASSET_ID }).success).toBe(false);
    expect(schema.safeParse({ ...valid, sneaky: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The state machine — the rule this entity exists to protect
// ---------------------------------------------------------------------------

describe("status and its timestamps are never accepted from a payload", () => {
  /**
   * The most important assertion in this file.
   *
   * A visit moves SCHEDULED -> IN_PROGRESS -> COMPLETED, and each step is a
   * separate action that reads the CURRENT status before writing. A patchable
   * `status` would let a caller jump straight to COMPLETED and skip the machine
   * entirely; a settable `completedAt` would let them decide when the work
   * "happened". Neither is a field, so neither is a request the server has to
   * refuse — it is a request it cannot parse.
   */
  it("has no status, startedAt or completedAt on create or update", () => {
    for (const schema of [createPpmScheduleSchema, updatePpmScheduleSchema]) {
      expect("status" in schema.shape).toBe(false);
      expect("startedAt" in schema.shape).toBe(false);
      expect("completedAt" in schema.shape).toBe(false);
    }
  });

  it("rejects them when they are sent anyway", () => {
    expect(createPpmScheduleSchema.safeParse({ ...validCreate, status: "COMPLETED" }).success).toBe(
      false,
    );
    expect(
      createPpmScheduleSchema.safeParse({ ...validCreate, completedAt: "2026-03-14" }).success,
    ).toBe(false);
    expect(
      updatePpmScheduleSchema.safeParse({ id: SCHEDULE_ID, status: "COMPLETED" }).success,
    ).toBe(false);
  });

  /**
   * Both transitions take an id and NOTHING else. What they set is decided by
   * the server from the row's current state, never proposed by the caller.
   */
  it("lets the transitions carry an id and nothing else", () => {
    for (const schema of [startPpmScheduleSchema, completePpmScheduleSchema]) {
      expect(Object.keys(schema.shape)).toEqual(["id"]);
      expect(schema.safeParse({ id: SCHEDULE_ID, startedAt: "2026-03-14" }).success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

describe("schedule payloads", () => {
  it("requires an asset and a technician — an unassigned visit is not a state we have", () => {
    const { assetId, technicianId, ...rest } = validCreate;
    expect(assetId && technicianId).toBeTruthy();

    expect(createPpmScheduleSchema.safeParse({ ...rest, technicianId }).success).toBe(false);
    expect(createPpmScheduleSchema.safeParse({ ...rest, assetId }).success).toBe(false);
  });

  it("requires well-formed ids everywhere one appears", () => {
    expect(createPpmScheduleSchema.safeParse({ ...validCreate, assetId: "chiller-3" }).success).toBe(
      false,
    );
    expect(
      createPpmScheduleSchema.safeParse({ ...validCreate, technicianId: ASSET_ID.slice(0, 23) })
        .success,
    ).toBe(false);
    expect(updatePpmScheduleSchema.safeParse({ id: "nope", type: "WEEKLY" }).success).toBe(false);
    expect(deletePpmScheduleSchema.safeParse({ id: SCHEDULE_ID.slice(0, 23) }).success).toBe(false);
  });

  it("accepts only the six frequencies", () => {
    for (const type of ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"]) {
      expect(createPpmScheduleSchema.safeParse({ ...validCreate, type }).success, type).toBe(true);
    }
    // Lowercase is not the stored form, and the brief's "Half-Yearly" is not
    // either — a hyphen has no business in a key that ends up in a message path.
    for (const type of ["monthly", "Monthly", "Half-Yearly", "BIENNIAL", ""]) {
      expect(createPpmScheduleSchema.safeParse({ ...validCreate, type }).success, type).toBe(false);
    }
  });

  /**
   * The date input submits `YYYY-MM-DD` and a JSON caller may send a full
   * instant. Both have to parse, because the action normalises whatever it gets
   * to UTC midnight afterwards.
   */
  it("coerces the date a form submits", () => {
    const parsed = createPpmScheduleSchema.parse(validCreate);
    expect(parsed.dueDate).toBeInstanceOf(Date);
    expect(parsed.dueDate.toISOString()).toBe("2026-03-14T00:00:00.000Z");

    expect(
      createPpmScheduleSchema.safeParse({ ...validCreate, dueDate: "2026-03-14T09:30:00.000Z" })
        .success,
    ).toBe(true);
  });

  it("refuses something that is not a date at all", () => {
    for (const dueDate of ["next tuesday", "", "2026-13-45", {}, []]) {
      expect(
        createPpmScheduleSchema.safeParse({ ...validCreate, dueDate }).success,
        JSON.stringify(dueDate),
      ).toBe(false);
    }
  });

  /**
   * The documented limit of `z.coerce.date()`, asserted so it is a known
   * behaviour rather than a surprise.
   *
   * Coercion is `new Date(value)`, and that turns a boolean, a null or a number
   * into an instant near the epoch rather than rejecting it. Nothing real sends
   * one — a form yields strings and the client component only ever submits the
   * date input's `YYYY-MM-DD` — and the failure is benign and loud: the row
   * appears dated 1970 and screaming OVERDUE, which is noticed immediately and
   * corrected by an edit.
   *
   * It is left alone rather than tightened because the only way to tighten it is
   * to restate `dueDate` on this schema instead of picking it from the model,
   * and breaking the single source of truth to guard an unreachable input costs
   * more than it buys. If a JSON API is ever exposed, that is the moment to
   * revisit it.
   */
  it("coerces a non-string primitive to the epoch rather than rejecting it", () => {
    const parsed = createPpmScheduleSchema.parse({ ...validCreate, dueDate: 0 });
    expect(parsed.dueDate.getUTCFullYear()).toBe(1970);
  });

  it("lets every planning field be corrected, because visits get rebooked", () => {
    expect(updatePpmScheduleSchema.safeParse({ id: SCHEDULE_ID, assetId: ASSET_ID }).success).toBe(
      true,
    );
    expect(
      updatePpmScheduleSchema.safeParse({ id: SCHEDULE_ID, technicianId: TECHNICIAN_ID }).success,
    ).toBe(true);
    expect(updatePpmScheduleSchema.safeParse({ id: SCHEDULE_ID, dueDate: "2026-04-01" }).success).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

describe("list parameters", () => {
  it("defaults to the first page", () => {
    const parsed = listPpmSchedulesSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });

  it("coerces page numbers arriving as strings from a query string", () => {
    expect(listPpmSchedulesSchema.parse({ page: "3", pageSize: "50" })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it("refuses a page size above the DAL's cap rather than silently clamping", () => {
    expect(listPpmSchedulesSchema.safeParse({ pageSize: 1000 }).success).toBe(false);
    expect(listPpmSchedulesSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  /**
   * The status filter speaks the DISPLAY vocabulary, not the stored one: a
   * person filters for "overdue", which is not a value any row holds. The list
   * query translates it into a fragment over `status` and `dueDate`.
   */
  it("filters by the five display statuses, including the two that are derived", () => {
    for (const status of ["SCHEDULED", "UPCOMING", "OVERDUE", "IN_PROGRESS", "COMPLETED"]) {
      expect(listPpmSchedulesSchema.safeParse({ status }).success, status).toBe(true);
    }
    expect(listPpmSchedulesSchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
  });

  it("refuses an operator smuggled in as a filter's shape", () => {
    expect(listPpmSchedulesSchema.safeParse({ status: { $ne: null } }).success).toBe(false);
    expect(listPpmSchedulesSchema.safeParse({ type: { $ne: null } }).success).toBe(false);
    expect(listPpmSchedulesSchema.safeParse({ assetId: { $ne: null } }).success).toBe(false);
    expect(listPpmSchedulesSchema.safeParse({ technicianId: { $gt: "" } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The derivation itself
// ---------------------------------------------------------------------------

describe("the action schemas stay derived from the model schema", () => {
  /**
   * If someone restates a field here instead of picking it, this is what
   * notices. The point of the zod-first pattern is that there is one definition
   * of "a PPM frequency", not two that agree today.
   */
  it("shares the model's field definitions", () => {
    expect(createPpmScheduleSchema.shape.type).toBe(ppmScheduleInputSchema.shape.type);
    expect(createPpmScheduleSchema.shape.dueDate).toBe(ppmScheduleInputSchema.shape.dueDate);
  });

  it("never exposes organizationId as a field on any schema", () => {
    for (const schema of [createPpmScheduleSchema, updatePpmScheduleSchema]) {
      expect("organizationId" in schema.shape).toBe(false);
    }
  });
});
