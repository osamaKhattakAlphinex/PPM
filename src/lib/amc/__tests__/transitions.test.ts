import { describe, expect, it } from "vitest";

import {
  CONTRACT_STATUSES,
  CONTRACT_TRANSITIONS,
  canTransitionContract,
  nextContractStatuses,
} from "@/lib/domain/amc";

/**
 * The contract state machine, as data.
 *
 *     ACTIVE ⇄ SUSPENDED
 *        └────────┴──────▶ CANCELLED
 *
 * The map is consulted from two places that must never disagree:
 * `transitionContract` refuses anything it rejects, and `amc-manager.tsx`
 * renders a button only for what it allows. So what is asserted here is the
 * SHAPE of the map — total, closed, and free of self-edges — rather than any
 * one journey through it.
 */

describe("CONTRACT_TRANSITIONS", () => {
  it("names every stored status exactly once", () => {
    // A `Record` keyed by the status type makes a MISSING key a compile error,
    // but not an extra one — a stale key left behind by a renamed status would
    // sit here unreferenced and unnoticed.
    expect(Object.keys(CONTRACT_TRANSITIONS).sort()).toEqual([...CONTRACT_STATUSES].sort());
  });

  it("only ever points at a status that exists", () => {
    for (const targets of Object.values(CONTRACT_TRANSITIONS)) {
      for (const target of targets) {
        expect(CONTRACT_STATUSES).toContain(target);
      }
    }
  });

  it("has no self-edges", () => {
    // Pressing Suspend twice is a double-submit, and the second press should be
    // told the row already moved rather than silently re-stamping `suspendedAt`.
    for (const status of CONTRACT_STATUSES) {
      expect(CONTRACT_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("lists no target twice from the same status", () => {
    for (const status of CONTRACT_STATUSES) {
      const targets = CONTRACT_TRANSITIONS[status];
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it("makes CANCELLED terminal", () => {
    // A contract cancelled in error is re-signed, not revived: un-cancelling
    // would make `cancelledAt` a lie and turn the row's history into something
    // you reconstruct rather than read.
    expect(CONTRACT_TRANSITIONS.CANCELLED).toEqual([]);
    for (const status of CONTRACT_STATUSES) {
      expect(canTransitionContract("CANCELLED", status)).toBe(false);
    }
  });

  it("lets a suspension be reversed", () => {
    // Unlike cancellation. A suspension is a pause — a payment dispute, a site
    // closed for a refit — and the contract goes back into force when it ends.
    expect(canTransitionContract("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionContract("SUSPENDED", "ACTIVE")).toBe(true);
  });

  it("lets a contract be cancelled from either live state", () => {
    expect(canTransitionContract("ACTIVE", "CANCELLED")).toBe(true);
    expect(canTransitionContract("SUSPENDED", "CANCELLED")).toBe(true);
  });

  it("reaches every status except the starting one", () => {
    // No orphan: a status nothing can move to is a status no row can ever hold,
    // which would make its badge and its filter dead code.
    const reachable = new Set(Object.values(CONTRACT_TRANSITIONS).flat());
    for (const status of CONTRACT_STATUSES) {
      if (status === "ACTIVE") continue; // where every contract starts
      expect(reachable).toContain(status);
    }
  });
});

describe("canTransitionContract and nextContractStatuses", () => {
  it("agree on every pair", () => {
    // The UI builds buttons from `nextContractStatuses` and the server checks
    // `canTransitionContract`. If those two ever answered differently, a button
    // would be rendered for a move the server refuses.
    for (const from of CONTRACT_STATUSES) {
      const next = nextContractStatuses(from);
      for (const to of CONTRACT_STATUSES) {
        expect(canTransitionContract(from, to)).toBe(next.includes(to));
      }
    }
  });
});
