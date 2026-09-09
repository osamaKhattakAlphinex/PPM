import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { attendanceDayOf, attendanceStatusOf } from "../../domain/attendance";
import { addUtcDays } from "../../domain/dates";
import {
  attendanceRepository,
  findAttendanceForDay,
  listAttendanceForDay,
} from "../repositories/attendance";
import { getScope, ScopeResolutionError, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * Attendance, against a real mongod.
 *
 * Two guarantees, and they are different in kind:
 *
 *  1. **Tenant isolation**, as everywhere: one organisation cannot read or
 *     write another's records even holding the right `_id`.
 *  2. **A customer cannot reach this collection at all.** `Attendance` has no
 *     `clientId` and is not `sharedWithClients`, so the DAL REFUSES a
 *     client-scoped session rather than widening it to the organisation — the
 *     fail-closed direction. Asserted here by the throw, because "a client sees
 *     nothing" and "a client is refused" look identical from a caller that only
 *     checks for an empty array.
 *
 * The uniqueness constraint gets its own block: "one record per technician per
 * day" is what makes a check-out able to find the check-in it is closing, and
 * it is enforced by a partial unique index rather than by the action's own
 * read-then-write, which a race can defeat.
 */

const ORG_A = new Types.ObjectId();
const ORG_B = new Types.ObjectId();
const CLIENT = new Types.ObjectId();

const TECH_A1 = new Types.ObjectId();
const TECH_A2 = new Types.ObjectId();

function staffSession(organizationId: Types.ObjectId): AppSession {
  return {
    user: {
      id: new Types.ObjectId().toHexString(),
      role: "SUPERVISOR",
      organizationId: organizationId.toHexString(),
    },
  };
}

function clientSession(organizationId: Types.ObjectId): AppSession {
  return {
    user: {
      id: new Types.ObjectId().toHexString(),
      role: "CLIENT",
      organizationId: organizationId.toHexString(),
      clientId: CLIENT.toHexString(),
    },
  };
}

const staffA: TenantScope = getScope(staffSession(ORG_A));
const staffB: TenantScope = getScope(staffSession(ORG_B));
const customer: TenantScope = getScope(clientSession(ORG_A));

const NOW = new Date("2026-03-14T06:00:00.000Z");
const TODAY = attendanceDayOf(NOW);

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  await attendanceRepository.forScope(staffA).create({
    technicianId: TECH_A1,
    day: TODAY,
    checkInAt: NOW,
    consentGiven: false,
  });

  // Another tenant's record on the same day, so every cross-org assertion has
  // something real to fail against.
  await attendanceRepository.forScope(staffB).create({
    technicianId: new Types.ObjectId(),
    day: TODAY,
    checkInAt: NOW,
    consentGiven: false,
  });
});

describe("tenant isolation", () => {
  it("does not serve another organisation's record", async () => {
    const mine = await findAttendanceForDay(staffA, TECH_A1, TODAY);
    expect(mine).not.toBeNull();

    expect(await findAttendanceForDay(staffB, TECH_A1, TODAY)).toBeNull();
  });

  it("does not let another organisation close somebody's shift", async () => {
    const mine = await findAttendanceForDay(staffA, TECH_A1, TODAY);

    const updated = await attendanceRepository
      .forScope(staffB)
      .update(mine!._id, { checkOutAt: new Date() });
    expect(updated).toBeNull();

    const untouched = await findAttendanceForDay(staffA, TECH_A1, TODAY);
    expect(untouched?.checkOutAt).toBeNull();
  });

  it("shows the board only its own tenant", async () => {
    expect(await listAttendanceForDay(staffA, TODAY)).toHaveLength(1);
    expect(await listAttendanceForDay(staffB, TODAY)).toHaveLength(1);
  });
});

describe("a client scope is refused, not narrowed", () => {
  /**
   * The fail-closed direction. Serving a client session here would mean serving
   * it the whole organisation's roster, because there is no `clientId` to
   * narrow by — so the repository refuses instead.
   */
  it("throws rather than returning the organisation's records", () => {
    expect(() => attendanceRepository.forScope(customer).find()).toThrow(ScopeResolutionError);
  });

  /**
   * The named reads guard explicitly rather than letting that throw escape as a
   * 500 three layers down. Both directions are asserted: the guard returns
   * nothing, and the underlying repository would genuinely have thrown.
   */
  it("returns nothing from the named reads", async () => {
    expect(await findAttendanceForDay(customer, TECH_A1, TODAY)).toBeNull();
    expect(await listAttendanceForDay(customer, TODAY)).toEqual([]);
  });
});

describe("one record per technician per day", () => {
  it("refuses a second record for the same technician and day", async () => {
    await expect(
      attendanceRepository.forScope(staffA).create({
        technicianId: TECH_A1,
        day: TODAY,
        checkInAt: NOW,
      }),
    ).rejects.toThrow();
  });

  it("allows the same technician on a different day", async () => {
    const created = await attendanceRepository.forScope(staffA).create({
      technicianId: TECH_A1,
      day: addUtcDays(TODAY, 1),
      checkInAt: NOW,
    });

    expect(created._id).toBeDefined();
  });

  it("allows a different technician on the same day", async () => {
    const created = await attendanceRepository.forScope(staffA).create({
      technicianId: TECH_A2,
      day: TODAY,
      checkInAt: NOW,
    });

    expect(created._id).toBeDefined();
    expect(await listAttendanceForDay(staffA, TODAY)).toHaveLength(2);
  });

  /**
   * The index is PARTIAL on `deletedAt: null`, so a soft-deleted correction
   * does not reserve the day forever.
   */
  it("frees the day when a record is soft-deleted", async () => {
    const existing = await findAttendanceForDay(staffA, TECH_A1, TODAY);
    await attendanceRepository.forScope(staffA).delete(existing!._id);

    const replacement = await attendanceRepository.forScope(staffA).create({
      technicianId: TECH_A1,
      day: TODAY,
      checkInAt: NOW,
    });

    expect(replacement._id.toHexString()).not.toBe(existing!._id.toHexString());
  });
});

describe("the stored record", () => {
  it("stores no location and no consent by default", async () => {
    const record = await findAttendanceForDay(staffA, TECH_A1, TODAY);

    expect(record?.consentGiven).toBe(false);
    expect(record?.checkInLocation ?? null).toBeNull();
    expect(record?.checkOutLocation ?? null).toBeNull();
  });

  it("round-trips a consented position as a pair", async () => {
    const created = await attendanceRepository.forScope(staffA).create({
      technicianId: TECH_A2,
      day: TODAY,
      checkInAt: NOW,
      consentGiven: true,
      checkInLocation: { latitude: 24.7136, longitude: 46.6753, accuracy: 12 },
    });

    const read = await findAttendanceForDay(staffA, TECH_A2, TODAY);
    expect(read?._id.toHexString()).toBe(created._id.toHexString());
    expect(read?.consentGiven).toBe(true);
    expect(read?.checkInLocation?.latitude).toBeCloseTo(24.7136, 4);
    expect(read?.checkInLocation?.longitude).toBeCloseTo(46.6753, 4);
  });

  it("reads its status from the two timestamps", async () => {
    const open = await findAttendanceForDay(staffA, TECH_A1, TODAY);
    expect(attendanceStatusOf(open)).toBe("ON_SITE");

    await attendanceRepository
      .forScope(staffA)
      .update(open!._id, { checkOutAt: new Date("2026-03-14T15:00:00.000Z") });

    const closed = await findAttendanceForDay(staffA, TECH_A1, TODAY);
    expect(attendanceStatusOf(closed)).toBe("CHECKED_OUT");
  });
});
