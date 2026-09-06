import type { WorkOrderDocument } from "@/lib/db";
import type { WorkOrderPriority, WorkOrderStatus } from "@/lib/domain/corrective";

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
 *     Nothing reaches the client unless it is named below — and `clientId` is
 *     deliberately not named: it is a scoping fact, not information a ticket
 *     row needs, and the only session that could act on it already knows it.
 */

export interface WorkOrderSummary {
  id: string;
  assetId: string;
  /** Resolved through a second SCOPED read, never a populate. */
  assetName: string | null;
  issue: string;
  priority: WorkOrderPriority;
  /**
   * What is stored, and — unlike preventive's schedules — also exactly what is
   * shown. There is no `displayStatus` companion because nothing about a work
   * order is derived from the clock; see `src/lib/domain/corrective.ts`.
   */
  status: WorkOrderStatus;
  /** Null while the ticket is OPEN — a fault exists before anyone owns it. */
  technicianId: string | null;
  /**
   * Resolved through a second SCOPED read, never a populate.
   *
   * Always null for a CLIENT session, and not because the lookup failed: the
   * `Technician` collection has no `clientId`, so the DAL refuses a
   * client-scoped read of it outright and `namesFor()` does not attempt one.
   * The client UI renders no technician column at all rather than a column of
   * blanks — see `corrective-manager.tsx`.
   */
  technicianName: string | null;
  /** ISO 8601. A Date does not survive the boundary. */
  createdAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
}

export function toWorkOrderSummary(
  document: WorkOrderDocument,
  assetName: string | null,
  technicianName: string | null,
): WorkOrderSummary {
  return {
    id: document._id.toHexString(),
    assetId: document.assetId.toHexString(),
    assetName,
    issue: document.issue,
    priority: document.priority,
    status: document.status,
    technicianId: document.technicianId ? document.technicianId.toHexString() : null,
    technicianName,
    createdAt: document.createdAt.toISOString(),
    assignedAt: document.assignedAt ? document.assignedAt.toISOString() : null,
    startedAt: document.startedAt ? document.startedAt.toISOString() : null,
    closedAt: document.closedAt ? document.closedAt.toISOString() : null,
  };
}
