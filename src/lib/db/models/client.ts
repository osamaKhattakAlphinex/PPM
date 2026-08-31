import { z } from "zod";

import { defineModel } from "../define-model";
import { entity, mongo, type DocumentOf } from "../zod-mongoose";

/**
 * A customer of the organization: the building owner or tenant whose assets are
 * maintained. CLIENT-role users are pinned to exactly one of these, and every
 * client-partitioned collection is narrowed by it — see `scope.ts`.
 */
export const clientInputSchema = entity({
  name: mongo(z.string().min(2).max(160), { trim: true }),
  /** Short handle, unique inside the organization (not globally). */
  code: mongo(
    z
      .string()
      .min(2)
      .max(32)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens"),
    { trim: true, lowercase: true },
  ),
  status: z.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
  contactEmail: mongo(z.email().max(254).nullable().optional(), { trim: true, lowercase: true }),
});

export type ClientInput = z.input<typeof clientInputSchema>;
export type ClientDocument = DocumentOf<typeof clientInputSchema>;

export const Client = defineModel("Client", clientInputSchema, {
  collection: "clients",
  indexes: [
    // Tenant-first, and the uniqueness of `code` is per-organization: two
    // tenants may both have a client coded "aramco" without colliding.
    // Partial, so soft-deleted rows do not reserve a code forever.
    {
      fields: { organizationId: 1, code: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },
    { fields: { organizationId: 1, status: 1, name: 1 } },
  ],
});
