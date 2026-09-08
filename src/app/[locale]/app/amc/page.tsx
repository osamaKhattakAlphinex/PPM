import {
  AMC_READERS,
  canManageContracts,
  listContracts,
  summariseContractsForCaller,
} from "@/lib/amc/queries";
import { requireRole } from "@/lib/auth/guard";
import { listClients } from "@/lib/master-data/queries";
import { AmcManager, type PickerOption } from "./amc-manager";

/**
 * AMC & contracts — the commercial book.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts`, which is
 * also what built this module's sidebar entry and its route rule.
 *
 * This is the narrowest reader list in the app, and the narrowest write list.
 * `nav/modules.ts` states the reason on the route itself: "commercial, so
 * management and the client whose contract it is. A supervisor schedules work;
 * they do not price it." So SUPERVISOR and TECHNICIAN cannot open the page at
 * all, and CLIENT can open it but not write to it — a customer is a party to a
 * contract, not its author.
 *
 * `Contract` carries a required `clientId`, so the data-access layer narrows a
 * client-scoped session to its own contracts rather than refusing it, which is
 * what lets CLIENT be on the route in the first place.
 *
 * No `params`, no `setRequestLocale`, no `metadata`: the locale is resolved from
 * the request header in `src/lib/i18n/request.ts`, and `noindex` is inherited
 * from the two layouts above this one.
 */
export default async function AmcPage() {
  const { user } = await requireRole(...AMC_READERS);

  const canManage = canManageContracts(user.role);

  const [page, totals, clients] = await Promise.all([
    listContracts(),
    summariseContractsForCaller(),
    loadClientOptions(canManage),
  ]);

  return (
    <AmcManager
      initialPage={page}
      initialTotals={totals}
      canManage={canManage}
      isClientSession={user.role === "CLIENT"}
      clientOptions={clients}
    />
  );
}

/**
 * The client picker, loaded ONLY for a session that can use it — and the
 * condition is a correctness requirement, not an optimisation.
 *
 * `listClients` is gated on `MASTER_DATA_READERS`, which is STAFF-only and
 * therefore excludes CLIENT. Calling it unconditionally would throw an
 * authorization error for one of the three roles this screen exists to serve,
 * on their very first page load. This is the same trap `preventive/page.tsx`
 * documents for `listTechnicians`, and it has the same shape of fix.
 *
 * A customer needs no picker anyway: they cannot create a contract, and their
 * list is already narrowed to their own by the DAL, so a client filter would
 * have exactly one option and no effect.
 *
 * Capped at the DAL's maximum page size. That is a real limit, not a rounding: a
 * tenant with more than 100 clients needs a typeahead here rather than a
 * `<select>`, and that is a later prompt. The cap fails visibly — a client
 * missing from the list — rather than silently running an unbounded query.
 */
async function loadClientOptions(canManage: boolean): Promise<PickerOption[]> {
  if (!canManage) return [];

  // Only customers who are actually trading. Raising a contract against a
  // suspended client is a data-entry mistake, not a commercial decision.
  const clients = await listClients({ pageSize: 100, status: "ACTIVE" });

  return clients.items.map((client) => ({ id: client.id, name: client.name }));
}
