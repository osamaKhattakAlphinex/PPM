import "server-only";

import { requireAuth } from "@/lib/auth/guard";
import {
  clientsRepository,
  connectToDatabase,
  getOrganizationForScope,
  usersRepository,
  type TenantScope,
} from "@/lib/db";
import type { AccountProfile } from "./dto";

/**
 * The read side of the account screen.
 *
 * Everything here is about the SIGNED-IN user and takes no id, so there is no
 * "whose account" question to get wrong. The session is the parameter.
 */

/** Never `passwordHash`. It is `select: false` on the model; this says it twice. */
const PROFILE_FIELDS = [
  "_id",
  "name",
  "email",
  "role",
  "status",
  "clientId",
  "lastLoginAt",
] as const;

/**
 * The tenant's own name.
 *
 * Through `getOrganizationForScope`, which is the DAL's purpose-built read for
 * the one collection whose rows ARE the tenants and which therefore cannot be
 * scoped by `organizationId` like everything else.
 *
 * A failure to resolve is left as `null` rather than thrown: a missing
 * organization name is a cosmetic gap on this screen, not a reason to refuse
 * somebody their own profile.
 */
async function organizationNameFor(scope: TenantScope): Promise<string | null> {
  const organization = await getOrganizationForScope(scope);
  return organization?.name ?? null;
}

/** For a CLIENT user, the customer they belong to. Staff have none. */
async function clientNameFor(scope: TenantScope): Promise<string | null> {
  if (!scope.clientId) return null;

  const client = await clientsRepository
    .forScope(scope)
    .findById(scope.clientId, { select: ["_id", "name"] });

  return client?.name ?? null;
}

export async function loadAccountProfile(): Promise<AccountProfile> {
  const { user, scope } = await requireAuth();

  await connectToDatabase();

  /**
   * Read the row rather than trust the session for the display fields.
   *
   * The session is a signed token that may be up to
   * `AUTH_SESSION_REVALIDATE_AFTER` seconds stale, so a name changed on another
   * device would show the old one here — on the very screen whose job is to
   * show it. The AUTHORISATION still comes from the session; only the
   * displayed values come from the database.
   */
  const document = await usersRepository
    .forScope(scope)
    .findById(user.id, { select: PROFILE_FIELDS });

  const [organizationName, clientName] = await Promise.all([
    organizationNameFor(scope),
    clientNameFor(scope),
  ]);

  return {
    // The session is the fallback, for the one render between a change and the
    // token catching up.
    name: document?.name ?? user.name ?? "",
    email: document?.email ?? user.email ?? "",
    role: user.role,
    status: document?.status ?? "ACTIVE",
    organizationName,
    clientName,
    lastLoginAt: document?.lastLoginAt
      ? document.lastLoginAt.toISOString()
      : null,
  };
}
