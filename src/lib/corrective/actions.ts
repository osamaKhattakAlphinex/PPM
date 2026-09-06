"use server";

import { revalidatePath } from "next/cache";

import {
  assetsRepository,
  connectToDatabase,
  techniciansRepository,
  workOrdersRepository,
  type AssetDocument,
  type Page,
  type TenantScope,
  type WorkOrderDocument,
  type WorkOrderPriorityCount,
} from "@/lib/db";
import { canTransition, type WorkOrderStatus } from "@/lib/domain/corrective";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { toWorkOrderSummary, type WorkOrderSummary } from "./dto";
import {
  listWorkOrdersForScope,
  summariseWorkOrdersForScope,
  WORK_ORDER_ASSIGNERS,
  WORK_ORDER_EXECUTORS,
  WORK_ORDER_MANAGERS,
  WORK_ORDER_RAISERS,
  WORK_ORDER_READERS,
} from "./queries";
import {
  assignWorkOrderSchema,
  createWorkOrderSchema,
  deleteWorkOrderSchema,
  listWorkOrdersSchema,
  summariseWorkOrdersSchema,
  transitionWorkOrderSchema,
  updateWorkOrderSchema,
} from "./schemas";

/**
 * Write access to corrective maintenance.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md. Everything above the
 * business rule comes from `defineAction`: authenticate, check the role, resolve
 * the tenant scope, rate limit, parse with zod — in that order, once, for all of
 * them. What is left in each handler is the part that is actually about the
 * entity, which here is two things: keeping `clientId` honest, and refusing any
 * status move that is not on the map in `src/lib/domain/corrective.ts`.
 */

const REVALIDATE_PATH = "/[locale]/app/corrective";

/**
 * Read an asset back through the SCOPED repository.
 *
 * An `assetId` that arrived in a request is never trusted to live inside the
 * caller's tenant — nor, for a CLIENT, inside their own partition, which the
 * scoped repository narrows to on its own. `findById` treats the id as a filter
 * term with organizationId (and clientId) layered on top, so one from another
 * organization or another customer matches nothing and fails here with a field
 * message rather than being written against equipment the caller cannot see.
 *
 * `clientId` is projected because the caller needs it: it is the value the work
 * order derives its own partition from.
 */
async function requireAssetInScope(
  scope: TenantScope,
  assetId: string,
): Promise<Pick<AssetDocument, "_id" | "clientId">> {
  const asset = await assetsRepository
    .forScope(scope)
    .findById(assetId, { select: ["_id", "clientId"] });

  if (!asset) {
    throw new ValidationError(`assetId ${assetId} is outside the actor's scope`, {
      assetId: "Unknown asset.",
    });
  }

  return asset;
}

async function requireTechnicianInScope(scope: TenantScope, technicianId: string): Promise<void> {
  const person = await techniciansRepository
    .forScope(scope)
    .findById(technicianId, { select: ["_id"] });

  if (!person) {
    throw new ValidationError(`technicianId ${technicianId} is outside the actor's scope`, {
      technicianId: "Unknown technician.",
    });
  }
}

async function requireWorkOrderInScope(
  scope: TenantScope,
  id: string,
): Promise<WorkOrderDocument> {
  const workOrder = await workOrdersRepository.forScope(scope).findById(id);
  if (!workOrder) throw new NotFoundError(`work order ${id} not in scope`);
  return workOrder;
}

/** Two client ids are the same partition when both are absent or both match. */
function sameClient(
  a: WorkOrderDocument["clientId"] | null | undefined,
  b: AssetDocument["clientId"] | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.equals(b);
}

/**
 * Resolve the asset and technician names for one row.
 *
 * The technician read is skipped for an unassigned ticket, and — importantly —
 * this is only ever reached from an action whose role list excludes CLIENT, so
 * unlike `namesFor()` in `queries.ts` it needs no client-scope guard. The two
 * actions a CLIENT can reach are create (which produces an unassigned row) and
 * the reads, which go through `queries.ts`.
 */
async function summariseOne(
  scope: TenantScope,
  document: WorkOrderDocument,
): Promise<WorkOrderSummary> {
  const [asset, person] = await Promise.all([
    assetsRepository.forScope(scope).findById(document.assetId, { select: ["_id", "name"] }),
    document.technicianId
      ? techniciansRepository
          .forScope(scope)
          .findById(document.technicianId, { select: ["_id", "name"] })
      : Promise.resolve(null),
  ]);

  return toWorkOrderSummary(document, asset?.name ?? null, person?.name ?? null);
}

// ---------------------------------------------------------------------------
// Raising, correcting, removing
// ---------------------------------------------------------------------------

const runCreateWorkOrder = defineAction({
  name: "createWorkOrder",
  roles: WORK_ORDER_RAISERS,
  input: createWorkOrderSchema,
  async handler({ input, scope }): Promise<WorkOrderSummary> {
    await connectToDatabase();

    const asset = await requireAssetInScope(scope, input.assetId);

    const created = await workOrdersRepository.forScope(scope).create({
      assetId: input.assetId,
      /**
       * Derived, not supplied. A fault belongs to whichever customer owns the
       * site the broken thing stands at, so "raised at Acme's tower, visible to
       * a rival" is not a state this can reach. Null means an org-wide site
       * such as the depot, which is invisible to every CLIENT.
       *
       * For a CLIENT session the DAL overwrites this with the session's own
       * client anyway — but the two can only ever agree, because the asset was
       * read back through a repository already narrowed to that same client.
       */
      clientId: asset.clientId ?? null,
      issue: input.issue,
      priority: input.priority,
      // Explicit rather than relying on the schema default: a new ticket is
      // raised, not owned, and OPEN is the only state the map lets it start in.
      status: "OPEN",
      technicianId: null,
    });

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, created);
  },
});

const runUpdateWorkOrder = defineAction({
  name: "updateWorkOrder",
  roles: WORK_ORDER_MANAGERS,
  input: updateWorkOrderSchema,
  async handler({ input, scope }): Promise<WorkOrderSummary> {
    await connectToDatabase();

    const { id, ...patch } = input;
    const current = await requireWorkOrderInScope(scope, id);

    // A closed ticket is a record of what happened. Rewriting the fault text or
    // the severity after the fact would change what the record SAYS happened,
    // which is the one thing an audit trail must not permit.
    if (current.status === "CLOSED") {
      throw new ValidationError(`work order ${id} is closed and cannot be edited`, {
        id: "A closed work order cannot be changed.",
      });
    }

    /**
     * Re-filing against a different asset has to stay inside the ticket's own
     * client partition.
     *
     * `clientId` is derived and sits in the DAL's `RESERVED_FIELDS`, so
     * `update()` strips it and the derived value CANNOT be recomputed by this
     * patch. Left unchecked, moving a fault from Acme's tower to a rival's
     * asset would leave it describing one customer's building while still
     * visible to another. Refusing the cross-client move is what keeps the
     * derivation true without needing to rewrite it. Same rule, same reason, as
     * relocating an asset in `src/lib/assets/actions.ts`.
     */
    if (patch.assetId) {
      const asset = await requireAssetInScope(scope, patch.assetId);
      if (!sameClient(current.clientId, asset.clientId)) {
        throw new ValidationError(`work order ${id} cannot move across a client boundary`, {
          assetId: "That asset belongs to a different client.",
        });
      }
    }

    const updated = await workOrdersRepository.forScope(scope).update(id, {
      ...(patch.assetId ? { assetId: patch.assetId } : {}),
      ...(patch.issue !== undefined ? { issue: patch.issue } : {}),
      ...(patch.priority ? { priority: patch.priority } : {}),
    });

    if (!updated) throw new NotFoundError(`work order ${id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

const runDeleteWorkOrder = defineAction({
  name: "deleteWorkOrder",
  roles: WORK_ORDER_MANAGERS,
  input: deleteWorkOrderSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    const deleted = await workOrdersRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`work order ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------
//
//     OPEN ──assign──▶ ASSIGNED ──start──▶ IN_PROGRESS ──close──▶ CLOSED
//              ▲           │                    │
//              │        unassign          hold  │  ▲ resume
//              │           ▼                    ▼  │
//              └────────  OPEN               PENDING
//              └──assign──────────────────────────┘
//
// Both actions below read the row back through the SCOPED repository before
// deciding anything, then consult `canTransition()` — the same predicate the
// UI builds its buttons from. That shared predicate is what stops a greyed-out
// button and a server rejection ever disagreeing, and reading first is what
// makes the check meaningful: a transition is a property of the PAIR (where the
// row is, where it is going), and only the database knows the first half.

/**
 * Refuse a move that is not on the map.
 *
 * The message is a FIELD message on `id` rather than a general one, and the
 * client relies on that: a field error on a transition means the row moved
 * under whoever pressed the button — someone else started it, or closed it —
 * so the manager shows the message and reloads the page rather than leaving a
 * stale row on screen with a confident badge.
 */
function assertTransition(id: string, from: WorkOrderStatus, to: WorkOrderStatus): void {
  if (canTransition(from, to)) return;

  throw new ValidationError(`work order ${id} cannot move ${from} -> ${to}`, {
    id: "This work order has already moved on.",
  });
}

const runAssignWorkOrder = defineAction({
  name: "assignWorkOrder",
  roles: WORK_ORDER_ASSIGNERS,
  input: assignWorkOrderSchema,
  async handler({ input, scope }): Promise<WorkOrderSummary> {
    await connectToDatabase();

    const [current] = await Promise.all([
      requireWorkOrderInScope(scope, input.id),
      requireTechnicianInScope(scope, input.technicianId),
    ]);

    /**
     * Reassignment is not a transition.
     *
     * `ASSIGNED -> ASSIGNED` is deliberately absent from the map — a self-edge
     * would also make "press Start twice" legal everywhere else. But handing a
     * job from one technician to another is an ordinary thing to do, and while
     * the ticket is ASSIGNED it changes the assignee, not the state. So it is
     * allowed here and nowhere else, which keeps the map free of an edge that
     * only means something for this one action.
     */
    if (current.status !== "ASSIGNED") {
      assertTransition(input.id, current.status, "ASSIGNED");
    }

    const updated = await workOrdersRepository.forScope(scope).update(input.id, {
      status: "ASSIGNED",
      technicianId: input.technicianId,
      assignedAt: new Date(),
    });

    if (!updated) throw new NotFoundError(`work order ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

const runTransitionWorkOrder = defineAction({
  name: "transitionWorkOrder",
  roles: WORK_ORDER_EXECUTORS,
  input: transitionWorkOrderSchema,
  async handler({ input, scope }): Promise<WorkOrderSummary> {
    await connectToDatabase();

    /**
     * Every move except assignment: start, hold, resume, close, unassign.
     *
     * One action rather than five, because the rule they share is the thing
     * being enforced and five handlers would be five places to forget it.
     * `-> ASSIGNED` is the exception and is refused here: it needs a
     * technician, and an ASSIGNED row with a null assignee is exactly the state
     * the status exists to rule out. That is a 400 on the payload, not a
     * transition failure, so it gets its own field message.
     */
    if (input.to === "ASSIGNED") {
      throw new ValidationError(`work order ${input.id} must be moved to ASSIGNED via assign`, {
        to: "Choose a technician to assign this work order.",
      });
    }

    const current = await requireWorkOrderInScope(scope, input.id);
    assertTransition(input.id, current.status, input.to);

    const now = new Date();

    const updated = await workOrdersRepository.forScope(scope).update(input.id, {
      status: input.to,
      /**
       * Timestamps are stamped by the server, from the transition it just
       * authorised — never proposed by the caller.
       *
       * Unassigning clears the assignee AND `assignedAt` together: the ticket is
       * genuinely back in the queue, and a lingering `assignedAt` on an OPEN row
       * would read as "someone had this" with no way to say who. `startedAt` is
       * NOT cleared by a hold — work did begin, and PENDING is a pause in it,
       * not a retraction.
       */
      ...(input.to === "OPEN" ? { technicianId: null, assignedAt: null } : {}),
      ...(input.to === "IN_PROGRESS" && !current.startedAt ? { startedAt: now } : {}),
      ...(input.to === "CLOSED" ? { closedAt: now } : {}),
    });

    if (!updated) throw new NotFoundError(`work order ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const runListWorkOrders = defineAction({
  name: "listWorkOrders",
  roles: WORK_ORDER_READERS,
  input: listWorkOrdersSchema,
  // A read behind a session. The mutation limiter exists to bound writes.
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<WorkOrderSummary>> {
    await connectToDatabase();
    return listWorkOrdersForScope(scope, input);
  },
});

const runSummariseWorkOrders = defineAction({
  name: "summariseWorkOrders",
  roles: WORK_ORDER_READERS,
  input: summariseWorkOrdersSchema,
  rateLimit: null,
  async handler({ scope }): Promise<WorkOrderPriorityCount[]> {
    await connectToDatabase();
    return summariseWorkOrdersForScope(scope);
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

export async function createWorkOrderAction(
  _previous: ActionResult<WorkOrderSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<WorkOrderSummary>> {
  return runCreateWorkOrder(payload);
}

export async function updateWorkOrderAction(
  _previous: ActionResult<WorkOrderSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<WorkOrderSummary>> {
  return runUpdateWorkOrder(payload);
}

export async function assignWorkOrderAction(
  payload: unknown,
): Promise<ActionResult<WorkOrderSummary>> {
  return runAssignWorkOrder(payload);
}

export async function transitionWorkOrderAction(
  payload: unknown,
): Promise<ActionResult<WorkOrderSummary>> {
  return runTransitionWorkOrder(payload);
}

export async function deleteWorkOrderAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runDeleteWorkOrder(payload);
}

export async function listWorkOrdersAction(
  payload: unknown,
): Promise<ActionResult<Page<WorkOrderSummary>>> {
  return runListWorkOrders(payload);
}

export async function summariseWorkOrdersAction(
  payload: unknown,
): Promise<ActionResult<WorkOrderPriorityCount[]>> {
  return runSummariseWorkOrders(payload);
}
