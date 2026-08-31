import { z } from "zod";

/**
 * The five roles in the product. Ordered from most to least privileged, which
 * is the order `atLeast()` compares against.
 *
 * CLIENT is deliberately last and is the only role that is *narrowed* rather
 * than privileged: a client user sees one client's data inside one
 * organization. See `src/lib/db/scope.ts`.
 */
export const ROLES = ["ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN", "CLIENT"] as const;

export type Role = (typeof ROLES)[number];

export const roleSchema = z.enum(ROLES);

/** Roles that are additionally scoped to a single client within their org. */
export const CLIENT_SCOPED_ROLES: ReadonlySet<Role> = new Set<Role>(["CLIENT"]);

export function isClientScopedRole(role: Role): boolean {
  return CLIENT_SCOPED_ROLES.has(role);
}
