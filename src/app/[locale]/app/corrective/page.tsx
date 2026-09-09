import { listAssets } from "@/lib/assets/queries";
import { requireRole } from "@/lib/auth/guard";
import {
  canAssignWorkOrders,
  canExecuteWorkOrders,
  canManageWorkOrders,
  canRaiseWorkOrders,
  listWorkOrders,
  summariseWorkOrders,
  WORK_ORDER_READERS,
} from "@/lib/corrective/queries";
import { listTechnicians } from "@/lib/technicians/queries";
import { canRaiseApprovals } from "@/lib/approvals/queries";
import { CorrectiveManager, type PickerOption } from "./corrective-manager";

/**
 * Corrective maintenance — the reactive work order queue.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts`, which is
 * also what built this module's sidebar entry and its route rule.
 *
 * Unlike preventive, there IS a CLIENT session to think about here, and the
 * whole module is shaped by it. `WorkOrder` carries a `clientId`, so the
 * data-access layer narrows a client-scoped session to its own faults instead
 * of refusing it, and `nav/modules.ts` gives the route to EVERYONE for the same
 * reason — "the one thing a client raises directly". What a client may DO is
 * narrower than what they may see, and each of the four capabilities below is
 * decided here, on the server, and passed down as a boolean. Hiding a button
 * only hides an affordance; every action re-checks the role on every call.
 */
export default async function CorrectivePage() {
  const { user } = await requireRole(...WORK_ORDER_READERS);

  const canAssign = canAssignWorkOrders(user.role);
  const canRaise = canRaiseWorkOrders(user.role);

  const [page, summary, pickers] = await Promise.all([
    listWorkOrders(),
    summariseWorkOrders(),
    loadPickerOptions(canRaise, canAssign),
  ]);

  return (
    <CorrectiveManager
      initialPage={page}
      initialSummary={summary}
      canRaise={canRaise}
      canAssign={canAssign}
      canExecute={canExecuteWorkOrders(user.role)}
      canManage={canManageWorkOrders(user.role)}
      /**
       * Whether the "send for approval" button appears on a closed ticket.
       *
       * `canRaiseApprovals` is the approvals module's own list, imported rather
       * than restated — a screen that decided for itself who may start a chain
       * would be a second policy, and the second one is the one that goes stale.
       */
      canSubmitForApproval={canRaiseApprovals(user.role)}
      isClientSession={user.role === "CLIENT"}
      assetOptions={pickers.assets}
      technicianOptions={pickers.technicians}
    />
  );
}

interface PickerOptions {
  assets: PickerOption[];
  technicians: PickerOption[];
}

/**
 * The two pickers — each loaded ONLY for a session that can use it, and the
 * conditions are not optimisations but correctness requirements.
 *
 * The asset picker is for anyone who may raise a ticket, which includes CLIENT.
 * That is safe and needs no special case: `listAssets` is gated on
 * `ASSET_READERS`, which includes CLIENT, and `assetsRepository` is
 * client-partitioned — so a customer's picker is narrowed to their own
 * equipment by the data-access layer rather than by anything written here.
 *
 * The technician picker is for assigners only. `listTechnicians()` is gated on
 * `TECHNICIAN_READERS`, which deliberately excludes TECHNICIAN and CLIENT — a
 * technician may not enumerate the workforce directory, and a customer
 * certainly may not — so calling it unconditionally would throw an
 * authorization error for most of the people this screen exists to serve.
 * `WORK_ORDER_ASSIGNERS` is defined to be exactly `TECHNICIAN_READERS` so this
 * condition and that gate cannot drift apart.
 *
 * The assignee's NAME still appears on every row for every STAFF reader; that
 * comes from a much narrower read in `listWorkOrdersForScope`, over ids that
 * were already in a scoped result. A client gets no technician column at all.
 *
 * Both are capped at the DAL's maximum page size. That is a real limit, not a
 * rounding: a tenant with more than 100 assets needs a typeahead here rather
 * than a `<select>`, and that is a later prompt. The cap fails visibly (an asset
 * missing from the list) rather than silently returning an unbounded query.
 */
async function loadPickerOptions(canRaise: boolean, canAssign: boolean): Promise<PickerOptions> {
  const [assets, technicians] = await Promise.all([
    canRaise
      ? // Only equipment that is actually in service. A fault against a
        // decommissioned asset is a data-entry mistake, not a work order.
        listAssets({ pageSize: 100, status: "ACTIVE" })
      : Promise.resolve(null),
    canAssign
      ? // ON_LEAVE people are excluded as well as INACTIVE ones: giving this
        // morning's breakdown to someone who is away until the 14th is the
        // mistake the technician status field exists to prevent.
        listTechnicians({ pageSize: 100, status: "ACTIVE" })
      : Promise.resolve(null),
  ]);

  return {
    assets: assets ? assets.items.map((asset) => ({ id: asset.id, name: asset.name })) : [],
    technicians: technicians
      ? technicians.items.map((person) => ({ id: person.id, name: person.name }))
      : [],
  };
}
