import type { Address, ClientDocument, LocationDocument, OrganizationProfile } from "@/lib/db";

/**
 * The shapes that cross the server/client boundary.
 *
 * Two reasons this layer exists rather than handing a lean document straight to
 * a Client Component:
 *
 *  1. React cannot serialise an `ObjectId` or a `Date` into a client payload.
 *     Mapping here means the failure is a type error at build time instead of a
 *     runtime "Only plain objects can be passed" in a page nobody opened yet.
 *  2. It is an explicit answer to "what does the browser get?". A document
 *     forwarded wholesale ships whatever field is added to the model next,
 *     including ones added for the server's benefit. Nothing reaches the client
 *     unless it is named below.
 */

export interface ClientSummary {
  id: string;
  name: string;
  code: string;
  status: "ACTIVE" | "SUSPENDED";
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface LocationSummary {
  id: string;
  name: string;
  building: string | null;
  status: "ACTIVE" | "INACTIVE";
  clientId: string | null;
  /** Resolved through a second SCOPED read, never a populate. Null for org-wide sites. */
  clientName: string | null;
  address: Address;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  defaultLocale: "en" | "ar";
  timezone: string;
  vatNumber: string | null;
  defaultCurrency: string;
  settings: {
    vatRate: number;
    workWeekStartsOn: "SUN" | "MON";
    contactEmail: string | null;
    contactPhone: string | null;
  };
}

export function toClientSummary(document: ClientDocument): ClientSummary {
  return {
    id: document._id.toHexString(),
    name: document.name,
    code: document.code,
    status: document.status,
    contactName: document.contactInfo?.name ?? null,
    contactEmail: document.contactInfo?.email ?? null,
    contactPhone: document.contactInfo?.phone ?? null,
  };
}

export function toLocationSummary(
  document: LocationDocument,
  clientName: string | null,
): LocationSummary {
  return {
    id: document._id.toHexString(),
    name: document.name,
    building: document.building ?? null,
    status: document.status,
    clientId: document.clientId ? document.clientId.toHexString() : null,
    clientName,
    address: {
      line1: document.address.line1,
      line2: document.address.line2 ?? null,
      district: document.address.district ?? null,
      city: document.address.city,
      region: document.address.region ?? null,
      postalCode: document.address.postalCode ?? null,
      country: document.address.country,
    },
  };
}

export function toOrganizationSummary(profile: OrganizationProfile): OrganizationSummary {
  return {
    id: profile._id.toHexString(),
    name: profile.name,
    slug: profile.slug,
    defaultLocale: profile.defaultLocale,
    timezone: profile.timezone,
    vatNumber: profile.vatNumber ?? null,
    defaultCurrency: profile.defaultCurrency,
    settings: {
      vatRate: profile.settings.vatRate,
      workWeekStartsOn: profile.settings.workWeekStartsOn,
      contactEmail: profile.settings.contactEmail ?? null,
      contactPhone: profile.settings.contactPhone ?? null,
    },
  };
}
