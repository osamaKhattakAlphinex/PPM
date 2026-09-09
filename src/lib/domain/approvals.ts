import { z } from "zod";

import type { Role } from "../auth/roles";

/**
 * The approval chain: its vocabulary, its stage order, and the pure predicates
 * that decide who may move an item and where it may go next.
 *
 * This lives outside `src/lib/db` for the reason every other domain module
 * gives: the pending queue, the stage progress indicator and the approve/reject
 * buttons are Client Components, and anything a Client Component imports as a
 * VALUE ends up in the browser bundle — so a stage list re-exported from
 * `@/lib/db` would drag Mongoose (and `fs`, `net`, `tls`) into it and fail the
 * build.
 *
 * Pure: zod and the role type, nothing else. Safe from a Client Component, a
 * Server Component and the Edge middleware alike.
 */

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * The chain, in order. Position IS the rule — `nextStage()` is an index step,
 * and `canTransitionTo()` compares indices — so the array order is not
 * cosmetic and must not be re-sorted for readability.
 *
 * Read it as the life of a completed job on its way to being billed:
 *
 *   TECHNICIAN — the person who did the work says it is done.
 *   SUPERVISOR — the person who dispatched them says it was done properly.
 *   FM_MANAGER — the provider signs it off as billable.
 *   CLIENT     — the customer accepts it. This is the one that makes the
 *                invoice defensible; without it a dispute is the provider's
 *                word against the customer's.
 *   INVOICE_TRIGGER — nobody stands here. It is the flag that says the item is
 *                ready for Invoicing to pick up, and it exists as a STAGE
 *                rather than as a boolean so that "how far has this got" has
 *                exactly one answer in exactly one field.
 */
export const APPROVAL_STAGES = [
  "TECHNICIAN",
  "SUPERVISOR",
  "FM_MANAGER",
  "CLIENT",
  "INVOICE_TRIGGER",
] as const;

export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

export const approvalStageSchema = z.enum(APPROVAL_STAGES);

/**
 * The terminal stage — reached, never acted on.
 *
 * Named rather than written as a literal at seven call sites, because the day a
 * sixth stage is added between CLIENT and this one, every one of those literals
 * would still compile and still be wrong.
 */
export const INVOICE_TRIGGER_STAGE: ApprovalStage = "INVOICE_TRIGGER";

/** Where a chain begins. A new request always starts at the person who did it. */
export const FIRST_APPROVAL_STAGE: ApprovalStage = "TECHNICIAN";

/**
 * The role that acts at each stage, or `null` at the terminal one.
 *
 * The mapping is deliberately total and deliberately one-to-one for the four
 * acting stages: a stage whose name is a role is a stage nobody can misread on
 * screen, and the pending queue filters by exactly this.
 */
const STAGE_ROLE: Readonly<Record<ApprovalStage, Role | null>> = Object.freeze({
  TECHNICIAN: "TECHNICIAN",
  SUPERVISOR: "SUPERVISOR",
  FM_MANAGER: "FM_MANAGER",
  CLIENT: "CLIENT",
  INVOICE_TRIGGER: null,
});

export function roleForStage(stage: ApprovalStage): Role | null {
  return STAGE_ROLE[stage];
}

export function stageIndex(stage: ApprovalStage): number {
  return APPROVAL_STAGES.indexOf(stage);
}

/** The stage after this one, or `null` if there is none. */
export function nextStage(stage: ApprovalStage): ApprovalStage | null {
  return APPROVAL_STAGES[stageIndex(stage) + 1] ?? null;
}

/** True once an item has reached the flag Invoicing reads. */
export function isTerminalStage(stage: ApprovalStage): boolean {
  return stage === INVOICE_TRIGGER_STAGE;
}

/**
 * May this role act on an item sitting at this stage?
 *
 * Two clauses, and the second one is the only discretion in the whole module:
 *
 *  1. The role IS the stage. This is the rule the product asks for — a
 *     supervisor may not approve something waiting on the FM manager, and a
 *     technician may not sign off their own work twice by walking it forward.
 *  2. ADMIN may act at any STAFF stage. The tenant owner is the person who
 *     unblocks a chain when a supervisor leaves the company mid-week, and
 *     without this the only remedy would be editing the database.
 *
 * ADMIN is explicitly NOT allowed to stand in at the CLIENT stage, and that
 * exclusion is the point of writing the override as a whitelist rather than a
 * blanket. Customer acceptance is the evidence an invoice rests on; a provider
 * who can record their own customer's acceptance has an audit trail that proves
 * nothing at all. Every approval records its actor and role in `history[]`, so
 * an override is visible in the record rather than indistinguishable from the
 * real thing.
 */
export function canActOnStage(role: Role, stage: ApprovalStage): boolean {
  if (isTerminalStage(stage)) return false;

  const required = roleForStage(stage);
  if (required === null) return false;
  if (role === required) return true;

  return role === "ADMIN" && required !== "CLIENT";
}

/**
 * Is `to` a legal next stage from `from`?
 *
 * Exactly one step forward, never a jump and never a step back. Approving is
 * the only thing that moves a stage at all, so this is the whole of the
 * forward motion — a rejection stops the chain where it stands rather than
 * moving it anywhere.
 *
 * Written as a predicate over a PAIR rather than as "call nextStage and trust
 * it" so that the server can validate a `to` that arrived in a request. The UI
 * never sends one; a hand-rolled client might.
 */
export function canTransitionTo(from: ApprovalStage, to: ApprovalStage): boolean {
  return nextStage(from) === to;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Where the chain as a whole stands, as opposed to which desk the item is on.
 *
 *   PENDING   — moving. Someone owes it an answer.
 *   APPROVED  — it reached INVOICE_TRIGGER. Nothing more to approve; Invoicing
 *               may now raise a document against it.
 *   REJECTED  — someone said no, with a reason. The chain stops, permanently:
 *               re-doing the work produces a NEW request, because reopening
 *               this one would put a second, contradictory decision under the
 *               same audit trail.
 *   COMPLETED — an invoice was actually raised from it. Written by the
 *               invoicing module, not by anything in this one, which is why
 *               `completeApproval` is a separate action from `decideApproval`.
 *
 * PENDING is the only status from which anything may be decided;
 * `isOpen()` is the single expression of that and every guard uses it.
 */
export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);

export function isOpen(status: ApprovalStatus): boolean {
  return status === "PENDING";
}

/** True when Invoicing may raise a document from this item. */
export function isReadyToInvoice(status: ApprovalStatus, stage: ApprovalStage): boolean {
  return status === "APPROVED" && isTerminalStage(stage);
}

// ---------------------------------------------------------------------------
// What is being approved
// ---------------------------------------------------------------------------

/**
 * The kinds of thing a chain can hang off.
 *
 * A discriminator plus an id rather than three nullable foreign keys, because
 * an approval is the same object whatever it points at and three columns would
 * mean three ways to be in an impossible state (two set, none set).
 *
 * `INVOICE` is here because a credit note or an unusually large invoice can
 * itself need signing off before it is issued — the chain is the same chain.
 */
export const APPROVAL_REF_TYPES = ["WORK_ORDER", "PM_REPORT", "INVOICE"] as const;

export type ApprovalRefType = (typeof APPROVAL_REF_TYPES)[number];

export const approvalRefTypeSchema = z.enum(APPROVAL_REF_TYPES);

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

/**
 * What a person did, at which desk.
 *
 * SUBMITTED is recorded once, when the chain is raised, so that the history
 * answers "who asked for this?" without the reader having to know that
 * `requestedBy` exists. APPROVED and REJECTED are the decisions.
 */
export const APPROVAL_ACTIONS = ["SUBMITTED", "APPROVED", "REJECTED"] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const approvalActionSchema = z.enum(APPROVAL_ACTIONS);

/** How long a rejection reason may be. Long enough to be useful, short enough
 * that the reason cannot become the report. */
export const REJECTION_REASON_MAX_LENGTH = 500;

/** A rejection must say why. An approval need not, and usually does not. */
export function requiresReason(action: ApprovalAction): boolean {
  return action === "REJECTED";
}

/**
 * How far along a chain is, 0–100, for the progress indicator.
 *
 * Measured in STAGES CLEARED over stages to clear, so a brand-new request reads
 * 0% and one sitting at INVOICE_TRIGGER reads 100%. A rejected chain keeps the
 * progress it had earned — it did get that far — and the badge beside it is what
 * says it stopped.
 */
export function stageProgress(stage: ApprovalStage): number {
  const cleared = stageIndex(stage);
  const total = APPROVAL_STAGES.length - 1;
  return Math.round((cleared / total) * 100);
}
