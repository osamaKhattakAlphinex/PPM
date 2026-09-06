import type { Types } from "mongoose";

import {
  WORK_ORDER_PRIORITIES,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "../../domain/corrective";
import { WorkOrder, type WorkOrderDocument } from "../models/work-order";
import { createRepository } from "../repository";
import type { TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach work orders.
 *
 * Deliberately NOT marked `sharedWithClients`, and it does not need to be: the
 * model HAS a `clientId` path, so `createRepository()` sets
 * `isClientPartitioned` and appends `clientId: scope.clientId` to every filter
 * it builds for a client-scoped session. That is narrowing, which is what a
 * customer should get; `sharedWithClients` is the opposite escape hatch, for an
 * org-wide collection a CLIENT may read in full, and using it here would serve
 * every customer's faults to every customer.
 *
 * This is the first operational collection a CLIENT session actually reaches.
 * `PpmSchedule` refuses one and `Technician` refuses one; both are tested for
 * the throw. The test for this collection asserts the other half — that a
 * client IS served, and served only its own rows.
 */

/**
 * What a caller may supply. `organizationId` comes from the scope, never here.
 *
 * `clientId` is accepted because the DAL's create path reads it for a
 * client-partitioned collection — but it is DERIVED by the action from the
 * asset's own client, never taken from a request payload. For a CLIENT session
 * the DAL overwrites it with the session's own client regardless.
 *
 * `status` and the three timestamps are accepted because the transition actions
 * set them, but they are not on any payload schema: a new ticket is always
 * OPEN and unassigned, and a timestamp a client could choose is not evidence
 * that anything happened.
 */
export interface WorkOrderCreateInput {
  assetId: Types.ObjectId | string;
  clientId?: Types.ObjectId | string | null;
  issue: string;
  priority: WorkOrderPriority;
  status?: WorkOrderStatus;
  technicianId?: Types.ObjectId | string | null;
}

/** Patchable fields. The transitions patch `status`, the assignee and a timestamp. */
export interface WorkOrderUpdateInput {
  assetId?: Types.ObjectId | string;
  issue?: string;
  priority?: WorkOrderPriority;
  status?: WorkOrderStatus;
  technicianId?: Types.ObjectId | string | null;
  assignedAt?: Date | null;
  startedAt?: Date | null;
  closedAt?: Date | null;
}

export const workOrdersRepository = createRepository<
  WorkOrderDocument,
  WorkOrderCreateInput,
  WorkOrderUpdateInput
>(WorkOrder);

// ---------------------------------------------------------------------------
// The priority summary
// ---------------------------------------------------------------------------

/** One tile: how much unfinished work sits at this priority, and how much of it nobody owns. */
export interface WorkOrderPriorityCount {
  readonly priority: WorkOrderPriority;
  /** Anything not CLOSED — the tile's headline figure. */
  readonly open: number;
  /** Of those, how many are still status OPEN, i.e. have no assignee. */
  readonly unassigned: number;
}

interface PriorityCountRow {
  _id: WorkOrderPriority;
  open: number;
  unassigned: number;
}

/**
 * Count the unfinished work orders per priority, and how many of each are still
 * nobody's.
 *
 * This lives INSIDE `src/lib/db/**` rather than in the feature module because it
 * is an aggregation, and the DAL-boundary lint rule forbids `Model.aggregate`
 * anywhere else — for the reason the repository's own header gives: a pipeline
 * is reached under MongoDB's rules rather than ours, so the one place it may be
 * written is the layer that can prove the first stage is scoped.
 *
 * And it is proven, not asserted. The `$match` is `matchStage()` — the very
 * filter `find()` and `paginate()` build, with `organizationId` (and, for a
 * client session, `clientId`) applied last where nothing can displace it, and
 * `deletedAt: null` already in place. Four tiles therefore cost one round trip
 * instead of eight `count()` calls, and there is no second definition of "a work
 * order this session can see" to keep in step.
 *
 * The two conditions restate `isOpenStatus` and `isUnassignedStatus` from
 * `src/lib/domain/corrective.ts` as a query. Both statuses here are literals
 * from our own enum, never values that arrived in a request.
 */
export async function countWorkOrdersByPriority(
  scope: TenantScope,
): Promise<WorkOrderPriorityCount[]> {
  const rows = await WorkOrder.aggregate<PriorityCountRow>([
    {
      $match: {
        ...workOrdersRepository.forScope(scope).matchStage(),
        status: { $ne: "CLOSED" },
      },
    },
    {
      $group: {
        _id: "$priority",
        open: { $sum: 1 },
        unassigned: { $sum: { $cond: [{ $eq: ["$status", "OPEN"] }, 1, 0] } },
      },
    },
  ]).exec();

  const counts = new Map(rows.map((row) => [row._id, row]));

  // Every priority, in the vocabulary's own order (most urgent first),
  // including the ones with no work. A tile grid that grows and shrinks as rows
  // appear is a grid whose tiles move under the pointer.
  return WORK_ORDER_PRIORITIES.map((priority) => ({
    priority,
    open: counts.get(priority)?.open ?? 0,
    unassigned: counts.get(priority)?.unassigned ?? 0,
  }));
}
