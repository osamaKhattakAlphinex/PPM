import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  clientsRepository,
  connectToDatabase,
  contractsRepository,
  isClientScope,
  mapPage,
  summariseContracts as summariseContractsInScope,
  toObjectId,
  type ClientDocument,
  type ContractDocument,
  type Page,
  type TenantScope,
} from "@/lib/db";
import { contractStatusQueryFragment } from "@/lib/domain/amc";
import { toContractSummary, toContractTotals, type ContractSummary, type ContractTotals } from "./dto";
import { listContractsSchema, type ListContractsInput } from "./schemas";

/**
 * The read side of AMC contracts.
 *
 * Server Components call these directly (CLAUDE.md prefers Server Components for
 * reads); the list action in `actions.ts` is a thin wrapper over the same
 * function, so a page load and a client-side page change cannot diverge in what
 * they are allowed to return.
 *
 * Every exported entry point starts with `requireRole()`, which is also the only
 * way to obtain the `TenantScope` the repository needs — so "checked the caller"
 * and "scoped the query" are one step and cannot come apart.
 */

/**
 * Who may read the contract book: management, and the customer whose contract it
 * is.
 *
 * This is the same list `src/lib/nav/modules.ts` gives the route, and that is
 * not a coincidence to be maintained by hand: a route open to a role whose
 * queries the DAL would refuse is a 500, not a security boundary. Here they
 * agree the way corrective's do — `Contract` HAS a `clientId`, so the repository
 * narrows a client session to its own contracts rather than refusing it.
 *
 * SUPERVISOR and TECHNICIAN are absent ENTIRELY, which no other operational
 * module in this app does. `nav/modules.ts` gives the reason in its own note on
 * this route: "a supervisor schedules work; they do not price it." A
 * supervisor's screens are the PPM calendar and the ticket queue. What a client
 * is paying, and how close to spec the provider is running, is commercial
 * information that does not help them dispatch anybody and does change what they
 * say on site.
 */
export const AMC_READERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER", "CLIENT"];

/**
 * Who may write one. Management only — CLIENT is read-only here, and this is the
 * sharpest role split in the app.
 *
 * A customer is a PARTY to a contract, not its author. A client who could edit
 * `value` would be editing what they owe, and a client who could edit
 * `compliance` would be editing the number their provider is measured on. That
 * is the same reasoning `WORK_ORDER_EXECUTORS` gives for keeping a customer from
 * closing a ticket — "closing is the provider's assertion about work the
 * provider did, and it is what an AMC gets measured on". This is that AMC.
 */
export const AMC_MANAGERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

export function canReadContracts(role: Role): boolean {
  return (AMC_READERS as readonly Role[]).includes(role);
}

export function canManageContracts(role: Role): boolean {
  return (AMC_MANAGERS as readonly Role[]).includes(role);
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the client names for one page of contracts.
 *
 * A second SCOPED read rather than a `populate()`: the DAL refuses populate on
 * purpose, because a join is reached under MongoDB's rules rather than ours and
 * would cross into a collection nothing had scoped. The ids here came out of a
 * query that was already scoped, and the lookup is scoped again on the way back
 * — so the fragment is genuinely code-authored even though the ids are data.
 *
 * A CLIENT scope must not touch `clientsRepository` AT ALL. That collection has
 * no `clientId` path of its own and is not `sharedWithClients`, so the DAL
 * refuses a client-scoped read of it with a `ScopeResolutionError` — which would
 * surface as a 500 on the one screen a customer is guaranteed to open. Skipping
 * the lookup is the fail-closed answer, and the UI then renders no client column
 * at all rather than a column of blanks: a customer already knows whose
 * contracts these are.
 */
async function clientNamesFor(
  scope: TenantScope,
  documents: readonly ContractDocument[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  if (isClientScope(scope) || documents.length === 0) return names;

  // Deduplicated by hex string, collected as ObjectIds. Mongoose would cast the
  // strings for us, but handing the driver the type the field actually stores
  // keeps the `$in` a plain index lookup with nothing left to infer. The id type
  // is derived from the document rather than imported from mongoose: feature
  // code must not reach the driver, and the DAL-boundary lint rule enforces that
  // for type imports too.
  const clientIds = new Map<string, ContractDocument["clientId"]>();
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
// The list
// ---------------------------------------------------------------------------

/**
 * The scope-taking half. Exported so `actions.ts` can reuse it with the scope
 * `defineAction` already resolved, instead of authenticating a second time — one
 * implementation, so a page load and a client-side page change can never return
 * different things.
 *
 * `now` is threaded through rather than read twice: the same instant decides
 * which rows the `EXPIRING`/`EXPIRED` filter matches AND which badge each row
 * gets, so a page cannot come back holding a row its own filter excludes.
 */
export async function listContractsForScope(
  scope: TenantScope,
  params: ListContractsInput = {},
  now: Date = new Date(),
): Promise<Page<ContractSummary>> {
  const { page, pageSize, status, type, clientId } = listContractsSchema.parse(params);

  // The schema guarantees 24 hex characters, so this cannot fail — but the
  // filter takes an ObjectId, and coercing here rather than casting keeps the
  // "an unparseable id matches nothing" behaviour the rest of the DAL has.
  const clientFilter = clientId ? toObjectId(clientId) : null;

  await connectToDatabase();

  const result = await contractsRepository.forScope(scope).paginate({
    page,
    pageSize,
    // Untrusted values go in `filter`, which is sanitized and rejected for
    // operators. Only the code-authored status fragment goes in `where`.
    filter: {
      ...(type ? { type } : {}),
      ...(clientFilter ? { clientId: clientFilter } : {}),
    },
    where: status ? contractStatusQueryFragment(status, now) : undefined,
    // Soonest renewal first: the top of this list is the contract that has run
    // out, then the one about to. The sort key is in the index, so this is a
    // walk of it rather than an in-memory sort of the tenant's whole book.
    sort: { endDate: 1 },
  });

  const names = await clientNamesFor(scope, result.items);

  return mapPage(result, (document) =>
    toContractSummary(document, names.get(document.clientId.toHexString()) ?? null, now),
  );
}

export async function listContracts(
  params: ListContractsInput = {},
): Promise<Page<ContractSummary>> {
  const { scope } = await requireRole(...AMC_READERS);
  return listContractsForScope(scope, params);
}

// ---------------------------------------------------------------------------
// The KPI header
// ---------------------------------------------------------------------------

/**
 * The four header figures, in one round trip.
 *
 * One aggregation for the whole header, built inside the DAL from a `$match`
 * that layer had already scoped. See `summariseContracts` in
 * `src/lib/db/repositories/contracts.ts` for which contracts each figure is
 * over, and why.
 *
 * `now` is threaded through for the same reason as the list: a tile that
 * disagreed with the badge on the row beneath it would be worse than no tile.
 */
export async function summariseContractsForScope(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<ContractTotals> {
  await connectToDatabase();
  return toContractTotals(await summariseContractsInScope(scope, now));
}

export async function summariseContractsForCaller(): Promise<ContractTotals> {
  const { scope } = await requireRole(...AMC_READERS);
  return summariseContractsForScope(scope);
}
