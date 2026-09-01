import { requireRole } from "@/lib/auth/guard";
import { canManageMasterData, listClients, MASTER_DATA_READERS } from "@/lib/master-data/queries";
import { ClientsManager } from "./clients-manager";

/**
 * The client list.
 *
 * A Server Component per CLAUDE.md: the first page is read and rendered on the
 * server, so nothing about the organization's customer list is fetched from the
 * browser to draw the initial screen.
 *
 * The `requireRole` here is not a duplicate of the middleware's check. The
 * middleware guards NAVIGATION; this guards DATA, and it is also where the role
 * comes from — `canManage` decides whether the write affordances are drawn at
 * all. The actions behind them check again regardless.
 *
 * There is no CLIENT branch, because a CLIENT never reaches this route: the
 * module table marks it staff-only, so the middleware refuses it, and the
 * repository beneath would refuse a client-scoped session anyway.
 */
export default async function ClientsPage() {
  const { user } = await requireRole(...MASTER_DATA_READERS);
  const page = await listClients();

  return <ClientsManager initialPage={page} canManage={canManageMasterData(user.role)} />;
}
