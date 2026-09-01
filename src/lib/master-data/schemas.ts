import { z } from "zod";

import {
  addressSchema,
  clientInputSchema,
  clientStatusSchema,
  DEFAULT_PAGE_SIZE,
  locationInputSchema,
  locationStatusSchema,
  MAX_PAGE_SIZE,
  organizationInputSchema,
  organizationSettingsSchema,
} from "@/lib/db";

/**
 * Every payload that reaches a master-data action is parsed here first.
 *
 * These schemas are DERIVED from the model schemas rather than restated
 * alongside them. That is the point of the zod-first pattern in CLAUDE.md: the
 * model is the single source of truth, so a field that gains a bound or a
 * regex gains it in the action too, and the two cannot drift into a state where
 * the database accepts something the form rejects (or, far worse, the reverse).
 *
 * What the derivation deliberately changes:
 *
 *  - `organizationId` is never a field. It comes from the session's scope, and
 *    a payload that could name a tenant would defeat the entire data-isolation
 *    rule. `clientId` is the same for a CLIENT session.
 *  - ids arrive as 24-character hex strings, because that is what a URL and a
 *    JSON body carry. The DAL converts them, and treats them as filter terms
 *    that the scope is still layered on top of.
 *  - update schemas are `.partial()`, minus the fields that are not patchable.
 *
 * `entity()` builds a `z.strictObject`, and `pick`/`partial`/`extend` preserve
 * that, so an unknown key is still rejected everywhere below.
 */

/** The only id shape accepted anywhere, matching `src/lib/auth/session.ts`. */
export const objectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Expected a 24-character object id");

/**
 * A free-text search term.
 *
 * Capped hard at 64 characters and used only as an ANCHORED, escaped prefix
 * match (see `prefixFilter()` in `queries.ts`). Neither the cap nor the escape
 * is optional: an unescaped user string in a `$regex` is a ReDoS, and an
 * unanchored one is a full collection scan on every keystroke.
 */
export const searchTerm = z.string().trim().min(1).max(64);

const pageParams = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

// --- Client -----------------------------------------------------------------

export const createClientSchema = clientInputSchema.pick({
  name: true,
  code: true,
  status: true,
  contactInfo: true,
});

/**
 * `code` is absent: it is the client's stable handle, referenced by contracts
 * and invoices, and it carries a unique index per organization. Renaming one is
 * a migration, not an edit.
 */
export const updateClientSchema = clientInputSchema
  .pick({ name: true, status: true, contactInfo: true })
  .partial()
  .extend({ id: objectIdString });

export const deleteClientSchema = z.strictObject({ id: objectIdString });

export const listClientsSchema = z.strictObject({
  ...pageParams,
  status: clientStatusSchema.optional(),
  q: searchTerm.optional(),
});

export type CreateClientInput = z.input<typeof createClientSchema>;
export type UpdateClientInput = z.input<typeof updateClientSchema>;
export type ListClientsInput = z.input<typeof listClientsSchema>;

// --- Location ---------------------------------------------------------------

/**
 * `clientId` is optional on CREATE — staff may file an org-wide site — and is
 * re-checked against the caller's organization in the action before it is used.
 * A CLIENT session's value is ignored entirely by the DAL, which stamps their
 * own id instead.
 */
export const createLocationSchema = locationInputSchema
  .pick({ name: true, building: true, address: true, status: true })
  .extend({ clientId: objectIdString.nullish() });

/**
 * No `clientId`. A location's customer is fixed at creation — the DAL enforces
 * this independently by listing `clientId` in `RESERVED_FIELDS`, so this
 * omission is documentation of an existing guarantee rather than the guarantee
 * itself.
 */
export const updateLocationSchema = locationInputSchema
  .pick({ name: true, building: true, address: true, status: true })
  .partial()
  .extend({ id: objectIdString });

export const deleteLocationSchema = z.strictObject({ id: objectIdString });

export const listLocationsSchema = z.strictObject({
  ...pageParams,
  status: locationStatusSchema.optional(),
  /**
   * Narrow to one client. Meaningless for a CLIENT session — the DAL has
   * already narrowed to their own id, and a different value here cannot widen
   * that, because scope keys are applied after the filter.
   */
  clientId: objectIdString.optional(),
  q: searchTerm.optional(),
});

export type CreateLocationInput = z.input<typeof createLocationSchema>;
export type UpdateLocationInput = z.input<typeof updateLocationSchema>;
export type ListLocationsInput = z.input<typeof listLocationsSchema>;
export type AddressInput = z.input<typeof addressSchema>;

// --- Organization -----------------------------------------------------------

/**
 * The tenant's own profile.
 *
 * `slug` and `status` are absent, matching the allow-list in
 * `repositories/organizations.ts` — the schema and the `$set` refuse the same
 * fields, from two directions.
 *
 * `settings` is sent whole rather than patched field by field: a partial
 * subdocument in a `$set` replaces the whole subdocument in MongoDB, so
 * accepting a partial one here would silently drop whatever the form did not
 * send. `vatRate` is coerced because it arrives from a number input as a string.
 */
export const updateOrganizationSchema = organizationInputSchema
  .pick({
    name: true,
    defaultLocale: true,
    timezone: true,
    vatNumber: true,
    defaultCurrency: true,
  })
  .partial()
  .extend({
    settings: organizationSettingsSchema
      .extend({ vatRate: z.coerce.number().min(0).max(100).default(15) })
      .optional(),
  });

export type UpdateOrganizationInput = z.input<typeof updateOrganizationSchema>;
