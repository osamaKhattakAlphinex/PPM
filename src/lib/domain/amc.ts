import { z } from "zod";

import { addUtcDays, startOfUtcDay } from "./dates";

/**
 * The AMC vocabulary, the contract state machine, and the two pure functions
 * that turn a term into something a person can act on.
 *
 * This lives outside `src/lib/db` for the reason spelled out in `assets.ts`,
 * `technicians.ts`, `preventive.ts` and `corrective.ts`: it is domain
 * vocabulary, not a storage concern. The `Contract` model needs it, and so do
 * the contract list, its filters, its KPI header, its status badge and its
 * per-row action buttons. All of those are Client Components, and anything a
 * Client Component imports as a VALUE ends up in the browser bundle — so a
 * status list re-exported from `@/lib/db` would drag Mongoose (and `fs`, `net`,
 * `tls`) into it and fail the build.
 *
 * Pure: zod and the calendar helpers, nothing else. Safe from a Client
 * Component, a Server Component and the Edge middleware alike.
 */

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * What the price includes.
 *
 * The three ways a Gulf AMC is actually written, and the distinction between
 * them is who pays for spare parts — which is the whole commercial argument of
 * the contract and the reason the `value` figure is what it is.
 *
 * Stable uppercase keys rather than display strings, like every other enum in
 * the app: the product is bilingual, so "Comprehensive" and "شامل" are two
 * renderings of one stored value, and the moment a label IS the stored value an
 * Arabic-first tenant cannot filter on it. Labels live in
 * `messages/{en,ar}.json` under `amc.type`.
 */
export const AMC_CONTRACT_TYPES = [
  // Labour and parts. The provider carries the spares risk.
  "COMPREHENSIVE",
  // Labour and consumables; parts are quoted and billed as they are needed.
  "NON_COMPREHENSIVE",
  // Labour alone — the client buys their own parts and the provider fits them.
  "LABOUR_ONLY",
] as const;

export type AmcContractType = (typeof AMC_CONTRACT_TYPES)[number];

export const amcContractTypeSchema = z.enum(AMC_CONTRACT_TYPES);

// ---------------------------------------------------------------------------
// Status — stored vs displayed
// ---------------------------------------------------------------------------

/**
 * What is actually STORED on a contract. Three values, moved only by a person.
 *
 * `EXPIRING` and `EXPIRED` are deliberately NOT here, and neither is
 * `UPCOMING`. They are functions of the clock, not facts about the row: a
 * contract stored as "active" is wrong the morning after its end date, and
 * nothing would be running to correct it — there is no scheduler in the product
 * yet. Storing them would mean a book that is accurate only until midnight.
 * They are derived instead, by `effectiveContractStatus()` below, which cannot
 * go stale because it takes `now` as an argument.
 *
 * `src/lib/domain/corrective.ts` anticipated exactly this: "SLA targets belong
 * to an AMC contract, which is a later prompt. When it arrives it should follow
 * the preventive pattern and be derived, never stored."
 */
export const CONTRACT_STATUSES = ["ACTIVE", "SUSPENDED", "CANCELLED"] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const contractStatusSchema = z.enum(CONTRACT_STATUSES);

/**
 * What a person SEES — the stored three, with `ACTIVE` split four ways by where
 * today falls in the term.
 *
 * This is the vocabulary the status badge, the status filter and the KPI header
 * all speak. It is a superset of the stored one, so a display value is never a
 * legal thing to write to the database: `contractStatusSchema` guards writes and
 * this guards reads and filters.
 */
export const CONTRACT_DISPLAY_STATUSES = [
  "UPCOMING",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "SUSPENDED",
  "CANCELLED",
] as const;

export type ContractDisplayStatus = (typeof CONTRACT_DISPLAY_STATUSES)[number];

export const contractDisplayStatusSchema = z.enum(CONTRACT_DISPLAY_STATUSES);

/**
 * How far ahead "expiring" reaches, in days.
 *
 * Sixty, which is much further out than preventive's seven-day `UPCOMING`
 * window, and the difference is the difference between the two things. A visit
 * needs a person and a van by next week. A contract renewal needs a survey, a
 * re-quote, an approval and a signature, and the last of those does not happen
 * in a week — a provider who finds out a contract is ending with a month to run
 * is a provider negotiating from behind.
 */
export const EXPIRING_WINDOW_DAYS = 60;

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Every legal move, as data.
 *
 *     ACTIVE ⇄ SUSPENDED
 *        └────────┴──────▶ CANCELLED
 *
 * A suspension is temporary and reversible — a payment dispute, a site closed
 * for a refit — so it goes both ways.
 *
 * `CANCELLED` is terminal, for the reason `CLOSED` is on a work order: a
 * contract cancelled in error is re-signed, not revived. Un-cancelling would
 * make `cancelledAt` a lie and turn the row's history into something you
 * reconstruct rather than read — and unlike a work order, this row is the thing
 * an invoice will point at.
 *
 * A `Record` keyed by every status rather than a list of pairs: the type makes a
 * forgotten status a compile error, and `transitions.test.ts` asserts the map is
 * total and mentions no status that does not exist.
 */
export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  ACTIVE: ["SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
} as const;

/**
 * May this contract move from `from` to `to`?
 *
 * The single predicate both sides consult: `transitionContract` in
 * `src/lib/amc/actions.ts` refuses anything this rejects, and `amc-manager.tsx`
 * renders a button only for what it allows. One function rather than two lists
 * is what keeps a greyed-out button and a server rejection from disagreeing.
 *
 * A no-op move (`from === to`) is NOT legal — pressing Suspend twice is a
 * double-submit, and the second press should be told the row already moved
 * rather than silently re-stamping `suspendedAt`.
 */
export function canTransitionContract(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/** The moves available from here — what the row's action buttons are built from. */
export function nextContractStatuses(from: ContractStatus): readonly ContractStatus[] {
  return CONTRACT_TRANSITIONS[from];
}

// ---------------------------------------------------------------------------
// Derived status
// ---------------------------------------------------------------------------

/**
 * The status to SHOW for a contract, given the clock.
 *
 * Evaluated on the SERVER, in the DTO, and shipped to the browser as a plain
 * field. The client must not recompute it: a device whose clock is a day out
 * would hydrate a different badge than the server rendered, which React reports
 * as a hydration mismatch and a user reports as "it says expired on my phone".
 *
 * Only `ACTIVE` is time-sensitive. `SUSPENDED` and `CANCELLED` were reached by a
 * PERSON pressing a button, and the clock does not get to relabel that — a
 * contract cancelled in March whose term ran to December is CANCELLED, not
 * EXPIRED. Reporting it as expired would say the term ran out, when in fact
 * somebody terminated it, and those are different conversations with a customer.
 */
export function effectiveContractStatus(
  status: ContractStatus,
  startDate: Date,
  endDate: Date,
  now: Date = new Date(),
): ContractDisplayStatus {
  if (status !== "ACTIVE") return status;

  const today = startOfUtcDay(now);
  const start = startOfUtcDay(startDate).getTime();
  const end = startOfUtcDay(endDate).getTime();
  const horizon = addUtcDays(today, EXPIRING_WINDOW_DAYS).getTime();
  const todayTime = today.getTime();

  /**
   * `UPCOMING` is tested FIRST, and that precedence is the thing to preserve.
   *
   * The action refuses a term whose end precedes its start, so on well-formed
   * data the two ranges cannot both be true. But a row repaired by hand in a
   * shell, or written before that rule existed, would satisfy both — and a row
   * matching two filters is a row the list shows twice under contradictory
   * badges. Deciding the precedence here and MIRRORING it in
   * `contractStatusQueryFragment` is what makes that impossible rather than
   * merely unlikely.
   */
  if (todayTime < start) return "UPCOMING";

  // The term is up when the last day has PASSED, not on it: a contract ending
  // today is in force for the whole of today. The same half-open convention as
  // preventive's "due today is not yet late".
  if (end < todayTime) return "EXPIRED";
  if (end < horizon) return "EXPIRING";
  return "ACTIVE";
}

/**
 * The same rule as `effectiveContractStatus`, written as a QUERY instead of a
 * branch.
 *
 * A person filters for "expiring", which is not a value any row holds — it is
 * `ACTIVE` plus an end date inside the window — so the filter has to be
 * expressed in terms the database can answer. These are the three columns that
 * are stored, and the shape is what the `{ organizationId, status, endDate }`
 * and `{ organizationId, status, startDate }` indexes serve: equality on the
 * second key, a range on the third.
 *
 * It lives HERE, beside its branch twin, rather than in the query module, and
 * that is the point of the file. The two are one rule expressed twice — once for
 * a row in hand, once for rows still in the database — and if they ever disagree
 * the list shows the wrong rows with confident badges and nothing throws.
 * Keeping them in the same forty lines is what makes a change to one an obvious
 * prompt to change the other; `list-filter.test.ts` asserts they agree.
 *
 * The returned object is a TRUSTED, code-authored fragment: it carries Mongo
 * operators, so it belongs in the DAL's `where` channel, never in `filter`. The
 * untrusted part of a request is the status NAME, and it only ever selects a
 * branch below — it is never interpolated into one.
 *
 * Pure: a plain object literal. Nothing here imports the driver.
 */
export function contractStatusQueryFragment(
  status: ContractDisplayStatus,
  now: Date = new Date(),
): Record<string, unknown> {
  const today = startOfUtcDay(now);
  const horizon = addUtcDays(today, EXPIRING_WINDOW_DAYS);

  switch (status) {
    /**
     * The two stored non-ACTIVE states short-circuit with a bare equality, and
     * deliberately carry NO date term. This is the query half of the early
     * return above: without it, a suspended contract whose term has run out
     * would match both the `SUSPENDED` filter and the `EXPIRED` one.
     */
    case "SUSPENDED":
    case "CANCELLED":
      return { status };

    // Everything below is `status: ACTIVE` plus a range, and that equality is
    // what keeps the suspended and cancelled rows out of all four branches.
    case "UPCOMING":
      return { status: "ACTIVE", startDate: { $gt: today } };

    /**
     * `startDate: { $lte: today }` appears on all three branches below, and on
     * `EXPIRED` it looks redundant — a contract that has ended must have
     * started. It is there to mirror the PRECEDENCE in
     * `effectiveContractStatus`, which answers UPCOMING before it looks at the
     * end date at all. Without this term, a row with a corrupt date pair matches
     * both the UPCOMING filter and the EXPIRED one while its badge says
     * UPCOMING, and the "the six statuses partition the list" test fails with a
     * row counted twice — which is the cheap way to find out, rather than a
     * customer finding it.
     */
    case "EXPIRED":
      return { status: "ACTIVE", startDate: { $lte: today }, endDate: { $lt: today } };

    case "EXPIRING":
      // Half-open, matching the branch: ending today is expiring, and day 60 has
      // already fallen back to plain ACTIVE.
      return {
        status: "ACTIVE",
        startDate: { $lte: today },
        endDate: { $gte: today, $lt: horizon },
      };

    case "ACTIVE":
      return { status: "ACTIVE", startDate: { $lte: today }, endDate: { $gte: horizon } };
  }
}
