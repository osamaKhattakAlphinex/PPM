import type { ApprovalDocument, ApprovalHistoryEntry } from "@/lib/db";
import type { Role } from "@/lib/auth/roles";
import {
  stageProgress,
  type ApprovalAction,
  type ApprovalRefType,
  type ApprovalStage,
  type ApprovalStatus,
} from "@/lib/domain/approvals";

/**
 * The shape that crosses the server/client boundary.
 *
 * Two reasons this layer exists rather than handing a lean document straight to
 * a Client Component: React cannot serialise an `ObjectId` or a `Date`, and a
 * document forwarded wholesale ships whatever field is added to the model next.
 * Nothing reaches the browser unless it is named below.
 */

export interface ApprovalHistoryView {
  stage: ApprovalStage;
  action: ApprovalAction;
  actorId: string;
  /** The role held AT THE TIME — snapshot on the record, not resolved now. */
  actorRole: Role;
  actorName: string | null;
  reason: string | null;
  /** ISO 8601. A Date does not survive the boundary. */
  at: string;
}

export interface ApprovalSummary {
  id: string;
  refType: ApprovalRefType;
  refId: string;
  refLabel: string;
  clientId: string | null;
  clientName: string | null;
  requestedBy: string;
  requestedByName: string | null;
  currentStage: ApprovalStage;
  status: ApprovalStatus;
  rejectionReason: string | null;
  approvedAt: string | null;
  invoiceId: string | null;
  completedAt: string | null;
  createdAt: string;

  /**
   * 0–100. Computed HERE, on the server, and shipped as data rather than
   * derived in the browser — the same rule the AMC badge follows, so the bar and
   * the stage label can never disagree.
   */
  progress: number;

  /**
   * Whether THIS session may decide THIS row, decided on the server from the
   * session's role and the row's stage.
   *
   * A capability, not a permission: hiding the buttons only hides an
   * affordance. `decideApproval` re-checks `canActOnStage` on every call
   * against the row it reads back, so a stale `true` on a screen someone left
   * open is refused by the server.
   */
  canDecide: boolean;

  history: ApprovalHistoryView[];
}

export function toApprovalHistoryView(
  entry: ApprovalHistoryEntry,
  actorName: string | null,
): ApprovalHistoryView {
  return {
    stage: entry.stage,
    action: entry.action,
    actorId: entry.actorId.toHexString(),
    actorRole: entry.actorRole,
    actorName,
    reason: entry.reason ?? null,
    at: entry.at.toISOString(),
  };
}

export function toApprovalSummary(
  document: ApprovalDocument,
  options: {
    clientName?: string | null;
    /** userId hex -> display name, for the trail and the requester. */
    actorNames?: ReadonlyMap<string, string>;
    canDecide: boolean;
  },
): ApprovalSummary {
  const names = options.actorNames ?? new Map<string, string>();
  const requestedBy = document.requestedBy.toHexString();

  return {
    id: document._id.toHexString(),
    refType: document.refType,
    refId: document.refId.toHexString(),
    refLabel: document.refLabel,
    clientId: document.clientId ? document.clientId.toHexString() : null,
    clientName: options.clientName ?? null,
    requestedBy,
    requestedByName: names.get(requestedBy) ?? null,
    currentStage: document.currentStage,
    status: document.status,
    rejectionReason: document.rejectionReason ?? null,
    approvedAt: document.approvedAt ? document.approvedAt.toISOString() : null,
    invoiceId: document.invoiceId ? document.invoiceId.toHexString() : null,
    completedAt: document.completedAt ? document.completedAt.toISOString() : null,
    createdAt: document.createdAt.toISOString(),
    progress: stageProgress(document.currentStage),
    canDecide: options.canDecide,
    history: document.history.map((entry) =>
      toApprovalHistoryView(entry, names.get(entry.actorId.toHexString()) ?? null),
    ),
  };
}

/** The queue header: how many items sit at each desk, plus the totals. */
export interface ApprovalTotals {
  /** One entry per stage, in stage order, including the empty ones. */
  byStage: { stage: ApprovalStage; count: number }[];
  pending: number;
  /** Reached INVOICE_TRIGGER and not yet billed. What Invoicing picks up. */
  readyToInvoice: number;
  rejected: number;
  completed: number;
}
