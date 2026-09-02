import { describe, expect, it } from "vitest";

import { assetInputSchema } from "@/lib/db";
import {
  createAssetSchema,
  deleteAssetSchema,
  listAssetsSchema,
  updateAssetSchema,
} from "../schemas";

/**
 * The validation rules, tested without a database.
 *
 * These schemas are derived from `assetInputSchema`, so most of what is
 * asserted here is really an assertion that the derivation kept the constraint
 * — a bound that stops applying to an action payload is a hole nothing else in
 * the stack would notice, because the DAL sanitizes shapes rather than values.
 */

const LOCATION_ID = "0123456789abcdef01234567";
const ASSET_ID = "0123456789abcdef01234568";

const validCreate = {
  name: "Rooftop Chiller 3",
  category: "HVAC",
  type: "Chiller",
  locationId: LOCATION_ID,
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
    ["createAsset", createAssetSchema, validCreate],
    ["updateAsset", updateAssetSchema, { id: ASSET_ID, name: "Renamed" }],
    ["deleteAsset", deleteAssetSchema, { id: ASSET_ID }],
    ["listAssets", listAssetsSchema, {}],
  ])("%s", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);

    // The tenant key is the one that must never be accepted from a payload.
    expect(schema.safeParse({ ...valid, organizationId: LOCATION_ID }).success).toBe(false);
    expect(schema.safeParse({ ...valid, sneaky: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The derived clientId — the rule this entity exists to protect
// ---------------------------------------------------------------------------

describe("clientId is never accepted from a payload", () => {
  /**
   * The most important assertion in this file.
   *
   * An asset's client is DERIVED from the location it is filed at, so a payload
   * that could name one would let a caller file an asset at Acme's tower while
   * billing it to a rival. The DAL strips `clientId` from writes independently
   * (it is in `RESERVED_FIELDS`), so this is the second of two locks — but it is
   * the one that fails loudly, at the boundary, with a message.
   */
  it("has no clientId on create or update", () => {
    expect("clientId" in createAssetSchema.shape).toBe(false);
    expect("clientId" in updateAssetSchema.shape).toBe(false);
  });

  it("rejects one that is sent anyway", () => {
    expect(createAssetSchema.safeParse({ ...validCreate, clientId: ASSET_ID }).success).toBe(false);
    expect(updateAssetSchema.safeParse({ id: ASSET_ID, clientId: ASSET_ID }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

describe("asset payloads", () => {
  it("requires a location — an asset that is nowhere cannot be dispatched to", () => {
    const { name, category, type } = validCreate;
    expect(createAssetSchema.safeParse({ name, category, type }).success).toBe(false);
    expect(createAssetSchema.safeParse({ ...validCreate, locationId: "site-a" }).success).toBe(
      false,
    );
  });

  it("allows a location on update, because assets get relocated", () => {
    expect("locationId" in updateAssetSchema.shape).toBe(true);
    expect(updateAssetSchema.safeParse({ id: ASSET_ID, locationId: LOCATION_ID }).success).toBe(
      true,
    );
  });

  it("accepts only the five categories", () => {
    for (const category of ["HVAC", "ELECTRICAL", "ELV", "CIVIL", "PLUMBING"]) {
      expect(createAssetSchema.safeParse({ ...validCreate, category }).success, category).toBe(true);
    }
    // Lowercase is not the stored form — the enum is uppercase everywhere.
    for (const category of ["hvac", "Electrical", "LIFTS", ""]) {
      expect(createAssetSchema.safeParse({ ...validCreate, category }).success, category).toBe(
        false,
      );
    }
  });

  it("accepts only the three statuses and defaults to ACTIVE", () => {
    expect(createAssetSchema.parse(validCreate).status).toBe("ACTIVE");
    for (const status of ["ACTIVE", "INACTIVE", "MAINTENANCE"]) {
      expect(createAssetSchema.safeParse({ ...validCreate, status }).success, status).toBe(true);
    }
    expect(createAssetSchema.safeParse({ ...validCreate, status: "RETIRED" }).success).toBe(false);
  });

  it("bounds health to 0–100 and defaults to 100", () => {
    expect(createAssetSchema.parse(validCreate).health).toBe(100);

    for (const health of [0, 50, 100]) {
      expect(createAssetSchema.safeParse({ ...validCreate, health }).success, `${health}`).toBe(
        true,
      );
    }
    for (const health of [-1, 101, 1.5]) {
      expect(createAssetSchema.safeParse({ ...validCreate, health }).success, `${health}`).toBe(
        false,
      );
    }
  });

  it("coerces health, because a number input submits a string", () => {
    expect(createAssetSchema.parse({ ...validCreate, health: "64" }).health).toBe(64);
    // Coercion must not become a way past the bound.
    expect(createAssetSchema.safeParse({ ...validCreate, health: "999" }).success).toBe(false);
  });

  it("keeps the length bounds the model enforces", () => {
    expect(createAssetSchema.safeParse({ ...validCreate, name: "A" }).success).toBe(false);
    expect(
      createAssetSchema.safeParse({ ...validCreate, name: "A".repeat(161) }).success,
    ).toBe(false);
    expect(createAssetSchema.safeParse({ ...validCreate, type: "" }).success).toBe(false);
    expect(createAssetSchema.safeParse({ ...validCreate, type: "T".repeat(81) }).success).toBe(
      false,
    );
  });

  it("requires a well-formed id on update and delete", () => {
    expect(updateAssetSchema.safeParse({ id: "nope", name: "X" }).success).toBe(false);
    expect(deleteAssetSchema.safeParse({ id: ASSET_ID.slice(0, 23) }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

describe("list parameters", () => {
  it("defaults to the first page", () => {
    const parsed = listAssetsSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });

  it("coerces page numbers arriving as strings from a query string", () => {
    expect(listAssetsSchema.parse({ page: "3", pageSize: "50" })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it("refuses a page size above the DAL's cap rather than silently clamping", () => {
    expect(listAssetsSchema.safeParse({ pageSize: 1000 }).success).toBe(false);
    expect(listAssetsSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it("caps the search term, because it becomes a regex or a $text search", () => {
    expect(listAssetsSchema.safeParse({ q: "a".repeat(64) }).success).toBe(true);
    expect(listAssetsSchema.safeParse({ q: "a".repeat(65) }).success).toBe(false);
    expect(listAssetsSchema.safeParse({ q: "   " }).success).toBe(false);
  });

  it("refuses an operator smuggled in as a filter's shape", () => {
    expect(listAssetsSchema.safeParse({ q: { $gt: "" } }).success).toBe(false);
    expect(listAssetsSchema.safeParse({ status: { $ne: null } }).success).toBe(false);
    expect(listAssetsSchema.safeParse({ locationId: { $ne: null } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The derivation itself
// ---------------------------------------------------------------------------

describe("the action schemas stay derived from the model schema", () => {
  /**
   * If someone restates a field here instead of picking it, this is what
   * notices. The point of the zod-first pattern is that there is one definition
   * of "an asset name", not two that agree today.
   */
  it("shares the model's field definitions", () => {
    expect(createAssetSchema.shape.name).toBe(assetInputSchema.shape.name);
    expect(createAssetSchema.shape.category).toBe(assetInputSchema.shape.category);
    expect(createAssetSchema.shape.type).toBe(assetInputSchema.shape.type);
    expect(createAssetSchema.shape.health).toBe(assetInputSchema.shape.health);
  });

  it("never exposes organizationId as a field on any schema", () => {
    for (const schema of [createAssetSchema, updateAssetSchema]) {
      expect("organizationId" in schema.shape).toBe(false);
    }
  });
});
