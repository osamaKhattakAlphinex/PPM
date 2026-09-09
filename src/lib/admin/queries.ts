import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import { ASSIGNABLE_ROLES } from "@/lib/auth/access";
import {
  clientsRepository,
  connectToDatabase,
  mapPage,
  prefixFilter,
  usersRepository,
  type ClientDocument,
  type Page,
  type ScopedFilter,
  type TenantScope,
  type UserDocument,
} from "@/lib/db";
import { toUserSummary, type UserSummary } from "./dto";
import { listUsersSchema, type ListUsersInput } from "./schemas";

/**
 * The read side of user administration.
 *
 * Every exported function starts with `requireRole()`, which is also the only
 * way to obtain the `TenantScope` the repository needs — so "checked the
 * caller" and "scoped the query" are one step and cannot come apart.
 *
 * The directory it returns is the organization's own staff and customer
 * accounts, scoped like everything else: an administrator of one company
 * cannot see, count, or discover the existence of another company's users.
 */

/**
 * Who may administer accounts.
 *
 * The same two roles `registerUser` accepts, and that is not a coincidence
 * maintained by hand: a screen that lists accounts to someone who cannot act on
 * them is a directory of email addresses handed out for no reason. SUPERVISOR
 * is absent here for the same reason `ASSIGNABLE_ROLES` gives them an empty
 * list — creating and disabling colleagues is not a shift-supervision task.
 */
export const USER_ADMINS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

export function canAdministerUsers(role: Role): boolean {
  return (USER_ADMINS as readonly Role[]).includes(role);
}

/**
 * Which roles this administrator may create, taken from the one table that
 * decides it rather than restated. An FM_MANAGER's form therefore offers no
 * ADMIN option, and the action refuses one anyway if the option is forged.
 */
export function assignableRolesFor(role: Role): readonly Role[] {
  return ASSIGNABLE_ROLES[role];
}

/**
 * Never `passwordHash`.
 *
 * The field is `select: false` on the model, so it is already excluded — this
 * projection states it a second way, because the cost of the two of them
 * disagreeing is an argon2 digest in a page's RSC payload.
 */
const USER_FIELDS = [
  "_id",
  "name",
  "email",
  "role",
  "status",
  "clientId",
  "createdAt",
] as const;

/**
 * Resolve the client names for one page of users.
 *
 * A second SCOPED read rather than a `populate()`: a join runs under MongoDB's
 * rules rather than ours, and would cross into a collection nothing had scoped.
 * The ids came out of a query that was already scoped, and this lookup is
 * scoped again on the way back.
 *
 * An id that resolves to nothing is left unresolved rather than reported —
 * the row still renders, without a name the caller was not entitled to read.
 */
async function clientNamesFor(
  scope: TenantScope,
  documents: readonly UserDocument[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  const clientIds = new Map<string, NonNullable<UserDocument["clientId"]>>();
  for (const document of documents) {
    if (document.clientId)
      clientIds.set(document.clientId.toHexString(), document.clientId);
  }
  if (clientIds.size === 0) return names;

  const clients: ClientDocument[] = await clientsRepository
    .forScope(scope)
    .find(undefined, {
      where: { _id: { $in: [...clientIds.values()] } },
      select: ["_id", "name"],
      limit: clientIds.size,
    });

  for (const client of clients)
    names.set(client._id.toHexString(), client.name);
  return names;
}

/**
 * The scope-taking half. Exported so `actions.ts` can reuse it with the scope
 * `defineAction` already resolved, instead of authenticating a second time.
 */
export async function listUsersForScope(
  scope: TenantScope,
  params: ListUsersInput = {},
): Promise<Page<UserSummary>> {
  const { page, pageSize, search, role, status } =
    listUsersSchema.parse(params);

  await connectToDatabase();

  // Untrusted values go in `filter`, which the DAL sanitizes and checks against
  // the model's real paths. Only the code-authored, escaped, anchored regex
  // from `prefixFilter` is allowed into the trusted `where` fragment.
  const filter: ScopedFilter<UserDocument> = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
  };

  const result = await usersRepository.forScope(scope).paginate({
    page,
    pageSize,
    filter,
    where: search ? prefixFilter("name", search) : undefined,
    select: USER_FIELDS,
    sort: { name: 1 },
  });

  const names = await clientNamesFor(scope, result.items);

  return mapPage(result, (document) =>
    toUserSummary(
      document,
      document.clientId
        ? (names.get(document.clientId.toHexString()) ?? null)
        : null,
    ),
  );
}

export async function listUsers(
  params: ListUsersInput = {},
): Promise<Page<UserSummary>> {
  const { scope } = await requireRole(...USER_ADMINS);
  return listUsersForScope(scope, params);
}

/** The clients a CLIENT user can be attached to, for the create form's picker. */
export interface ClientOption {
  id: string;
  name: string;
}

/**
 * Capped at the DAL's maximum page size. A real limit rather than a rounding:
 * a tenant with more than 100 clients needs a typeahead here instead of a
 * `<select>`. It fails visibly — a client missing from the list — rather than
 * silently issuing an unbounded query.
 */
export async function listClientOptions(): Promise<ClientOption[]> {
  const { scope } = await requireRole(...USER_ADMINS);
  await connectToDatabase();

  const clients: ClientDocument[] = await clientsRepository
    .forScope(scope)
    .find(undefined, {
      select: ["_id", "name"],
      sort: { name: 1 },
      limit: 100,
    });

  return clients.map((client) => ({
    id: client._id.toHexString(),
    name: client.name,
  }));
}
