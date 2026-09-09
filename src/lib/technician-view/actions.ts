"use server";

import { revalidatePath } from "next/cache";

import {
  attendanceRepository,
  connectToDatabase,
  findAttendanceForDay,
  type AttendanceDocument,
} from "@/lib/db";
import {
  attendanceDayOf,
  isUsableFix,
  MAX_SHIFT_MINUTES,
  shiftMinutes,
  type Coordinates,
} from "@/lib/domain/attendance";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { checkInSchema, checkOutSchema } from "./schemas";
import {
  loadMyJobsForScope,
  MY_JOBS_ROLES,
  resolveOwnTechnician,
  type MyJobsData,
} from "./queries";

/**
 * Check in, check out.
 *
 * Two rules carry this module, and both are about not recording things that did
 * not happen:
 *
 *  1. **Consent gates location, always.** Coordinates are only accepted
 *     alongside `consent: true`, and a payload carrying a position without one
 *     is REFUSED rather than quietly stored without it. The consent flag is
 *     written onto the record, so "we had permission" is a stored fact rather
 *     than an assumption about the code that ran.
 *  2. **Timestamps come from the server.** There is no field on either payload
 *     for a time. A phone can be wrong by hours and can be set deliberately;
 *     an attendance record is evidence, and evidence a phone can choose is not
 *     evidence.
 *
 * The technician is resolved from the SESSION, never from the payload — neither
 * schema has a `technicianId`, so there is no wire representation for checking
 * somebody else in.
 */

const REVALIDATE_PATH = "/[locale]/app/my-jobs";

/**
 * The position to store, after the consent and quality gates.
 *
 * A fix coarser than `MAX_ACCEPTABLE_ACCURACY_METRES` is DROPPED rather than
 * refused: the check-in itself is legitimate and must not fail because the
 * technician is standing in a plant room with no sky. What is refused is
 * storing a city-sized guess as if it were a position.
 */
function locationToStore(input: { consent: boolean; coordinates?: Coordinates }) {
  if (!input.consent || !input.coordinates) return null;
  return isUsableFix(input.coordinates) ? input.coordinates : null;
}

const runCheckIn = defineAction({
  name: "checkIn",
  roles: MY_JOBS_ROLES,
  input: checkInSchema,
  async handler({ input, scope, user }): Promise<MyJobsData> {
    await connectToDatabase();

    const technician = await resolveOwnTechnician(scope, user);
    if (!technician) {
      throw new ValidationError(`user ${user.id} has no technician record`, {
        _: "This login is not linked to a technician record yet.",
      });
    }

    const now = new Date();
    const day = attendanceDayOf(now);

    const existing = await findAttendanceForDay(scope, technician._id, day);

    /**
     * Already checked in and not out — the ordinary double-tap on a flaky
     * connection. Refused rather than overwriting the original stamp, which
     * would quietly move the start of somebody's shift.
     */
    if (existing?.checkInAt && !existing.checkOutAt) {
      throw new ValidationError(`technician ${technician._id.toHexString()} is already on site`, {
        _: "You are already checked in.",
      });
    }

    /**
     * Already checked out today. Also refused: a second shift on one day is a
     * real thing, and it needs a data model with shifts in it rather than a
     * second overwrite of the same row.
     */
    if (existing?.checkOutAt) {
      throw new ValidationError(`technician ${technician._id.toHexString()} already finished`, {
        _: "You have already checked out today.",
      });
    }

    const location = locationToStore(input);

    if (existing) {
      await attendanceRepository.forScope(scope).update(existing._id, {
        checkInAt: now,
        checkInLocation: location,
        consentGiven: input.consent,
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
    } else {
      await attendanceRepository.forScope(scope).create({
        technicianId: technician._id,
        userId: user.id,
        day,
        checkInAt: now,
        checkInLocation: location,
        consentGiven: input.consent,
        note: input.note ?? null,
      });
    }

    revalidatePath(REVALIDATE_PATH, "page");
    // The whole screen back, so the client replaces state rather than patching
    // it — the job list can change between renders and a partial update would
    // leave a stale one beside a fresh shift.
    return loadMyJobsForScope(scope, user, now);
  },
});

const runCheckOut = defineAction({
  name: "checkOut",
  roles: MY_JOBS_ROLES,
  input: checkOutSchema,
  async handler({ input, scope, user }): Promise<MyJobsData> {
    await connectToDatabase();

    const technician = await resolveOwnTechnician(scope, user);
    if (!technician) {
      throw new ValidationError(`user ${user.id} has no technician record`, {
        _: "This login is not linked to a technician record yet.",
      });
    }

    const now = new Date();
    const day = attendanceDayOf(now);

    const existing: AttendanceDocument | null = await findAttendanceForDay(
      scope,
      technician._id,
      day,
    );

    if (!existing?.checkInAt) {
      throw new ValidationError(`technician ${technician._id.toHexString()} is not checked in`, {
        _: "You are not checked in.",
      });
    }

    if (existing.checkOutAt) {
      throw new ValidationError(`technician ${technician._id.toHexString()} already checked out`, {
        _: "You have already checked out.",
      });
    }

    /**
     * A shift longer than sixteen hours is a forgotten check-in rather than a
     * long day, and recording it puts a false number into every report that
     * reads attendance. Refused with a message that says what to do about it,
     * because the fix is a supervisor correcting the record and not the
     * technician tapping again.
     */
    const minutes = shiftMinutes({ checkInAt: existing.checkInAt, checkOutAt: now });
    if (minutes !== null && minutes > MAX_SHIFT_MINUTES) {
      throw new ValidationError(
        `shift of ${minutes} minutes exceeds the ${MAX_SHIFT_MINUTES} minute cap`,
        { _: "This shift is too long to close automatically. Ask your supervisor to correct it." },
      );
    }

    const updated = await attendanceRepository.forScope(scope).update(existing._id, {
      checkOutAt: now,
      checkOutLocation: locationToStore(input),
      // Consent is per-record and the check-out is a second capture, so an
      // agreement given now is recorded now. It is never turned OFF here: a
      // position already stored under consent stays stored under consent.
      ...(input.consent ? { consentGiven: true } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });

    if (!updated) throw new NotFoundError("attendance record not in scope");

    revalidatePath(REVALIDATE_PATH, "page");
    return loadMyJobsForScope(scope, user, now);
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export async function checkInAction(payload: unknown): Promise<ActionResult<MyJobsData>> {
  return runCheckIn(payload);
}

export async function checkOutAction(payload: unknown): Promise<ActionResult<MyJobsData>> {
  return runCheckOut(payload);
}
