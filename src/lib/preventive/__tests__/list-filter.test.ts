import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "@/lib/auth/session";
import {
  getScope,
  ppmSchedulesRepository,
  requireObjectId,
  type TenantScope,
} from "@/lib/db";
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from "@/lib/db/__tests__/helpers/memory-mongo";
import {
  effectiveStatus,
  statusQueryFragment,
  type PpmDisplayStatus,
} from "@/lib/domain/preventive";

/**
 * The bridge between the status a person filters by and the two columns the
 * database actually stores.
 *
 * `UPCOMING` and `OVERDUE` are not values any row holds — they are `SCHEDULED`
 * plus a date on one side or the other of today — so the list translates the
 * filter into a range query (`statusQueryFragment`) while each row's badge comes
 * from a branch (`effectiveStatus`). Those are one rule written twice, and a
 * disagreement between them is invisible: the page simply shows the wrong rows,
 * with confident badges, and nothing throws.
 *
 * So the invariant asserted throughout is the strong form: **every row a status
 * filter returns carries that status, and every row it omits does not.** An
 * assertion that only counted rows would pass just as well if the query and the
 * badge were wrong in the same direction.
 *
 * Run against a real mongod, because the question is what MongoDB returns for a
 * `$lt`/`$gte` on a Date, not what filter object we believe we built. It goes
 * through the repository rather than `listPpmSchedulesForScope`, which cannot be
 * imported here: that module pulls `requireRole` and therefore next-auth, which
 * does not resolve under vitest. The fragment and the repository are the two
 * halves that carry the behaviour, and both are exercised as the query layer
 * uses them — code-authored fragment in `where`, untrusted values in `filter`.
 */

/**
 * Ids as 24-hex strings, not driver objects.
 *
 * The dal-boundary lint rule forbids importing mongoose anywhere outside
 * `src/lib/db/**`, and a test is feature code too — if it needed the driver to
 * exercise the repository, so would the module under test. The DAL casts a hex
 * string on the way in, which is exactly what a request carries.
 */
const ORG = "0123456789abcdef0000000a";
const OTHER_ORG = "0123456789abcdef0000000b";
const USER = "0123456789abcdef0000000c";

function staffSession(organizationId: string): AppSession {
  return {
    user: { id: USER, role: "FM_MANAGER", organizationId },
  };
}

const scope: TenantScope = getScope(staffSession(ORG));
const otherScope: TenantScope = getScope(staffSession(OTHER_ORG));

const ASSET = "0123456789abcdef00000001";
const TECHNICIAN = "0123456789abcdef00000002";
const OTHER_TECHNICIAN = "0123456789abcdef00000003";

/** Fixed "today", so the fixtures below sit at known distances from it. */
const NOW = new Date("2026-03-14T09:00:00.000Z");
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * One row on each side of every boundary the filter has to get right.
 *
 * `dueToday` and `windowEdge` are the two that matter most: due today is NOT
 * late (the technician has the whole day), and the upcoming window is half-open,
 * so the seventh day out is already back to plain SCHEDULED.
 */
const FIXTURES = {
  longOverdue: utc("2026-01-05"),
  justOverdue: utc("2026-03-13"),
  dueToday: utc("2026-03-14"),
  lastUpcomingDay: utc("2026-03-20"),
  windowEdge: utc("2026-03-21"),
  farFuture: utc("2026-09-01"),
} as const;

beforeAll(async () => {
  await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const schedules = ppmSchedulesRepository.forScope(scope);

  for (const dueDate of Object.values(FIXTURES)) {
    await schedules.create({ assetId: ASSET, type: "MONTHLY", dueDate, technicianId: TECHNICIAN });
  }

  // One started and one finished, both dated long ago — so the date-derived
  // filters have something they must NOT pick up despite the past due date.
  const started = await schedules.create({
    assetId: ASSET,
    type: "WEEKLY",
    dueDate: utc("2026-02-01"),
    technicianId: OTHER_TECHNICIAN,
  });
  await schedules.update(started._id, { status: "IN_PROGRESS", startedAt: NOW });

  const finished = await schedules.create({
    assetId: ASSET,
    type: "ANNUAL",
    dueDate: utc("2026-02-02"),
    technicianId: OTHER_TECHNICIAN,
  });
  await schedules.update(finished._id, { status: "COMPLETED", completedAt: NOW });
});

/**
 * The query the list runs, minus the name resolution and the DTO mapping.
 *
 * The split between `filter` and `where` mirrors `listPpmSchedulesForScope`
 * exactly, and it is the security-relevant half: untrusted request values go in
 * `filter`, which the DAL sanitizes and refuses operators in, while the
 * code-authored status fragment goes in `where`.
 */
async function listWith(
  usingScope: TenantScope,
  params: { status?: PpmDisplayStatus; technicianId?: string } = {},
) {
  return ppmSchedulesRepository.forScope(usingScope).paginate({
    filter: params.technicianId ? { technicianId: requireObjectId(params.technicianId) } : {},
    where: params.status ? statusQueryFragment(params.status, NOW) : undefined,
    sort: { dueDate: 1 },
  });
}

/** The due dates a filter returned, as plain `YYYY-MM-DD`, in page order. */
async function dueDatesFor(status?: PpmDisplayStatus) {
  const page = await listWith(scope, { status });
  return page.items.map((item) => item.dueDate.toISOString().slice(0, 10));
}

describe("the derived-status filter", () => {
  it("returns everything when no status is given, soonest first", async () => {
    const page = await listWith(scope);

    expect(page.total).toBe(8);
    // Sorted by dueDate ascending — the top of this list is what is most late.
    const times = page.items.map((item) => item.dueDate.getTime());
    expect([...times]).toEqual([...times].sort((a, b) => a - b));
  });

  it("returns exactly the rows whose badge says OVERDUE", async () => {
    expect(await dueDatesFor("OVERDUE")).toEqual(["2026-01-05", "2026-03-13"]);
  });

  it("does not call a visit due today overdue", async () => {
    expect(await dueDatesFor("OVERDUE")).not.toContain("2026-03-14");
    expect(await dueDatesFor("UPCOMING")).toContain("2026-03-14");
  });

  it("returns exactly the rows whose badge says UPCOMING", async () => {
    expect(await dueDatesFor("UPCOMING")).toEqual(["2026-03-14", "2026-03-20"]);
  });

  it("puts the far side of the seven-day window back into SCHEDULED", async () => {
    expect(await dueDatesFor("SCHEDULED")).toEqual(["2026-03-21", "2026-09-01"]);
  });

  /**
   * The whole point, stated as one assertion.
   *
   * A page containing a row its own filter excludes would mean the range query
   * and `effectiveStatus()` had drifted apart — exactly the bug that would never
   * be noticed, because both halves look right in isolation.
   */
  it.each(["SCHEDULED", "UPCOMING", "OVERDUE", "IN_PROGRESS", "COMPLETED"] as const)(
    "never returns a row whose own badge disagrees with the %s filter",
    async (status) => {
      const page = await listWith(scope, { status });

      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        expect(
          effectiveStatus(item.status, item.dueDate, NOW),
          item.dueDate.toISOString(),
        ).toBe(status);
      }
    },
  );

  /**
   * The other direction: the five filters PARTITION the collection. Together
   * they return every row exactly once, so no schedule can hide from every
   * filter — which a badge-agreement test alone would not catch.
   */
  it("partitions the whole list between the five statuses", async () => {
    const seen: string[] = [];

    for (const status of [
      "SCHEDULED",
      "UPCOMING",
      "OVERDUE",
      "IN_PROGRESS",
      "COMPLETED",
    ] as const) {
      const page = await listWith(scope, { status });
      seen.push(...page.items.map((item) => item._id.toHexString()));
    }

    const all = await listWith(scope);
    expect(new Set(seen).size).toBe(seen.length); // no row counted twice
    expect(seen.sort()).toEqual(all.items.map((item) => item._id.toHexString()).sort());
  });

  it("keeps started and completed visits out of the date-derived filters", async () => {
    for (const status of ["SCHEDULED", "UPCOMING", "OVERDUE"] as const) {
      const page = await listWith(scope, { status });
      for (const item of page.items) expect(item.status).toBe("SCHEDULED");
    }

    // ...and they are reachable under their own statuses, so the exclusions
    // above are not just "the rows were never written".
    expect(await dueDatesFor("IN_PROGRESS")).toEqual(["2026-02-01"]);
    expect(await dueDatesFor("COMPLETED")).toEqual(["2026-02-02"]);
  });

  it("combines a status with the other filters rather than replacing them", async () => {
    // The only IN_PROGRESS row belongs to the OTHER technician, so narrowing by
    // this one must empty the page — proving the untrusted `filter` and the
    // code-authored `where` are both applied, not one or the other.
    const mine = await listWith(scope, { status: "IN_PROGRESS", technicianId: TECHNICIAN });
    expect(mine.total).toBe(0);

    const theirs = await listWith(scope, {
      status: "IN_PROGRESS",
      technicianId: OTHER_TECHNICIAN,
    });
    expect(theirs.total).toBe(1);
  });

  /**
   * The status fragment is a `where`, and `where` is applied BEFORE the scope
   * keys — so it must not be able to reach another tenant however it is written.
   */
  it("stays inside the tenant, filter or no filter", async () => {
    for (const status of [undefined, "OVERDUE" as const, "COMPLETED" as const]) {
      const page = await listWith(otherScope, { status });
      expect(page.total, String(status)).toBe(0);
    }

    // The rows exist and belong to the other organization.
    expect((await listWith(scope)).total).toBe(8);
  });
});
