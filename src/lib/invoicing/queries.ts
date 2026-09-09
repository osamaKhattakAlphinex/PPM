import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  clientsRepository,
  connectToDatabase,
  findOwnClientForScope,
  invoicesRepository,
  isClientScope,
  mapPage,
  summariseInvoices as summariseInvoicesInScope,
  toObjectId,
  type ClientDocument,
  type InvoiceDocument,
  type Page,
  type TenantScope,
} from "@/lib/db";
import { listInvoiceableApprovals } from "@/lib/approvals/queries";
import { invoiceStatusQueryFragment } from "@/lib/domain/invoicing";
import {
  toInvoiceSummary,
  toInvoiceTotals,
  type InvoiceableApproval,
  type InvoiceSummary,
  type InvoiceTotalsView,
} from "./dto";
import { listInvoicesSchema, type ListInvoicesInput } from "./schemas";

/**
 * The read side of invoicing.
 *
 * Server Components call these directly; the list action in `actions.ts` is a
 * thin wrapper over the same functions, so a page load and a client-side page
 * change cannot diverge in what they are allowed to return.
 *
 * Every exported entry point starts with `requireRole()`, which is also the only
 * way to obtain the `TenantScope` the repository needs.
 */

/**
 * Who may read the ledger: management, and the customer whose invoices they are.
 *
 * The same list `src/lib/nav/modules.ts` gives the route, and they agree the way
 * AMC's do: `Invoice` HAS a required `clientId`, so the repository narrows a
 * client session to its own documents rather than refusing it.
 *
 * SUPERVISOR and TECHNICIAN are absent entirely, which is the same split AMC
 * makes and for the same reason: a supervisor dispatches work, they do not price
 * it. What a customer is charged is commercial information that does not help
 * anyone dispatch a van and does change what they say on site.
 */
export const INVOICE_READERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER", "CLIENT"];

/**
 * Who may RAISE and correct one. Management only — the sharpest split in the
 * app, alongside AMC's.
 *
 * A customer is the addressee of an invoice, not its author. A client who could
 * raise one would be a client deciding what they owe; a client who could mark
 * one paid would be a client settling their own account.
 */
export const INVOICE_RAISERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

export function canReadInvoices(role: Role): boolean {
  return (INVOICE_READERS as readonly Role[]).includes(role);
}

export function canRaiseInvoices(role: Role): boolean {
  return (INVOICE_RAISERS as readonly Role[]).includes(role);
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the client names for one page of invoices.
 *
 * A second SCOPED read rather than a `populate()`: the DAL refuses populate on
 * purpose, because a join is reached under MongoDB's rules rather than ours. The
 * ids came out of a query that was already scoped, and the lookup is scoped
 * again on the way back.
 *
 * A CLIENT scope must not touch `clientsRepository` AT ALL: that collection has
 * no `clientId` path of its own and is not `sharedWithClients`, so the DAL
 * refuses a client-scoped read of it with a `ScopeResolutionError` — which would
 * surface as a 500 on the one screen a customer is guaranteed to open. Skipping
 * the lookup is the fail-closed answer, and the UI then renders no client column
 * at all: a customer already knows whose invoices these are.
 */
async function clientNamesFor(
  scope: TenantScope,
  documents: readonly InvoiceDocument[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (isClientScope(scope) || documents.length === 0) return names;

  const clientIds = new Map<string, InvoiceDocument["clientId"]>();
  for (const document of documents) {
    clientIds.set(document.clientId.toHexString(), document.clientId);
  }

  const clients: ClientDocument[] = await clientsRepository.forScope(scope).find(undefined, {
    where: { _id: { $in: [...clientIds.values()] } },
    select: ["_id", "name"],
    limit: clientIds.size,
  });

  for (const client of clients) names.set(client._id.toHexString(), client.name);
  return names;
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * The scope-taking half. Exported so `actions.ts` can reuse it with the scope
 * `defineAction` already resolved, instead of authenticating a second time.
 *
 * `now` is threaded through rather than read twice: the same instant decides
 * which rows the OVERDUE filter matches AND which badge each row gets, so a page
 * cannot come back holding a row its own filter excludes.
 */
export async function listInvoicesForScope(
  scope: TenantScope,
  params: ListInvoicesInput = {},
  now: Date = new Date(),
): Promise<Page<InvoiceSummary>> {
  const { page, pageSize, status, clientId } = listInvoicesSchema.parse(params);

  const clientFilter = clientId ? toObjectId(clientId) : null;

  await connectToDatabase();

  const result = await invoicesRepository.forScope(scope).paginate({
    page,
    pageSize,
    // Untrusted values go in `filter`, which is sanitized and rejected for
    // operators. Only the code-authored status fragment goes in `where`.
    filter: clientFilter ? { clientId: clientFilter } : {},
    where: status ? invoiceStatusQueryFragment(status, now) : undefined,
    // Most recently issued first. The sort key is in the index, so this is a
    // walk of it rather than an in-memory sort of the tenant's whole ledger.
    sort: { issueDate: -1 },
  });

  const names = await clientNamesFor(scope, result.items);

  return mapPage(result, (document) =>
    toInvoiceSummary(document, names.get(document.clientId.toHexString()) ?? null, now),
  );
}

export async function listInvoices(params: ListInvoicesInput = {}): Promise<Page<InvoiceSummary>> {
  const { scope } = await requireRole(...INVOICE_READERS);
  return listInvoicesForScope(scope, params);
}

// ---------------------------------------------------------------------------
// The KPI header
// ---------------------------------------------------------------------------

export async function summariseInvoicesForScope(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<InvoiceTotalsView> {
  await connectToDatabase();
  return toInvoiceTotals(await summariseInvoicesInScope(scope, now));
}

export async function summariseInvoicesForCaller(): Promise<InvoiceTotalsView> {
  const { scope } = await requireRole(...INVOICE_READERS);
  return summariseInvoicesForScope(scope);
}

// ---------------------------------------------------------------------------
// What can be billed
// ---------------------------------------------------------------------------

/**
 * The approvals that have reached INVOICE_TRIGGER and carry no invoice yet.
 *
 * The picker on the "raise from approval" sheet. Gated on `INVOICE_RAISERS`
 * rather than on the approvals module's own reader list, because this is an
 * invoicing screen: the question being asked is "what may I bill", not "what is
 * waiting on me".
 */
export async function listInvoiceableForScope(
  scope: TenantScope,
): Promise<InvoiceableApproval[]> {
  const approvals = await listInvoiceableApprovals(scope);
  if (approvals.length === 0) return [];

  const names = new Map<string, string>();

  if (!isClientScope(scope)) {
    const ids = new Map<string, NonNullable<InvoiceDocument["clientId"]>>();
    for (const approval of approvals) {
      if (approval.clientId) ids.set(approval.clientId.toHexString(), approval.clientId);
    }

    if (ids.size > 0) {
      const clients = await clientsRepository.forScope(scope).find(undefined, {
        where: { _id: { $in: [...ids.values()] } },
        select: ["_id", "name"],
        limit: ids.size,
      });
      for (const client of clients) names.set(client._id.toHexString(), client.name);
    }
  }

  return approvals.map((approval) => ({
    id: approval._id.toHexString(),
    refLabel: approval.refLabel,
    clientId: approval.clientId ? approval.clientId.toHexString() : null,
    clientName: approval.clientId
      ? (names.get(approval.clientId.toHexString()) ?? null)
      : null,
    approvedAt: approval.approvedAt ? approval.approvedAt.toISOString() : null,
  }));
}

export async function listInvoiceableForCaller(): Promise<InvoiceableApproval[]> {
  const { scope } = await requireRole(...INVOICE_RAISERS);
  return listInvoiceableForScope(scope);
}

// ---------------------------------------------------------------------------
// One invoice, for the PDF route
// ---------------------------------------------------------------------------

/**
 * One invoice, resolved through the SCOPED repository.
 *
 * This is what the PDF route calls, and its return being `null` for anything
 * outside the caller's scope is the whole of that route's authorisation: the id
 * in the URL is a FILTER TERM with organizationId (and clientId) layered on top
 * by the DAL, so another tenant's invoice number simply matches nothing and the
 * route answers 404 without ever having read a document it should not.
 */
export async function findInvoiceForScope(
  scope: TenantScope,
  id: string,
  now: Date = new Date(),
): Promise<InvoiceSummary | null> {
  await connectToDatabase();

  const document = await invoicesRepository.forScope(scope).findById(id);
  if (!document) return null;

  /**
   * The client NAME matters here in a way it does not in the list: this feeds
   * the PDF, and an invoice addressed to nobody is not a document anyone can
   * send. A client session cannot read `clientsRepository` at all (see
   * `clientNamesFor`), so it takes the purpose-built read instead — one row,
   * filtered by `_id: scope.clientId`, which is the only client record a
   * customer is ever allowed to see.
   */
  if (isClientScope(scope)) {
    const own = await findOwnClientForScope(scope);
    return toInvoiceSummary(document, own?.name ?? null, now);
  }

  const names = await clientNamesFor(scope, [document]);
  return toInvoiceSummary(document, names.get(document.clientId.toHexString()) ?? null, now);
}
