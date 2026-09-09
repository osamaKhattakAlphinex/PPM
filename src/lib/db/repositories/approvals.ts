import type { Types } from "mongoose";

import type {
  ApprovalRefType,
  ApprovalStage,
  ApprovalStatus,
} from "../../domain/approvals";
import { Approval, type ApprovalDocument, type ApprovalHistoryEntry } from "../models/approval";
import { createRepository } from "../repository";
import type { TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach approvals.
 *
 * Client-partitioned, which follows from the model rather than from an option
 * here: `Approval` has a `clientId` path, so `createRepository()` narrows a
 * CLIENT session to its own chains. That is a requirement, not a convenience —
 * CLIENT is a STAGE in this chain, so a customer must be able to open the queue
 * and see what is waiting on them.
 */

export interface ApprovalCreateInput {
  refType: ApprovalRefType;
  refId: Types.ObjectId | string;
  refLabel: string;
  clientId?: Types.ObjectId | string | null;
  requestedBy: Types.ObjectId | string;
  currentStage?: ApprovalStage;
  status?: ApprovalStatus;
  history?: readonly ApprovalHistoryEntry[];
}

/**
 * What a decision may change.
 *
 * No `refType`, `refId` or `refLabel`: what a chain is about is fixed when it is
 * raised. Repointing an approval at a different job would move a signature onto
 * work nobody signed for, which is the one thing an audit trail must not permit.
 */
export interface ApprovalUpdateInput {
  currentStage?: ApprovalStage;
  status?: ApprovalStatus;
  rejectionReason?: string | null;
  approvedAt?: Date | null;
  invoiceId?: Types.ObjectId | string | null;
  completedAt?: Date | null;
  history?: readonly ApprovalHistoryEntry[];
}

export const approvalsRepository = createRepository<
  ApprovalDocument,
  ApprovalCreateInput,
  ApprovalUpdateInput
>(Approval);

// ---------------------------------------------------------------------------
// The queue header
// ---------------------------------------------------------------------------

/** One row of "how many items are sitting at this desk". */
export interface ApprovalStageCount {
  readonly stage: ApprovalStage;
  readonly count: number;
}

/**
 * How many PENDING items sit at each stage, in one round trip.
 *
 * Inside `src/lib/db/**` because it is an aggregation, and the DAL-boundary lint
 * rule forbids `Model.aggregate` anywhere else — a pipeline is reached under
 * MongoDB's rules rather than ours, so the one place it may be written is the
 * layer that can prove the first stage is scoped. And it is proven: the `$match`
 * is `matchStage()`, the very filter `find()` builds, with `organizationId` (and
 * `clientId` for a client session) applied last and `deletedAt: null` already in
 * place. The base plugin does not filter aggregations, so that last part is
 * doing real work.
 *
 * Returns a row per stage rather than one object, unlike `summariseContracts` —
 * the tiles here ARE the enum, one per desk, and the array is what guarantees an
 * empty desk still renders a tile so the row does not reflow as work moves.
 */
export async function countApprovalsByStage(
  scope: TenantScope,
  stages: readonly ApprovalStage[],
): Promise<ApprovalStageCount[]> {
  const rows = await Approval.aggregate<{ _id: ApprovalStage; count: number }>([
    // Every literal below is code-authored. Nothing from a request reaches it.
    { $match: approvalsRepository.forScope(scope).matchStage({ status: "PENDING" }) },
    { $group: { _id: "$currentStage", count: { $sum: 1 } } },
  ]).exec();

  const counts = new Map(rows.map((row) => [row._id, row.count]));
  return stages.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
}
