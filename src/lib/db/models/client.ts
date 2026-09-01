import { z } from "zod";

import { defineModel } from "../define-model";
import { entity, mongo, type DocumentOf } from "../zod-mongoose";

/**
 * How to reach the people who speak for this client.
 *
 * Nested rather than flattened into `contactName` / `contactEmail` /
 * `contactPhone`: it is one thing — a point of contact — and a work-order email
 * that needs "who do I tell" wants the whole of it or none of it. Every field
 * is nullable because a client is often created from a signed contract that
 * names the company and nobody in it yet.
 */
export const clientContactInfoSchema = z.strictObject({
  name: mongo(z.string().max(120).nullable().optional(), { trim: true }),
  email: mongo(z.email().max(254).nullable().optional(), { trim: true, lowercase: true }),
  phone: mongo(z.string().max(32).nullable().optional(), { trim: true }),
});

/**
 * A customer of the organization: the building owner or tenant whose assets are
 * maintained. CLIENT-role users are pinned to exactly one of these, and every
 * client-partitioned collection is narrowed by it — see `scope.ts`.
 */
export const CLIENT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export const clientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

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
  status: clientStatusSchema.default("ACTIVE"),
  contactInfo: clientContactInfoSchema.default({}),
});

export type ClientInput = z.input<typeof clientInputSchema>;
export type ClientDocument = DocumentOf<typeof clientInputSchema>;
export type ClientContactInfo = z.infer<typeof clientContactInfoSchema>;

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
    // The master-data list: tenant-first, ordered by name.
    { fields: { organizationId: 1, name: 1 } },
    { fields: { organizationId: 1, status: 1, name: 1 } },
  ],
});
