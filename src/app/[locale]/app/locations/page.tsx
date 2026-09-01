import { requireRole } from "@/lib/auth/guard";
import {
  canManageMasterData,
  listClients,
  listLocations,
  LOCATION_READERS,
} from "@/lib/master-data/queries";
import { LocationsManager, type ClientOption } from "./locations-manager";

/**
 * The location list — the one master-data screen a CLIENT may open.
 *
 * There is no `if (role === "CLIENT")` around the read. `listLocations()` runs
 * the same query for every role, and the data-access layer narrows it: the
 * collection carries a `clientId`, so a client-scoped session has its own id
 * appended to the filter last, where nothing can displace it. A client sees its
 * own sites and not the organization's own, because null matches no client id.
 *
 * The only branch is cosmetic: the client picker and the client column need a
 * list of clients, and `listClients()` deliberately refuses a CLIENT session —
 * so it is not called for one.
 */
export default async function LocationsPage() {
  const { user } = await requireRole(...LOCATION_READERS);
  const isClientSession = user.role === "CLIENT";

  const [page, clientOptions] = await Promise.all([
    listLocations(),
    loadClientOptions(isClientSession),
  ]);

  return (
    <LocationsManager
      initialPage={page}
      canManage={canManageMasterData(user.role)}
      clientOptions={clientOptions}
      isClientSession={isClientSession}
    />
  );
}

/**
 * Clients for the picker.
 *
 * Capped at the DAL's maximum page size. That is a real limit, not a rounding:
 * a tenant with more than 100 customers needs a typeahead here rather than a
 * `<select>`, and that is a later prompt. The cap fails visibly (a client
 * missing from the list) rather than silently returning an unbounded query.
 */
async function loadClientOptions(isClientSession: boolean): Promise<ClientOption[]> {
  if (isClientSession) return [];

  const clients = await listClients({ pageSize: 100, status: "ACTIVE" });
  return clients.items.map((client) => ({ id: client.id, name: client.name }));
}
