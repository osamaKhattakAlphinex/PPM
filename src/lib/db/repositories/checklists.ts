import type { ChecklistCategory } from "../../domain/checklists";
import { Checklist, type ChecklistDocument, type ChecklistItem } from "../models/checklist";
import { createRepository } from "../repository";

/**
 * The tenant-scoped way to reach checklist templates.
 *
 * Deliberately NOT marked `sharedWithClients`, and the model has no `clientId`
 * path either — which together mean `createRepository()` REFUSES a
 * client-scoped session outright rather than serving it. That is the
 * fail-closed direction and it agrees with `src/lib/nav/modules.ts`, where
 * `checklists` is STAFF only. The same shape as `technicians.ts` and
 * `ppm-schedules.ts`, and for the same reason: a collection that cannot be
 * narrowed to one customer must not be widened to the whole organization for a
 * customer's benefit.
 */

/**
 * What a caller may supply. `organizationId` comes from the scope, never here.
 *
 * `items` is the whole array, always. There is no per-item create path and
 * there should not be: order is data (see the model), so adding a line is a
 * rewrite of the sequence, not an append to it.
 *
 * `lastUsedAt` is accepted because `startChecklistRun` stamps it, but it is not
 * on any payload schema — a "last used" a caller could set is not evidence that
 * anything was used.
 */
export interface ChecklistCreateInput {
  name: string;
  category: ChecklistCategory;
  items: readonly ChecklistItem[];
  lastUsedAt?: Date | null;
}

/** Patchable fields. Every one of them is edited from the builder except the last. */
export interface ChecklistUpdateInput {
  name?: string;
  category?: ChecklistCategory;
  items?: readonly ChecklistItem[];
  lastUsedAt?: Date | null;
}

export const checklistsRepository = createRepository<
  ChecklistDocument,
  ChecklistCreateInput,
  ChecklistUpdateInput
>(Checklist);
