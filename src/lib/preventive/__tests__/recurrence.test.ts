import { describe, expect, it } from "vitest";

import {
  effectiveStatus,
  nextDueDate,
  planNextOccurrence,
  startOfUtcDay,
  UPCOMING_WINDOW_DAYS,
  type PpmFrequency,
} from "@/lib/domain/preventive";

/**
 * The two pure functions the module's whole reading of "what needs doing" rests
 * on, tested without a database.
 *
 * These matter more than a normal date helper because nothing else in the stack
 * checks them. A wrong bound in `effectiveStatus` does not throw, does not fail
 * a schema and does not fail a query — it silently shows a supervisor that
 * nothing is late. And `nextDueDate` has no caller yet, so a bug in it would sit
 * undetected until the day recurrence is switched on and the whole calendar
 * drifts.
 */

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const ASSET_ID = "0123456789abcdef01234567";
const TECHNICIAN_ID = "0123456789abcdef01234568";

// ---------------------------------------------------------------------------
// startOfUtcDay
// ---------------------------------------------------------------------------

describe("startOfUtcDay", () => {
  it("collapses any instant in a day to that day's UTC midnight", () => {
    expect(startOfUtcDay(new Date("2026-03-14T23:59:59.999Z")).toISOString()).toBe(
      "2026-03-14T00:00:00.000Z",
    );
    expect(startOfUtcDay(new Date("2026-03-14T00:00:00.000Z")).toISOString()).toBe(
      "2026-03-14T00:00:00.000Z",
    );
  });

  it("is idempotent, so normalising twice cannot shift a date", () => {
    const once = startOfUtcDay(new Date("2026-03-14T17:30:00.000Z"));
    expect(startOfUtcDay(once).getTime()).toBe(once.getTime());
  });
});

// ---------------------------------------------------------------------------
// effectiveStatus — the boundaries
// ---------------------------------------------------------------------------

describe("effectiveStatus", () => {
  const today = utc("2026-03-14");

  /**
   * The boundary that decides whether anyone is called at 7am. Due TODAY is not
   * late — the technician has the whole day — so the flip is at the start of the
   * due day, not the end of it.
   */
  it("is overdue only once the due day has passed", () => {
    expect(effectiveStatus("SCHEDULED", utc("2026-03-13"), today)).toBe("OVERDUE");
    expect(effectiveStatus("SCHEDULED", utc("2026-03-14"), today)).toBe("UPCOMING");
  });

  it("treats any time on the due day the same as its midnight", () => {
    // A schedule written by a JSON caller at 23:00 must not read as overdue an
    // hour later; both sides of the comparison are normalised.
    const lateInTheDay = new Date("2026-03-14T23:00:00.000Z");
    expect(effectiveStatus("SCHEDULED", lateInTheDay, today)).toBe("UPCOMING");
    expect(effectiveStatus("SCHEDULED", utc("2026-03-14"), new Date("2026-03-14T23:00:00.000Z"))).toBe(
      "UPCOMING",
    );
  });

  it("calls the next seven days upcoming, and anything beyond them scheduled", () => {
    const lastUpcomingDay = utc("2026-03-20"); // today + 6
    const firstScheduledDay = utc("2026-03-21"); // today + 7, the window's edge

    expect(UPCOMING_WINDOW_DAYS).toBe(7);
    expect(effectiveStatus("SCHEDULED", lastUpcomingDay, today)).toBe("UPCOMING");
    expect(effectiveStatus("SCHEDULED", firstScheduledDay, today)).toBe("SCHEDULED");
    expect(effectiveStatus("SCHEDULED", utc("2026-06-01"), today)).toBe("SCHEDULED");
  });

  /**
   * The half of the rule that keeps history honest. A visit someone started or
   * finished was moved by a PERSON, and the clock does not get to move it back —
   * a service completed three weeks late is completed, not overdue.
   */
  it("never lets the clock move a row a person moved", () => {
    const longPast = utc("2020-01-01");
    const longFuture = utc("2030-01-01");

    for (const due of [longPast, longFuture]) {
      expect(effectiveStatus("IN_PROGRESS", due, today)).toBe("IN_PROGRESS");
      expect(effectiveStatus("COMPLETED", due, today)).toBe("COMPLETED");
    }
  });
});

// ---------------------------------------------------------------------------
// nextDueDate
// ---------------------------------------------------------------------------

describe("nextDueDate", () => {
  it("advances by the interval the frequency names", () => {
    const from = utc("2026-03-14");

    const expected: Record<PpmFrequency, string> = {
      DAILY: "2026-03-15",
      WEEKLY: "2026-03-21",
      MONTHLY: "2026-04-14",
      QUARTERLY: "2026-06-14",
      HALF_YEARLY: "2026-09-14",
      ANNUAL: "2027-03-14",
    };

    for (const [type, iso] of Object.entries(expected)) {
      expect(nextDueDate(type as PpmFrequency, from).toISOString(), type).toBe(
        `${iso}T00:00:00.000Z`,
      );
    }
  });

  /**
   * The reason `addUtcMonths` is not `setUTCMonth(month + n)`.
   *
   * The native setter OVERFLOWS: 31 January plus one month becomes 3 March,
   * because there is no 31 February. A monthly PPM that walks forward three days
   * every short month is a calendar that no longer matches the contract it was
   * written from — so the day is clamped to the end of the target month instead.
   */
  it("clamps to the end of a short month instead of overflowing into the next", () => {
    expect(nextDueDate("MONTHLY", utc("2026-01-31")).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    // 2028 is a leap year, so the clamp lands a day later.
    expect(nextDueDate("MONTHLY", utc("2028-01-31")).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    // 31 August + 1 month is 30 September, not 1 October.
    expect(nextDueDate("MONTHLY", utc("2026-08-31")).toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );
    // Quarterly from 30 November lands in December, which is long enough to keep it.
    expect(nextDueDate("QUARTERLY", utc("2026-11-30")).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });

  it("keeps 29 February annual visits on a real date", () => {
    expect(nextDueDate("ANNUAL", utc("2028-02-29")).toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });

  it("always advances, and always lands on a UTC midnight", () => {
    const from = new Date("2026-03-14T18:45:12.345Z");

    for (const type of [
      "DAILY",
      "WEEKLY",
      "MONTHLY",
      "QUARTERLY",
      "HALF_YEARLY",
      "ANNUAL",
    ] as const) {
      const next = nextDueDate(type, from);
      expect(next.getTime(), type).toBeGreaterThan(from.getTime());
      // The time component of the source is discarded, not carried forward.
      expect(next.toISOString().endsWith("T00:00:00.000Z"), type).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// planNextOccurrence
// ---------------------------------------------------------------------------

describe("planNextOccurrence", () => {
  const source = {
    assetId: ASSET_ID,
    type: "MONTHLY" as const,
    dueDate: utc("2026-03-01"),
    technicianId: TECHNICIAN_ID,
  };

  it("carries the asset, frequency and assignee forward and nothing else", () => {
    expect(planNextOccurrence(source)).toEqual({
      assetId: ASSET_ID,
      type: "MONTHLY",
      dueDate: utc("2026-04-01"),
      technicianId: TECHNICIAN_ID,
    });
  });

  /**
   * The rule that stops a schedule walking through the calendar.
   *
   * The next date is measured from the PLANNED due date, not from when the work
   * actually happened. A monthly service due on the 1st and done on the 9th is
   * still due on the 1st next month; measuring from the completion would push it
   * to the 9th, then the 17th, one late visit at a time.
   */
  it("measures from the planned due date, not from when the work happened", () => {
    const doneLate = planNextOccurrence({ ...source, dueDate: utc("2026-03-01") });
    expect(doneLate.dueDate).toEqual(utc("2026-04-01"));

    // Same schedule, same output, regardless of any completion timestamp — the
    // function is not given one, and that is the point.
    expect(Object.keys(planNextOccurrence(source)).sort()).toEqual([
      "assetId",
      "dueDate",
      "technicianId",
      "type",
    ]);
  });

  it("produces a payload the create schema would accept", () => {
    // Ids stay 24-hex strings and the date stays a Date, which is exactly the
    // shape `createPpmScheduleSchema` parses.
    const planned = planNextOccurrence(source);
    expect(planned.assetId).toMatch(/^[0-9a-fA-F]{24}$/);
    expect(planned.technicianId).toMatch(/^[0-9a-fA-F]{24}$/);
    expect(planned.dueDate).toBeInstanceOf(Date);
  });
});
