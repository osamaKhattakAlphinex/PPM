import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  clientsRepository,
  connectToDatabase,
  findOwnClientForScope,
  getOrganizationForScope,
  locationsRepository,
  type ClientDocument,
  type LocationDocument,
  type Page,
  toObjectId,
  type TenantScope,
} from "@/lib/db";
import {
  listClientsSchema,
  listLocationsSchema,
  type ListClientsInput,
  type ListLocationsInput,
} from "./schemas";
import {
  toClientSummary,
  toLocationSummary,
  toOrganizationSummary,
  type ClientSummary,
  type LocationSummary,
  type OrganizationSummary,
} from "./dto";

/**
 * The read side of master data.
 *
 * Server Components call these directly (CLAUDE.md prefers Server Components
 * for reads); the list actions in `actions.ts` are thin wrappers over the same
 * two functions, so a page load and a client-side page change cannot diverge in
 * what they are allowed to return.
 *
 * Every function starts with `requireRole()`, which is also the only way to
 * obtain the `TenantScope` the repository needs — so "checked the caller" and
 * "scoped the query" are one step and cannot come apart.
 */

/** Everyone inside the organization may READ master data. Writing is narrower. */
export const MASTER_DATA_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
];

/** Locations are additionally readable by a CLIENT — narrowed to their own by the DAL. */
export const LOCATION_READERS: readonly [Role, ...Role[]] = [...MASTER_DATA_READERS, "CLIENT"];

/** ADMIN and FM_MANAGER manage; every other role is read-only. */
export const MASTER_DATA_MANAGERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

export function canManageMasterData(role: Role): boolean {
  return (MASTER_DATA_MANAGERS as readonly Role[]).includes(role);
}

/**
 * An anchored, case-insensitive prefix match on a user-supplied term.
 *
 * `$regex` is only ever reached through the repository's TRUSTED `where`
 * fragment, so three things have to be true before a search term may go near
 * it, and all three are enforced here rather than trusted to a caller:
 *
 *  - the term is escaped, so no metacharacter survives. An unescaped `(a+)+$`
 *    is a denial of service against our own database.
 *  - it is anchored with `^`, so the query can use the
 *    `{ organizationId, name }` index instead of scanning the collection.
 *  - it is length-capped upstream by `searchTerm` (64 characters).
 *
 * The scope keys are still applied after this fragment, and always win.
 */
function prefixFilter(field: string, term: string): Record<string, unknown> {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { [field]: { $regex: `^${escaped}`, $options: "i" } };
}

function mapPage<T, U>(page: Page<T>, map: (item: T) => U): Page<U> {
  return { ...page, items: page.items.map(map) };
}

// --- Clients ----------------------------------------------------------------

/**
 * The scope-taking half. Exported so `actions.ts` can reuse it with the scope
 * `defineAction` already resolved, instead of authenticating a second time —
 * one implementation, so a page load and a client-side page change can never
 * return different things.
 */
export async function listClientsForScope(
  scope: TenantScope,
  params: ListClientsInput = {},
): Promise<Page<ClientSummary>> {
  const { page, pageSize, status, q } = listClientsSchema.parse(params);

  await connectToDatabase();

  const result = await clientsRepository.forScope(scope).paginate({
    page,
    pageSize,
    // Untrusted values go in `filter`, which is sanitized and rejected for
    // operators. Only the code-authored regex goes in `where`.
    filter: status ? { status } : {},
    where: q ? prefixFilter("name", q) : undefined,
    sort: { name: 1 },
  });

  return mapPage(result, toClientSummary);
}

export async function listClients(params: ListClientsInput = {}): Promise<Page<ClientSummary>> {
  const { scope } = await requireRole(...MASTER_DATA_READERS);
  return listClientsForScope(scope, params);
}

// --- Locations --------------------------------------------------------------

/**
 * Resolve the client names for one page of locations.
 *
 * A second SCOPED read rather than a `populate()`: the DAL refuses populate on
 * purpose, because a join is reached under MongoDB's rules rather than ours and
 * would cross into a collection nothing had scoped. The ids here came out of a
 * query that was already scoped, and the lookup is scoped again on the way back
 * — so the fragment is genuinely code-authored even though the ids are data.
 *
 * Skipped entirely for a CLIENT session: `clientsRepository` refuses a
 * client-scoped session by design, and a client already knows who they are.
 */
async function clientNamesFor(
  scope: TenantScope,
  documents: readonly LocationDocument[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (scope.clientId) return names;

  // Deduplicated by hex string, collected as ObjectIds. Mongoose would cast the
  // strings for us, but handing the driver the type the field actually stores
  // keeps the `$in` a plain index lookup with nothing left to infer.
  // The id type is derived from the document rather than imported from
  // mongoose: feature code must not reach the driver, and the DAL-boundary
  // lint rule enforces that for type imports too.
  const unique = new Map<string, NonNullable<LocationDocument["clientId"]>>();
  for (const document of documents) {
    if (document.clientId) unique.set(document.clientId.toHexString(), document.clientId);
  }
  if (unique.size === 0) return names;

  const clients: ClientDocument[] = await clientsRepository.forScope(scope).find(undefined, {
    where: { _id: { $in: [...unique.values()] } },
    select: ["_id", "name"],
    limit: unique.size,
  });

  for (const client of clients) names.set(client._id.toHexString(), client.name);
  return names;
}

export async function listLocationsForScope(
  scope: TenantScope,
  params: ListLocationsInput = {},
): Promise<Page<LocationSummary>> {
  const { page, pageSize, status, clientId, q } = listLocationsSchema.parse(params);

  // The schema guarantees 24 hex characters, so this cannot fail — but the
  // filter takes an ObjectId, and coercing here rather than casting keeps the
  // "an unparseable id matches nothing" behaviour the rest of the DAL has.
  const clientFilter = clientId ? toObjectId(clientId) : null;

  await connectToDatabase();

  const result = await locationsRepository.forScope(scope).paginate({
    page,
    pageSize,
    /**
     * `clientId` here is a staff convenience filter. It is NOT a security
     * control and does not need to be one: for a CLIENT session the DAL appends
     * its own `clientId` after this filter, so a client passing someone else's
     * id narrows their own result set to nothing rather than widening it.
     */
    filter: { ...(status ? { status } : {}), ...(clientFilter ? { clientId: clientFilter } : {}) },
    where: q ? prefixFilter("name", q) : undefined,
    sort: { name: 1 },
  });

  const names = await clientNamesFor(scope, result.items);

  return mapPage(result, (document) =>
    toLocationSummary(
      document,
      document.clientId ? (names.get(document.clientId.toHexString()) ?? null) : null,
    ),
  );
}

export async function listLocations(
  params: ListLocationsInput = {},
): Promise<Page<LocationSummary>> {
  const { scope } = await requireRole(...LOCATION_READERS);
  return listLocationsForScope(scope, params);
}

// --- Organization -----------------------------------------------------------

export async function getOrganization(): Promise<OrganizationSummary | null> {
  const { scope } = await requireRole(...MASTER_DATA_READERS);

  await connectToDatabase();

  const profile = await getOrganizationForScope(scope);
  return profile ? toOrganizationSummary(profile) : null;
}

// --- The client portal ------------------------------------------------------

/**
 * The one client record a CLIENT session may see: its own.
 *
 * CLIENT-only on purpose. Staff reach a client through `listClients`, and
 * giving this function a staff fallback would turn "my own record" into "any
 * record" the first time someone passed it an id.
 */
export async function getOwnClient(): Promise<ClientSummary | null> {
  const { scope } = await requireRole("CLIENT");

  await connectToDatabase();

  const document = await findOwnClientForScope(scope);
  return document ? toClientSummary(document) : null;
}
