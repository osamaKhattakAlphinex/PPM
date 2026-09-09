import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  approvalsRepository,
  clientsRepository,
  connectToDatabase,
  countApprovalsByStage,
  isClientScope,
  usersRepository,
  type ApprovalDocument,
  type Page,
  type TenantScope,
} from "@/lib/db";
import {
  APPROVAL_STAGES,
  canActOnStage,
  isOpen,
  roleForStage,
  type ApprovalStage,
} from "@/lib/domain/approvals";
import { toApprovalSummary, type ApprovalSummary, type ApprovalTotals } from "./dto";
import { listApprovalsSchema, type ListApprovalsInput } from "./schemas";

/**
 * The read side of approvals.
 *
 * Server Components call these directly (CLAUDE.md prefers Server Components for
 * reads); the list action in `actions.ts` is a thin wrapper over the same
 * functions, so a page load and a client-side page change cannot diverge in what
 * they are allowed to return.
 *
 * Every exported entry point starts with `requireRole()`, which is also the only
 * way to obtain the `TenantScope` the repository needs — so "checked the caller"
 * and "scoped the query" are one step and cannot come apart.
 */

/**
 * Who may open the queue: everyone who can stand at a desk in it, plus ADMIN.
 *
 * TECHNICIAN is here because the chain STARTS at their desk — a technician
 * confirming their own completed job is the first signature, and a module they
 * cannot open is a chain that never begins. CLIENT is here because customer
 * acceptance is a stage, and it is the stage the invoice rests on.
 *
 * This is deliberately WIDER than the route in `src/lib/nav/modules.ts`, which
 * gives `approvals` to management and supervisors only, and the difference is
 * intentional rather than drift: the nav table decides who gets a sidebar entry
 * and a route, and the two roles missing from it reach their approvals from
 * elsewhere — a technician from "My jobs", a client from their portal. Widening
 * the READER list without widening the route is the safe direction; the reverse
 * (a route open to a role the queries refuse) would be a 500 rather than a
 * boundary.
 */
export const APPROVAL_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
  "CLIENT",
];

/**
 * Who may RAISE a chain: the people who do and dispatch the work.
 *
 * Not CLIENT. A customer raising an approval chain would be a customer asking
 * to be asked to accept something, which is not a thing; a customer's entry
 * point into this module is the CLIENT desk on a chain the provider raised.
 */
export const APPROVAL_REQUESTERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
];

/**
 * Who may DECIDE — the same list as readers, and the width is deliberate.
 *
 * This list is only the outer gate. The real check is `canActOnStage(role,
 * stage)` inside the action, which compares the caller's role against the desk
 * the row is actually sitting at and is what makes "a supervisor cannot approve
 * an FM item" true. A narrower list here would give the same answer for the
 * wrong reason and would break the moment a stage was reordered.
 */
export const APPROVAL_DECIDERS: readonly [Role, ...Role[]] = APPROVAL_READERS;

/** Who may mark a chain billed. Invoicing calls this, not a person. */
export const APPROVAL_COMPLETERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

export function canRaiseApprovals(role: Role): boolean {
  return (APPROVAL_REQUESTERS as readonly Role[]).includes(role);
}

/** The desk this role stands at, or null for a role with no desk (none today). */
export function deskForRole(role: Role): ApprovalStage | null {
  return APPROVAL_STAGES.find((stage) => roleForStage(stage) === role) ?? null;
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the display names for one page of approvals: the requester, and every
 * actor in every trail on the page.
 *
 * A second SCOPED read rather than a `populate()`, for the reason the DAL's own
 * header gives — a join is reached under MongoDB's rules rather than ours. The
 * ids came out of a query that was already scoped, and the lookup is scoped
 * again on the way back.
 *
 * A CLIENT scope gets an EMPTY map, and that is correct rather than a
 * limitation. `usersRepository` narrows a client session to its own client's
 * users, so a customer asking for staff names would receive a map of blanks
 * anyway; returning nothing makes the UI fall back to the role label held in
 * each history entry — "Approved by the FM manager" — which is what a customer
 * actually needs to know and does not name an individual they have no
 * relationship with.
 */
async function actorNamesFor(
  scope: TenantScope,
  documents: readonly ApprovalDocument[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (isClientScope(scope) || documents.length === 0) return names;

  const ids = new Map<string, ApprovalDocument["requestedBy"]>();
  for (const document of documents) {
    ids.set(document.requestedBy.toHexString(), document.requestedBy);
    for (const entry of document.history) {
      ids.set(entry.actorId.toHexString(), entry.actorId);
    }
  }
  if (ids.size === 0) return names;

  const users = await usersRepository.forScope(scope).find(undefined, {
    where: { _id: { $in: [...ids.values()] } },
    select: ["_id", "name"],
    limit: ids.size,
  });

  for (const user of users) names.set(user._id.toHexString(), user.name);
  return names;
}

/**
 * Resolve the client names for one page.
 *
 * Skipped entirely for a CLIENT scope, for the same reason the AMC list skips
 * it: `clientsRepository` has no `clientId` path and is not
 * `sharedWithClients`, so a client-scoped read of it is refused by the DAL with
 * a `ScopeResolutionError` — which would surface as a 500 on a screen a
 * customer is expected to open. A customer already knows whose approvals these
 * are.
 */
async function clientNamesFor(
  scope: TenantScope,
  documents: readonly ApprovalDocument[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (isClientScope(scope) || documents.length === 0) return names;

  const ids = new Map<string, NonNullable<ApprovalDocument["clientId"]>>();
  for (const document of documents) {
    if (document.clientId) ids.set(document.clientId.toHexString(), document.clientId);
  }
  if (ids.size === 0) return names;

  const clients = await clientsRepository.forScope(scope).find(undefined, {
    where: { _id: { $in: [...ids.values()] } },
    select: ["_id", "name"],
    limit: ids.size,
  });

  for (const client of clients) names.set(client._id.toHexString(), client.name);
  return names;
}

/**
 * Turn documents into DTOs, resolving both name maps in parallel.
 *
 * `canDecide` is computed per row from the CALLER's role and the row's own
 * stage, and only for a row that is still open. It is a UI capability, not a
 * permission — `decideApproval` re-checks the same predicate against the row it
 * reads back.
 */
async function summarisePage(
  scope: TenantScope,
  role: Role,
  documents: readonly ApprovalDocument[],
): Promise<ApprovalSummary[]> {
  const [actorNames, clientNames] = await Promise.all([
    actorNamesFor(scope, documents),
    clientNamesFor(scope, documents),
  ]);

  return documents.map((document) =>
    toApprovalSummary(document, {
      actorNames,
      clientName: document.clientId
        ? (clientNames.get(document.clientId.toHexString()) ?? null)
        : null,
      canDecide: isOpen(document.status) && canActOnStage(role, document.currentStage),
    }),
  );
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export async function listApprovalsForScope(
  scope: TenantScope,
  role: Role,
  params: ListApprovalsInput = {},
): Promise<Page<ApprovalSummary>> {
  const { page, pageSize, status, stage, refType, mine } = listApprovalsSchema.parse(params);

  /**
   * "Only what is waiting on me" resolves to a desk from the SESSION's role,
   * never from the request. A role with no desk — none today, but ADMIN would
   * be one if the override were removed — falls back to no stage filter rather
   * than to an empty queue, because "show me everything" is the honest answer
   * for someone who stands at no desk in particular.
   */
  const desk = mine ? deskForRole(role) : null;
  const stageFilter = desk ?? stage;

  await connectToDatabase();

  const result = await approvalsRepository.forScope(scope).paginate({
    page,
    pageSize,
    // Untrusted values, all of them enum members already validated above. They
    // go in `filter`, which is sanitized and refuses operators; nothing here
    // needs the trusted `where` channel.
    filter: {
      // `mine` implies the open queue: a decided item is not waiting on anyone.
      ...(mine ? { status: "PENDING" as const } : status ? { status } : {}),
      ...(stageFilter ? { currentStage: stageFilter } : {}),
      ...(refType ? { refType } : {}),
    },
    // Oldest first inside the queue: the thing that has been waiting longest is
    // the thing to decide next. The sort key is in the index.
    sort: { createdAt: 1 },
  });

  /**
   * The envelope is carried through unchanged and only `items` is replaced,
   * because the DTOs are produced for the WHOLE page at once — the two name
   * lookups are one round trip each rather than one per row, so there is no
   * per-item mapping function for `mapPage` to take.
   */
  return { ...result, items: await summarisePage(scope, role, result.items) };
}

export async function listApprovals(
  params: ListApprovalsInput = {},
): Promise<Page<ApprovalSummary>> {
  const { scope, user } = await requireRole(...APPROVAL_READERS);
  return listApprovalsForScope(scope, user.role, params);
}

/** One chain, with its full trail. Scoped — an id from another tenant is a 404. */
export async function findApprovalForScope(
  scope: TenantScope,
  role: Role,
  id: string,
): Promise<ApprovalSummary | null> {
  await connectToDatabase();

  const document = await approvalsRepository.forScope(scope).findById(id);
  if (!document) return null;

  const [summary] = await summarisePage(scope, role, [document]);
  return summary ?? null;
}

// ---------------------------------------------------------------------------
// The queue header
// ---------------------------------------------------------------------------

export async function summariseApprovalsForScope(scope: TenantScope): Promise<ApprovalTotals> {
  await connectToDatabase();

  const repository = approvalsRepository.forScope(scope);

  /**
   * Four counts and one grouped aggregation, issued together.
   *
   * `countDocuments` rather than one big `$group` over every status, because
   * three of these four are answered directly from the
   * `{ organizationId, status, ... }` index without touching a document, and
   * the fourth needs the same index anyway. One pipeline would read every row
   * in the tenant to produce numbers three narrow counts already have.
   */
  const [byStage, pending, readyToInvoice, rejected, completed] = await Promise.all([
    countApprovalsByStage(scope, APPROVAL_STAGES),
    repository.count({ status: "PENDING" }),
    repository.count({ status: "APPROVED" }),
    repository.count({ status: "REJECTED" }),
    repository.count({ status: "COMPLETED" }),
  ]);

  return { byStage: [...byStage], pending, readyToInvoice, rejected, completed };
}

export async function summariseApprovalsForCaller(): Promise<ApprovalTotals> {
  const { scope } = await requireRole(...APPROVAL_READERS);
  return summariseApprovalsForScope(scope);
}

/**
 * Everything that has reached INVOICE_TRIGGER and has not been billed.
 *
 * Exported for the INVOICING module, which offers these as the things an
 * invoice may be raised from. It takes a scope the caller already resolved
 * rather than authenticating again, and it is not exported as an action — a
 * caller reaches it through invoicing's own guard.
 */
export async function listInvoiceableApprovals(
  scope: TenantScope,
  limit = 50,
): Promise<ApprovalDocument[]> {
  await connectToDatabase();

  return approvalsRepository.forScope(scope).find(
    { status: "APPROVED" },
    {
      // Code-authored, so it belongs in the trusted channel.
      where: { invoiceId: null },
      sort: { approvedAt: 1 },
      limit,
    },
  );
}