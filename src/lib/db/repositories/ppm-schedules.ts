import type { Types } from "mongoose";

import {
  PPM_FREQUENCIES,
  startOfUtcDay,
  type PpmFrequency,
  type PpmScheduleStatus,
} from "../../domain/preventive";
import { PpmSchedule, type PpmScheduleDocument } from "../models/ppm-schedule";
import { createRepository } from "../repository";
import type { TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach PPM schedules.
 *
 * Deliberately NOT marked `sharedWithClients`, and the model deliberately has no
 * `clientId`. Between them that means `createRepository()` refuses a CLIENT
 * scope outright with a `ScopeResolutionError` rather than serving it the
 * organization's whole maintenance plan — the fail-closed half of the rule in
 * CLAUDE.md. `src/lib/nav/modules.ts` agrees: `preventive` is STAFF.
 *
 * If a client portal ever needs "the visits planned at my sites", that is a
 * purpose-built read filtered from the client's own assets, not a widening of
 * this repository — the same shape as `findOwnClientForScope()`.
 */

/**
 * What a caller may supply. `organizationId` comes from the scope, never here.
 *
 * `status`, `startedAt` and `completedAt` are accepted because the transition
 * actions set them, but they are not on the create payload schema: a new
 * schedule is always `SCHEDULED`, and a timestamp a client could choose is not
 * evidence that anything happened.
 */
export interface PpmScheduleCreateInput {
  assetId: Types.ObjectId | string;
  type: PpmFrequency;
  dueDate: Date;
  technicianId: Types.ObjectId | string;
  status?: PpmScheduleStatus;
}

/** Patchable fields. The transitions patch `status` and one timestamp. */
export interface PpmScheduleUpdateInput {
  assetId?: Types.ObjectId | string;
  type?: PpmFrequency;
  dueDate?: Date;
  technicianId?: Types.ObjectId | string;
  status?: PpmScheduleStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export const ppmSchedulesRepository = createRepository<
  PpmScheduleDocument,
  PpmScheduleCreateInput,
  PpmScheduleUpdateInput
>(PpmSchedule);

// ---------------------------------------------------------------------------
// The frequency summary
// ---------------------------------------------------------------------------

/** One tile: how much open work of this frequency there is, and how late. */
export interface PpmTypeCount {
  readonly type: PpmFrequency;
  /** Not yet completed — the tile's headline figure. */
  readonly open: number;
  /** Of those, how many are past their due date. */
  readonly overdue: number;
}

interface TypeCountRow {
  _id: PpmFrequency;
  open: number;
  overdue: number;
}

/**
 * Count the open schedules per frequency, and how many of each are late.
 *
 * This lives INSIDE `src/lib/db/**` rather than in the feature module because it
 * is an aggregation, and the DAL-boundary lint rule forbids `Model.aggregate`
 * anywhere else — for the reason the repository's own header gives: a pipeline
 * is reached under MongoDB's rules rather than ours, so the one place it may be
 * written is the layer that can prove the first stage is scoped.
 *
 * And it is proven, not asserted. The `$match` is `matchStage()` — the very
 * filter `find()` and `paginate()` build, with `organizationId` applied last
 * where nothing can displace it and `deletedAt: null` already in place. Six
 * tiles therefore cost one round trip instead of six `count()` calls, and there
 * is no second definition of "a schedule this tenant can see" to keep in step.
 *
 * `overdue` is computed against a date passed in from the caller rather than
 * `$$NOW`, so the boundary is the same UTC midnight `effectiveStatus()` uses.
 * A tile that disagreed with the badge on the row beneath it would be worse than
 * no tile.
 */
export async function countPpmSchedulesByType(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<PpmTypeCount[]> {
  const today = startOfUtcDay(now);

  const rows = await PpmSchedule.aggregate<TypeCountRow>([
    {
      $match: {
        // Scoped by the DAL, then narrowed to open work. `status` is a literal
        // from our own enum, never a value that arrived in a request.
        ...ppmSchedulesRepository.forScope(scope).matchStage(),
        status: { $ne: "COMPLETED" },
      },
    },
    {
      $group: {
        _id: "$type",
        open: { $sum: 1 },
        overdue: { $sum: { $cond: [{ $lt: ["$dueDate", today] }, 1, 0] } },
      },
    },
  ]).exec();

  const counts = new Map(rows.map((row) => [row._id, row]));

  // Every frequency, in the vocabulary's own order, including the ones with no
  // work. A tile grid that grows and shrinks as rows appear is a grid whose
  // tiles move under the pointer.
  return PPM_FREQUENCIES.map((type) => ({
    type,
    open: counts.get(type)?.open ?? 0,
    overdue: counts.get(type)?.overdue ?? 0,
  }));
}
