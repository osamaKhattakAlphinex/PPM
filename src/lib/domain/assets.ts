import { z } from "zod";

/**
 * The vocabulary an asset is classified by.
 *
 * This lives outside `src/lib/db` on purpose, the same way `domain/currency.ts`
 * and `auth/roles.ts` do. It is domain vocabulary, not a storage concern: the
 * Asset model needs it, and so does the asset register — and that register is a
 * Client Component. Anything it imports as a VALUE ends up in the browser
 * bundle, so a category list re-exported from `@/lib/db` would drag Mongoose
 * (and `fs`, `net`, `tls`) into it and fail the build.
 *
 * Pure: zod and nothing else. Safe from a Client Component, a Server Component
 * and the Edge middleware alike.
 */

/**
 * The trades a Gulf FM contract is organised around.
 *
 * ELV — "extra-low voltage" — is its own discipline here rather than a kind of
 * Electrical: it covers fire alarm, CCTV, access control and BMS, and it is
 * almost always a separate subcontractor on a separate AMC.
 *
 * Stored uppercase like every other enum in the app; the display labels
 * ("Electrical", "الكهرباء") live in `src/messages/{en,ar}.json`.
 */
export const ASSET_CATEGORIES = ["HVAC", "ELECTRICAL", "ELV", "CIVIL", "PLUMBING"] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const assetCategorySchema = z.enum(ASSET_CATEGORIES);

/**
 * `MAINTENANCE` is not a third flavour of inactive: an asset under maintenance
 * is live and owned, it just cannot be dispatched against right now. Keeping it
 * distinct from `INACTIVE` (decommissioned, sold, demolished) is what lets a
 * report separate "down today" from "gone".
 */
export const ASSET_STATUSES = ["ACTIVE", "INACTIVE", "MAINTENANCE"] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const assetStatusSchema = z.enum(ASSET_STATUSES);

/** A new asset is assumed sound until someone says otherwise. */
export const DEFAULT_ASSET_HEALTH = 100;
