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
  SYSTEM_ACTOR_ID,
  systemScopeForOrganization,
  type TenantScope,
} from "./scope";

export { toObjectId, requireObjectId, type ObjectIdLike } from "./object-id";

export {
  createRepository,
  DEFAULT_FIND_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_FIND_LIMIT,
  MAX_PAGE_SIZE,
  mapPage,
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

export { prefixFilter, textSearchFilter } from "./text-search";

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
  listActiveOrganizationIds,
  MAX_ORGANIZATIONS_PER_JOB,
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
  clientExistsInScope,
  clientsRepository,
  findOwnClientForScope,
  type ClientCreateInput,
  type ClientUpdateInput,
} from "./repositories/clients";

export {
  locationsRepository,
  type LocationCreateInput,
  type LocationUpdateInput,
} from "./repositories/locations";

export {
  assetsRepository,
  type AssetCreateInput,
  type AssetUpdateInput,
} from "./repositories/assets";

export {
  techniciansRepository,
  type TechnicianCreateInput,
  type TechnicianUpdateInput,
} from "./repositories/technicians";

export {
  countPpmSchedulesByType,
  ppmSchedulesRepository,
  type PpmScheduleCreateInput,
  type PpmScheduleUpdateInput,
  type PpmTypeCount,
} from "./repositories/ppm-schedules";

export {
  countWorkOrdersByPriority,
  workOrdersRepository,
  type WorkOrderCreateInput,
  type WorkOrderPriorityCount,
  type WorkOrderUpdateInput,
} from "./repositories/work-orders";

export {
  contractsRepository,
  summariseContracts,
  type ContractCreateInput,
  type ContractSummaryTotals,
  type ContractUpdateInput,
} from "./repositories/contracts";

export {
  approvalsRepository,
  countApprovalsByStage,
  type ApprovalCreateInput,
  type ApprovalStageCount,
  type ApprovalUpdateInput,
} from "./repositories/approvals";

export {
  assetNamesFor,
  assetsByCategory,
  countWorkOrdersByStatus,
  maintenanceTrend,
  summariseAssets,
  ppmByFrequency,
  summarisePpmCompliance,
  type AssetCategoryRow,
  type AssetHealthSummary,
  type PpmFrequencyRow,
  type MaintenanceTrendPoint,
  type PpmComplianceSummary,
  type WorkOrderStatusCount,
} from "./repositories/analytics";

export {
  countUnreadNotifications,
  listNotificationsFor,
  notificationsRepository,
  type NotificationCreateInput,
  type NotificationUpdateInput,
} from "./repositories/notifications";

export {
  attendanceRepository,
  findAttendanceForDay,
  listAttendanceForDay,
  type AttendanceCreateInput,
  type AttendanceUpdateInput,
} from "./repositories/attendance";

export {
  invoicesRepository,
  summariseInvoices,
  type InvoiceCreateInput,
  type InvoiceSummaryTotals,
  type InvoiceUpdateInput,
} from "./repositories/invoices";

export {
  checklistsRepository,
  type ChecklistCreateInput,
  type ChecklistUpdateInput,
} from "./repositories/checklists";

export {
  checklistRunsRepository,
  type ChecklistRunCreateInput,
  type ChecklistRunUpdateInput,
} from "./repositories/checklist-runs";

export {
  getOrganizationForScope,
  updateOrganizationForScope,
  type OrganizationPatch,
  type OrganizationProfile,
} from "./repositories/organizations";

// --- Entity shapes and their zod schemas ------------------------------------
// The MODELS stay unexported (see above); their zod schemas do not, because
// they are the source of truth every action payload schema is derived from.

export { USER_STATUSES, userStatusSchema, type UserDocument, type UserStatus } from "./models/user";

export {
  CLIENT_STATUSES,
  clientContactInfoSchema,
  clientInputSchema,
  clientStatusSchema,
  type ClientContactInfo,
  type ClientDocument,
  type ClientStatus,
} from "./models/client";

export {
  LOCATION_STATUSES,
  addressSchema,
  locationInputSchema,
  locationStatusSchema,
  type Address,
  type LocationDocument,
  type LocationStatus,
} from "./models/location";

// The category and status vocabularies are NOT re-exported here: they are
// domain constants (`src/lib/domain/assets.ts`) that Client Components import
// as values, and anything reachable from this barrel drags Mongoose with it.
export { assetInputSchema, type AssetDocument } from "./models/asset";

// Same rule as assets above: the trade and status vocabularies, and the bounds
// on a skills list, are domain constants (`src/lib/domain/technicians.ts`) that
// the directory grid imports as values, so they are not re-exported here.
export { technicianInputSchema, type TechnicianDocument } from "./models/technician";

// Same rule again: the frequency and status vocabularies are domain constants
// (`src/lib/domain/preventive.ts`) that the schedule list, its filters and its
// tiles import as values, so they are not re-exported here.
export { ppmScheduleInputSchema, type PpmScheduleDocument } from "./models/ppm-schedule";

// And again: the priority and status vocabularies are domain constants
// (`src/lib/domain/corrective.ts`) that the ticket list, its filters, its tiles
// and — uniquely — its per-row action buttons import as values, so they are not
// re-exported here.
export { workOrderInputSchema, type WorkOrderDocument } from "./models/work-order";

// And again: the contract type and status vocabularies, the display statuses
// and the two derived-status functions are domain constants
// (`src/lib/domain/amc.ts`) that the contract list, its filters, its KPI header,
// its badge and its per-row action buttons import as values, so they are not
// re-exported here.
export { contractInputSchema, type ContractDocument } from "./models/contract";

// And again: the category vocabulary, the run statuses, the job-type
// discriminator and the bounds on an item array are domain constants
// (`src/lib/domain/checklists.ts`) that the library list, the item builder and
// the run sheet all import as values, so they are not re-exported here.
export {
  checklistInputSchema,
  checklistItemSchema,
  type ChecklistDocument,
  type ChecklistItem,
} from "./models/checklist";

// And again: the stage order, the status and ref-type vocabularies and the
// stage predicates are domain constants (`src/lib/domain/approvals.ts`) that the
// pending queue, its filters and its progress indicator import as values, so
// they are not re-exported here.
export {
  approvalHistoryEntrySchema,
  approvalInputSchema,
  type ApprovalDocument,
  type ApprovalHistoryEntry,
} from "./models/approval";

// And again: the stored and display status vocabularies, the VAT arithmetic and
// the derived-status functions are domain constants
// (`src/lib/domain/invoicing.ts`) that the ledger, its filters, its KPI header
// and its badge import as values, so they are not re-exported here.
export { invoiceInputSchema, type InvoiceDocument } from "./models/invoice";

// And again: the attendance statuses, the coordinate schema and the shift
// arithmetic are domain constants (`src/lib/domain/attendance.ts`) that the
// check-in button and the status pill import as values, so they are not
// re-exported here.
export { attendanceInputSchema, type AttendanceDocument } from "./models/attendance";

// And again: the kinds, severities and the dedupe-key builder are domain
// constants (`src/lib/domain/notifications.ts`) that the bell menu imports as
// values, so they are not re-exported here.
export {
  notificationInputSchema,
  type NotificationDocument,
} from "./models/notification";

export {
  checklistRunInputSchema,
  checklistRunItemSchema,
  type ChecklistRunDocument,
  type ChecklistRunItem,
} from "./models/checklist-run";

export {
  organizationInputSchema,
  organizationSettingsSchema,
  type OrganizationDocument,
  type OrganizationInput,
} from "./models/organization";
