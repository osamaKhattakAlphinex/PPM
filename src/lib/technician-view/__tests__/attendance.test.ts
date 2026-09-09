import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_STATUSES,
  attendanceDayOf,
  attendanceStatusOf,
  coordinatesSchema,
  isUsableFix,
  MAX_ACCEPTABLE_ACCURACY_METRES,
  MAX_SHIFT_MINUTES,
  shiftMinutes,
} from "@/lib/domain/attendance";
import { checkInSchema, checkOutSchema } from "../schemas";

/**
 * The attendance rules, tested where they live.
 *
 * Two of them are product promises rather than implementation details, and both
 * are asserted directly:
 *
 *  1. **Location is never recorded without consent.** The payload schema
 *     refuses coordinates that arrive without `consent: true` — so the refusal
 *     happens before the handler runs, not inside it.
 *  2. **A phone cannot choose a timestamp.** Neither payload has a field for
 *     one, so there is no wire representation for a check-in at a time the
 *     server did not observe.
 *
 * Pure, so it runs anywhere: no database, no session.
 */

describe("consent gates location", () => {
  const coordinates = { latitude: 24.7136, longitude: 46.6753, accuracy: 12 };

  it("refuses coordinates that arrive without consent", () => {
    for (const schema of [checkInSchema, checkOutSchema]) {
      const result = schema.safeParse({ consent: false, coordinates });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path[0] === "consent")).toBe(true);
      }
    }
  });

  it("accepts coordinates with consent", () => {
    expect(checkInSchema.safeParse({ consent: true, coordinates }).success).toBe(true);
  });

  /** The ordinary case: agreed, but the device could not get a fix. */
  it("accepts consent with no coordinates", () => {
    expect(checkInSchema.safeParse({ consent: true }).success).toBe(true);
  });

  /** And the other ordinary case: declined, so nothing is sent. */
  it("accepts a check-in with neither", () => {
    expect(checkInSchema.safeParse({}).success).toBe(true);
    expect(checkInSchema.parse({}).consent).toBe(false);
  });
});

describe("the payload has no timestamp and no technician", () => {
  /**
   * The strong form of "the server stamps the time": there is no field to send
   * one in. Likewise for the technician — resolving one from the session is
   * only meaningful if a caller cannot name a different one.
   */
  it("refuses every field that would let a caller choose", () => {
    for (const smuggled of [
      "checkInAt",
      "checkOutAt",
      "at",
      "timestamp",
      "technicianId",
      "userId",
      "day",
      "organizationId",
    ]) {
      expect(
        checkInSchema.safeParse({ consent: false, [smuggled]: "2020-01-01" }).success,
        `checkIn accepted ${smuggled}`,
      ).toBe(false);
      expect(
        checkOutSchema.safeParse({ consent: false, [smuggled]: "2020-01-01" }).success,
        `checkOut accepted ${smuggled}`,
      ).toBe(false);
    }
  });

  it("refuses operator-shaped keys", () => {
    expect(checkInSchema.safeParse({ $set: { consent: true } }).success).toBe(false);
  });
});

describe("coordinates", () => {
  it("bounds latitude and longitude to the real world", () => {
    expect(coordinatesSchema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: 0, longitude: 181 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: -90, longitude: 180 }).success).toBe(true);
  });

  it("requires both halves of a position", () => {
    expect(coordinatesSchema.safeParse({ latitude: 24.7 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ longitude: 46.6 }).success).toBe(false);
  });

  it("treats a city-sized fix as unusable and a building-sized one as usable", () => {
    const at = (accuracy: number) => ({ latitude: 24.7, longitude: 46.6, accuracy });

    expect(isUsableFix(at(8))).toBe(true);
    expect(isUsableFix(at(MAX_ACCEPTABLE_ACCURACY_METRES))).toBe(true);
    expect(isUsableFix(at(MAX_ACCEPTABLE_ACCURACY_METRES + 1))).toBe(false);
  });

  /** Some browsers omit accuracy entirely; refusing those would disable GPS. */
  it("accepts a fix with no accuracy reported", () => {
    expect(isUsableFix({ latitude: 24.7, longitude: 46.6, accuracy: null })).toBe(true);
    expect(isUsableFix({ latitude: 24.7, longitude: 46.6 })).toBe(true);
  });
});

describe("attendanceStatusOf", () => {
  const day = new Date("2026-03-14T06:00:00.000Z");
  const later = new Date("2026-03-14T15:00:00.000Z");

  it("reads three states out of two timestamps", () => {
    expect(attendanceStatusOf(null)).toBe("NOT_CHECKED_IN");
    expect(attendanceStatusOf({})).toBe("NOT_CHECKED_IN");
    expect(attendanceStatusOf({ checkInAt: day })).toBe("ON_SITE");
    expect(attendanceStatusOf({ checkInAt: day, checkOutAt: later })).toBe("CHECKED_OUT");
  });

  it("returns a value from the declared vocabulary", () => {
    expect(ATTENDANCE_STATUSES).toContain(attendanceStatusOf({ checkInAt: day }));
  });
});

describe("attendanceDayOf", () => {
  it("normalises any instant in a day to the same UTC midnight", () => {
    const morning = attendanceDayOf(new Date("2026-03-14T05:30:00.000Z"));
    const evening = attendanceDayOf(new Date("2026-03-14T23:59:59.000Z"));

    expect(morning.getTime()).toBe(evening.getTime());
    expect(morning.toISOString()).toBe("2026-03-14T00:00:00.000Z");
  });

  /**
   * The documented cost of a UTC day: 03:00 in Riyadh is the previous day in
   * UTC. The test pins the behaviour so a change to it is deliberate.
   */
  it("puts an early-hours check-in on the UTC day, not the local one", () => {
    // 03:00 Riyadh on the 15th is 00:00 UTC on the 15th.
    expect(attendanceDayOf(new Date("2026-03-15T00:00:00.000Z")).toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
    // 02:00 Riyadh on the 15th is 23:00 UTC on the 14th — the 14th's shift.
    expect(attendanceDayOf(new Date("2026-03-14T23:00:00.000Z")).toISOString()).toBe(
      "2026-03-14T00:00:00.000Z",
    );
  });
});

describe("shiftMinutes", () => {
  it("is null while the shift is open", () => {
    expect(shiftMinutes({})).toBeNull();
    expect(shiftMinutes({ checkInAt: new Date() })).toBeNull();
  });

  it("counts whole minutes", () => {
    expect(
      shiftMinutes({
        checkInAt: new Date("2026-03-14T06:00:00.000Z"),
        checkOutAt: new Date("2026-03-14T14:30:00.000Z"),
      }),
    ).toBe(510);
  });

  /** A clock adjustment must not produce a negative shift. */
  it("clamps a backwards pair to zero", () => {
    expect(
      shiftMinutes({
        checkInAt: new Date("2026-03-14T14:00:00.000Z"),
        checkOutAt: new Date("2026-03-14T06:00:00.000Z"),
      }),
    ).toBe(0);
  });

  it("recognises a forgotten check-in as past the cap", () => {
    const minutes = shiftMinutes({
      checkInAt: new Date("2026-03-10T06:00:00.000Z"),
      checkOutAt: new Date("2026-03-14T06:00:00.000Z"),
    });

    expect(minutes).not.toBeNull();
    expect(minutes!).toBeGreaterThan(MAX_SHIFT_MINUTES);
  });
});
