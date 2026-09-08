import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "@/lib/auth/session";
import { contractsRepository, getScope, type TenantScope } from "@/lib/db";
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from "@/lib/db/__tests__/helpers/memory-mongo";
import {
  CONTRACT_DISPLAY_STATUSES,
  EXPIRING_WINDOW_DAYS,
  contractStatusQueryFragment,
  effectiveContractStatus,
  type ContractDisplayStatus,
} from "@/lib/domain/amc";
import { addUtcDays, startOfUtcDay } from "@/lib/domain/dates";

/**
 * The bridge between the status a person filters by and the three columns the
 * database actually stores.
 *
 * `UPCOMING`, `EXPIRING` and `EXPIRED` are not values any row holds — they are
 * `ACTIVE` plus a date on one side or another of today — so the list translates
 * the filter into a range query (`contractStatusQueryFragment`) while each row's
 * badge comes from a branch (`effectiveContractStatus`). Those are one rule
 * written twice, and a disagreement between them is invisible: the page simply
 * shows the wrong rows, with confident badges, and nothing throws.
 *
 * So the invariant asserted throughout is the strong form: **every row a status
 * filter returns carries that status, and every row it omits does not.** An
 * assertion that only counted rows would pass just as well if the query and the
 * badge were wrong in the same direction.
 *
 * Run against a real mongod, because the question is what MongoDB returns for a
 * `$lt`/`$gte` on a Date, not what filter object we believe we built. It goes
 * through the repository rather than `listContractsForScope`, which cannot be
 * imported here: that module pulls `requireRole` and therefore next-auth, which
 * does not resolve under vitest. The fragment and the repository are the two
 * halves that carry the behaviour, and both are exercised as the query layer
 * uses them — code-authored fragment in `where`, untrusted values in `filter`.
 */

/**
 * Ids as 24-hex strings, not driver objects.
 *
 * The dal-boundary lint rule forbids importing mongoose anywhere outside
 * `src/lib/db/**`, and a test is feature code too. The DAL casts a hex string on
 * the way in, which is exactly what a request carries.
 */
const ORG = "0123456789abcdef0000010a";
const OTHER_ORG = "0123456789abcdef0000010b";
const USER = "0123456789abcdef0000010c";

const ACME = "0123456789abcdef00000201";
const ZENITH = "0123456789abcdef00000202";

function staffSession(organizationId: string): AppSession {
  return { user: { id: USER, role: "FM_MANAGER", organizationId } };
}

function clientSession(organizationId: string, clientId: string): AppSession {
  return { user: { id: USER, role: "CLIENT", organizationId, clientId } };
}

const scope: TenantScope = getScope(staffSession(ORG));
const otherScope: TenantScope = getScope(staffSession(OTHER_ORG));
const acmeScope: TenantScope = getScope(clientSession(ORG, ACME));

/** Fixed "today", so the fixtures below sit at known distances from it. */
const NOW = new Date("2026-03-14T09:00:00.000Z");
const TODAY = startOfUtcDay(NOW);
const day = (offset: number) => addUtcDays(TODAY, offset);

const UNIT = 100_000;

/**
 * One row on each side of every boundary the filter has to get right.
 *
 * The two that matter most: a contract ENDING today is still in force (the whole
 * of the last day belongs to it), and the expiring window is half-open, so day
 * 60 is already back to plain ACTIVE.
 */
const FIXTURES = [
  { number: "starts-tomorrow", start: 1, end: 400, status: "ACTIVE" as const },
  { number: "starts-today", start: 0, end: 400, status: "ACTIVE" as const },
  { number: "ended-yesterday", start: -400, end: -1, status: "ACTIVE" as const },
  { number: "ends-today", start: -400, end: 0, status: "ACTIVE" as const },
  {
    number: "last-expiring-day",
    start: -100,
    end: EXPIRING_WINDOW_DAYS - 1,
    status: "ACTIVE" as const,
  },
  { number: "window-edge", start: -100, end: EXPIRING_WINDOW_DAYS, status: "ACTIVE" as const },
  { number: "far-future", start: -100, end: 900, status: "ACTIVE" as const },
  // Stored non-ACTIVE rows with dates that WOULD make them expired or active.
  // The date-derived filters must not pick either of them up.
  { number: "suspended-and-ended", start: -400, end: -5, status: "SUSPENDED" as const },
  { number: "cancelled-but-live", start: -100, end: 400, status: "CANCELLED" as const },
] as const;

/** Read the list the way `listContractsForScope` does: `where` for the fragment. */
async function listWith(status: ContractDisplayStatus, on: TenantScope = scope) {
  return contractsRepository.forScope(on).find(undefined, {
    where: contractStatusQueryFragment(status, NOW),
    limit: 100,
  });
}

/** The badge each row would render, from the branch half of the rule. */
function badgeOf(row: {
  status: "ACTIVE" | "SUSPENDED" | "CANCELLED";
  startDate: Date;
  endDate: Date;
}): ContractDisplayStatus {
  return effectiveContractStatus(row.status, row.startDate, row.endDate, NOW);
}

beforeAll(async () => {
  await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const contracts = contractsRepository.forScope(scope);

  for (const fixture of FIXTURES) {
    const created = await contracts.create({
      clientId: ACME,
      contractNumber: fixture.number,
      title: fixture.number,
      type: "COMPREHENSIVE",
      value: UNIT,
      startDate: day(fixture.start),
      endDate: day(fixture.end),
      compliance: 100,
    });

    if (fixture.status !== "ACTIVE") {
      await contracts.update(created._id, { status: fixture.status });
    }
  }

  // Another client in the same tenant, and another tenant entirely — so a filter
  // that widened has something to leak.
  await contracts.create({
    clientId: ZENITH,
    contractNumber: "zenith-live",
    title: "zenith-live",
    type: "LABOUR_ONLY",
    value: UNIT,
    startDate: day(-100),
    endDate: day(900),
    compliance: 100,
  });

  await contractsRepository.forScope(otherScope).create({
    clientId: ACME,
    contractNumber: "other-org",
    title: "other-org",
    type: "COMPREHENSIVE",
    value: UNIT,
    startDate: day(-100),
    endDate: day(900),
    compliance: 100,
  });
});

// ---------------------------------------------------------------------------

describe("each filter returns exactly the rows whose badge agrees", () => {
  it.each(CONTRACT_DISPLAY_STATUSES)("%s", async (status: ContractDisplayStatus) => {
    const returned = await listWith(status);
    const all = await contractsRepository.forScope(scope).find(undefined, { limit: 100 });

    const returnedNumbers = returned.map((row) => row.contractNumber).sort();
    const expectedNumbers = all
      .filter((row) => badgeOf(row) === status)
      .map((row) => row.contractNumber)
      .sort();

    // Both directions in one assertion: nothing returned that disagrees, and
    // nothing omitted that agrees.
    expect(returnedNumbers).toEqual(expectedNumbers);
  });
});

describe("the six statuses partition the list", () => {
  it("returns every row exactly once across all six filters", async () => {
    const seen: string[] = [];

    for (const status of CONTRACT_DISPLAY_STATUSES) {
      const rows = await listWith(status);
      seen.push(...rows.map((row) => row.contractNumber));
    }

    const all = await contractsRepository.forScope(scope).find(undefined, { limit: 100 });

    // No row twice — the reason `EXPIRED` carries a startDate term it does not
    // strictly need — and none missing.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(all.map((row) => row.contractNumber).sort());
  });
});

describe("the stored statuses win over the clock", () => {
  it("does not report a suspended contract as expired, though its term ran out", async () => {
    const expired = await listWith("EXPIRED");
    expect(expired.map((row) => row.contractNumber)).not.toContain("suspended-and-ended");

    // And it IS reachable, by the filter that should find it.
    const suspended = await listWith("SUSPENDED");
    expect(suspended.map((row) => row.contractNumber)).toContain("suspended-and-ended");
  });

  it("keeps a cancelled contract out of every date-derived filter", async () => {
    for (const status of ["UPCOMING", "ACTIVE", "EXPIRING", "EXPIRED"] as const) {
      const rows = await listWith(status);
      expect(rows.map((row) => row.contractNumber)).not.toContain("cancelled-but-live");
    }

    const cancelled = await listWith("CANCELLED");
    expect(cancelled.map((row) => row.contractNumber)).toContain("cancelled-but-live");
  });
});

describe("the day boundaries", () => {
  it("treats a contract ending today as expiring, not expired", async () => {
    const expiring = await listWith("EXPIRING");
    const expired = await listWith("EXPIRED");

    expect(expiring.map((row) => row.contractNumber)).toContain("ends-today");
    expect(expired.map((row) => row.contractNumber)).toContain("ended-yesterday");
    expect(expired.map((row) => row.contractNumber)).not.toContain("ends-today");
  });

  it("treats a contract starting today as active, not upcoming", async () => {
    const upcoming = await listWith("UPCOMING");
    const numbers = upcoming.map((row) => row.contractNumber);

    expect(numbers).toContain("starts-tomorrow");
    expect(numbers).not.toContain("starts-today");
  });

  it("closes the expiring window half-open at day 60", async () => {
    const expiring = (await listWith("EXPIRING")).map((row) => row.contractNumber);
    const active = (await listWith("ACTIVE")).map((row) => row.contractNumber);

    expect(expiring).toContain("last-expiring-day");
    expect(expiring).not.toContain("window-edge");
    expect(active).toContain("window-edge");
  });
});

describe("the filter is layered on the scope, never instead of it", () => {
  it("stays inside the tenant, filter or no filter", async () => {
    for (const status of CONTRACT_DISPLAY_STATUSES) {
      const rows = await listWith(status);
      expect(rows.map((row) => row.contractNumber)).not.toContain("other-org");
    }

    const unfiltered = await contractsRepository.forScope(scope).find(undefined, { limit: 100 });
    expect(unfiltered.map((row) => row.contractNumber)).not.toContain("other-org");
  });

  it("narrows to one client for a client session", async () => {
    const staffActive = await listWith("ACTIVE");
    const clientActive = await listWith("ACTIVE", acmeScope);

    // Zenith's live contract is ACTIVE for staff and invisible to Acme — the
    // scope keys are applied after the fragment, so the two compose.
    expect(staffActive.map((row) => row.contractNumber)).toContain("zenith-live");
    expect(clientActive.map((row) => row.contractNumber)).not.toContain("zenith-live");
    expect(clientActive.map((row) => row.contractNumber)).toContain("far-future");
  });

  it("combines a status with an untrusted filter rather than replacing it", async () => {
    // `type` goes in the sanitized `filter` channel; the status fragment goes in
    // the trusted `where` one. Both must apply.
    const rows = await contractsRepository.forScope(scope).find(
      { type: "LABOUR_ONLY" },
      { where: contractStatusQueryFragment("ACTIVE", NOW), limit: 100 },
    );

    expect(rows.map((row) => row.contractNumber)).toEqual(["zenith-live"]);
  });
});
