import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  assetsRepository,
  connectToDatabase,
  locationsRepository,
  mapPage,
  prefixFilter,
  textSearchFilter,
  toObjectId,
  type AssetDocument,
  type LocationDocument,
  type Page,
  type TenantScope,
} from "@/lib/db";
import { listAssetsSchema, type ListAssetsInput } from "./schemas";
import { toAssetSummary, type AssetSummary } from "./dto";

/**
 * The read side of assets.
 *
 * Server Components call these directly (CLAUDE.md prefers Server Components
 * for reads); the list action in `actions.ts` is a thin wrapper over the same
 * function, so a page load and a client-side page change cannot diverge in what
 * they are allowed to return.
 *
 * Every exported entry point starts with `requireRole()`, which is also the
 * only way to obtain the `TenantScope` the repository needs — so "checked the
 * caller" and "scoped the query" are one step and cannot come apart.
 */

/**
 * Everyone inside the organization may READ assets, including a CLIENT.
 *
 * The CLIENT entry needs no special case anywhere: `Asset` carries a `clientId`
 * path, so the DAL narrows a client-scoped session to its own sites' assets
 * before the query runs. It is listed here because `nav/modules.ts` already
 * grants the route to `EVERYONE` — and a route open to a role whose queries the
 * DAL would refuse is a 500, not a security boundary.
 */
export const ASSET_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
  "CLIENT",
];

/** ADMIN and FM_MANAGER manage; every other role is read-only. */
export const ASSET_MANAGERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

export function canManageAssets(role: Role): boolean {
  return (ASSET_MANAGERS as readonly Role[]).includes(role);
}

/**
 * Turn a search term into a trusted `where` fragment.
 *
 * Two strategies, because one index cannot serve both jobs:
 *
 *  - a single word is a TYPE-AHEAD. "chil" must find "Chiller Plant A" while
 *    the user is still typing, and `$text` cannot do that — it matches whole
 *    words, so a partial one matches nothing. An anchored prefix regex on
 *    `{ organizationId, name }` can.
 *  - a multi-word term is a SEARCH. "rooftop chiller" matches nothing as a
 *    prefix, but is exactly what the text index is for.
 *
 * Both fragments are code-authored and both go in `where`, so the scope keys
 * are still applied after them and still win. The term itself was capped at 64
 * characters by `searchTerm` before it got here.
 */
function searchFilter(term: string): Record<string, unknown> {
  return /\s/.test(term.trim()) ? textSearchFilter(term) : prefixFilter("name", term);
}

/**
 * Resolve the site names for one page of assets.
 *
 * A second SCOPED read rather than a `populate()`: the DAL refuses populate on
 * purpose, because a join is reached under MongoDB's rules rather than ours and
 * would cross into a collection nothing had scoped. The ids here came out of a
 * query that was already scoped, and the lookup is scoped again on the way back
 * — so the fragment is genuinely code-authored even though the ids are data.
 *
 * Unlike the equivalent for clients, this runs for a CLIENT session too:
 * `locationsRepository` is client-partitioned, so it narrows rather than
 * refuses, and a client may of course see the names of their own sites.
 */
async function locationNamesFor(
  scope: TenantScope,
  documents: readonly AssetDocument[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  // Deduplicated by hex string, collected as ObjectIds. Mongoose would cast the
  // strings for us, but handing the driver the type the field actually stores
  // keeps the `$in` a plain index lookup with nothing left to infer. The id
  // type is derived from the document rather than imported from mongoose:
  // feature code must not reach the driver, and the DAL-boundary lint rule
  // enforces that for type imports too.
  const unique = new Map<string, AssetDocument["locationId"]>();
  for (const document of documents) {
    unique.set(document.locationId.toHexString(), document.locationId);
  }
  if (unique.size === 0) return names;

  const locations: LocationDocument[] = await locationsRepository.forScope(scope).find(undefined, {
    where: { _id: { $in: [...unique.values()] } },
    select: ["_id", "name"],
    limit: unique.size,
  });

  for (const location of locations) names.set(location._id.toHexString(), location.name);
  return names;
}

/**
 * The scope-taking half. Exported so `actions.ts` can reuse it with the scope
 * `defineAction` already resolved, instead of authenticating a second time —
 * one implementation, so a page load and a client-side page change can never
 * return different things.
 */
export async function listAssetsForScope(
  scope: TenantScope,
  params: ListAssetsInput = {},
): Promise<Page<AssetSummary>> {
  const { page, pageSize, status, category, locationId, q } = listAssetsSchema.parse(params);

  // The schema guarantees 24 hex characters, so this cannot fail — but the
  // filter takes an ObjectId, and coercing here rather than casting keeps the
  // "an unparseable id matches nothing" behaviour the rest of the DAL has.
  const locationFilter = locationId ? toObjectId(locationId) : null;

  await connectToDatabase();

  const result = await assetsRepository.forScope(scope).paginate({
    page,
    pageSize,
    // Untrusted values go in `filter`, which is sanitized and rejected for
    // operators. Only the code-authored search fragment goes in `where`.
    filter: {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(locationFilter ? { locationId: locationFilter } : {}),
    },
    where: q ? searchFilter(q) : undefined,
    sort: { name: 1 },
  });

  const names = await locationNamesFor(scope, result.items);

  return mapPage(result, (document) =>
    toAssetSummary(document, names.get(document.locationId.toHexString()) ?? null),
  );
}

export async function listAssets(params: ListAssetsInput = {}): Promise<Page<AssetSummary>> {
  const { scope } = await requireRole(...ASSET_READERS);
  return listAssetsForScope(scope, params);
}
