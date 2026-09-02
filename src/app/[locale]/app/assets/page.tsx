import { requireRole } from "@/lib/auth/guard";
import { ASSET_READERS, canManageAssets, listAssets } from "@/lib/assets/queries";
import { listLocations } from "@/lib/master-data/queries";
import { AssetsManager, type LocationOption } from "./assets-manager";

/**
 * The asset register.
 *
 * There is no `if (role === "CLIENT")` around the read. `listAssets()` runs the
 * same query for every role, and the data-access layer narrows it: the
 * collection carries a `clientId`, so a client-scoped session has its own id
 * appended to the filter last, where nothing can displace it. A client sees the
 * assets at their own sites and not the organization's own depot equipment,
 * because null matches no client id.
 *
 * The only branch is cosmetic — the location picker is filtered to what the
 * session can already see, which for a client is their own sites anyway.
 */
export default async function AssetsPage() {
  const { user } = await requireRole(...ASSET_READERS);
  const isClientSession = user.role === "CLIENT";

  const [page, locationOptions] = await Promise.all([listAssets(), loadLocationOptions()]);

  return (
    <AssetsManager
      initialPage={page}
      canManage={canManageAssets(user.role)}
      locationOptions={locationOptions}
      isClientSession={isClientSession}
    />
  );
}

/**
 * Sites for the picker and the filter.
 *
 * Capped at the DAL's maximum page size. That is a real limit, not a rounding:
 * a tenant with more than 100 sites needs a typeahead here rather than a
 * `<select>`, and that is a later prompt. The cap fails visibly (a site missing
 * from the list) rather than silently returning an unbounded query.
 *
 * `listLocations()` is itself scoped and role-checked, and it admits CLIENT —
 * so this needs no branch: a client session gets its own sites and nothing else.
 */
async function loadLocationOptions(): Promise<LocationOption[]> {
  const locations = await listLocations({ pageSize: 100, status: "ACTIVE" });
  return locations.items.map((location) => ({
    id: location.id,
    name: location.name,
    clientId: location.clientId,
  }));
}
