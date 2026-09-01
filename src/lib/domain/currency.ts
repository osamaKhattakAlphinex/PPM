import { z } from "zod";

/**
 * The currencies a tenant may price in.
 *
 * This lives outside `src/lib/db` on purpose, the same way `auth/roles.ts`
 * does. It is domain vocabulary, not a storage concern: the Organization model
 * needs it, and so does the settings form — and that form is a Client
 * Component. Anything it imports as a VALUE ends up in the browser bundle, so a
 * currency list re-exported from `@/lib/db` would drag Mongoose (and `fs`,
 * `net`, `tls`) into it and fail the build.
 *
 * Pure: zod and nothing else. Safe from a Client Component, a Server Component
 * and the Edge middleware alike.
 *
 * SAR is the product's currency (CLAUDE.md) and the default everywhere. The
 * rest of the GCC is here because the same organization structure is sold
 * across the Gulf; a single-value enum would be a field with nothing to choose.
 */
export const CURRENCIES = ["SAR", "AED", "KWD", "BHD", "OMR", "QAR"] as const;

export type Currency = (typeof CURRENCIES)[number];

export const currencySchema = z.enum(CURRENCIES);

export const DEFAULT_CURRENCY: Currency = "SAR";
