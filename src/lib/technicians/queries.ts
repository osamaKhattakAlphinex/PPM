import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  connectToDatabase,
  mapPage,
  prefixFilter,
  techniciansRepository,
  usersRepository,
  type Page,
  type ScopedFilter,
  type TechnicianDocument,
  type TenantScope,
  type UserDocument,
} from "@/lib/db";
import { listTechniciansSchema, type ListTechniciansInput } from "./schemas";
import {
  toTechnicianSummary,
  type TechnicianAccountOption,
  type TechnicianSummary,
} from "./dto";

/**
 * The read side of the technicians module.
 *
 * Server Components call these directly (CLAUDE.md prefers Server Components
 * for reads); the list action in `actions.ts` is a thin wrapper over
 * `listTechniciansForScope`, so the first render and a client-side page change
 * run the same query and cannot diverge in what they are allowed to return.
 *
 * Every exported function starts with `requireRole()`, which is also the only
 * way to obtain the `TenantScope` the repository needs — so "checked the
 * caller" and "scoped the query" are one step and cannot come apart.
 */

/**
 * Who may read the workforce.
 *
 * The same three roles the module table gives this route, and that is not a
 * coincidence to be maintained by hand — a nav entry a user cannot open is a
 * bug, and a route whose data is wider than its nav entry is a leak. CLIENT is
 * absent in both places for the same reason: a customer must not be able to
 * enumerate its provider's staff, and the repository refuses a client-scoped
 * session outright regardless of what this list said.
 *
 * TECHNICIAN is absent too. A technician's own record and their colleagues'
 * skill sets are a scheduling concern, not a field concern; when the mobile
 * work-order view needs "who else is on this job", that is a narrower read than
 * the whole directory and gets its own function.
 */
export const TECHNICIAN_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
];

/** ADMIN and FM_MANAGER manage the workforce; a supervisor reads it. */
export const TECHNICIAN_MANAGERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

export function canManageTechnicians(role: Role): boolean {
  return (TECHNICIAN_MANAGERS as readonly Role[]).includes(role);
}

/** Fields of a linked account that are safe to show beside a technician. */
const ACCOUNT_FIELDS = ["_id", "name", "email"] as const;

/**
 * Resolve the linked accounts for one page of technicians.
 *
 * A second SCOPED read rather than a `populate()`: the DAL refuses populate on
 * purpose, because a join is reached under MongoDB's rules rather than ours and
 * would cross into a collection nothing had scoped. The ids here came out of a
 * query that was already scoped, and this lookup is scoped again on the way
 * back — so the `$in` fragment is genuinely code-authored even though the ids
 * inside it are data.
 *
 * An id that resolves to nothing is left unresolved rather than reported. That
 * is the fail-closed direction: the technician still renders, without a name
 * the caller was not entitled to read.
 */
async function linkedAccountsFor(
  scope: TenantScope,
  documents: readonly TechnicianDocument[],
): Promise<Map<string, { name: string; email: string }>> {
  const accounts = new Map<string, { name: string; email: string }>();

  // Deduplicated by hex string, collected as ObjectIds. The id type is derived
  // from the document rather than imported from mongoose: feature code must not
  // reach the driver, and the DAL-boundary lint rule covers type imports too.
  const unique = new Map<string, NonNullable<TechnicianDocument["userId"]>>();
  for (const document of documents) {
    if (document.userId) unique.set(document.userId.toHexString(), document.userId);
  }
  if (unique.size === 0) return accounts;

  const users: UserDocument[] = await usersRepository.forScope(scope).find(undefined, {
    where: { _id: { $in: [...unique.values()] } },
    select: ACCOUNT_FIELDS,
    limit: unique.size,
  });

  for (const user of users) {
    accounts.set(user._id.toHexString(), { name: user.name, email: user.email });
  }
  return accounts;
}

/**
 * The scope-taking half. Exported so `actions.ts` can reuse it with the scope
 * `defineAction` already resolved, instead of authenticating a second time.
 */
export async function listTechniciansForScope(
  scope: TenantScope,
  params: ListTechniciansInput = {},
): Promise<Page<TechnicianSummary>> {
  const { page, pageSize, status, trade, skill, q } = listTechniciansSchema.parse(params);

  await connectToDatabase();

  /**
   * Untrusted values go in `filter`, which the DAL sanitizes, refuses operator
   * keys in, and checks against the real schema paths. Only the code-authored,
   * escaped, anchored regex is allowed into the trusted `where` fragment.
   *
   * `skills` is matched against a single string on purpose: to MongoDB that is
   * plain equality against an ARRAY field, meaning "contains", and it rides the
   * `{ organizationId, skills }` multikey index. Expressing it as an operator
   * would have forced a user-supplied value into `where`, which is exactly what
   * that fragment is not for.
   */
  const filter: ScopedFilter<TechnicianDocument> = {
    ...(status ? { status } : {}),
    ...(trade ? { trade } : {}),
    ...(skill ? { skills: skill } : {}),
  };

  const result = await techniciansRepository.forScope(scope).paginate({
    page,
    pageSize,
    filter,
    where: q ? prefixFilter("name", q) : undefined,
    sort: { name: 1 },
  });

  const accounts = await linkedAccountsFor(scope, result.items);

  return mapPage(result, (document) =>
    toTechnicianSummary(
      document,
      document.userId ? (accounts.get(document.userId.toHexString()) ?? null) : null,
    ),
  );
}

export async function listTechnicians(
  params: ListTechniciansInput = {},
): Promise<Page<TechnicianSummary>> {
  const { scope } = await requireRole(...TECHNICIAN_READERS);
  return listTechniciansForScope(scope, params);
}

/**
 * The sign-in accounts a technician may be linked to.
 *
 * Restricted to managers, because it is the only thing in this module that
 * lists user accounts, and a supervisor who cannot change a link has no reason
 * to receive the directory of addresses behind it.
 *
 * Capped at the DAL's maximum page size. That is a real limit, not a rounding:
 * a tenant with more than 100 technician accounts needs a typeahead here rather
 * than a `<select>`. The cap fails visibly — an account missing from the list —
 * rather than silently issuing an unbounded query.
 */
export async function listTechnicianAccounts(): Promise<TechnicianAccountOption[]> {
  const { scope } = await requireRole(...TECHNICIAN_MANAGERS);

  await connectToDatabase();

  const users: UserDocument[] = await usersRepository.forScope(scope).find(
    // Both terms are code-authored constants, but they still go through
    // `filter` rather than `where`: they are plain equality, and the sanitized
    // path is the one that also proves they are real schema paths.
    { role: "TECHNICIAN", status: "ACTIVE" },
    { select: ACCOUNT_FIELDS, sort: { name: 1 }, limit: 100 },
  );

  if (users.length === 0) return [];

  const claimed = await techniciansRepository.forScope(scope).find(undefined, {
    where: { userId: { $in: users.map((user) => user._id) } },
    select: ["_id", "userId"],
    limit: users.length,
  });

  const holders = new Map<string, string>();
  for (const technician of claimed) {
    if (technician.userId) holders.set(technician.userId.toHexString(), technician._id.toHexString());
  }

  return users.map((user) => {
    const id = user._id.toHexString();
    return {
      id,
      name: user.name,
      email: user.email,
      linkedTechnicianId: holders.get(id) ?? null,
    };
  });
}
