import { z } from "zod";

/**
 * The corrective-maintenance vocabulary, and the state machine a work order
 * moves through.
 *
 * This lives outside `src/lib/db` for the reason spelled out in `assets.ts`,
 * `technicians.ts` and `preventive.ts`: it is domain vocabulary, not a storage
 * concern. The `WorkOrder` model needs it, and so do the ticket list, its
 * filters, its tiles and — uniquely here — the row's ACTION BUTTONS, which are
 * derived from the transition map so that what a person can press and what the
 * server will accept cannot drift apart. All of those are Client Components,
 * and anything a Client Component imports as a VALUE ends up in the browser
 * bundle, so a status list re-exported from `@/lib/db` would drag Mongoose (and
 * `fs`, `net`, `tls`) into it and fail the build.
 *
 * Pure: zod and nothing else. Safe from a Client Component, a Server Component
 * and the Edge middleware alike.
 */

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/**
 * How badly this needs doing, in the order a person triages.
 *
 * Four steps, not five: a scale with a middle AND a "medium-high" is a scale
 * where every ticket lands in the middle. The ordering here is the display
 * ordering — most urgent first — and the tile grid reads it directly.
 *
 * Stable uppercase keys rather than display strings, like every other enum in
 * the app: the product is bilingual, so "Critical" and "حرج" are two renderings
 * of one stored value, and the moment a label IS the stored value an
 * Arabic-first tenant cannot filter on it. Labels live in
 * `messages/{en,ar}.json` under `corrective.priority`.
 */
export const WORK_ORDER_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const workOrderPrioritySchema = z.enum(WORK_ORDER_PRIORITIES);

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * What is actually STORED on a work order — and, unlike preventive, also
 * exactly what is SHOWN.
 *
 * `src/lib/domain/preventive.ts` keeps two vocabularies because `UPCOMING` and
 * `OVERDUE` are functions of the clock rather than facts about the row, so they
 * have to be derived at read time or they go stale at midnight. Nothing here is
 * like that: a work order is only ever moved by a PERSON pressing a button, so
 * there is no `effectiveStatus()`/`statusQueryFragment()` pair to keep in
 * agreement, and the status filter is a plain equality the DAL can take in its
 * untrusted `filter` channel. The absence of that machinery is a decision, not
 * an oversight.
 *
 * (An SLA breach — "open too long against its priority" — is the one thing that
 * WOULD be clock-derived, and it is deliberately not modelled yet: SLA targets
 * belong to an AMC contract, which is a later prompt. When it arrives it should
 * follow the preventive pattern and be derived, never stored.)
 */
export const WORK_ORDER_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING",
  "CLOSED",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const workOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Every legal move, as data.
 *
 *     OPEN ──assign──▶ ASSIGNED ──start──▶ IN_PROGRESS ──close──▶ CLOSED
 *              ▲           │                    │
 *              │        unassign             hold │ ▲ resume
 *              │           ▼                    ▼ │
 *              └────────  OPEN              PENDING
 *              └──assign──────────────────────┘
 *
 * The shape of it is one rule: **nothing reaches CLOSED without having been
 * assigned to someone.** `OPEN -> CLOSED` and `OPEN -> IN_PROGRESS` are
 * therefore both absent, which is what stops a ticket being quietly closed by
 * whoever finds it inconvenient — the audit question a year later is "who did
 * this work", and a row that never had an assignee cannot answer it.
 *
 * `PENDING` is work that has STOPPED for a reason outside the technician's
 * hands: waiting on a part, an approval, or access to a plant room. It can only
 * be reached from a ticket someone was actually working on or holds, and it
 * leads back into the flow rather than out of it.
 *
 * `CLOSED` is terminal. A ticket closed in error is re-raised, not revived —
 * reopening would make `closedAt` a lie and turn the row's history into
 * something you have to reconstruct rather than read.
 *
 * A `Record` keyed by every status rather than a list of pairs: the type makes
 * a forgotten status a compile error, and `transitions.test.ts` asserts the map
 * is total and mentions no status that does not exist.
 */
export const WORK_ORDER_TRANSITIONS: Readonly<
  Record<WorkOrderStatus, readonly WorkOrderStatus[]>
> = {
  // Raised, nobody owns it. The only thing to do is give it to someone.
  OPEN: ["ASSIGNED"],
  // Owned but not started: it can begin, be parked, or be handed back.
  ASSIGNED: ["IN_PROGRESS", "PENDING", "OPEN"],
  // In hand. Either it finishes, or it blocks.
  IN_PROGRESS: ["PENDING", "CLOSED"],
  // Blocked. Back to work, or back to the queue for someone else.
  PENDING: ["IN_PROGRESS", "ASSIGNED"],
  CLOSED: [],
} as const;

/**
 * May this work order move from `from` to `to`?
 *
 * The single predicate both sides consult: `transitionWorkOrder` in
 * `src/lib/corrective/actions.ts` refuses anything this rejects, and
 * `corrective-manager.tsx` renders a button only for what it allows. One
 * function rather than two lists is what keeps a greyed-out button and a server
 * rejection from ever disagreeing.
 *
 * A no-op move (`from === to`) is NOT legal. Pressing Start twice is a
 * double-submit, and the second press should be told the row already moved
 * rather than silently re-stamping `startedAt`.
 */
export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WORK_ORDER_TRANSITIONS[from].includes(to);
}

/** The moves available from here — what the row's action buttons are built from. */
export function nextStatuses(from: WorkOrderStatus): readonly WorkOrderStatus[] {
  return WORK_ORDER_TRANSITIONS[from];
}

/**
 * Still someone's problem.
 *
 * "Open" in the tile sense — anything that is not finished — rather than the
 * `OPEN` status specifically. The tiles count these; `countWorkOrdersByPriority`
 * expresses the same rule as a `$match`, and the two are one line apart from
 * each other on purpose.
 */
export function isOpenStatus(status: WorkOrderStatus): boolean {
  return status !== "CLOSED";
}

/** Nobody has picked this up yet — the figure a supervisor triages against. */
export function isUnassignedStatus(status: WorkOrderStatus): boolean {
  return status === "OPEN";
}
