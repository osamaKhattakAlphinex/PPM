import type { Types } from "mongoose";

import type { AssetCategory, AssetStatus } from "../../domain/assets";
import { Asset, type AssetDocument } from "../models/asset";
import { createRepository } from "../repository";

/**
 * The tenant-scoped way to reach assets.
 *
 * As with locations, there is no client-handling code here and that is the
 * point. The `Asset` schema has a `clientId` path, so `createRepository()` sets
 * `isClientPartitioned` and appends `clientId: scope.clientId` to every filter
 * it builds for a client-scoped session — last, after anything the caller
 * passed, so no argument can displace it. A CLIENT user sees the assets at
 * their own sites and nothing else, including none at the organization's own
 * depots.
 */

/**
 * What a caller may supply. `organizationId` comes from the scope, never here.
 *
 * `clientId` is accepted because the DAL's create path reads it for a
 * client-partitioned collection, but feature code does not put a REQUEST value
 * in it: `createAsset` derives it from the location the asset is filed at. A
 * CLIENT session's value is ignored and replaced with their own regardless.
 */
export interface AssetCreateInput {
  name: string;
  category: AssetCategory;
  type: string;
  locationId: Types.ObjectId | string;
  clientId?: Types.ObjectId | string | null;
  status?: AssetStatus;
  health?: number;
}

/**
 * Patchable fields.
 *
 * `locationId` IS patchable — assets get relocated, unlike a location's own
 * customer. `clientId` is not, and the DAL enforces that independently by
 * listing it in `RESERVED_FIELDS`. Because the derived value cannot be
 * recomputed by a patch, `updateAsset` refuses a move to a site belonging to a
 * different client; see the note on the model.
 */
export interface AssetUpdateInput {
  name?: string;
  category?: AssetCategory;
  type?: string;
  locationId?: Types.ObjectId | string;
  status?: AssetStatus;
  health?: number;
}

export const assetsRepository = createRepository<
  AssetDocument,
  AssetCreateInput,
  AssetUpdateInput
>(Asset);
