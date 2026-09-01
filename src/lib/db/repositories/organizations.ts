import { z } from "zod";

import type { Currency } from "../../domain/currency";
import {
  Organization,
  organizationInputSchema,
  organizationSettingsSchema,
  type OrganizationDocument,
} from "../models/organization";
import type { TenantScope } from "../scope";

/**
 * The tenant's own record.
 *
 * Not a `createRepository()` — that constructor throws for a model with no
 * `organizationId`, and it is right to: there is no tenant key to inject into a
 * collection that IS the tenants. So this is a purpose-built module in the same
 * spirit as `identity-store.ts`, and it earns the exemption the same way:
 *
 *  1. Both queries are fixed, code-authored shapes. A caller supplies values,
 *     never a filter.
 *  2. The `_id` comes from `scope.organizationId` and nowhere else — there is
 *     no parameter for it, so no request can name a different organization.
 *  3. The update is an allow-listed `$set`. `slug` and `status` are not in it.
 *
 * Together those mean the worst a compromised ADMIN session can do here is
 * rename its own tenant.
 */

/** What the profile screen shows. Projected, so nothing else leaks into an RSC payload. */
const PROFILE_FIELDS = {
  name: 1,
  slug: 1,
  status: 1,
  defaultLocale: 1,
  timezone: 1,
  vatNumber: 1,
  defaultCurrency: 1,
  settings: 1,
} as const;

export type OrganizationProfile = Pick<
  OrganizationDocument,
  | "_id"
  | "name"
  | "slug"
  | "status"
  | "defaultLocale"
  | "timezone"
  | "vatNumber"
  | "defaultCurrency"
  | "settings"
>;

/**
 * Fields an ADMIN or FM_MANAGER may change about their own organization.
 *
 * `slug` is absent because it keys sign-in lookups (`findOrganizationBySlug`)
 * and changing it would strand every bookmark and invitation link. `status` is
 * absent because suspending a tenant is a platform decision, not one the tenant
 * makes about itself — it would lock every one of its own users out.
 */
export interface OrganizationPatch {
  name?: string;
  defaultLocale?: "en" | "ar";
  timezone?: string;
  vatNumber?: string | null;
  defaultCurrency?: Currency;
  settings?: z.infer<typeof organizationSettingsSchema>;
}

/** The allow-list, restated as data so the `$set` below cannot drift from it. */
const PATCHABLE_FIELDS = [
  "name",
  "defaultLocale",
  "timezone",
  "vatNumber",
  "defaultCurrency",
  "settings",
] as const satisfies ReadonlyArray<keyof OrganizationPatch>;

/**
 * The allow-listed fields, re-validated here.
 *
 * Callers validate already — every action parses its payload before the handler
 * runs — and this parses again anyway, for the same reason `identity-store.ts`
 * re-checks an email it was handed: the zod-to-Mongoose converter maps lengths
 * and enums onto the schema but NOT regexes, so a malformed VAT number would
 * reach MongoDB intact if the only check were the one at the boundary. A store
 * that can be called from a script, a migration or a future route has to be
 * safe on its own terms.
 *
 * Derived from the model schema, so the rules cannot drift apart.
 */
const patchSchema = organizationInputSchema
  .pick({
    name: true,
    defaultLocale: true,
    timezone: true,
    vatNumber: true,
    defaultCurrency: true,
    settings: true,
  })
  .partial();

export async function getOrganizationForScope(
  scope: TenantScope,
): Promise<OrganizationProfile | null> {
  return Organization.findOne({ _id: scope.organizationId }, PROFILE_FIELDS)
    .lean<OrganizationProfile | null>()
    .exec();
}

/**
 * Update the caller's own organization. Returns the updated profile, or null if
 * the session points at an organization that no longer exists.
 */
export async function updateOrganizationForScope(
  scope: TenantScope,
  patch: OrganizationPatch,
): Promise<OrganizationProfile | null> {
  const set: Record<string, unknown> = {};
  for (const field of PATCHABLE_FIELDS) {
    // `undefined` means "not supplied"; null is a real value for vatNumber and
    // has to survive, so the check is against undefined rather than falsiness.
    if (patch[field] !== undefined) set[field] = patch[field];
  }

  if (Object.keys(set).length === 0) return getOrganizationForScope(scope);

  // Only allow-listed keys reached `set`, so the strict parse can never trip on
  // a field the caller passed — it is here to check the VALUES.
  const validated = patchSchema.parse(set);

  return Organization.findOneAndUpdate(
    { _id: scope.organizationId },
    { $set: validated },
    { returnDocument: "after", runValidators: true, projection: PROFILE_FIELDS },
  )
    .lean<OrganizationProfile | null>()
    .exec();
}
