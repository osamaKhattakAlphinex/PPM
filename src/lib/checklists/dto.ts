import type { ChecklistDocument, ChecklistRunDocument } from "@/lib/db";
import {
  runProgress,
  type ChecklistCategory,
  type ChecklistJobType,
  type ChecklistRunStatus,
  type RunProgress,
} from "@/lib/domain/checklists";

/**
 * The shapes that cross the server/client boundary.
 *
 * Two reasons this layer exists rather than handing a lean document straight to
 * a Client Component:
 *
 *  1. React cannot serialise an `ObjectId` or a `Date` into a client payload.
 *     Mapping here means the failure is a type error at build time instead of a
 *     runtime "Only plain objects can be passed" in a page nobody opened yet.
 *  2. It is an explicit answer to "what does the browser get?". A document
 *     forwarded wholesale ships whatever field is added to the model next.
 *     Nothing reaches the client unless it is named below — and
 *     `completedByUserId` is deliberately NOT named: the run sheet has no use
 *     for a raw user id, and shipping one would leak the shape of the identity
 *     collection to a screen that only needs to know the run is signed.
 */

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

export interface ChecklistItemView {
  label: string;
  required: boolean;
}

export interface ChecklistSummary {
  id: string;
  name: string;
  category: ChecklistCategory;
  /**
   * The whole procedure, not just a count.
   *
   * Shipped with the list because the builder opens from a row and must show
   * what is already there — and a second round trip to fetch forty short
   * strings would put a spinner between pressing Edit and seeing the form. The
   * payload is bounded by construction: `MAX_CHECKLIST_ITEMS` lines of at most
   * `ITEM_LABEL_MAX_LENGTH` characters is a few kilobytes at the very worst.
   */
  items: ChecklistItemView[];
  /** Derived here so the list and the builder cannot count differently. */
  itemCount: number;
  requiredCount: number;
  /** ISO 8601. A Date does not survive the boundary. Null means never run. */
  lastUsedAt: string | null;
  createdAt: string;
}

export function toChecklistSummary(document: ChecklistDocument): ChecklistSummary {
  const items = document.items.map((item) => ({ label: item.label, required: item.required }));

  return {
    id: document._id.toHexString(),
    name: document.name,
    category: document.category,
    items,
    itemCount: items.length,
    requiredCount: items.filter((item) => item.required).length,
    lastUsedAt: document.lastUsedAt ? document.lastUsedAt.toISOString() : null,
    createdAt: document.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface ChecklistRunItemView {
  label: string;
  required: boolean;
  done: boolean;
  note: string | null;
  /** ISO 8601, or null while the line is unticked. */
  completedAt: string | null;
}

export interface ChecklistRunSummary {
  id: string;
  checklistId: string;
  /** Snapshot on the run, so this is readable after the template is deleted. */
  checklistName: string;
  category: ChecklistCategory;
  jobType: ChecklistJobType;
  jobId: string;
  /**
   * What to call the job on screen — an asset name for a PPM visit, the fault
   * text for a work order.
   *
   * Resolved through a second SCOPED read, never a populate: the DAL refuses
   * populate on purpose, because a join is reached under MongoDB's rules rather
   * than ours. Null when the job has since been deleted, which the run survives
   * — everything it needs to be read as a record was snapshot.
   */
  jobLabel: string | null;
  items: ChecklistRunItemView[];
  status: ChecklistRunStatus;
  /**
   * Computed on the SERVER and shipped as data, not derived in the browser.
   *
   * The same discipline `preventive/dto.ts` applies to `displayStatus`, for a
   * related reason: the progress figure and the enabled/disabled state of the
   * Complete button must agree with what the server will actually accept, and
   * the only way to guarantee that is for both to come from one function
   * (`runProgress`) over one array. The client recomputes it optimistically
   * while a tick is in flight — with the same function, imported from the
   * domain module.
   */
  progress: RunProgress;
  completedAt: string | null;
  createdAt: string;
}

export function toChecklistRunSummary(
  document: ChecklistRunDocument,
  jobLabel: string | null,
): ChecklistRunSummary {
  const items = document.items.map((item) => ({
    label: item.label,
    required: item.required,
    done: item.done,
    note: item.note ?? null,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
  }));

  return {
    id: document._id.toHexString(),
    checklistId: document.checklistId.toHexString(),
    checklistName: document.checklistName,
    category: document.category,
    jobType: document.jobType,
    jobId: document.jobId.toHexString(),
    jobLabel,
    items,
    status: document.status,
    progress: runProgress(items),
    completedAt: document.completedAt ? document.completedAt.toISOString() : null,
    createdAt: document.createdAt.toISOString(),
  };
}
