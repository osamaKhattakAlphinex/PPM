import "server-only";

import { cache } from "react";

import { getScope, ScopeResolutionError, type TenantScope } from "../db";
import { auth } from "./auth";
import { sessionUserSchema, type AppSession, type SessionUser } from "./session";
import type { Role } from "./roles";

/**
 * The authorisation guard for server actions and route handlers.
 *
 * The middleware bounces a request before a page renders, but it guards
 * NAVIGATION, not data: a server action is reachable by POSTing to the page it
 * belongs to, and a route handler by calling it directly. Neither goes through
 * `middleware.ts` in a way that could protect the data itself. So every entry
 * point that touches data starts with one of these:
 *
 *     export async function closeWorkOrder(input: unknown) {
 *       const { scope } = await requireRole("ADMIN", "FM_MANAGER", "SUPERVISOR");
 *       const parsed = closeWorkOrderSchema.parse(input);
 *       return workOrders.forScope(scope).update(parsed.id, { status: "CLOSED" });
 *     }
 *
 * The returned `scope` is the point: it is the only way to obtain a repository,
 * so "checked the role" and "scoped the query to the tenant" become the same
 * step, and a caller cannot do the second without having done the first.
 *
 * `server-only` is imported at the top so that importing this from a Client
 * Component is a build error rather than a runtime surprise.
 */

/** No session at all. The caller should be sent to the login page — 401. */
export class AuthenticationError extends Error {
  readonly code = "UNAUTHENTICATED";
  readonly status = 401;

  constructor() {
    super("You need to sign in.");
    this.name = "AuthenticationError";
  }
}

/** A valid session, but not one that may do this — 403. */
export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  readonly status = 403;

  /** For the server log only. Never send it to a client. */
  readonly detail: string;

  constructor(detail: string) {
    super("You do not have access to this.");
    this.name = "AuthorizationError";
    this.detail = detail;
  }
}

export function isAuthError(error: unknown): error is AuthenticationError | AuthorizationError {
  return error instanceof AuthenticationError || error instanceof AuthorizationError;
}

/** What every guard hands back: who is asking, and the scope for their data. */
export interface AuthContext {
  readonly user: SessionUser;
  /** Pass to `repository.forScope(...)`. Carries organizationId and clientId. */
  readonly scope: TenantScope;
}

/**
 * The role check on its own — pure, so the policy can be tested without a
 * session, a request or a database.
 */
export function assertRole(user: SessionUser, roles: readonly Role[]): void {
  if (roles.length === 0) {
    // A guard that permits everything is almost certainly a mistake, and a
    // silent one. Fail loudly instead of quietly authorising the request.
    throw new AuthorizationError("requireRole() was called with no roles");
  }

  if (!roles.includes(user.role)) {
    throw new AuthorizationError(`role ${user.role} is not in [${roles.join(", ")}]`);
  }
}

/**
 * The session, resolved at most ONCE per request.
 *
 * `auth()` decrypts and verifies a JWE cookie, and — because the session
 * carries a revalidation window — may also read the user back from the database
 * to re-check their role, status and tenant. Every guarded page calls
 * `requireRole()`, the shell layout calls `requireAuth()` for the nav and again
 * for the notification feed, and a page with three parallel reads calls it once
 * per read. That is five to eight verifications of the same cookie to serve one
 * screen.
 *
 * React's `cache()` memoises per REQUEST, not across requests, which is the only
 * kind of caching a session may have: two concurrent requests from two people
 * never share an entry, and the entry is discarded when the request ends. It is
 * the same primitive Next uses for its own `cookies()` and `headers()`.
 *
 * Measured during the performance pass (`docs/PERFORMANCE.md`): the dashboard
 * went from seven session resolutions per render to one.
 */
const resolveSession = cache(async (): Promise<AppSession | null> => auth());

/**
 * Resolve the current session into a validated user plus a tenant scope.
 *
 * The session is re-parsed even though the server issued it: a token minted by
 * an older deploy, or a callback that forgot to copy `organizationId`, must
 * fail closed rather than produce a scope with an undefined tenant. The parse
 * is deliberately NOT inside the memo above — memoising the raw session is a
 * performance decision, and re-validating it on every call is a security one.
 */
export async function requireAuth(): Promise<AuthContext> {
  const session: AppSession | null = await resolveSession();
  const user = session?.user;

  if (!user || !sessionUserSchema.safeParse(user).success) {
    throw new AuthenticationError();
  }

  try {
    return {
      user,
      // The single source of organizationId. Throws unless the session carries
      // a resolvable tenant — and, for a CLIENT, a clientId as well.
      scope: getScope(session),
    };
  } catch (error) {
    if (error instanceof ScopeResolutionError) {
      console.warn(`[auth] scope unresolved: ${error.detail}`);
      throw new AuthenticationError();
    }
    throw error;
  }
}

/**
 * Require a session AND one of `roles`.
 *
 * Listing the roles at the call site rather than deriving them from the URL is
 * deliberate: a server action has no route of its own, and an action reachable
 * from two pages must not inherit whichever policy the caller came through.
 */
export async function requireRole(...roles: Role[]): Promise<AuthContext> {
  const context = await requireAuth();
  assertRole(context.user, roles);
  return context;
}

/** True when the session may act as one of `roles`. For conditional UI. */
export async function hasRole(...roles: Role[]): Promise<boolean> {
  try {
    await requireRole(...roles);
    return true;
  } catch (error) {
    if (isAuthError(error)) return false;
    throw error;
  }
}

/** The session, or null. For pages that render differently when signed in. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const { user } = await requireAuth();
    return user;
  } catch (error) {
    if (isAuthError(error)) return null;
    throw error;
  }
}

/**
 * Map a guard failure onto a Response, for route handlers.
 *
 * Deliberately generic: 401 and 403 say nothing beyond their status, and
 * anything unrecognised becomes a 500 with the detail written to the server log
 * only — a stack trace or a Mongo error must never reach a client.
 */
export function toAuthErrorResponse(error: unknown): Response {
  const body = (code: string, message: string, status: number): Response =>
    Response.json({ ok: false, error: { code, message } }, { status });

  if (error instanceof AuthenticationError) {
    return body(error.code, error.message, error.status);
  }

  if (error instanceof AuthorizationError) {
    console.warn(`[auth] forbidden: ${error.detail}`);
    return body(error.code, error.message, error.status);
  }

  console.error("[auth] unhandled error in a guarded handler", error);
  return body("INTERNAL_ERROR", "Something went wrong.", 500);
}
