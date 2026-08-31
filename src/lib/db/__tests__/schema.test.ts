import mongoose, { Schema, Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { applySoftDeleteFilter, SOFT_DELETE_FILTERED_OPS } from "../base-plugin";
import { ExampleNote, noteInputSchema } from "../models/example-note";
import { buildSchema, entity, mongo, SchemaDerivationError } from "../zod-mongoose";

import "../mongoose-setup";

/** Compile a throwaway model, tolerating a re-run under `vitest --watch`. */
function compileFixture(name: string, schema: Schema) {
  mongoose.deleteModel(new RegExp(`^${name}$`));
  return mongoose.model(name, schema);
}

function pathOptions(schema: Schema, path: string): Record<string, unknown> {
  const schemaPath = schema.path(path);
  expect(schemaPath, `expected path "${path}" to exist`).toBeDefined();
  return schemaPath.options as unknown as Record<string, unknown>;
}

describe("global mongoose configuration", () => {
  it("keeps strictQuery on so unknown filter paths are dropped", () => {
    expect(mongoose.get("strictQuery")).toBe(true);
  });

  it("enables sanitizeFilter as defence in depth", () => {
    expect(mongoose.get("sanitizeFilter")).toBe(true);
  });

  it("does not push global plugins into subdocument schemas", () => {
    expect(mongoose.get("applyPluginsToChildSchemas")).toBe(false);
  });
});

describe("base plugin", () => {
  it("adds organizationId, timestamps and deletedAt to every model", () => {
    const paths = Object.keys(ExampleNote.schema.paths);

    expect(paths).toEqual(
      expect.arrayContaining(["organizationId", "createdAt", "updatedAt", "deletedAt"]),
    );
  });

  it("makes organizationId a required, indexed, immutable ObjectId", () => {
    const options = pathOptions(ExampleNote.schema, "organizationId");

    expect(options.type).toBe(Schema.Types.ObjectId);
    expect(options.required).toBe(true);
    expect(options.index).toBe(true);
    expect(options.immutable).toBe(true);
  });

  it("declares a tenant-first compound index", () => {
    const indexes = ExampleNote.schema.indexes().map(([fields]) => Object.keys(fields));

    expect(indexes).toContainEqual(["organizationId", "deletedAt", "createdAt"]);
    // Every declared index starts with the tenant key.
    for (const fields of indexes) {
      expect(fields[0]).toBe("organizationId");
    }
  });

  it("hides soft-deleted documents by default", () => {
    const query = ExampleNote.find({ status: "DRAFT" });
    applySoftDeleteFilter(query);

    expect(query.getFilter()).toEqual({ status: "DRAFT", deletedAt: null });
  });

  it("includes deleted documents only when explicitly asked", () => {
    const query = ExampleNote.find({ status: "DRAFT" }).setOptions({ withDeleted: true });
    applySoftDeleteFilter(query);

    expect(query.getFilter()).toEqual({ status: "DRAFT" });
  });

  it("never overrides an explicit deletedAt condition", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    const query = ExampleNote.find({ deletedAt: { $gte: since } });
    applySoftDeleteFilter(query);

    expect(query.getFilter()).toEqual({ deletedAt: { $gte: since } });
  });

  it("actually applies the filter when a query executes", async () => {
    const query = ExampleNote.find({ status: "DRAFT" });

    // No connection is open, so exec() rejects — but the pre hooks have
    // already run against the query by then. This proves the hook is wired up,
    // not merely that the rule above is correct.
    await query.exec().catch(() => undefined);

    expect(query.getFilter()).toEqual({ status: "DRAFT", deletedAt: null });
  });

  it("covers read and update operations but leaves hard deletes alone", () => {
    expect(SOFT_DELETE_FILTERED_OPS).toEqual(
      expect.arrayContaining(["find", "findOne", "countDocuments", "updateMany", "updateOne"]),
    );
    // A purge job must be able to hard delete an already soft-deleted document.
    expect(SOFT_DELETE_FILTERED_OPS).not.toContain("deleteMany");
    expect(SOFT_DELETE_FILTERED_OPS).not.toContain("deleteOne");
    expect(SOFT_DELETE_FILTERED_OPS).not.toContain("findOneAndDelete");
  });

  it("omits organizationId when a schema opts out of tenant scoping", () => {
    const schema = buildSchema(entity({ name: z.string() }), { tenantScoped: false });
    const model = compileFixture("OptedOutFixture", schema);

    expect(model.schema.path("organizationId")).toBeUndefined();
    expect(model.schema.path("deletedAt")).toBeDefined();
    expect(model.schema.path("createdAt")).toBeDefined();
  });

  it("leaves subdocument schemas free of tenant fields", () => {
    const withNested = buildSchema(
      entity({ address: entity({ city: z.string(), district: z.string().optional() }) }),
    );
    compileFixture("NestedFixture", withNested);

    expect(withNested.path("address.organizationId")).toBeUndefined();
    expect(withNested.path("address.deletedAt")).toBeUndefined();
    expect(withNested.path("address.city")).toBeDefined();
  });
});

describe("zod -> mongoose derivation", () => {
  const schema = ExampleNote.schema;

  it("marks a plain required field required and carries its length bounds", () => {
    const options = pathOptions(schema, "title");

    expect(options.type).toBe(String);
    expect(options.required).toBe(true);
    expect(options.minlength).toBe(1);
    expect(options.maxlength).toBe(120);
    expect(options.trim).toBe(true);
  });

  it("does not mark an optional field required", () => {
    expect(pathOptions(schema, "body").required).toBeUndefined();
  });

  it("mirrors inclusive numeric bounds but leaves exclusive ones to zod", () => {
    const derived = buildSchema(
      entity({ floorArea: z.number().min(1).max(100), ratio: z.number().gt(0) }),
      { tenantScoped: false },
    );

    expect(pathOptions(derived, "floorArea").min).toBe(1);
    expect(pathOptions(derived, "floorArea").max).toBe(100);
    expect(pathOptions(derived, "ratio").min).toBeUndefined();
  });

  it("turns a zod enum into a Mongoose enum with the zod default", () => {
    const options = pathOptions(schema, "status");

    expect(options.type).toBe(String);
    expect(options.enum).toEqual(["DRAFT", "PUBLISHED", "ARCHIVED"]);
    expect(options.default).toBe("DRAFT");
    expect(options.required).toBeUndefined();
  });

  it("derives ObjectId with a ref from objectId()", () => {
    const options = pathOptions(schema, "authorId");

    expect(options.type).toBe(Schema.Types.ObjectId);
    expect(options.ref).toBe("User");
    expect(options.required).toBe(true);
  });

  it("derives arrays of primitives", () => {
    expect(schema.path("tags")).toBeInstanceOf(mongoose.Schema.Types.Array);
  });

  it("gives each document its own copy of an object default", () => {
    const first = new ExampleNote();
    const second = new ExampleNote();

    first.tags.push("hvac");

    expect(second.tags).toHaveLength(0);
  });

  it("treats a nullable field as optional and defaults it to null", () => {
    const options = pathOptions(schema, "reminderAt");

    expect(options.type).toBe(Date);
    expect(options.required).toBeUndefined();
    expect(options.default).toBeNull();
  });

  it("supports an explicit Mixed escape hatch", () => {
    const derived = buildSchema(
      entity({ payload: mongo(z.unknown(), { type: "Mixed" }) }),
      { tenantScoped: false },
    );

    expect(pathOptions(derived, "payload").type).toBe(Schema.Types.Mixed);
  });

  it("fails loudly on a shape it cannot derive", () => {
    expect(() =>
      buildSchema(entity({ weird: z.map(z.string(), z.string()) })),
    ).toThrow(SchemaDerivationError);
  });
});

describe("zod schema as the source of truth", () => {
  it("rejects unknown fields", () => {
    const result = noteInputSchema.safeParse({
      title: "Chiller service",
      authorId: new Types.ObjectId().toHexString(),
      organizationId: new Types.ObjectId().toHexString(), // client-supplied scope
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid payload and coerces an id string to an ObjectId", () => {
    const authorId = new Types.ObjectId();

    const result = noteInputSchema.parse({
      title: "Chiller service",
      authorId: authorId.toHexString(),
    });

    expect(result.authorId).toBeInstanceOf(Types.ObjectId);
    expect(result.authorId.equals(authorId)).toBe(true);
    expect(result.status).toBe("DRAFT");
    expect(result.pinned).toBe(false);
    expect(result.tags).toEqual([]);
  });

  it("rejects a malformed object id", () => {
    const result = noteInputSchema.safeParse({ title: "x", authorId: "not-an-id" });

    expect(result.success).toBe(false);
  });
});
