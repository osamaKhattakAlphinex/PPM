import { requireRole } from "@/lib/auth/guard";
import {
  canManageTechnicians,
  listTechnicianAccounts,
  listTechnicians,
  TECHNICIAN_READERS,
} from "@/lib/technicians/queries";
import { TechniciansManager } from "./technicians-manager";

/**
 * The technician directory.
 *
 * A Server Component per CLAUDE.md: the first page is read and rendered on the
 * server, so nothing about the organization's workforce is fetched from the
 * browser to draw the initial screen.
 *
 * The `requireRole` here is not a duplicate of the middleware's check. The
 * middleware guards NAVIGATION; this guards DATA, and it is also where the role
 * comes from — `canManage` decides whether the write affordances are drawn at
 * all. The actions behind them check again regardless.
 *
 * There is no CLIENT branch, because a CLIENT never reaches this route: the
 * module table marks it management-and-supervisor only, so the middleware
 * refuses it, and the repository beneath would refuse a client-scoped session
 * anyway — `Technician` has no `clientId` to narrow by.
 *
 * The account list is loaded only for a session that may manage: it is the one
 * thing on this screen that names user accounts, and a supervisor who cannot
 * change a link has no reason to receive the addresses behind it.
 */
export default async function TechniciansPage() {
  const { user } = await requireRole(...TECHNICIAN_READERS);
  const canManage = canManageTechnicians(user.role);

  const [page, accountOptions] = await Promise.all([
    listTechnicians(),
    canManage ? listTechnicianAccounts() : Promise.resolve([]),
  ]);

  return (
    <TechniciansManager
      initialPage={page}
      canManage={canManage}
      accountOptions={accountOptions}
    />
  );
}
