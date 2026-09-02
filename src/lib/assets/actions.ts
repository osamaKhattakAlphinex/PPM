"use server";

import { revalidatePath } from "next/cache";

import {
  assetsRepository,
  connectToDatabase,
  locationsRepository,
  type LocationDocument,
  type Page,
  type TenantScope,
} from "@/lib/db";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { toAssetSummary, type AssetSummary } from "./dto";
import { ASSET_MANAGERS, ASSET_READERS, listAssetsForScope } from "./queries";
import {
  createAssetSchema,
  deleteAssetSchema,
  listAssetsSchema,
  updateAssetSchema,
} from "./schemas";

/**
 * The write side of assets.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md. Everything above
 * the business rule comes from `defineAction`: authenticate, check the role,
 * resolve the tenant scope, rate limit, parse with zod — in that order, once,
 * for all of them. What is left in each handler is the part that is actually
 * about the entity, which here is one thing: keeping `clientId` honest.
 */

/**
 * Read a location back through the SCOPED repository.
 *
 * A `locationId` that arrived in a request is never trusted to live inside the
 * caller's tenant. `findById` treats the id as a filter term with organizationId
 * layered on top, so one from another organization matches nothing and fails
 * here with a field message rather than being written against a site the tenant
 * cannot see.
 */
async function requireLocationInScope(
  scope: TenantScope,
  locationId: string,
): Promise<LocationDocument> {
  const site = await locationsRepository.forScope(scope).findById(locationId);
  if (!site) {
    throw new ValidationError(`locationId ${locationId} is outside the actor's scope`, {
      locationId: "Unknown location.",
    });
  }
  return site;
}

/** Two client ids are the same partition when both are absent or both match. */
function sameClient(
  a: LocationDocument["clientId"] | null | undefined,
  b: LocationDocument["clientId"] | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.equals(b);
}

const runCreateAsset = defineAction({
  name: "createAsset",
  roles: ASSET_MANAGERS,
  input: createAssetSchema,
  async handler({ input, scope }): Promise<AssetSummary> {
    await connectToDatabase();

    const site = await requireLocationInScope(scope, input.locationId);

    const created = await assetsRepository.forScope(scope).create({
      name: input.name,
      category: input.category,
      type: input.type,
      locationId: site._id,
      /**
       * DERIVED, never taken from the payload — the schema has no such field.
       * An asset belongs to whichever customer owns the site it stands at, so
       * "at Acme's tower, billed to a rival" is not a state this can reach.
       * Null means an org-wide site, which is invisible to every CLIENT.
       */
      clientId: site.clientId ?? null,
      status: input.status,
      health: input.health,
    });

    revalidatePath("/[locale]/app/assets", "page");
    // `locationName` is left null rather than resolved: naming it would cost a
    // second scoped read for a value nothing renders — the list reloads from
    // the server on success, and that read resolves names a page at a time.
    return toAssetSummary(created, null);
  },
});

const runUpdateAsset = defineAction({
  name: "updateAsset",
  roles: ASSET_MANAGERS,
  input: updateAssetSchema,
  async handler({ input, scope }): Promise<AssetSummary> {
    await connectToDatabase();

    const { id, ...patch } = input;

    /**
     * A move has to stay inside the asset's own client partition.
     *
     * `clientId` is derived and sits in the DAL's `RESERVED_FIELDS`, so
     * `update()` strips it and the derived value CANNOT be recomputed by this
     * patch. Left unchecked, moving an asset from Acme's tower to a rival's
     * would leave it standing on one customer's site while still scoped — and
     * billed, and visible — to another. Refusing the cross-client move is what
     * keeps the derivation true without needing to rewrite it.
     */
    if (patch.locationId) {
      const [current, site] = await Promise.all([
        assetsRepository.forScope(scope).findById(id),
        requireLocationInScope(scope, patch.locationId),
      ]);
      if (!current) throw new NotFoundError(`asset ${id} not in scope`);

      if (!sameClient(current.clientId, site.clientId)) {
        throw new ValidationError(
          `asset ${id} cannot move across a client boundary`,
          { locationId: "That site belongs to a different client." },
        );
      }
    }

    // The id is never trusted to belong to the caller's tenant: `update()`
    // treats it as a filter term with organizationId layered on top, so one
    // from another organization matches nothing and returns null here.
    const updated = await assetsRepository.forScope(scope).update(id, patch);
    if (!updated) throw new NotFoundError(`asset ${id} not in scope`);

    revalidatePath("/[locale]/app/assets", "page");
    // Null `locationName`, for the same reason as create above.
    return toAssetSummary(updated, null);
  },
});

const runDeleteAsset = defineAction({
  name: "deleteAsset",
  roles: ASSET_MANAGERS,
  input: deleteAssetSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    // Soft delete. The row stays for audit and for the work orders and readings
    // that will point at it.
    const deleted = await assetsRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`asset ${input.id} not in scope`);

    revalidatePath("/[locale]/app/assets", "page");
    return { id: input.id };
  },
});

const runListAssets = defineAction({
  name: "listAssets",
  // CLIENT is included, and needs no special case: the DAL narrows a
  // client-scoped session to its own sites' assets before the query runs.
  roles: ASSET_READERS,
  input: listAssetsSchema,
  // A read behind a session. A limiter here would only get in the way of
  // someone paging through their own data.
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<AssetSummary>> {
    await connectToDatabase();
    return listAssetsForScope(scope, input);
  },
});

// --- Exports ----------------------------------------------------------------
//
// Every export of a `"use server"` module must be an async function, so the
// wrappers above are assigned to module constants and re-exported here. The
// `(previous, payload)` signature is what `useActionState` calls with; the
// previous state is ignored on purpose, because it arrives from the client on
// every submit and treating it as input would be a way past the schema.

export async function createAssetAction(
  _previous: ActionResult<AssetSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<AssetSummary>> {
  return runCreateAsset(payload);
}

export async function updateAssetAction(
  _previous: ActionResult<AssetSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<AssetSummary>> {
  return runUpdateAsset(payload);
}

export async function deleteAssetAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  return runDeleteAsset(payload);
}

export async function listAssetsAction(
  payload: unknown,
): Promise<ActionResult<Page<AssetSummary>>> {
  return runListAssets(payload);
}
