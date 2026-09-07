import type { Types } from "mongoose";

import type {
  ChecklistCategory,
  ChecklistJobType,
  ChecklistRunStatus,
} from "../../domain/checklists";
import {
  ChecklistRun,
  type ChecklistRunDocument,
  type ChecklistRunItem,
} from "../models/checklist-run";
import { createRepository } from "../repository";

/**
 * The tenant-scoped way to reach checklist runs.
 *
 * Refuses a client-scoped session for the same reason `checklists.ts` does: no
 * `clientId` path, not `sharedWithClients`. See the note on the model about why
 * that holds even for a run attached to a work order, which does carry one.
 */

/**
 * What a caller may supply.
 *
 * Almost all of it is DERIVED rather than entered: `checklistName`, `category`
 * and `items` are snapshot from the template by `startChecklistRun`, and
 * `jobType`/`jobId` come from a job that was re-read through a scoped
 * repository first. Nothing here arrives from a request untouched except the
 * two ids, and those are only ever used after being proved in scope.
 */
export interface ChecklistRunCreateInput {
  checklistId: Types.ObjectId | string;
  checklistName: string;
  category: ChecklistCategory;
  jobType: ChecklistJobType;
  jobId: Types.ObjectId | string;
  items: readonly ChecklistRunItem[];
  status?: ChecklistRunStatus;
}

/**
 * Patchable fields.
 *
 * `items` is the WHOLE array even when one line changed, because MongoDB's
 * positional operators address an element through a dotted path
 * (`items.3.done`) and the DAL's sanitizer refuses dotted keys by design — they
 * are the mechanism a filter uses to reach into a nested document, and allowing
 * them from feature code would reopen exactly the hole the sanitizer closes. So
 * `setChecklistRunItem` reads the run, mutates the array in memory and writes it
 * back whole; see the note there about what that costs.
 *
 * The identifying fields are absent on purpose: a run cannot be moved to
 * another job or another template. That would be a different run.
 */
export interface ChecklistRunUpdateInput {
  items?: readonly ChecklistRunItem[];
  status?: ChecklistRunStatus;
  completedAt?: Date | null;
  completedByUserId?: Types.ObjectId | string | null;
}

export const checklistRunsRepository = createRepository<
  ChecklistRunDocument,
  ChecklistRunCreateInput,
  ChecklistRunUpdateInput
>(ChecklistRun);
