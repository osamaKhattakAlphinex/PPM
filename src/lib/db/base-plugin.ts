import { Schema, type MongooseDefaultQueryMiddleware, type Query } from "mongoose";

/**
 * The base plugin. Registered globally in `mongoose-setup.ts`, so every model
 * compiled anywhere in the app gets tenant scoping, timestamps and soft delete
 * whether or not its author remembered to ask for them.
 *
 * Global plugins run when a model is COMPILED, not when the schema is
 * constructed, so `buildSchema()` can stamp options that the plugin then reads.
 */

/** Schema option used to opt a top-level collection out of tenant scoping. */
export const TENANT_SCOPED_OPTION = "tenantScoped";

/**
 * Query option that includes soft-deleted documents:
 * `Model.find(filter).setOptions({ withDeleted: true })`.
 */
export const WITH_DELETED_OPTION = "withDeleted";

/** Paths the plugin owns. Feature schemas must not declare these themselves. */
export const BASE_PATHS = ["organizationId", "createdAt", "updatedAt", "deletedAt"] as const;

/**
 * Almost every collection is tenant-owned. The exceptions are the few global
 * ones (the Organization collection itself, a system-wide audit log) which pass
 * `tenantScoped: false` to `buildSchema()`.
 */
function isTenantScoped(schema: Schema): boolean {
  const options = schema.options as unknown as Record<string, unknown>;
  return options[TENANT_SCOPED_OPTION] !== false;
}

/**
 * Operations that hide soft-deleted documents by default.
 *
 * Reads and updates only. Hard deletes are deliberately absent so a purge job
 * can remove an already soft-deleted document without opting in, and
 * `estimatedDocumentCount` is absent because it takes no filter.
 *
 * Does NOT cover `aggregate` — a pipeline must filter `deletedAt: null` itself.
 */
export const SOFT_DELETE_FILTERED_OPS: readonly MongooseDefaultQueryMiddleware[] = [
  "countDocuments",
  "distinct",
  "find",
  "findOne",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateMany",
  "updateOne",
];

/**
 * The soft-delete rule itself, separated from the hook so it can be tested
 * without a live connection.
 *
 * Excludes deleted documents unless the caller opted in with
 * `withDeleted: true`, and never overrides an explicit `deletedAt` condition.
 */
export function applySoftDeleteFilter(query: Query<unknown, unknown>): void {
  const options = query.getOptions() as Record<string, unknown>;
  if (options[WITH_DELETED_OPTION] === true) return;

  if (!("deletedAt" in query.getFilter())) {
    query.where({ deletedAt: null });
  }
}

export function basePlugin(schema: Schema): void {
  // --- timestamps ---------------------------------------------------------
  // Mongoose maintains createdAt/updatedAt itself, including on updates.
  // Respect an explicit choice if the schema already made one.
  if (schema.options.timestamps === undefined) {
    schema.set("timestamps", true);
  }

  // --- soft delete --------------------------------------------------------
  if (!schema.path("deletedAt")) {
    schema.add({
      deletedAt: { type: Date, default: null },
    });
  }

  // --- tenant scoping -----------------------------------------------------
  if (isTenantScoped(schema)) {
    if (!schema.path("organizationId")) {
      schema.add({
        organizationId: {
          type: Schema.Types.ObjectId,
          required: true,
          index: true,
          // A document can never be moved between tenants after creation.
          immutable: true,
        },
      });
    }

    // Every common query starts with organizationId, then excludes deleted
    // rows, then sorts newest-first. One compound index serves all three.
    schema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });
  } else {
    schema.index({ deletedAt: 1 });
  }

  // --- default soft-delete filter ----------------------------------------
  schema.pre<Query<unknown, unknown>>([...SOFT_DELETE_FILTERED_OPS], function () {
    applySoftDeleteFilter(this);
  });

  // --- helpers ------------------------------------------------------------
  schema.methods.softDelete = function softDelete(this: {
    deletedAt: Date | null;
    save: () => Promise<unknown>;
  }): Promise<unknown> {
    this.deletedAt = new Date();
    return this.save();
  };

  schema.methods.restore = function restore(this: {
    deletedAt: Date | null;
    save: () => Promise<unknown>;
  }): Promise<unknown> {
    this.deletedAt = null;
    return this.save();
  };
}
