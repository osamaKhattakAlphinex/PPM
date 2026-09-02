import { z } from "zod";

import {
  assetCategorySchema,
  assetStatusSchema,
  DEFAULT_ASSET_HEALTH,
} from "../../domain/assets";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * A maintainable thing at a site: a chiller, an air handling unit, a fire pump,
 * a distribution board, a lift. The first OPERATIONAL entity in the product —
 * work orders, PPM schedules and AMC contracts all hang off one of these.
 *
 * Two fields carry the tenancy, and the difference between them is the whole
 * design of this collection:
 *
 *  - `locationId` is REQUIRED. An asset that is nowhere cannot be visited,
 *    dispatched to, or counted in a site report, so there is no such thing.
 *  - `clientId` is OPTIONAL and DERIVED. It is never entered on a form: the
 *    action copies it from the location the asset was filed at, so an asset can
 *    never be at Acme's tower while billed to a rival. Present means the site
 *    belongs to a customer; absent means the organization's own depot or
 *    workshop, which is invisible to every CLIENT session because null matches
 *    no client id — the fail-closed direction.
 *
 * The mere PRESENCE of the `clientId` path is what makes `createRepository()`
 * treat this collection as client-partitioned and append `clientId:
 * scope.clientId` to every filter it builds. It is also in the DAL's
 * `RESERVED_FIELDS`, so `repository.update()` strips it — which is why moving an
 * asset between sites is only allowed between sites of the SAME client (see
 * `updateAsset` in `src/lib/assets/actions.ts`): the derived value cannot be
 * recomputed by a patch, so the patch must not be able to invalidate it.
 */

/**
 * The category and status vocabularies live in `src/lib/domain/assets.ts`, not
 * here. The asset register is a Client Component and needs both as VALUES to
 * build its filters and selects — importing them from this file would pull
 * Mongoose into the browser bundle. See the note at the top of that module.
 */
export const assetInputSchema = entity({
  name: mongo(z.string().min(2).max(160), { trim: true }),
  category: assetCategorySchema,
  /**
   * The model or kind within the category — "Chiller", "AHU", "Fire panel".
   * Free text on purpose: every tenant's plant list is different, and an enum
   * here would need a migration each time one of them bought something new.
   */
  type: mongo(z.string().min(1).max(80), { trim: true }),
  locationId: mongo(objectId("Location"), { index: true }),
  clientId: mongo(objectId("Client").nullable().optional(), { index: true }),
  status: assetStatusSchema.default("ACTIVE"),
  /**
   * Condition, 0–100. Coerced because a number input submits a string.
   *
   * Entered by hand for now. Once work orders exist it becomes a derived figure
   * (age against expected life, open corrective count, last PPM outcome), and
   * the field does not have to change for that to happen — only who writes it.
   */
  health: z.coerce.number().int().min(0).max(100).default(DEFAULT_ASSET_HEALTH),
});

export type AssetInput = z.input<typeof assetInputSchema>;
export type AssetDocument = DocumentOf<typeof assetInputSchema>;

export const Asset = defineModel("Asset", assetInputSchema, {
  collection: "assets",
  indexes: [
    // Tenant-first, as every index on a tenant-scoped collection must be. The
    // sort key is part of each compound so the list's `sort: { name: 1 }` is
    // served by the index rather than by an in-memory sort of the whole match.
    { fields: { organizationId: 1, name: 1 } },
    { fields: { organizationId: 1, status: 1, name: 1 } },
    { fields: { organizationId: 1, category: 1, name: 1 } },
    // Every asset at one site: the drill-down from a location, and the query
    // the work-order module will run constantly.
    { fields: { organizationId: 1, locationId: 1, status: 1 } },
    /**
     * Free-text search on the name.
     *
     * Compound, with organizationId as the non-text prefix. MongoDB requires an
     * equality predicate on such a prefix before it will use the index — and
     * `buildFilter()` supplies exactly that, unconditionally and last, so a
     * `$text` query physically cannot escape its tenant. A bare `{ name:
     * "text" }` index would have made the search global and relied on the
     * filter alone to narrow it.
     *
     * One text index per collection is the MongoDB limit; this is it.
     */
    { fields: { organizationId: 1, name: "text" } },
  ],
});
