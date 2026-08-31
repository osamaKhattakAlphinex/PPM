import { z } from "zod";

import { roleSchema, type Role } from "./roles";

/**
 * The tenant-relevant shape of a server session.
 *
 * Auth.js populates this from the database in the `jwt`/`session` callbacks
 * (Prompt 0.5). It is declared here, separately from the auth wiring, because
 * the data-access layer depends on the *shape* of a session and must not
 * depend on the auth runtime — that keeps `getScope()` testable and keeps the
 * dependency arrow pointing one way (auth -> db, never db -> auth).
 *
 * SECURITY: nothing in here may ever be populated from a request body, a query
 * string, or a header. It comes from the signed, httpOnly session cookie only.
 */
export interface SessionUser {
  id: string;
  role: Role;
  organizationId: string;
  /** Present only for CLIENT users. */
  clientId?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface AppSession {
  user?: SessionUser | null;
  expires?: string;
}

/** 24-character hex — the only id shape we accept anywhere. */
const objectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Expected a 24-character object id");

/**
 * Parsed defensively even though the session is server-issued: a token minted
 * by an older deploy, a partially-migrated user row, or a callback that forgot
 * to copy `organizationId` must fail closed rather than produce a scope with
 * an undefined tenant.
 */
export const sessionUserSchema = z
  .object({
    id: objectIdString,
    role: roleSchema,
    organizationId: objectIdString,
    clientId: objectIdString.nullish(),
  })
  // Unknown session keys (email, name, image, …) are irrelevant to scoping and
  // are dropped rather than rejected — this is not a request payload.
  .loose();

export type ParsedSessionUser = z.infer<typeof sessionUserSchema>;
