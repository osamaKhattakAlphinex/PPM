import { describe, expect, it } from "vitest";

import { MAX_PAGE_SIZE, workOrderInputSchema } from "@/lib/db";
import {
  assignWorkOrderSchema,
  createWorkOrderSchema,
  deleteWorkOrderSchema,
  listWorkOrdersSchema,
  transitionWorkOrderSchema,
  updateWorkOrderSchema,
} from "../schemas";

/**
 * The validation rules, tested without a database.
 *
 * These schemas are derived from `workOrderInputSchema`, so most of what is
 * asserted here is really an assertion that the derivation kept the constraint —
 * a bound that stops applying to an action payload is a hole nothing else in the
 * stack would notice, because the DAL sanitizes shapes rather than values.
 */

const ASSET_ID = "0123456789abcdef01234567";
const TECHNICIAN_ID = "0123456789abcdef01234568";
const WORK_ORDER_ID = "0123456789abcdef01234569";
const CLIENT_ID = "0123456789abcdef0123456a";

const validCreate = {
  assetId: ASSET_ID,
  issue: "Chiller 2 is tripping on high head pressure.",
  priority: "HIGH",
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
    ["createWorkOrder", createWorkOrderSchema, validCreate],
    ["updateWorkOrder", updateWorkOrderSchema, { id: WORK_ORDER_ID, priority: "LOW" }],
    ["deleteWorkOrder", deleteWorkOrderSchema, { id: WORK_ORDER_ID }],
    [
      "assignWorkOrder",
      assignWorkOrderSchema,
      { id: WORK_ORDER_ID, technicianId: TECHNICIAN_ID },
    ],
    ["transitionWorkOrder", transitionWorkOrderSchema, { id: WORK_ORDER_ID, to: "PENDING" }],
    ["listWorkOrders", listWorkOrdersSchema, {}],
  ])("%s", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);

    // The tenant key is the one that must never be accepted from a payload.
    expect(schema.safeParse({ ...valid, organizationId: ASSET_ID }).success).toBe(false);
    expect(schema.safeParse({ ...valid, sneaky: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The fields a caller must never set
// ---------------------------------------------------------------------------

describe("clientId is never a payload field", () => {
  /**
   * The rule this module turns on. `clientId` is DERIVED from the asset's own
   * site, and a client id a caller could name would let a staff user file one
   * customer's fault into another customer's partition — where that customer
   * would then see it, because the DAL narrows their queries by exactly this
   * field. The DAL keeps it in `RESERVED_FIELDS` independently; this is the
   * outer half of the same rule, and the half that produces a 400 instead of a
   * silent strip.
   */
  it("is rejected on create", () => {
    expect(createWorkOrderSchema.safeParse({ ...validCreate, clientId: CLIENT_ID }).success).toBe(
      false,
    );
  });

  it("is rejected on update", () => {
    expect(
      updateWorkOrderSchema.safeParse({ id: WORK_ORDER_ID, clientId: CLIENT_ID }).success,
    ).toBe(false);
  });
});

describe("status is never a payload field", () => {
  /**
   * A patchable status would let a caller jump straight from OPEN to CLOSED and
   * skip the state machine the module exists to enforce. It moves only through
   * `transitionWorkOrder`, which reads the current value first.
   */
  it.each([
    ["create", createWorkOrderSchema, { ...validCreate, status: "CLOSED" }],
    ["update", updateWorkOrderSchema, { id: WORK_ORDER_ID, status: "CLOSED" }],
  ])("%s", (_name, schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(false);
  });
});

describe("technicianId is never set by create or update", () => {
  /**
   * Assignment is its own action with its own, narrower role list: a technician
   * may move a ticket they hold, but only a supervisor decides who holds it.
   * Accepting it here would route around that.
   */
  it.each([
    ["create", createWorkOrderSchema, { ...validCreate, technicianId: TECHNICIAN_ID }],
    ["update", updateWorkOrderSchema, { id: WORK_ORDER_ID, technicianId: TECHNICIAN_ID }],
  ])("%s", (_name, schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(false);
  });
});

describe("the timestamps are never proposed by a caller", () => {
  /** A timestamp a client could choose is not evidence that anything happened. */
  it.each(["assignedAt", "startedAt", "closedAt"])("%s", (field) => {
    const payload = { ...validCreate, [field]: "2026-03-14T09:00:00.000Z" };
    expect(createWorkOrderSchema.safeParse(payload).success).toBe(false);
    expect(
      updateWorkOrderSchema.safeParse({ id: WORK_ORDER_ID, [field]: "2026-03-14T09:00:00.000Z" })
        .success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

describe("the payload schemas are derived from the model, not restated", () => {
  /**
   * Identity, not equivalence: the same zod object. A restated bound is a bound
   * that can drift, and the direction that drift is dangerous in is the one
   * nothing would notice — the database accepting what the form rejects.
   */
  it("reuses the model's issue field", () => {
    expect(createWorkOrderSchema.shape.issue).toBe(workOrderInputSchema.shape.issue);
  });

  it("reuses the model's priority field", () => {
    expect(createWorkOrderSchema.shape.priority).toBe(workOrderInputSchema.shape.priority);
  });
});

describe("the issue text keeps the model's bounds", () => {
  it("rejects anything too short to act on", () => {
    expect(createWorkOrderSchema.safeParse({ ...validCreate, issue: "ac" }).success).toBe(false);
  });

  it("accepts a report at the 2000-character limit", () => {
    const issue = "x".repeat(2000);
    expect(createWorkOrderSchema.safeParse({ ...validCreate, issue }).success).toBe(true);
  });

  it("rejects one past it", () => {
    const issue = "x".repeat(2001);
    expect(createWorkOrderSchema.safeParse({ ...validCreate, issue }).success).toBe(false);
  });
});

describe("priority must be one of the four", () => {
  it.each(["CRITICAL", "HIGH", "MEDIUM", "LOW"])("accepts %s", (priority) => {
    expect(createWorkOrderSchema.safeParse({ ...validCreate, priority }).success).toBe(true);
  });

  it.each(["URGENT", "high", "", null])("rejects %s", (priority) => {
    expect(createWorkOrderSchema.safeParse({ ...validCreate, priority }).success).toBe(false);
  });

  /** No default: an unconsidered ticket must not be able to look considered. */
  it("is required", () => {
    expect(createWorkOrderSchema.safeParse({ assetId: ASSET_ID, issue: validCreate.issue }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

describe("ids must be 24 hex characters", () => {
  it.each([
    ["too short", "abc"],
    ["not hex", "zzzzzzzzzzzzzzzzzzzzzzzz"],
    ["empty", ""],
  ])("rejects an assetId that is %s", (_name, assetId) => {
    expect(createWorkOrderSchema.safeParse({ ...validCreate, assetId }).success).toBe(false);
  });

  /**
   * An operator-shaped value is the NoSQL-injection case. The DAL would reject
   * it too, but a payload schema that let it through would have handed an object
   * to code expecting a string long before that.
   */
  it.each([
    ["createWorkOrder", createWorkOrderSchema, "assetId"],
    ["assignWorkOrder", assignWorkOrderSchema, "technicianId"],
    ["deleteWorkOrder", deleteWorkOrderSchema, "id"],
  ])("%s rejects an operator in %s", (_name, schema, field) => {
    expect(schema.safeParse({ [field]: { $ne: null } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

describe("the transition payload", () => {
  it.each(["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING", "CLOSED"])(
    "accepts the status name %s",
    (to) => {
      expect(transitionWorkOrderSchema.safeParse({ id: WORK_ORDER_ID, to }).success).toBe(true);
    },
  );

  /**
   * Naming a real status is all this layer can check. Whether that status is
   * REACHABLE from where the row actually is can only be decided by the action,
   * which reads the row first — see `transitions.test.ts` for that half.
   */
  it("rejects a status that does not exist", () => {
    expect(transitionWorkOrderSchema.safeParse({ id: WORK_ORDER_ID, to: "DONE" }).success).toBe(
      false,
    );
  });

  it("requires a technician to assign", () => {
    expect(assignWorkOrderSchema.safeParse({ id: WORK_ORDER_ID }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe("the list schema", () => {
  it("defaults to the first page", () => {
    const parsed = listWorkOrdersSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it("coerces the numbers a query string carries as text", () => {
    expect(listWorkOrdersSchema.parse({ page: "3", pageSize: "10" })).toMatchObject({
      page: 3,
      pageSize: 10,
    });
  });

  /** The cap is the DAL's own, so a list endpoint cannot be asked for the collection. */
  it("refuses a page larger than the maximum", () => {
    expect(listWorkOrdersSchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success).toBe(false);
  });

  it("filters on the stored status vocabulary", () => {
    expect(listWorkOrdersSchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(true);
    // There is no display-only status here, unlike preventive's OVERDUE.
    expect(listWorkOrdersSchema.safeParse({ status: "OVERDUE" }).success).toBe(false);
  });

  it("refuses an operator in a filter value", () => {
    expect(listWorkOrdersSchema.safeParse({ status: { $ne: "CLOSED" } }).success).toBe(false);
    expect(listWorkOrdersSchema.safeParse({ technicianId: { $ne: null } }).success).toBe(false);
  });
});
