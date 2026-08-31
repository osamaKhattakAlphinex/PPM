import { z } from "zod";

import { roleSchema } from "../../auth/roles";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/** Only an ACTIVE user may hold a session. The rest are refused at sign-in. */
export const USER_STATUSES = ["ACTIVE", "INVITED", "SUSPENDED"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * An account. Tenant-scoped like everything else: `organizationId` is added by
 * the base plugin and can never be changed once the document exists.
 *
 * `email` is unique across the SYSTEM, not per organization — sign-in takes an
 * email and a password and nothing else, so the address has to identify exactly
 * one account. A person who works for two tenants gets two accounts.
 */
export const userInputSchema = entity({
  name: mongo(z.string().min(1).max(120), { trim: true }),

  email: mongo(z.email().max(254), { trim: true, lowercase: true }),

  /**
   * An argon2id digest — never a password. `select: false` keeps it out of
   * every query result unless a caller explicitly asks for it, so a forgotten
   * projection cannot leak the hash into an RSC payload or an API response.
   */
  passwordHash: mongo(z.string().min(1).max(512), { select: false }),

  role: roleSchema,

  /**
   * Required for CLIENT users, forbidden for staff — see the invariant in
   * `refine` below. It is what narrows a client user to one customer's data.
   */
  clientId: objectId("Client").nullable().optional(),

  status: userStatusSchema.default("INVITED"),

  lastLoginAt: z.date().nullable().optional(),
});

export type UserInput = z.input<typeof userInputSchema>;
export type UserDocument = DocumentOf<typeof userInputSchema>;

/** Patch payload: every field optional, unknown keys still rejected. */
export const userUpdateSchema = userInputSchema.partial();

export const User = defineModel("User", userInputSchema, {
  collection: "users",
  indexes: [
    // System-wide unique email, ignoring soft-deleted rows so that removing a
    // user releases their address instead of reserving it forever.
    {
      fields: { email: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },
    // Tenant-first, as every index on a tenant-scoped collection must be.
    { fields: { organizationId: 1, status: 1, role: 1 } },
    { fields: { organizationId: 1, clientId: 1, status: 1 } },
  ],
  refine: (schema) => {
    /**
     * The role/clientId invariant, enforced at the storage layer so it holds
     * for every writer — not only the ones that remembered to run the zod
     * refinement in `src/lib/auth/schemas.ts`.
     *
     * Document middleware, so it covers `save()` (which is how the repository
     * creates). Query updates run path validators but not this hook, which is
     * why `changeUserRole()` in `identity-store.ts` re-reads and saves rather
     * than issuing a bare `$set`.
     */
    schema.pre("validate", function enforceClientScope(this: {
      get: (path: string) => unknown;
      invalidate: (path: string, message: string) => void;
    }) {
      const role = this.get("role");
      const clientId = this.get("clientId");

      if (role === "CLIENT" && clientId == null) {
        this.invalidate("clientId", "A CLIENT user must be attached to a client.");
      }
      if (role !== "CLIENT" && clientId != null) {
        this.invalidate("clientId", "Only a CLIENT user may be attached to a client.");
      }
    });
  },
});
