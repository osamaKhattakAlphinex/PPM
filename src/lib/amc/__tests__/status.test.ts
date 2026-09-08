import { describe, expect, it } from "vitest";

import {
  CONTRACT_DISPLAY_STATUSES,
  CONTRACT_STATUSES,
  EXPIRING_WINDOW_DAYS,
  contractStatusQueryFragment,
  effectiveContractStatus,
  type ContractDisplayStatus,
} from "@/lib/domain/amc";

/**
 * The clock-derived half of the contract vocabulary, tested without a database.
 *
 * `effectiveContractStatus` is a branch and `contractStatusQueryFragment` is the
 * same rule as a query. This suite pins the BRANCH and the SHAPE of the
 * fragment; `list-filter.test.ts` proves the two agree against a real mongod,
 * which is the only place that question can honestly be asked.
 *
 * Every boundary here is half-open in the same direction, and each one has a row
 * on both sides: starting today is not upcoming, ending today is not expired,
 * day 59 is expiring and day 60 is not.
 */

/** Fixed "today", so the fixtures sit at known distances from it. */
const NOW = new Date("2026-03-14T09:00:00.000Z");
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A term wide enough that only the end named in each test decides the answer. */
const LONG_AGO = utc("2020-01-01");
const FAR_FUTURE = utc("2030-01-01");

describe("effectiveContractStatus", () => {
  it("returns the stored status unchanged for a suspended contract, whatever its dates", () => {
    // The early return. A person moved this row, and the clock does not get to
    // relabel that — this is the assertion that keeps "suspended" from silently
    // becoming "expired" the morning after a term runs out.
    expect(effectiveContractStatus("SUSPENDED", LONG_AGO, utc("2025-01-01"), NOW)).toBe(
      "SUSPENDED",
    );
    expect(effectiveContractStatus("SUSPENDED", LONG_AGO, FAR_FUTURE, NOW)).toBe("SUSPENDED");
    expect(effectiveContractStatus("SUSPENDED", FAR_FUTURE, FAR_FUTURE, NOW)).toBe("SUSPENDED");
  });

  it("returns the stored status unchanged for a cancelled contract, whatever its dates", () => {
    // A contract cancelled in March whose term ran to December is CANCELLED, not
    // EXPIRED: the term did not run out, somebody terminated it.
    expect(effectiveContractStatus("CANCELLED", LONG_AGO, utc("2025-01-01"), NOW)).toBe(
      "CANCELLED",
    );
    expect(effectiveContractStatus("CANCELLED", LONG_AGO, FAR_FUTURE, NOW)).toBe("CANCELLED");
  });

  it("is UPCOMING only before the start date — starting today is already active", () => {
    expect(effectiveContractStatus("ACTIVE", utc("2026-03-15"), FAR_FUTURE, NOW)).toBe("UPCOMING");
    // Half-open: the first day of the term is inside the term.
    expect(effectiveContractStatus("ACTIVE", utc("2026-03-14"), FAR_FUTURE, NOW)).toBe("ACTIVE");
  });

  it("tests UPCOMING before it looks at the end date", () => {
    // A corrupt pair — end before start, which the action refuses but a
    // hand-repaired row could hold. The precedence has to be decided somewhere,
    // and `contractStatusQueryFragment` mirrors whatever is decided here.
    expect(effectiveContractStatus("ACTIVE", utc("2026-06-01"), utc("2026-01-01"), NOW)).toBe(
      "UPCOMING",
    );
  });

  it("is EXPIRED only after the last day — ending today is still in force", () => {
    expect(effectiveContractStatus("ACTIVE", LONG_AGO, utc("2026-03-13"), NOW)).toBe("EXPIRED");
    // The whole of the last day belongs to the contract, the same convention as
    // preventive's "due today is not yet late".
    expect(effectiveContractStatus("ACTIVE", LONG_AGO, utc("2026-03-14"), NOW)).toBe("EXPIRING");
  });

  it("is EXPIRING up to the window edge, and plain ACTIVE at it", () => {
    const dayBeforeEdge = new Date(NOW.getTime());
    dayBeforeEdge.setUTCDate(dayBeforeEdge.getUTCDate() + EXPIRING_WINDOW_DAYS - 1);

    const edge = new Date(NOW.getTime());
    edge.setUTCDate(edge.getUTCDate() + EXPIRING_WINDOW_DAYS);

    expect(effectiveContractStatus("ACTIVE", LONG_AGO, dayBeforeEdge, NOW)).toBe("EXPIRING");
    // Half-open: day 60 has already fallen back to plain ACTIVE.
    expect(effectiveContractStatus("ACTIVE", LONG_AGO, edge, NOW)).toBe("ACTIVE");
  });

  it("ignores the time of day on both sides of every comparison", () => {
    // Both ends are normalised to UTC midnight, so a contract created at 23:00
    // local does not read as expired an hour later.
    const lateInTheDay = new Date("2026-03-14T23:59:59.999Z");
    expect(effectiveContractStatus("ACTIVE", LONG_AGO, utc("2026-03-14"), lateInTheDay)).toBe(
      "EXPIRING",
    );
  });

  it("only ever returns a member of the display vocabulary", () => {
    for (const status of CONTRACT_STATUSES) {
      const result = effectiveContractStatus(status, LONG_AGO, FAR_FUTURE, NOW);
      expect(CONTRACT_DISPLAY_STATUSES).toContain(result);
    }
  });
});

describe("contractStatusQueryFragment", () => {
  it("is exhaustive over the display vocabulary", () => {
    for (const status of CONTRACT_DISPLAY_STATUSES) {
      // A missing branch would fall out of the switch and return undefined,
      // which the DAL would happily spread into an unfiltered query.
      expect(contractStatusQueryFragment(status, NOW)).toBeTypeOf("object");
    }
  });

  it("gives the two stored non-ACTIVE states a bare equality and no date term", () => {
    // The query half of the early return. Without this, a suspended contract
    // whose term ran out would match both the SUSPENDED filter and the EXPIRED
    // one — and be counted twice under contradictory badges.
    expect(contractStatusQueryFragment("SUSPENDED", NOW)).toEqual({ status: "SUSPENDED" });
    expect(contractStatusQueryFragment("CANCELLED", NOW)).toEqual({ status: "CANCELLED" });
  });

  it("pins every date-derived branch to status ACTIVE", () => {
    // That equality is what keeps the suspended and cancelled rows out of all
    // four date branches.
    for (const status of ["UPCOMING", "ACTIVE", "EXPIRING", "EXPIRED"] as const) {
      expect(contractStatusQueryFragment(status, NOW)).toMatchObject({ status: "ACTIVE" });
    }
  });

  it("carries a startDate term on EXPIRED, mirroring the branch precedence", () => {
    // Redundant on well-formed data — a contract that ended must have started —
    // but it is what stops a corrupt pair matching both UPCOMING and EXPIRED
    // while its badge says UPCOMING.
    expect(contractStatusQueryFragment("EXPIRED", NOW)).toHaveProperty("startDate");
  });

  it("builds only plain comparison operators over the three stored columns", () => {
    const allowedKeys = new Set(["status", "startDate", "endDate"]);
    const allowedOperators = new Set(["$gt", "$gte", "$lt", "$lte"]);

    for (const status of CONTRACT_DISPLAY_STATUSES) {
      const fragment = contractStatusQueryFragment(status, NOW);

      for (const [key, value] of Object.entries(fragment)) {
        expect(allowedKeys).toContain(key);
        if (typeof value === "object" && value !== null) {
          for (const operator of Object.keys(value)) {
            expect(allowedOperators).toContain(operator);
          }
        }
      }

      // The fragment goes into the DAL's TRUSTED `where` channel, so what is
      // NOT in it matters as much as what is.
      const serialised = JSON.stringify(fragment);
      expect(serialised).not.toContain("$where");
      expect(serialised).not.toContain("$expr");
      expect(serialised).not.toContain("$function");
    }
  });

  it("uses the same window as the branch it mirrors", () => {
    const expiring = contractStatusQueryFragment("EXPIRING", NOW) as {
      endDate: { $gte: Date; $lt: Date };
    };
    const active = contractStatusQueryFragment("ACTIVE", NOW) as { endDate: { $gte: Date } };

    // EXPIRING ends exactly where ACTIVE begins: half-open, no gap, no overlap.
    expect(expiring.endDate.$lt.getTime()).toBe(active.endDate.$gte.getTime());

    const days = (expiring.endDate.$lt.getTime() - expiring.endDate.$gte.getTime()) / 86_400_000;
    expect(days).toBe(EXPIRING_WINDOW_DAYS);
  });

  it("narrows to whole UTC days regardless of the time it is called at", () => {
    const morning = contractStatusQueryFragment("EXPIRED", new Date("2026-03-14T00:00:01.000Z"));
    const evening = contractStatusQueryFragment("EXPIRED", new Date("2026-03-14T23:59:59.000Z"));
    expect(morning).toEqual(evening);
  });
});

describe("the two halves cover the same ground", () => {
  it.each(CONTRACT_DISPLAY_STATUSES)(
    "%s is produced by the branch and asked for by the fragment",
    (status: ContractDisplayStatus) => {
      // A display status the fragment can filter for but the branch can never
      // return would be a filter that always comes back empty; the reverse would
      // be a badge nothing can be filtered by. Both are silent failures.
      expect(CONTRACT_DISPLAY_STATUSES).toContain(status);
      expect(contractStatusQueryFragment(status, NOW)).toBeDefined();
    },
  );
});
