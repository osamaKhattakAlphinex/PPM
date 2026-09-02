import { z } from "zod";

import { assetInputSchema } from "@/lib/db";
import { assetCategorySchema, assetStatusSchema } from "@/lib/domain/assets";
import { objectIdString, pageParams, searchTerm } from "@/lib/validation/primitives";

/**
 * Every payload that reaches an asset action is parsed here first.
 *
 * DERIVED from `assetInputSchema` rather than restated beside it, which is the
 * point of the zod-first pattern in CLAUDE.md: the model is the single source of
 * truth, so a bound or a regex that changes there changes here too, and the two
 * cannot drift into a state where the database accepts something the form
 * rejects — or, far worse, the reverse.
 *
 * What the derivation deliberately changes:
 *
 *  - `organizationId` is never a field. It comes from the session's scope, and
 *    a payload that could name a tenant would defeat data isolation entirely.
 *  - `clientId` is never a field either, for a different reason: it is DERIVED
 *    from the location the asset is filed at (see `actions.ts`). Accepting one
 *    would let a caller file an asset at Acme's tower while billing it to a
 *    rival — the exact inconsistency the derivation exists to make impossible.
 *  - ids arrive as 24-character hex strings, because that is what a URL and a
 *    JSON body carry. The DAL converts them, and treats them as filter terms
 *    that the scope is still layered on top of.
 *
 * `entity()` builds a `z.strictObject`, and `pick`/`partial`/`extend` preserve
 * that, so an unknown key is still rejected everywhere below.
 */

const assetFields = {
  name: true,
  category: true,
  type: true,
  status: true,
  health: true,
} as const;

/**
 * `locationId` is REQUIRED and re-checked against the caller's organization in
 * the action before it is used — an asset that is nowhere cannot be visited or
 * dispatched to, so there is no such thing.
 */
export const createAssetSchema = assetInputSchema
  .pick(assetFields)
  .extend({ locationId: objectIdString });

/**
 * `locationId` is optional here because assets DO get relocated — unlike a
 * location's own customer, which is fixed at creation.
 *
 * The move is constrained rather than free: `clientId` is derived and sits in
 * the DAL's `RESERVED_FIELDS`, so a patch cannot recompute it. `updateAsset`
 * therefore refuses a move to a site belonging to a different client, which
 * keeps the derived value true without needing to rewrite it.
 */
export const updateAssetSchema = assetInputSchema
  .pick(assetFields)
  .partial()
  .extend({ id: objectIdString, locationId: objectIdString.optional() });

export const deleteAssetSchema = z.strictObject({ id: objectIdString });

export const listAssetsSchema = z.strictObject({
  ...pageParams,
  status: assetStatusSchema.optional(),
  category: assetCategorySchema.optional(),
  /**
   * Narrow to one site. Not a security control and does not need to be one:
   * for a CLIENT session the DAL appends its own `clientId` after this filter,
   * so passing another client's site id narrows their result set to nothing
   * rather than widening it.
   */
  locationId: objectIdString.optional(),
  q: searchTerm.optional(),
});

export type CreateAssetInput = z.input<typeof createAssetSchema>;
export type UpdateAssetInput = z.input<typeof updateAssetSchema>;
export type ListAssetsInput = z.input<typeof listAssetsSchema>;
