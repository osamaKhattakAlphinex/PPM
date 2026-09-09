import { requireRole } from "@/lib/auth/guard";
import {
  canRaiseInvoices,
  INVOICE_READERS,
  listInvoiceableForCaller,
  listInvoices,
  summariseInvoicesForCaller,
} from "@/lib/invoicing/queries";
import { listClients } from "@/lib/master-data/queries";
import type { InvoiceableApproval } from "@/lib/invoicing/dto";
import { InvoicingManager, type PickerOption } from "./invoicing-manager";

/**
 * Invoicing — the ledger.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts`, which is
 * also what built this module's sidebar entry and its route rule.
 *
 * The same shape as AMC, and the sharpest role split in the app alongside it:
 * SUPERVISOR and TECHNICIAN cannot open the page at all, and CLIENT can open it
 * but not write to it. `Invoice` carries a REQUIRED `clientId`, so the DAL
 * narrows a client-scoped session to its own documents rather than refusing it,
 * which is what lets CLIENT be on the route in the first place.
 *
 * No `params`, no `setRequestLocale`, no `metadata`: the locale is resolved from
 * the request header in `src/lib/i18n/request.ts`, and `noindex` is inherited
 * from the two layouts above this one.
 */
export default async function InvoicingPage() {
  const { user } = await requireRole(...INVOICE_READERS);

  const canRaise = canRaiseInvoices(user.role);

  const [page, totals, clients, invoiceable] = await Promise.all([
    listInvoices(),
    summariseInvoicesForCaller(),
    loadClientOptions(canRaise),
    loadInvoiceable(canRaise),
  ]);

  return (
    <InvoicingManager
      initialPage={page}
      initialTotals={totals}
      canRaise={canRaise}
      isClientSession={user.role === "CLIENT"}
      clientOptions={clients}
      invoiceable={invoiceable}
    />
  );
}

/**
 * The client picker, loaded ONLY for a session that can use it — and the
 * condition is a correctness requirement, not an optimisation.
 *
 * `listClients` is gated on `MASTER_DATA_READERS`, which is STAFF-only and
 * therefore excludes CLIENT. Calling it unconditionally would throw an
 * authorization error for one of the three roles this screen exists to serve, on
 * their very first page load. The same trap `amc/page.tsx` documents.
 *
 * Capped at the DAL's maximum page size. That is a real limit, not a rounding: a
 * tenant with more than 100 clients needs a typeahead here rather than a
 * `<select>`. The cap fails visibly — a client missing from the list — rather
 * than silently running an unbounded query.
 */
async function loadClientOptions(canRaise: boolean): Promise<PickerOption[]> {
  if (!canRaise) return [];

  // Only customers who are actually trading. Invoicing a suspended client is a
  // data-entry mistake, not a commercial decision.
  const clients = await listClients({ pageSize: 100, status: "ACTIVE" });
  return clients.items.map((client) => ({ id: client.id, name: client.name }));
}

/**
 * The approvals that are ready to be billed, for the "raise from" picker.
 *
 * Also gated: `listInvoiceableForCaller` is `INVOICE_RAISERS`-only, so a client
 * session must not reach it — and has no use for it either, since they cannot
 * raise an invoice.
 */
async function loadInvoiceable(canRaise: boolean): Promise<InvoiceableApproval[]> {
  if (!canRaise) return [];
  return listInvoiceableForCaller();
}
