import type { AssetDocument } from "@/lib/db";
import type { AssetCategory, AssetStatus } from "@/lib/domain/assets";

/**
 * The shape that crosses the server/client boundary.
 *
 * Two reasons this layer exists rather than handing a lean document straight to
 * a Client Component:
 *
 *  1. React cannot serialise an `ObjectId` or a `Date` into a client payload.
 *     Mapping here means the failure is a type error at build time instead of a
 *     runtime "Only plain objects can be passed" in a page nobody opened yet.
 *  2. It is an explicit answer to "what does the browser get?". A document
 *     forwarded wholesale ships whatever field is added to the model next.
 *     Nothing reaches the client unless it is named below.
 */

export interface AssetSummary {
  id: string;
  name: string;
  category: AssetCategory;
  type: string;
  status: AssetStatus;
  /** Condition, 0–100. Rendered as the health bar. */
  health: number;
  locationId: string;
  /** Resolved through a second SCOPED read, never a populate. */
  locationName: string | null;
  /**
   * Derived from the location, never entered. Null means the asset sits at one
   * of the organization's own sites and belongs to no customer.
   */
  clientId: string | null;
}

export function toAssetSummary(
  document: AssetDocument,
  locationName: string | null,
): AssetSummary {
  return {
    id: document._id.toHexString(),
    name: document.name,
    category: document.category,
    type: document.type,
    status: document.status,
    health: document.health,
    locationId: document.locationId.toHexString(),
    locationName,
    clientId: document.clientId ? document.clientId.toHexString() : null,
  };
}
