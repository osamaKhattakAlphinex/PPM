"use server";

import { revalidatePath } from "next/cache";

import {
  clientExistsInScope,
  clientsRepository,
  connectToDatabase,
  contractsRepository,
  isClientScope,
  type ContractDocument,
  type Page,
  type TenantScope,
} from "@/lib/db";
import { canTransitionContract } from "@/lib/domain/amc";
import { startOfUtcDay } from "@/lib/domain/dates";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { toContractSummary, type ContractSummary, type ContractTotals } from "./dto";
import {
  AMC_MANAGERS,
  AMC_READERS,
  listContractsForScope,
  summariseContractsForScope,
} from "./queries";
import {
  createContractSchema,
  deleteContractSchema,
  listContractsSchema,
  summariseContractsSchema,
  transitionContractSchema,
  updateContractSchema,
} from "./schemas";

/**
 * Write access to AMC contracts.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md. Everything above the
 * business rule comes from `defineAction`: authenticate, check the role, resolve
 * the tenant scope, rate limit, parse with zod — in that order, once, for all of
 * them. What is left in each handler is the part that is actually about the
 * entity, which here is three things: keeping `clientId` honest, normalising the
 * term to whole UTC days, and refusing any status move that is not on the map in
 * `src/lib/domain/amc.ts`.
 *
 * Every write is gated on `AMC_MANAGERS`, so a CLIENT session is refused by
 * `requireRole` before its payload is even parsed. That is the boundary; the
 * hidden buttons on the screen and the DAL's own `clientId` overwrite are
 * defence in depth behind it.
 */

const REVALIDATE_PATH = "/[locale]/app/amc";

/**
 * Read a client back through the SCOPED repository.
 *
 * A `clientId` that arrived in a request is never trusted to live inside the
 * caller's tenant. `clientExistsInScope` treats the id as a filter term with
 * organizationId layered on top, so one from another organization matches
 * nothing and fails here with a field message rather than being written as the
 * counterparty of a contract the caller cannot see.
 *
 * Safe to call unscoped-by-client because every caller is gated on
 * `AMC_MANAGERS`, which excludes CLIENT — `clientsRepository` would refuse a
 * client scope outright.
 */
async function requireClientInScope(scope: TenantScope, clientId: string): Promise<void> {
  const exists = await clientExistsInScope(scope, clientId);
  if (!exists) {
    throw new ValidationError(`clientId ${clientId} is outside the actor's organization`, {
      clientId: "Unknown client.",
    });
  }
}

async function requireContractInScope(scope: TenantScope, id: string): Promise<ContractDocument> {
  const contract = await contractsRepository.forScope(scope).findById(id);
  if (!contract) throw new NotFoundError(`contract ${id} not in scope`);
  return contract;
}

/**
 * Resolve the client name for one row.
 *
 * Only ever reached from an action whose role list is `AMC_MANAGERS`, so unlike
 * `clientNamesFor()` in `queries.ts` it needs no client-scope guard — but the
 * guard is cheap and the invariant is worth asserting locally rather than
 * inherited from a caller three files away.
 */
async function summariseOne(
  scope: TenantScope,
  document: ContractDocument,
): Promise<ContractSummary> {
  if (isClientScope(scope)) return toContractSummary(document, null);

  const client = await clientsRepository
    .forScope(scope)
    .findById(document.clientId, { select: ["_id", "name"] });

  return toContractSummary(document, client?.name ?? null);
}

// ---------------------------------------------------------------------------
// Raising, correcting, removing
// ---------------------------------------------------------------------------

const runCreateContract = defineAction({
  name: "createContract",
  roles: AMC_MANAGERS,
  input: createContractSchema,
  async handler({ input, scope }): Promise<ContractSummary> {
    await connectToDatabase();

    await requireClientInScope(scope, input.clientId);

    const created = await contractsRepository.forScope(scope).create({
      clientId: input.clientId,
      contractNumber: input.contractNumber,
      title: input.title,
      type: input.type,
      value: input.value,
      /**
       * Normalised to whole UTC days on the way in, so that a JSON caller
       * sending an instant cannot make two contracts ending on the same day
       * compare differently from the `today` the status fragment builds. The
       * form sends `YYYY-MM-DD`, which already parses to UTC midnight; this is
       * for everything else.
       */
      startDate: startOfUtcDay(input.startDate),
      endDate: startOfUtcDay(input.endDate),
      compliance: input.compliance,
      // Explicit rather than relying on the schema default: a new contract is
      // signed, not suspended, and ACTIVE is the only state the map lets it
      // start in.
      status: "ACTIVE",
    });

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, created);
  },
});

const runUpdateContract = defineAction({
  name: "updateContract",
  roles: AMC_MANAGERS,
  input: updateContractSchema,
  async handler({ input, scope }): Promise<ContractSummary> {
    await connectToDatabase();

    const { id, ...patch } = input;
    const current = await requireContractInScope(scope, id);

    /**
     * A cancelled contract is a record of what was agreed and then ended.
     * Rewriting its value or its term after the fact would change what the
     * record SAYS was agreed, which is the one thing an audit trail must not
     * permit — and this row is the thing an invoice points at.
     */
    if (current.status === "CANCELLED") {
      throw new ValidationError(`contract ${id} is cancelled and cannot be edited`, {
        id: "A cancelled contract cannot be changed.",
      });
    }

    const updated = await contractsRepository.forScope(scope).update(id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.type ? { type: patch.type } : {}),
      ...(patch.value !== undefined ? { value: patch.value } : {}),
      // The schema guarantees these arrive together or not at all, so the term
      // is never half-written. See the induction argument in `schemas.ts`.
      ...(patch.startDate ? { startDate: startOfUtcDay(patch.startDate) } : {}),
      ...(patch.endDate ? { endDate: startOfUtcDay(patch.endDate) } : {}),
      ...(patch.compliance !== undefined ? { compliance: patch.compliance } : {}),
    });

    if (!updated) throw new NotFoundError(`contract ${id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

const runDeleteContract = defineAction({
  name: "deleteContract",
  roles: AMC_MANAGERS,
  input: deleteContractSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    const deleted = await contractsRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`contract ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------
//
//     ACTIVE ⇄ SUSPENDED
//        └────────┴──────▶ CANCELLED
//
// The action reads the row back through the SCOPED repository before deciding
// anything, then consults `canTransitionContract()` — the same predicate the UI
// builds its buttons from. That shared predicate is what stops a greyed-out
// button and a server rejection ever disagreeing, and reading first is what
// makes the check meaningful: a transition is a property of the PAIR (where the
// row is, where it is going), and only the database knows the first half.

const runTransitionContract = defineAction({
  name: "transitionContract",
  roles: AMC_MANAGERS,
  input: transitionContractSchema,
  async handler({ input, scope }): Promise<ContractSummary> {
    await connectToDatabase();

    const current = await requireContractInScope(scope, input.id);

    /**
     * The message is a FIELD message on `id` rather than a general one, and the
     * client relies on that: a field error on a transition means the row moved
     * under whoever pressed the button, so the manager shows the message and
     * reloads rather than leaving a stale row on screen with a confident badge.
     */
    if (!canTransitionContract(current.status, input.to)) {
      throw new ValidationError(`contract ${input.id} cannot move ${current.status} -> ${input.to}`, {
        id: "This contract has already moved on.",
      });
    }

    const now = new Date();

    const updated = await contractsRepository.forScope(scope).update(input.id, {
      status: input.to,
      /**
       * Timestamps are stamped by the server, from the transition it just
       * authorised — never proposed by the caller.
       *
       * Resuming CLEARS `suspendedAt`: the contract is genuinely back in force,
       * and a lingering suspension date on an ACTIVE row would read as "this is
       * on hold" to every later report. Cancelling does NOT clear it — a
       * contract suspended in March and cancelled in June was both, in that
       * order, and that is the history.
       */
      ...(input.to === "SUSPENDED" ? { suspendedAt: now } : {}),
      ...(input.to === "ACTIVE" ? { suspendedAt: null } : {}),
      ...(input.to === "CANCELLED" ? { cancelledAt: now } : {}),
    });

    if (!updated) throw new NotFoundError(`contract ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const runListContracts = defineAction({
  name: "listContracts",
  roles: AMC_READERS,
  input: listContractsSchema,
  // A read behind a session. The mutation limiter exists to bound writes.
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<ContractSummary>> {
    await connectToDatabase();
    return listContractsForScope(scope, input);
  },
});

const runSummariseContracts = defineAction({
  name: "summariseContracts",
  roles: AMC_READERS,
  input: summariseContractsSchema,
  rateLimit: null,
  async handler({ scope }): Promise<ContractTotals> {
    await connectToDatabase();
    return summariseContractsForScope(scope);
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
//
// `defineAction` returns a value, and a "use server" module may only export
// async functions — so the wrappers are assigned to module consts above and
// re-exported as real async functions here. The two that pair with
// `useActionState` take `(previous, payload)`; the one-shot ones take a payload.

export async function createContractAction(
  _previous: ActionResult<ContractSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<ContractSummary>> {
  return runCreateContract(payload);
}

export async function updateContractAction(
  _previous: ActionResult<ContractSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<ContractSummary>> {
  return runUpdateContract(payload);
}

export async function transitionContractAction(
  payload: unknown,
): Promise<ActionResult<ContractSummary>> {
  return runTransitionContract(payload);
}

export async function deleteContractAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runDeleteContract(payload);
}

export async function listContractsAction(
  payload: unknown,
): Promise<ActionResult<Page<ContractSummary>>> {
  return runListContracts(payload);
}

export async function summariseContractsAction(
  payload: unknown,
): Promise<ActionResult<ContractTotals>> {
  return runSummariseContracts(payload);
}
