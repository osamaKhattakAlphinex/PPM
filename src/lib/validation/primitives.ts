import { z } from "zod";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/db";

/**
 * The primitives every module's payload schemas are built from.
 *
 * They were written for master data and are now shared, because the moment a
 * second module restated them they stopped being one rule. An id shape that is
 * 24 hex characters in one action and `z.string()` in another is not a style
 * inconsistency — it is a hole, in whichever file lost the regex.
 *
 * Entity-shaped fields are NOT here. Those are derived from the model schema
 * that owns them (see `src/lib/technicians/schemas.ts`), so validation and
 * storage cannot drift.
 */

/** The only id shape accepted anywhere, matching `src/lib/auth/session.ts`. */
export const objectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Expected a 24-character object id");

/**
 * A free-text search term.
 *
 * Capped hard at 64 characters and used only as an ANCHORED, escaped prefix
 * match (see `prefixFilter()` in `src/lib/db/text-search.ts`). Neither the cap
 * nor the escape is optional: an unescaped user string in a `$regex` is a
 * ReDoS, and an unanchored one is a full collection scan on every keystroke.
 */
export const searchTerm = z.string().trim().min(1).max(64);

/**
 * Page and page size, as a shape to spread into a list schema.
 *
 * Coerced because these arrive as strings from a query string, and bounded by
 * the DAL's own maximum so a list endpoint cannot be asked for the collection.
 */
export const pageParams = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};
