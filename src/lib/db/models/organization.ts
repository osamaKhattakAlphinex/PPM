import { z } from "zod";

import { defineModel } from "../define-model";
import { entity, mongo, type DocumentOf } from "../zod-mongoose";

/**
 * The tenant itself.
 *
 * This is one of the very few collections that is NOT tenant-scoped — it has no
 * organizationId because it *is* the organization. `tenantScoped: false` tells
 * the base plugin to skip the organizationId path, and `createRepository()`
 * deliberately refuses to wrap this model: there is no scope to inject, so it
 * is reached only through the purpose-built `identity-store` module.
 */
export const organizationInputSchema = entity({
  name: mongo(z.string().min(2).max(120), { trim: true }),
  /** URL-safe handle. Unique across the system, so it can key a lookup. */
  slug: mongo(
    z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens"),
    { trim: true, lowercase: true, unique: true },
  ),
  status: z.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
  /** Default UI locale for the tenant. Users may still switch per session. */
  defaultLocale: z.enum(["en", "ar"]).default("en"),
  timezone: mongo(z.string().min(1).max(64).default("Asia/Riyadh"), { trim: true }),
});

export type OrganizationInput = z.input<typeof organizationInputSchema>;
export type OrganizationDocument = Omit<DocumentOf<typeof organizationInputSchema>, "organizationId">;

export const Organization = defineModel("Organization", organizationInputSchema, {
  collection: "organizations",
  tenantScoped: false,
});
