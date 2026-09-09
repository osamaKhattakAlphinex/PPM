import type { Types } from "mongoose";

import { isClientScopedRole, type Role } from "../auth/roles";
import { sessionUserSchema, type AppSession } from "../auth/session";
import { requireObjectId } from "./object-id";

/**
 * Tenant scope resolution.
 *
 * This is the ONLY place an organizationId enters the data layer. Every filter
 * the repository builds gets its tenant keys from a `TenantScope`, and a
 * `TenantScope` can only be produced from a server session — there is no
 * constructor that takes a request, a body, or a param.
 *
 * Deny by default: if the session is missing, malformed, or does not carry an
 * organizationId, we throw. No caller ever receives an unscoped repository.
 */

/**
 * Thrown when scope cannot be resolved. Carries a generic message because it is
 * allowed to reach an error boundary; the detail is for the server log only.
 */
export class ScopeResolutionError extends Error {
  readonly code = "SCOPE_UNRESOLVED";

  /** Detail for server-side logging. Never send this to a client. */
  readonly detail: string;

  constructor(detail: string) {
    super("Not authorised.");
    this.name = "ScopeResolutionError";
    this.detail = detail;
  }
}

/**
 * The resolved tenant identity for one request.
 *
 * `clientId` is present if and only if the role is client-scoped. Its absence
 * on a staff role is meaningful — staff see their whole organization — so it
 * is never defaulted to anything.
 */
export interface TenantScope {
  readonly organizationId: Types.ObjectId;
  readonly clientId?: Types.ObjectId;
  readonly role: Role;
  readonly userId: Types.ObjectId;
}

/**
 * The actor id a scheduled job runs under: twenty-four zeroes.
 *
 * A real, valid ObjectId that belongs to no user and never will — so a
 * notification's `readBy`, or any later audit field, can record "the system"
 * without borrowing a person's identity or leaving a null nobody can interpret.
 * It is greppable, which a random id would not be.
 */
export const SYSTEM_ACTOR_ID = "000000000000000000000000";

/**
 * A scope for a scheduled job, for ONE organisation.
 *
 * The only constructor of a `TenantScope` that does not take a session, and it
 * exists because a cron job genuinely has none — the alternative would be a job
 * that reaches models directly, which is the thing the whole data-access layer
 * exists to prevent.
 *
 * It is safe for a narrow, checkable reason rather than by assertion: it takes
 * ONE organisation id and produces a scope for exactly that tenant, so a job
 * holding it can still only see one tenant's data, and every repository below
 * behaves exactly as it does for a signed-in manager. What it cannot do is
 * widen: there is no "all organisations" scope, which is why the job loops.
 *
 * `role: "ADMIN"` because a job acts with the tenant's own full staff view and
 * never as a client — `isClientScope()` is false for it, so a job can write a
 * notification FOR a customer without ever reading AS one.
 *
 * Deliberately NOT exported from `@/lib/db`'s barrel under a friendly name: it
 * is imported explicitly, so `systemScopeForOrganization` is grep-able and a
 * reviewer can see every place a request-less scope is minted.
 */
export function systemScopeForOrganization(organizationId: Types.ObjectId): TenantScope {
  return {
    organizationId,
    role: "ADMIN",
    userId: requireObjectId(SYSTEM_ACTOR_ID),
  };
}

/**
 * Derive the tenant scope from a server session.
 *
 * @throws ScopeResolutionError when there is no session, the session fails
 * validation, or a client-scoped role arrives without a clientId.
 */
export function getScope(session: AppSession | null | undefined): TenantScope {
  if (!session?.user) {
    throw new ScopeResolutionError("No session user; request is unauthenticated.");
  }

  const parsed = sessionUserSchema.safeParse(session.user);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
    throw new ScopeResolutionError(`Session user failed validation: ${fields.join(", ")}`);
  }

  const user = parsed.data;
  const role = user.role;

  // A client user with no clientId would otherwise be scoped to their whole
  // organization — the exact leak this layer exists to prevent. Fail closed.
  if (isClientScopedRole(role) && !user.clientId) {
    throw new ScopeResolutionError(`Role ${role} requires a clientId; session has none.`);
  }

  return {
    organizationId: requireObjectId(user.organizationId, "organizationId"),
    // A staff session that somehow carries a clientId is NOT narrowed by it:
    // the narrowing is a property of the role, not of the token's contents.
    ...(isClientScopedRole(role) ? { clientId: requireObjectId(user.clientId, "clientId") } : {}),
    role,
    userId: requireObjectId(user.id, "user id"),
  };
}

/** True when this scope is narrowed to a single client inside its org. */
export function isClientScope(scope: TenantScope): scope is TenantScope & {
  clientId: Types.ObjectId;
} {
  return scope.clientId !== undefined;
}

/** Human-readable scope for a server log line. Contains no PII. */
export function describeScope(scope: TenantScope): string {
  const client = scope.clientId ? ` client=${scope.clientId.toHexString()}` : "";
  return `org=${scope.organizationId.toHexString()} role=${scope.role}${client}`;
}
