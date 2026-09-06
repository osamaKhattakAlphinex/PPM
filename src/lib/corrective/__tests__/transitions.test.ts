import { describe, expect, it } from "vitest";

import {
  canTransition,
  isOpenStatus,
  isUnassignedStatus,
  nextStatuses,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TRANSITIONS,
  type WorkOrderStatus,
} from "@/lib/domain/corrective";

/**
 * The state machine, tested without a database.
 *
 * This is the rule the module exists to enforce, and it is enforced in exactly
 * one place — `canTransition()` — which both the server action and the row's
 * action buttons consult. So a hole here is a hole in both at once, and every
 * assertion below is really an assertion about what `transitionWorkOrder` will
 * accept.
 *
 * The map is data, so it can be tested exhaustively rather than by example:
 * every one of the 25 ordered pairs is checked against an independently written
 * table, which is the point — a test that derived its expectations from
 * `WORK_ORDER_TRANSITIONS` would pass no matter what that map said.
 */

/**
 * The legal edges, written out by hand.
 *
 * Deliberately NOT built from `WORK_ORDER_TRANSITIONS`: this is the second
 * statement of the rule, and the test is that the two agree.
 */
const LEGAL: ReadonlyArray<readonly [WorkOrderStatus, WorkOrderStatus]> = [
  ["OPEN", "ASSIGNED"],
  ["ASSIGNED", "IN_PROGRESS"],
  ["ASSIGNED", "PENDING"],
  ["ASSIGNED", "OPEN"],
  ["IN_PROGRESS", "PENDING"],
  ["IN_PROGRESS", "CLOSED"],
  ["PENDING", "IN_PROGRESS"],
  ["PENDING", "ASSIGNED"],
];

function isLegal(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return LEGAL.some(([a, b]) => a === from && b === to);
}

// ---------------------------------------------------------------------------
// The map itself
// ---------------------------------------------------------------------------

describe("the transition map is well formed", () => {
  it("has an entry for every status", () => {
    expect(Object.keys(WORK_ORDER_TRANSITIONS).sort()).toEqual([...WORK_ORDER_STATUSES].sort());
  });

  it("names only statuses that exist", () => {
    for (const targets of Object.values(WORK_ORDER_TRANSITIONS)) {
      for (const target of targets) {
        expect(WORK_ORDER_STATUSES).toContain(target);
      }
    }
  });

  /**
   * A self-edge would make "press Start twice" legal everywhere, and the second
   * press would silently re-stamp `startedAt`. Reassignment is the one thing
   * that looks like a self-edge and is not one — it is handled in
   * `assignWorkOrder`, deliberately outside this map.
   */
  it("has no self-edges", () => {
    for (const status of WORK_ORDER_STATUSES) {
      expect(WORK_ORDER_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("lists no target twice", () => {
    for (const status of WORK_ORDER_STATUSES) {
      const targets = WORK_ORDER_TRANSITIONS[status];
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Every ordered pair
// ---------------------------------------------------------------------------

describe("canTransition covers every pair of statuses", () => {
  const pairs = WORK_ORDER_STATUSES.flatMap((from) =>
    WORK_ORDER_STATUSES.map((to) => [from, to] as const),
  );

  it.each(pairs)("%s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(isLegal(from, to));
  });

  it("checks all twenty-five", () => {
    expect(pairs).toHaveLength(WORK_ORDER_STATUSES.length ** 2);
  });
});

// ---------------------------------------------------------------------------
// The rules the map exists to express
// ---------------------------------------------------------------------------

describe("nothing reaches CLOSED without having been assigned", () => {
  /**
   * The whole point of the machine. A ticket that could be closed straight from
   * OPEN is a ticket nobody has to own, and the audit question a year later —
   * "who did this work" — has no answer.
   */
  it("refuses OPEN -> CLOSED", () => {
    expect(canTransition("OPEN", "CLOSED")).toBe(false);
  });

  it("refuses OPEN -> IN_PROGRESS, so work cannot start unowned", () => {
    expect(canTransition("OPEN", "IN_PROGRESS")).toBe(false);
  });

  it("refuses OPEN -> PENDING, so a ticket cannot be parked before it is triaged", () => {
    expect(canTransition("OPEN", "PENDING")).toBe(false);
  });

  it("refuses ASSIGNED -> CLOSED, so closing implies work was actually started", () => {
    expect(canTransition("ASSIGNED", "CLOSED")).toBe(false);
  });

  it("refuses PENDING -> CLOSED: a blocked ticket resumes before it finishes", () => {
    expect(canTransition("PENDING", "CLOSED")).toBe(false);
  });

  it("only allows CLOSED to be reached from IN_PROGRESS", () => {
    const sources = WORK_ORDER_STATUSES.filter((from) => canTransition(from, "CLOSED"));
    expect(sources).toEqual(["IN_PROGRESS"]);
  });

  /**
   * The shortest legal route to CLOSED, walked one edge at a time. This is the
   * positive half of the rule: refusing the shortcut is only correct if the long
   * way round actually works.
   */
  it("allows OPEN -> ASSIGNED -> IN_PROGRESS -> CLOSED", () => {
    const route: WorkOrderStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "CLOSED"];
    for (let i = 0; i < route.length - 1; i += 1) {
      expect(canTransition(route[i], route[i + 1])).toBe(true);
    }
  });
});

describe("CLOSED is terminal", () => {
  it("has no outgoing edges", () => {
    expect(WORK_ORDER_TRANSITIONS.CLOSED).toEqual([]);
    expect(nextStatuses("CLOSED")).toHaveLength(0);
  });

  it.each(WORK_ORDER_STATUSES)("refuses CLOSED -> %s", (to) => {
    expect(canTransition("CLOSED", to)).toBe(false);
  });
});

describe("a blocked ticket can always get moving again", () => {
  it("resumes into IN_PROGRESS", () => {
    expect(canTransition("PENDING", "IN_PROGRESS")).toBe(true);
  });

  it("can be handed to someone else instead", () => {
    expect(canTransition("PENDING", "ASSIGNED")).toBe(true);
  });

  it("is reachable from both ASSIGNED and IN_PROGRESS", () => {
    expect(canTransition("ASSIGNED", "PENDING")).toBe(true);
    expect(canTransition("IN_PROGRESS", "PENDING")).toBe(true);
  });
});

describe("unassigning returns a ticket to the queue", () => {
  it("is legal only from ASSIGNED", () => {
    const sources = WORK_ORDER_STATUSES.filter((from) => canTransition(from, "OPEN"));
    expect(sources).toEqual(["ASSIGNED"]);
  });
});

describe("every status except CLOSED can still be moved", () => {
  it.each(WORK_ORDER_STATUSES.filter((status) => status !== "CLOSED"))("%s", (status) => {
    expect(nextStatuses(status).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The tile predicates
// ---------------------------------------------------------------------------

describe("the tile predicates match the aggregation's conditions", () => {
  /**
   * `countWorkOrdersByPriority` restates both of these as a `$match` and a
   * `$cond`. If either drifts, the tiles disagree with the badges on the rows
   * beneath them — which is worse than having no tiles.
   */
  it("counts everything but CLOSED as open", () => {
    expect(WORK_ORDER_STATUSES.filter(isOpenStatus)).toEqual([
      "OPEN",
      "ASSIGNED",
      "IN_PROGRESS",
      "PENDING",
    ]);
  });

  it("counts only OPEN as unassigned", () => {
    expect(WORK_ORDER_STATUSES.filter(isUnassignedStatus)).toEqual(["OPEN"]);
  });

  it("keeps unassigned a subset of open, so a tile cannot exceed its own total", () => {
    for (const status of WORK_ORDER_STATUSES) {
      if (isUnassignedStatus(status)) expect(isOpenStatus(status)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The vocabularies
// ---------------------------------------------------------------------------

describe("the vocabularies", () => {
  it("orders priorities most urgent first, which is the tile order", () => {
    expect(WORK_ORDER_PRIORITIES).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
  });

  it("starts a work order's life at OPEN", () => {
    expect(WORK_ORDER_STATUSES[0]).toBe("OPEN");
  });

  it("uses stable uppercase keys, never display strings", () => {
    for (const value of [...WORK_ORDER_STATUSES, ...WORK_ORDER_PRIORITIES]) {
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });
});
