/**
 * Database layer public surface.
 *
 * Feature code imports from here, and reaches data ONLY through a repository
 * created by `createRepository` — that is the layer which injects
 * organizationId into every query. Importing a Mongoose model, or `mongoose`
 * itself, from outside `src/lib/db/**` is an ESLint error; see
 * `eslint-rules/dal-boundary.mjs`.
 */

export { connectToDatabase, disconnectFromDatabase, DatabaseConnectionError } from "./connect";

export {
  basePlugin,
  BASE_PATHS,
  TENANT_SCOPED_OPTION,
  WITH_DELETED_OPTION,
} from "./base-plugin";

export { defineModel } from "./define-model";

export {
  buildSchema,
  entity,
  mongo,
  objectId,
  zodToSchemaDefinition,
  SchemaDerivationError,
  type BaseDocumentFields,
  type BuildSchemaOptions,
  type DocumentOf,
  type MongoHints,
} from "./zod-mongoose";

export {
  getScope,
  isClientScope,
  describeScope,
  ScopeResolutionError,
  type TenantScope,
} from "./scope";

export { toObjectId, requireObjectId, type ObjectIdLike } from "./object-id";

export {
  createRepository,
  DEFAULT_FIND_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_FIND_LIMIT,
  MAX_PAGE_SIZE,
  RESERVED_FIELDS,
  type CreateInput,
  type Page,
  type PaginateParams,
  type ReadOptions,
  type Repository,
  type RepositoryFactory,
  type RepositoryOptions,
  type ScopedFilter,
  type SortSpec,
  type UpdateInput,
} from "./repository";

export {
  assertNoDangerousOperators,
  assertNoUnsafeKeys,
  DANGEROUS_OPERATORS,
  findUnsafeKeys,
  isUnsafeKey,
  sanitize,
  UnsafeQueryError,
  type SanitizeOptions,
} from "./sanitize";

// --- Identity ---------------------------------------------------------------
// The models are NOT exported: feature code reaches users and clients through
// the repositories below, and authentication reaches them through the identity
// store, which is the one deliberately unscoped module in the app.

export {
  clientBelongsToOrganization,
  ensureOrganization,
  findIdentityById,
  findOrganizationBySlug,
  findSignInCandidate,
  recordSuccessfulLogin,
  updatePasswordHash,
  type IdentitySnapshot,
  type OrganizationRecord,
  type OrganizationStatus,
  type SignInCandidate,
} from "./identity-store";

export {
  usersRepository,
  type UserCreateInput,
  type UserUpdateInput,
} from "./repositories/users";

export {
  clientsRepository,
  type ClientCreateInput,
  type ClientUpdateInput,
} from "./repositories/clients";

export { USER_STATUSES, userStatusSchema, type UserDocument, type UserStatus } from "./models/user";
export { type ClientDocument } from "./models/client";
export { type OrganizationInput, type OrganizationDocument } from "./models/organization";
