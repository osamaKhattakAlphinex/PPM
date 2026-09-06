import type { PpmScheduleDocument } from "@/lib/db";
import {
  effectiveStatus,
  type PpmDisplayStatus,
  type PpmFrequency,
  type PpmScheduleStatus,
} from "@/lib/domain/preventive";

/**
 * The shape that crosses the server/client boundary.
 *
 * Two reasons this layer exists rather than handing a lean document straight to
 * a Client Component:
 *
 *  1. React cannot serialise an `ObjectId` or a `Date` into a client payload.
 *     Mapping here means the failure is a type error at build time instead of a
 *     runtime "Only plain objects can be passed" in a page nobody opened yet.
 *  2. It is an explicit answer to "what does the browser get?". A document
 *     forwarded wholesale ships whatever field is added to the model next.
 *     Nothing reaches the client unless it is named below.
 */

export interface PpmScheduleSummary {
  id: string;
  assetId: string;
  /** Resolved through a second SCOPED read, never a populate. */
  assetName: string | null;
  type: PpmFrequency;
  /** ISO 8601. A Date does not survive the boundary. */
  dueDate: string;
  technicianId: string;
  /** Resolved through a second SCOPED read, never a populate. */
  technicianName: string | null;
  /** What is actually stored: SCHEDULED, IN_PROGRESS or COMPLETED. */
  status: PpmScheduleStatus;
  /**
   * What to SHOW — the stored value with SCHEDULED split by how close the due
   * date is.
   *
   * Computed HERE, on the server, and shipped as data. The client must not
   * derive it: a browser whose clock is a day out would render a different badge
   * than the server did, which React reports as a hydration mismatch and a user
   * reports as "my phone says it is overdue".
   */
  displayStatus: PpmDisplayStatus;
  startedAt: string | null;
  completedAt: string | null;
}

export function toPpmScheduleSummary(
  document: PpmScheduleDocument,
  assetName: string | null,
  technicianName: string | null,
  now: Date = new Date(),
): PpmScheduleSummary {
  return {
    id: document._id.toHexString(),
    assetId: document.assetId.toHexString(),
    assetName,
    type: document.type,
    dueDate: document.dueDate.toISOString(),
    technicianId: document.technicianId.toHexString(),
    technicianName,
    status: document.status,
    displayStatus: effectiveStatus(document.status, document.dueDate, now),
    startedAt: document.startedAt ? document.startedAt.toISOString() : null,
    completedAt: document.completedAt ? document.completedAt.toISOString() : null,
  };
}
