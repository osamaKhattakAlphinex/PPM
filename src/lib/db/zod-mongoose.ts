import {
  Schema,
  Types,
  type IndexDefinition,
  type IndexOptions,
  type SchemaDefinition,
  type SchemaOptions,
} from "mongoose";
import { z } from "zod";

import { TENANT_SCOPED_OPTION } from "./base-plugin";

/**
 * The zod-first modeling pattern.
 *
 * A zod schema is the single source of truth for an entity: it validates every
 * inbound payload AND generates the Mongoose schema. There is no second place
 * to update when a field changes, so validation and storage cannot drift.
 *
 *     const invoiceInput = entity({ ... });          // zod: source of truth
 *     export const Invoice = defineModel("Invoice", invoiceInput);
 *
 * Storage-only concerns that zod has no concept of (indexes, refs, `trim`) are
 * attached as metadata with {@link mongo}, keeping them next to the field they
 * describe without polluting the validation type.
 */

// ---------------------------------------------------------------------------
// Field metadata
// ---------------------------------------------------------------------------

/** Mongoose-only concerns attached to a zod field via `.meta({ mongo: … })`. */
export interface MongoHints {
  /** Store as ObjectId rather than String. Implied by `ref`. */
  objectId?: boolean;
  /** Referenced model name, for `populate()`. */
  ref?: string;
  /** Escape hatch for a shape the converter cannot derive. */
  type?: "Mixed";
  index?: boolean;
  /**
   * Unique index. Almost always wrong on its own in a multi-tenant app —
   * uniqueness is per-organization, so prefer a compound index in
   * `buildSchema({ indexes: [...] })` over a bare unique field.
   */
  unique?: boolean;
  sparse?: boolean;
  trim?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  /** `false` excludes the field from query results unless explicitly selected. */
  select?: boolean;
  immutable?: boolean;
}

interface FieldMeta {
  mongo?: MongoHints;
}

/** Attach storage hints to a zod field. Returns the same schema type. */
export function mongo<T extends z.ZodType>(schema: T, hints: MongoHints): T {
  const existing = (schema.meta() as FieldMeta | undefined)?.mongo ?? {};
  return schema.meta({ mongo: { ...existing, ...hints } }) as T;
}

/**
 * A reference to another document.
 *
 * Accepts a 24-character hex string (what arrives over the wire) or an
 * ObjectId, and always outputs an ObjectId — so `z.infer` matches what is
 * actually stored and the document type needs no casting.
 */
export function objectId(ref?: string) {
  const base = z
    .union([
      z.instanceof(Types.ObjectId),
      z.string().regex(/^[0-9a-fA-F]{24}$/, "Expected a 24-character object id"),
    ])
    .transform((value) => (typeof value === "string" ? new Types.ObjectId(value) : value));

  return base.meta({ mongo: { objectId: true, ...(ref ? { ref } : {}) } });
}

/**
 * Declare an entity shape.
 *
 * Strict by construction: an unknown key is an error, not something silently
 * dropped, so a client cannot smuggle a field past validation.
 */
export function entity<T extends z.ZodRawShape>(shape: T): z.ZodObject<T, z.core.$strict> {
  return z.strictObject(shape);
}

// ---------------------------------------------------------------------------
// zod introspection
// ---------------------------------------------------------------------------

interface ZodDef {
  type: string;
  [key: string]: unknown;
}

interface ZodCheckDef {
  check: string;
  minimum?: number;
  maximum?: number;
  value?: number;
  inclusive?: boolean;
  [key: string]: unknown;
}

/** zod v4 exposes its node definitions at `._zod.def`. */
function defOf(schema: z.ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

function checksOf(def: ZodDef): ZodCheckDef[] {
  const checks = def.checks;
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => (check as { _zod: { def: ZodCheckDef } })._zod.def);
}

interface Unwrapped {
  inner: z.ZodType;
  optional: boolean;
  nullable: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  hints: MongoHints;
}

/**
 * Peel wrapper nodes (`optional`, `nullable`, `default`, ...) off a field,
 * collecting the modifiers and any metadata found on the way down. Metadata on
 * an outer wrapper wins, so `mongo(z.string().meta(...), …)` behaves as read.
 */
function unwrap(schema: z.ZodType): Unwrapped {
  let current = schema;
  let optional = false;
  let nullable = false;
  let hasDefault = false;
  let defaultValue: unknown;
  let hints: MongoHints = {};

  // Bounded: a pathological chain of wrappers should not spin.
  for (let depth = 0; depth < 32; depth += 1) {
    const meta = current.meta() as FieldMeta | undefined;
    if (meta?.mongo) hints = { ...meta.mongo, ...hints };

    const def = defOf(current);

    if (def.type === "optional") {
      optional = true;
      current = def.innerType as z.ZodType;
      continue;
    }
    if (def.type === "nullable") {
      nullable = true;
      current = def.innerType as z.ZodType;
      continue;
    }
    if (def.type === "default" || def.type === "prefault") {
      hasDefault = true;
      defaultValue = def.defaultValue;
      current = def.innerType as z.ZodType;
      continue;
    }
    if (def.type === "nonoptional") {
      optional = false;
      current = def.innerType as z.ZodType;
      continue;
    }
    if (def.type === "readonly" || def.type === "catch") {
      current = def.innerType as z.ZodType;
      continue;
    }

    break;
  }

  return { inner: current, optional, nullable, hasDefault, defaultValue, hints };
}

// ---------------------------------------------------------------------------
// zod -> Mongoose
// ---------------------------------------------------------------------------

export class SchemaDerivationError extends Error {
  constructor(path: string, detail: string) {
    super(`Cannot derive a Mongoose type for "${path}": ${detail}`);
    this.name = "SchemaDerivationError";
  }
}

/**
 * Mongoose shares one schema instance across every document, so an object or
 * array default must be produced fresh per document rather than shared.
 */
function defaultFor(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    return () => structuredClone(value);
  }
  return value;
}

function enumTypeFor(values: readonly unknown[], path: string): typeof String | typeof Number {
  if (values.every((value) => typeof value === "string")) return String;
  if (values.every((value) => typeof value === "number")) return Number;
  throw new SchemaDerivationError(path, "mixed-type enum values are not supported");
}

function baseTypeFor(
  inner: z.ZodType,
  hints: MongoHints,
  path: string,
): Record<string, unknown> {
  // Hints win: an ObjectId or Mixed field is declared, not inferred.
  if (hints.objectId || hints.ref) {
    return {
      type: Schema.Types.ObjectId,
      ...(hints.ref ? { ref: hints.ref } : {}),
    };
  }
  if (hints.type === "Mixed") {
    return { type: Schema.Types.Mixed };
  }

  const def = defOf(inner);

  switch (def.type) {
    case "string": {
      const node: Record<string, unknown> = { type: String };
      for (const check of checksOf(def)) {
        if (check.check === "min_length" && typeof check.minimum === "number") {
          node.minlength = check.minimum;
        }
        if (check.check === "max_length" && typeof check.maximum === "number") {
          node.maxlength = check.maximum;
        }
      }
      return node;
    }

    case "number": {
      const node: Record<string, unknown> = { type: Number };
      for (const check of checksOf(def)) {
        // Mongoose min/max are inclusive, so only mirror an inclusive bound.
        // An exclusive one (`.gt()` / `.lt()`) stays enforced by zod alone.
        if (check.inclusive !== true) continue;
        if (check.check === "greater_than" && typeof check.value === "number") {
          node.min = check.value;
        }
        if (check.check === "less_than" && typeof check.value === "number") {
          node.max = check.value;
        }
      }
      return node;
    }

    case "bigint":
      return { type: Schema.Types.BigInt };

    case "boolean":
      return { type: Boolean };

    case "date":
      return { type: Date };

    case "enum": {
      const values = Object.values(def.entries as Record<string, unknown>);
      return { type: enumTypeFor(values, path), enum: values };
    }

    case "literal": {
      const values = def.values as readonly unknown[];
      return { type: enumTypeFor(values, path), enum: [...values] };
    }

    case "array": {
      const element = fieldDefinition(def.element as z.ZodType, `${path}[]`);
      return { type: [element] };
    }

    case "object":
      return { type: subSchema(inner as z.ZodObject, path) };

    case "record": {
      const value = fieldDefinition(def.valueType as z.ZodType, `${path}.*`);
      return { type: Map, of: value };
    }

    default:
      throw new SchemaDerivationError(
        path,
        `unsupported zod type "${def.type}". Add a storage hint, e.g. ` +
          `mongo(field, { type: "Mixed" }) or mongo(field, { objectId: true }).`,
      );
  }
}

function fieldDefinition(field: z.ZodType, path: string): Record<string, unknown> {
  const { inner, optional, nullable, hasDefault, defaultValue, hints } = unwrap(field);
  const node = baseTypeFor(inner, hints, path);

  // Required unless zod says the value may be absent. A nullable field is left
  // optional because Mongoose's `required` validator rejects null.
  if (!optional && !nullable && !hasDefault) {
    node.required = true;
  }

  if (hasDefault) {
    node.default = defaultFor(defaultValue);
  } else if (nullable) {
    node.default = null;
  }

  if (hints.index !== undefined) node.index = hints.index;
  if (hints.unique !== undefined) node.unique = hints.unique;
  if (hints.sparse !== undefined) node.sparse = hints.sparse;
  if (hints.trim !== undefined) node.trim = hints.trim;
  if (hints.lowercase !== undefined) node.lowercase = hints.lowercase;
  if (hints.uppercase !== undefined) node.uppercase = hints.uppercase;
  if (hints.select !== undefined) node.select = hints.select;
  if (hints.immutable !== undefined) node.immutable = hints.immutable;

  return node;
}

function shapeOf(schema: z.ZodObject): Record<string, z.ZodType> {
  return defOf(schema).shape as Record<string, z.ZodType>;
}

/**
 * Nested objects become real subdocument schemas with no `_id` of their own.
 * Global plugins do not reach them (`applyPluginsToChildSchemas` is off), so a
 * nested object never sprouts its own organizationId or timestamps.
 */
function subSchema(schema: z.ZodObject, path: string): Schema {
  const definition: SchemaDefinition = {};
  for (const [key, field] of Object.entries(shapeOf(schema))) {
    definition[key] = fieldDefinition(field, `${path}.${key}`);
  }
  return new Schema(definition, { _id: false, minimize: false });
}

/** Derive a Mongoose schema definition from a zod object. Exported for tests. */
export function zodToSchemaDefinition(schema: z.ZodObject): SchemaDefinition {
  const definition: SchemaDefinition = {};
  for (const [key, field] of Object.entries(shapeOf(schema))) {
    definition[key] = fieldDefinition(field, key);
  }
  return definition;
}

// ---------------------------------------------------------------------------
// Schema construction
// ---------------------------------------------------------------------------

export interface BuildSchemaOptions {
  collection?: string;
  /** Set false for the few collections that are not owned by an organization. */
  tenantScoped?: boolean;
  /**
   * Compound indexes. Every index on a tenant-scoped collection should start
   * with `organizationId`.
   */
  indexes?: ReadonlyArray<{ fields: IndexDefinition; options?: IndexOptions }>;
  schemaOptions?: SchemaOptions;
  /**
   * Last chance to touch the schema before the model is compiled — for the
   * cross-field invariants a per-field zod shape cannot express ("a CLIENT
   * user must have a clientId"). Runs after the fields and indexes are in
   * place; Mongoose ignores middleware registered after compilation, so this
   * is the only point at which a hook can still be added.
   */
  refine?: (schema: Schema) => void;
}

export function buildSchema(
  zodSchema: z.ZodObject,
  options: BuildSchemaOptions = {},
): Schema {
  const definition = zodToSchemaDefinition(zodSchema);

  const schemaOptions = {
    strict: "throw",
    // Keep empty objects rather than dropping them, so a document's shape
    // always matches the zod type it was validated against.
    minimize: false,
    id: false,
    ...(options.collection ? { collection: options.collection } : {}),
    ...options.schemaOptions,
    // Read back by the global base plugin at model-compile time. Not part of
    // Mongoose's own option type, hence the cast.
    [TENANT_SCOPED_OPTION]: options.tenantScoped ?? true,
  } as unknown as SchemaOptions;

  const schema = new Schema(definition, schemaOptions);

  for (const index of options.indexes ?? []) {
    schema.index(index.fields, index.options);
  }

  options.refine?.(schema);

  return schema;
}

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

/** Fields the base plugin adds to every tenant-scoped document. */
export interface BaseDocumentFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The stored shape of an entity: its zod output plus the base plugin fields. */
export type DocumentOf<T extends z.ZodObject> = z.infer<T> & BaseDocumentFields;
