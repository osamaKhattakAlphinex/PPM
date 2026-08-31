import mongoose, { Types, type Model, type QueryFilter, type SchemaType } from "mongoose";
import { z } from "zod";

import type { AppSession } from "../auth/session";
import { WITH_DELETED_OPTION } from "./base-plugin";
import { toObjectId, type ObjectIdLike } from "./object-id";
import {
  assertNoDangerousOperators,
  assertNoUnsafeKeys,
  findUnsafeKeys,
  sanitize,
  UnsafeQueryError,
} from "./sanitize";
import { getScope, isClientScope, ScopeResolutionError, type TenantScope } from "./scope";
import type { BaseDocumentFields } from "./zod-mongoose";

/**
 * The tenant-scoped data-access layer.
 *
 * Feature code NEVER touches a Mongoose model. It asks a repository, and the
 * repository decides what the filter looks like:
 *
 *     const notes = createRepository(ExampleNote);   // module scope
 *     const repo = notes.forSession(await auth());   // per request
 *     const page = await repo.paginate({ page: 1 });
 *
 * Four invariants hold for every method here, each proved against a real mongod
 * in `__tests__/repository.test.ts`:
 *
 *  1. organizationId is added to every filter LAST, so nothing a caller passes
 *     can displace it — not a filter key, not a trusted fragment, not an _id.
 *  2. clientId is added the same way whenever the session role is client-scoped.
 *  3. Every caller-supplied filter and payload goes through the Prompt 0.3
 *     sanitizer before it gets anywhere near a query.
 *  4. Soft-deleted documents are invisible unless explicitly asked for.
 *
 * Deliberately NOT supported: `populate` and raw aggregation pipelines. Both
 * cross a collection boundary, where the joined collection would be reached
 * under MongoDB's rules rather than ours. Start a pipeline from `matchStage()`
 * instead, which is a filter this layer has already scoped.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fields the DAL owns. A caller may never set or patch them. */
export const RESERVED_FIELDS = [
  "_id",
  "organizationId",
  "clientId",
  "createdAt",
  "updatedAt",
  "deletedAt",
] as const;

/**
 * The default shape a repository accepts on create: the entity's own fields.
 *
 * It is derived from the STORED document type, so a field with a schema default
 * looks required here even though the caller may omit it. Pass the entity's zod
 * input type explicitly to get that right:
 *
 *     createRepository<NoteDoc, z.input<typeof noteSchema>>(Note)
 *
 * `clientId` is added back as OPTIONAL for client-partitioned collections: a
 * staff user has to say which client a record belongs to, while a CLIENT user's
 * value is ignored and replaced with their own, so they may omit it.
 */
export type CreateInput<T> = Omit<T, (typeof RESERVED_FIELDS)[number]> &
  Partial<Pick<T, Extract<keyof T, "clientId">>>;

/** What a repository accepts on update. `clientId` is not patchable. */
export type UpdateInput<T> = Partial<Omit<T, (typeof RESERVED_FIELDS)[number]>>;

/** A plain equality filter. Operators belong in `where`, not here. */
export type ScopedFilter<T> = {
  readonly [K in keyof T]?: T[K] | readonly T[K][];
};

export type SortSpec = Readonly<Record<string, 1 | -1>>;

export interface ReadOptions<T> {
  /**
   * A TRUSTED, code-authored fragment where Mongo operators are allowed
   * (`$in`, `$gte`, `$or`, ...). Never pass request data here — that goes in
   * the `filter` argument, which is sanitized. Scope keys are applied after
   * this fragment either way, and always win.
   */
  where?: QueryFilter<T>;
  /** Project only these paths. Unknown paths are dropped. */
  select?: readonly string[];
  sort?: SortSpec;
  limit?: number;
  skip?: number;
  /** Include soft-deleted documents. For restore flows and purge jobs only. */
  includeDeleted?: boolean;
}

export interface PaginateParams<T> extends Omit<ReadOptions<T>, "limit" | "skip"> {
  filter?: ScopedFilter<T>;
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface RepositoryOptions {
  /**
   * Set true for an org-wide collection that has no `clientId` but that CLIENT
   * users are still allowed to read (a service catalogue, a price list).
   *
   * Without it, a client-scoped session hitting a collection that cannot be
   * narrowed to a client is refused — because "no clientId path" would
   * otherwise silently mean "this client sees the whole organization".
   */
  sharedWithClients?: boolean;
  /** Default page size for `paginate()`. */
  defaultPageSize?: number;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;
/** `find()` is capped so a forgotten filter cannot stream a whole collection. */
export const DEFAULT_FIND_LIMIT = 100;
export const MAX_FIND_LIMIT = 1_000;

// ---------------------------------------------------------------------------
// Trusted-fragment handling
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOperatorKey(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => key.startsWith("$"));
}

/**
 * `sanitizeFilter` is on globally, so Mongoose neutralises any filter value
 * that looks like an operator — including the ones we wrote ourselves. A
 * code-authored fragment has to be marked trusted or it silently matches
 * nothing. Values from `filter` are never passed through here.
 */
function markTrusted(fragment: unknown): unknown {
  if (Array.isArray(fragment)) return fragment.map(markTrusted);
  if (!isPlainObject(fragment)) return fragment;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fragment)) {
    if (Array.isArray(value)) {
      // $or / $and / $nor carry arrays of sub-filters. Recurse into them; the
      // array itself is not an operator object.
      result[key] = value.map(markTrusted);
    } else if (isPlainObject(value) && hasOperatorKey(value)) {
      result[key] = mongoose.trusted(markTrusted(value) as Record<string, unknown>);
    } else if (isPlainObject(value)) {
      result[key] = markTrusted(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface Repository<T, TCreate = CreateInput<T>, TUpdate = UpdateInput<T>> {
  readonly scope: TenantScope;
  readonly modelName: string;

  find(filter?: ScopedFilter<T>, options?: ReadOptions<T>): Promise<T[]>;
  findOne(filter?: ScopedFilter<T>, options?: ReadOptions<T>): Promise<T | null>;
  findById(id: ObjectIdLike, options?: ReadOptions<T>): Promise<T | null>;
  count(filter?: ScopedFilter<T>, options?: ReadOptions<T>): Promise<number>;
  exists(filter?: ScopedFilter<T>, options?: ReadOptions<T>): Promise<boolean>;
  paginate(params?: PaginateParams<T>): Promise<Page<T>>;

  create(input: TCreate): Promise<T>;
  createMany(inputs: readonly TCreate[]): Promise<T[]>;

  update(id: ObjectIdLike, patch: TUpdate): Promise<T | null>;
  updateMany(filter: ScopedFilter<T>, patch: TUpdate): Promise<number>;

  /** Soft delete. Returns false when nothing in scope matched. */
  delete(id: ObjectIdLike): Promise<boolean>;
  deleteMany(filter: ScopedFilter<T>): Promise<number>;
  restore(id: ObjectIdLike): Promise<T | null>;
  /** Irreversible. Still scoped — a purge job cannot reach another tenant. */
  hardDelete(id: ObjectIdLike): Promise<boolean>;

  /**
   * The scoped filter itself. Exposed so an aggregation can start from a
   * `$match` that is provably tenant-scoped, and so tests can assert the shape
   * without a round trip.
   */
  matchStage(filter?: ScopedFilter<T>, options?: ReadOptions<T>): Record<string, unknown>;
}

export interface RepositoryFactory<T, TCreate = CreateInput<T>, TUpdate = UpdateInput<T>> {
  readonly modelName: string;
  /** True when the collection carries a `clientId` and can be client-narrowed. */
  readonly isClientPartitioned: boolean;
  forScope(scope: TenantScope): Repository<T, TCreate, TUpdate>;
  /** Resolves scope from the session first. Throws if it cannot be resolved. */
  forSession(session: AppSession | null | undefined): Repository<T, TCreate, TUpdate>;
}

export function createRepository<
  T extends BaseDocumentFields,
  TCreate = CreateInput<T>,
  TUpdate = UpdateInput<T>,
>(model: Model<T>, options: RepositoryOptions = {}): RepositoryFactory<T, TCreate, TUpdate> {
  const { sharedWithClients = false, defaultPageSize = DEFAULT_PAGE_SIZE } = options;

  const schemaPaths = new Set(Object.keys(model.schema.paths));
  const clientPath: SchemaType | undefined = model.schema.path("clientId");
  const isClientPartitioned = clientPath !== undefined;

  if (!schemaPaths.has("organizationId")) {
    // A repository over an untenanted collection could not uphold its contract,
    // so it must not be constructible at all.
    throw new Error(
      `createRepository(${model.modelName}): the model has no organizationId. ` +
        "Untenanted collections need a purpose-built module, not the DAL.",
    );
  }

  const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(defaultPageSize),
  });

  // -------------------------------------------------------------------------

  function assertClientAccess(scope: TenantScope): void {
    if (!isClientScope(scope)) return;
    if (isClientPartitioned || sharedWithClients) return;

    throw new ScopeResolutionError(
      `${model.modelName} has no clientId and is not marked sharedWithClients; ` +
        `refusing to serve a ${scope.role} session rather than widening it to the org.`,
    );
  }

  /** Reject a filter whose keys are not schema paths. */
  function assertKnownPaths(filter: Record<string, unknown>): void {
    // strictQuery silently DROPS conditions on unknown paths, which widens the
    // result set. A typo'd or probed key has to fail the query, not relax it.
    const unknown = Object.keys(filter).filter((key) => !schemaPaths.has(key));
    if (unknown.length > 0) {
      throw new UnsafeQueryError(`Unknown filter path(s): ${unknown.join(", ")}`);
    }
  }

  /** Caller input to a filter that is safe to send. Scope keys applied last. */
  function buildFilter(
    scope: TenantScope,
    filter: ScopedFilter<T> | undefined,
    readOptions: ReadOptions<T> = {},
  ): Record<string, unknown> {
    assertClientAccess(scope);

    // 1. Untrusted input: refuse operators outright, then sanitize anyway.
    const raw = (filter ?? {}) as Record<string, unknown>;
    const unsafe = findUnsafeKeys(raw);
    if (unsafe.length > 0) {
      // Server log only; the caller gets UnsafeQueryError's generic message.
      console.warn(`[dal] rejected filter on ${model.modelName}: ${unsafe.join(", ")}`);
    }
    assertNoUnsafeKeys(raw);
    const clean = sanitize(raw);
    assertKnownPaths(clean);

    // 2. Trusted, code-authored fragment: operators allowed, JS execution not.
    const where = readOptions.where as Record<string, unknown> | undefined;
    if (where) assertNoDangerousOperators(where);
    const trustedWhere = where ? (markTrusted(where) as Record<string, unknown>) : {};

    // 3. Scope last. The spread order IS the security property: whatever a
    //    caller put in organizationId or clientId is overwritten here.
    return {
      ...trustedWhere,
      ...clean,
      ...(readOptions.includeDeleted ? {} : { deletedAt: null }),
      organizationId: scope.organizationId,
      ...(isClientScope(scope) && isClientPartitioned ? { clientId: scope.clientId } : {}),
    };
  }

  /** Drop reserved keys from a caller payload. */
  function cleanPayload(input: unknown): Record<string, unknown> {
    const raw = (input ?? {}) as Record<string, unknown>;
    assertNoUnsafeKeys(raw);
    const clean = sanitize(raw) as Record<string, unknown>;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(clean)) {
      // Ignored rather than rejected: a client round-tripping a whole document
      // should not fail, it should simply not get to choose its tenant.
      if ((RESERVED_FIELDS as readonly string[]).includes(key)) continue;
      result[key] = value;
    }
    return result;
  }

  function buildSort(sort: SortSpec | undefined): Record<string, 1 | -1> {
    const requested = sort ?? { createdAt: -1 };
    const result: Record<string, 1 | -1> = {};
    for (const [key, direction] of Object.entries(requested)) {
      if (!schemaPaths.has(key)) {
        throw new UnsafeQueryError(`Cannot sort by unknown path: ${key}`);
      }
      result[key] = direction === 1 ? 1 : -1;
    }
    // Deterministic tiebreak, so page 2 never repeats a row from page 1.
    if (!("_id" in result)) result._id = -1;
    return result;
  }

  function buildProjection(select: readonly string[] | undefined): Record<string, 1> | undefined {
    if (!select || select.length === 0) return undefined;
    const projection: Record<string, 1> = {};
    for (const path of select) {
      if (schemaPaths.has(path)) projection[path] = 1;
    }
    return Object.keys(projection).length > 0 ? projection : undefined;
  }

  function queryOptions(readOptions: ReadOptions<T>): Record<string, unknown> {
    // Tell the base plugin we have already decided about soft deletes, so it
    // does not layer its own `deletedAt: null` onto an includeDeleted read.
    return readOptions.includeDeleted ? { [WITH_DELETED_OPTION]: true } : {};
  }

  function clampLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_FIND_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) return DEFAULT_FIND_LIMIT;
    return Math.min(limit, MAX_FIND_LIMIT);
  }

  // -------------------------------------------------------------------------

  function forScope(scope: TenantScope): Repository<T, TCreate, TUpdate> {
    // The filter is built as a plain record so its construction is auditable in
    // one place; Mongoose's generic filter type cannot express "scope last".
    // This cast is the single seam between the two.
    const asFilter = (filter: Record<string, unknown>): QueryFilter<T> =>
      filter as QueryFilter<T>;

    const repository: Repository<T, TCreate, TUpdate> = {
      scope,
      modelName: model.modelName,

      matchStage(filter, options) {
        return buildFilter(scope, filter, options);
      },

      async find(filter, options = {}) {
        const query = model
          .find(asFilter(buildFilter(scope, filter, options)), buildProjection(options.select))
          .setOptions(queryOptions(options))
          .sort(buildSort(options.sort))
          .limit(clampLimit(options.limit));

        if (options.skip) query.skip(Math.max(0, Math.trunc(options.skip)));

        return query.lean<T[]>().exec();
      },

      async findOne(filter, options = {}) {
        return model
          .findOne(asFilter(buildFilter(scope, filter, options)), buildProjection(options.select))
          .setOptions(queryOptions(options))
          .sort(buildSort(options.sort))
          .lean<T | null>()
          .exec();
      },

      async findById(id, options = {}) {
        const _id = toObjectId(id);
        // An unparseable id is "no such document", never a 500.
        if (!_id) return null;

        // The id is a FILTER TERM, not a lookup key: buildFilter still layers
        // organizationId (and clientId) on top, so an id belonging to another
        // tenant simply matches nothing.
        const filter = { ...buildFilter(scope, undefined, options), _id };

        return model
          .findOne(asFilter(filter), buildProjection(options.select))
          .setOptions(queryOptions(options))
          .lean<T | null>()
          .exec();
      },

      async count(filter, options = {}) {
        return model
          .countDocuments(asFilter(buildFilter(scope, filter, options)))
          .setOptions(queryOptions(options))
          .exec();
      },

      async exists(filter, options = {}) {
        const found = await model
          .findOne(asFilter(buildFilter(scope, filter, options)), { _id: 1 })
          .setOptions(queryOptions(options))
          .lean<{ _id: Types.ObjectId } | null>()
          .exec();
        return found !== null;
      },

      async paginate(params = {}) {
        const { page, pageSize } = paginationSchema.parse({
          page: params.page,
          pageSize: params.pageSize,
        });

        const filter = asFilter(buildFilter(scope, params.filter, params));
        const opts = queryOptions(params);

        const [items, total] = await Promise.all([
          model
            .find(filter, buildProjection(params.select))
            .setOptions(opts)
            .sort(buildSort(params.sort))
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .lean<T[]>()
            .exec(),
          model.countDocuments(filter).setOptions(opts).exec(),
        ]);

        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

        return {
          items,
          page,
          pageSize,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1 && total > 0,
        };
      },

      async create(input) {
        assertClientAccess(scope);

        const raw = (input ?? {}) as Record<string, unknown>;
        const payload: Record<string, unknown> = {
          ...cleanPayload(raw),
          // Stamped last, and only from the scope. Any organizationId the
          // caller sent was already dropped by cleanPayload.
          organizationId: scope.organizationId,
        };

        if (isClientPartitioned) {
          if (isClientScope(scope)) {
            // A client user does not get to choose. Their own id, always.
            payload.clientId = scope.clientId;
          } else {
            // Staff must say which client the record is for. A missing or
            // malformed value is left absent so schema validation rejects it
            // loudly, rather than being silently stored against no client.
            const supplied = toObjectId(raw.clientId);
            if (supplied) payload.clientId = supplied;
          }
        }

        const document = new model(payload as unknown as T);
        await document.save();
        return document.toObject() as T;
      },

      async createMany(inputs) {
        const created: T[] = [];
        for (const input of inputs) {
          created.push(await repository.create(input));
        }
        return created;
      },

      async update(id, patch) {
        const _id = toObjectId(id);
        if (!_id) return null;

        const set = cleanPayload(patch);
        if (Object.keys(set).length === 0) return repository.findById(_id);

        const filter = { ...buildFilter(scope, undefined), _id };

        return model
          .findOneAndUpdate(asFilter(filter), { $set: set }, { returnDocument: "after", runValidators: true })
          .lean<T | null>()
          .exec();
      },

      async updateMany(filter, patch) {
        const set = cleanPayload(patch);
        if (Object.keys(set).length === 0) return 0;

        const result = await model
          .updateMany(asFilter(buildFilter(scope, filter)), { $set: set }, { runValidators: true })
          .exec();
        return result.modifiedCount;
      },

      async delete(id) {
        const _id = toObjectId(id);
        if (!_id) return false;

        const filter = { ...buildFilter(scope, undefined), _id };
        const result = await model
          .updateOne(asFilter(filter), { $set: { deletedAt: new Date() } })
          .exec();
        return result.modifiedCount === 1;
      },

      async deleteMany(filter) {
        const result = await model
          .updateMany(asFilter(buildFilter(scope, filter)), { $set: { deletedAt: new Date() } })
          .exec();
        return result.modifiedCount;
      },

      async restore(id) {
        const _id = toObjectId(id);
        if (!_id) return null;

        const filter = { ...buildFilter(scope, undefined, { includeDeleted: true }), _id };
        return model
          .findOneAndUpdate(asFilter(filter), { $set: { deletedAt: null } }, { returnDocument: "after" })
          .setOptions(queryOptions({ includeDeleted: true }))
          .lean<T | null>()
          .exec();
      },

      async hardDelete(id) {
        const _id = toObjectId(id);
        if (!_id) return false;

        // includeDeleted, because a purge job removes rows that are already
        // soft deleted. Still scoped, so it can only ever purge its own tenant.
        const filter = { ...buildFilter(scope, undefined, { includeDeleted: true }), _id };
        const result = await model.deleteOne(asFilter(filter)).exec();
        return result.deletedCount === 1;
      },
    };

    return repository;
  }

  return {
    modelName: model.modelName,
    isClientPartitioned,
    forScope,
    forSession(session) {
      return forScope(getScope(session));
    },
  };
}
