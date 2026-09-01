import { z } from "zod";

import { currencySchema, DEFAULT_CURRENCY } from "../../domain/currency";
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
/**
 * Operational preferences that belong to the tenant rather than to any one
 * user. Nested rather than flattened onto the root so the boundary between
 * "identity of the tenant" (name, slug, status) and "how it likes to work" is
 * visible in the document itself.
 */
export const organizationSettingsSchema = z.strictObject({
  /** Standard-rate VAT, as a percentage. 15 is the Saudi rate since 2020. */
  vatRate: z.number().min(0).max(100).default(15),
  /** The Gulf working week starts on Sunday; a scheduler has to know. */
  workWeekStartsOn: z.enum(["SUN", "MON"]).default("SUN"),
  contactEmail: mongo(z.email().max(254).nullable().optional(), {
    trim: true,
    lowercase: true,
  }),
  contactPhone: mongo(z.string().max(32).nullable().optional(), { trim: true }),
});

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

  /**
   * Saudi VAT registration number: exactly 15 digits. Nullable because a tenant
   * may be provisioned before ZATCA registration completes, and an invoice
   * template has to be able to tell "not registered" from "not filled in".
   */
  vatNumber: mongo(
    z
      .string()
      .regex(/^\d{15}$/, "A VAT number is exactly 15 digits")
      .nullable()
      .optional(),
    { trim: true },
  ),

  defaultCurrency: currencySchema.default(DEFAULT_CURRENCY),

  settings: organizationSettingsSchema.default({
    vatRate: 15,
    workWeekStartsOn: "SUN",
  }),
});

export type OrganizationInput = z.input<typeof organizationInputSchema>;
export type OrganizationDocument = Omit<DocumentOf<typeof organizationInputSchema>, "organizationId">;

export const Organization = defineModel("Organization", organizationInputSchema, {
  collection: "organizations",
  tenantScoped: false,
  indexes: [
    /**
     * `{ name: 1 }` and not `{ organizationId: 1, name: 1 }` — the rule in
     * CLAUDE.md ("every index starts with organizationId") cannot apply to the
     * one collection that has no organizationId, because it *is* the
     * organization. The omission is deliberate, not an oversight; `slug`
     * already carries the unique index that keys tenant lookup.
     */
    { fields: { name: 1 } },
  ],
});
