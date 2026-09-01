import { z } from "zod";

import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * A postal address, kept as discrete fields rather than one free-text blob.
 *
 * A technician navigating to a site and an invoice header need different parts
 * of it, and "sort the sites in Jeddah" is a query, not a substring search.
 * `country` defaults to SA because that is where the overwhelming majority of
 * this product's sites are; it is still a field, because the Gulf is not.
 */
export const addressSchema = z.strictObject({
  line1: mongo(z.string().min(1).max(160), { trim: true }),
  line2: mongo(z.string().max(160).nullable().optional(), { trim: true }),
  /** Neighbourhood. Saudi addresses are found by district far more than by street. */
  district: mongo(z.string().max(120).nullable().optional(), { trim: true }),
  city: mongo(z.string().min(1).max(120), { trim: true }),
  region: mongo(z.string().max(120).nullable().optional(), { trim: true }),
  postalCode: mongo(z.string().max(16).nullable().optional(), { trim: true }),
  country: mongo(z.string().length(2).default("SA"), { trim: true, uppercase: true }),
});

export type Address = z.infer<typeof addressSchema>;

/**
 * A physical site the organization maintains: a tower, a compound, a plant, a
 * store. Assets hang off locations, and work orders are dispatched to them.
 *
 * `clientId` is OPTIONAL, and that option is the whole design of this
 * collection:
 *
 *  - present  -> the site belongs to one customer. A CLIENT session sees it
 *                only if the id matches their own, because the presence of a
 *                `clientId` PATH is what makes `createRepository()` treat this
 *                collection as client-partitioned and append
 *                `clientId: scope.clientId` to every filter it builds.
 *  - absent   -> the site is the organization's own (a depot, a workshop). No
 *                client id can ever match null, so these are invisible to every
 *                CLIENT session. That is the fail-closed direction: a shared
 *                site is withheld from a customer rather than leaked to one.
 *
 * It is also NOT patchable. `clientId` is in the DAL's `RESERVED_FIELDS`, so
 * `repository.update()` strips it: a location's customer is chosen when the
 * location is created, and moving one means creating it again. Re-assignment
 * would be a silent transfer of every asset and work order beneath it.
 */
export const LOCATION_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const locationStatusSchema = z.enum(LOCATION_STATUSES);
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export const locationInputSchema = entity({
  name: mongo(z.string().min(2).max(160), { trim: true }),
  /** Tower, block or unit within a larger site. */
  building: mongo(z.string().max(120).nullable().optional(), { trim: true }),
  clientId: mongo(objectId("Client").nullable().optional(), { index: true }),
  address: addressSchema,
  status: locationStatusSchema.default("ACTIVE"),
});

export type LocationInput = z.input<typeof locationInputSchema>;
export type LocationDocument = DocumentOf<typeof locationInputSchema>;

export const Location = defineModel("Location", locationInputSchema, {
  collection: "locations",
  indexes: [
    // Tenant-first, as every index on a tenant-scoped collection must be.
    { fields: { organizationId: 1, name: 1 } },
    // The list query the UI actually runs for a CLIENT session, and for staff
    // filtering by customer. Matches the order the DAL builds its filter in.
    { fields: { organizationId: 1, clientId: 1, status: 1 } },
    { fields: { organizationId: 1, status: 1, name: 1 } },
  ],
});
