import { MODULES } from "../nav/modules";
import { ROLES, type Role } from "./roles";

/**
 * Which roles may enter which part of the app.
 *
 * One table, read by both halves of the enforcement:
 *
 *  - `src/middleware.ts` uses it to bounce a request before the page renders;
 *  - `requireRole()` uses the same roles inside the server action or route
 *    handler that actually touches data.
 *
 * The middleware alone is not a security boundary — it guards navigation, not
 * data — so every server action re-checks. This module is pure and imports
 * nothing but the role list, because middleware runs on the Edge runtime where
 * Mongoose, argon2 and `node:*` are unavailable.
 */

/** Everything under here needs a session. Everything else is public. */
export const PROTECTED_PREFIX = "/app";

export const LOGIN_PATH = "/login";
/** Rendered (not redirected to) when a signed-in user lacks the role. */
export const FORBIDDEN_PATH = "/forbidden";

const STAFF_ROLES: readonly Role[] = ["ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN"];

export interface RouteAccessRule {
  readonly prefix: string;
  readonly roles: readonly Role[];
}

/**
 * Longest matching prefix wins, so a specific area overrides the shell rule
 * above it. Order in the array is irrelevant.
 *
 * The catch-all for `/app` grants the four STAFF roles, not everyone: a new
 * area added under `/app` is therefore staff-only until someone deliberately
 * lists it here. CLIENT — the one role belonging to a party outside the
 * organization — has to be granted a path explicitly, which is the fail-closed
 * direction for the role that should see the least.
 */
export const ROUTE_ACCESS: readonly RouteAccessRule[] = [
  { prefix: "/app", roles: STAFF_ROLES },
  // Post-login dispatcher: every signed-in role may reach it, and it forwards
  // each one to `landingPathForRole()`. It renders nothing of its own.
  { prefix: "/app/start", roles: ROLES },
  { prefix: "/app/admin", roles: ["ADMIN"] },
  { prefix: "/app/settings", roles: ["ADMIN", "FM_MANAGER"] },
  { prefix: "/app/portal", roles: ["CLIENT"] },
  { prefix: "/app/account", roles: ROLES },
  /**
   * One rule per module, generated from the nav table rather than restated
   * here. Restating it is how a sidebar ends up offering a link that answers
   * 403 — or, far worse, how a module quietly inherits the permissive `/app`
   * catch-all after someone adds it to the nav and forgets this file.
   *
   * The dashboard entry (`/app`) is filtered out because it is the catch-all
   * above and must stay staff-only; a CLIENT reaches its own home at
   * `/app/portal`, which has its own rule.
   */
  ...MODULES.filter((module) => module.href !== "/app").map((module) => ({
    prefix: module.href,
    roles: module.roles,
  })),
];

/** True when `pathname` is `prefix` itself or a segment below it. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
}

/** Strip a trailing slash so "/app/admin/" and "/app/admin" resolve alike. */
function normalise(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function isProtectedPath(pathname: string): boolean {
  return matchesPrefix(normalise(pathname), PROTECTED_PREFIX);
}

/**
 * The rule governing a path, or null when the path is public.
 *
 * Deny by default: a protected path with no matching rule returns an empty role
 * list, which every caller reads as "nobody". That can only happen if someone
 * changes `PROTECTED_PREFIX` without adding a rule, and the failure mode is a
 * locked door rather than an open one.
 */
export function resolveRouteAccess(pathname: string): RouteAccessRule | null {
  const path = normalise(pathname);
  if (!isProtectedPath(path)) return null;

  let best: RouteAccessRule | null = null;
  for (const rule of ROUTE_ACCESS) {
    if (!matchesPrefix(path, rule.prefix)) continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }

  return best ?? { prefix: path, roles: [] };
}

export function canAccessPath(role: Role, pathname: string): boolean {
  const rule = resolveRouteAccess(pathname);
  if (!rule) return true;
  return rule.roles.includes(role);
}

/**
 * Where a role lands after signing in, and where it is sent when it asks for
 * something it may not have. A CLIENT has no business on the staff shell, so
 * sending it to `/app` would only produce a second 403.
 */
export function landingPathForRole(role: Role): string {
  return role === "CLIENT" ? "/app/portal" : "/app";
}

/**
 * Which roles each role may create.
 *
 * Nobody may mint a role above their own: without this, an FM_MANAGER could
 * create an ADMIN and take over the tenant in one step. SUPERVISOR and below
 * cannot create users at all — the empty lists are the policy, not an oversight.
 */
export const ASSIGNABLE_ROLES: Readonly<Record<Role, readonly Role[]>> = {
  ADMIN: ROLES,
  FM_MANAGER: ["SUPERVISOR", "TECHNICIAN", "CLIENT"],
  SUPERVISOR: [],
  TECHNICIAN: [],
  CLIENT: [],
};

export function canAssignRole(actor: Role, target: Role): boolean {
  return ASSIGNABLE_ROLES[actor].includes(target);
}
