import { z } from "zod";

import { startOfUtcDay } from "./dates";

/**
 * Attendance: the vocabulary, the coordinate rules, and the pure function that
 * turns a day's record into the status a person sees.
 *
 * Pure — zod and the calendar helper — so the check-in button, the status pill
 * and the model can all import it. The same rule every `src/lib/domain/*` file
 * follows: anything a Client Component imports as a VALUE would drag Mongoose
 * into the browser bundle if it came from `@/lib/db`.
 */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * What a technician's day looks like right now. DERIVED, never stored.
 *
 * Three states out of two timestamps: nothing recorded, checked in and not out,
 * both recorded. Storing a status alongside the timestamps would be a fourth
 * thing to keep consistent and the first to go wrong — a row that says ON_SITE
 * with a `checkOutAt` set is a contradiction the database would happily hold.
 */
export const ATTENDANCE_STATUSES = ["NOT_CHECKED_IN", "ON_SITE", "CHECKED_OUT"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export function attendanceStatusOf(record: {
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
} | null): AttendanceStatus {
  if (!record?.checkInAt) return "NOT_CHECKED_IN";
  return record.checkOutAt ? "CHECKED_OUT" : "ON_SITE";
}

// ---------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------

/**
 * A shift belongs to a DAY, and the day is UTC midnight.
 *
 * The same convention every date in this product follows (see
 * `src/lib/domain/dates.ts`), and here it is what makes "one attendance record
 * per technician per day" a uniqueness constraint the database can enforce: two
 * check-ins four hours apart must resolve to the same key, and they only do if
 * the key is a normalised day rather than an instant.
 *
 * The cost, stated plainly: a night shift that runs past midnight UTC — 03:00 in
 * Riyadh — is recorded against the day it STARTED, because `checkOut` finds the
 * open record rather than computing a fresh key. That is the right answer for a
 * shift and the wrong one for a technician who checks in at 02:00 and out at
 * 10:00 having never worked "yesterday". Correcting it properly means a shift
 * window in the organization's own timezone, which is a real feature and not
 * this one.
 */
export function attendanceDayOf(now: Date): Date {
  return startOfUtcDay(now);
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/**
 * A captured position. Optional everywhere it appears.
 *
 * The product rule from CLAUDE.md is that GPS is captured WITH EXPLICIT CONSENT
 * and never otherwise, so the shape reflects that: the coordinates and the
 * consent flag travel together, and the action refuses coordinates that arrive
 * without one.
 *
 * `accuracy` is metres, as the browser's Geolocation API reports it. Stored
 * because a fix accurate to 3km says something quite different from one
 * accurate to 8m, and a reviewer looking at a check-in months later needs to
 * know which they are looking at.
 */
export const coordinatesSchema = z.strictObject({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  /** Metres. Bounded so a nonsense reading cannot be stored as a number. */
  accuracy: z.coerce.number().min(0).max(100_000).nullable().optional(),
});

export type Coordinates = z.infer<typeof coordinatesSchema>;

/**
 * How coarse a fix may be and still be worth storing.
 *
 * Five kilometres. Beyond that a "position" is an IP-geolocation guess at the
 * city, which is not evidence that anybody was anywhere and is exactly the kind
 * of number that later gets treated as one. Refused rather than stored with a
 * caveat.
 */
export const MAX_ACCEPTABLE_ACCURACY_METRES = 5_000;

export function isUsableFix(coordinates: Coordinates): boolean {
  if (coordinates.accuracy === null || coordinates.accuracy === undefined) {
    // No accuracy reported at all — some browsers omit it. Accepted: the fix is
    // still the browser's best answer, and refusing it would silently disable
    // the feature on those devices.
    return true;
  }
  return coordinates.accuracy <= MAX_ACCEPTABLE_ACCURACY_METRES;
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/**
 * Minutes between check-in and check-out, or null while a shift is open.
 *
 * Rounded to whole minutes because that is the resolution anybody acts on, and
 * clamped at zero because a clock adjustment between the two stamps must not
 * produce a negative shift.
 */
export function shiftMinutes(record: {
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
}): number | null {
  if (!record.checkInAt || !record.checkOutAt) return null;
  const ms = record.checkOutAt.getTime() - record.checkInAt.getTime();
  return Math.max(0, Math.round(ms / 60_000));
}

/**
 * How long a shift may run before it is refused as a mistake.
 *
 * Sixteen hours. Long enough for a genuine double shift on a shutdown, short
 * enough that "checked in on Tuesday, checked out on Friday" is caught. A
 * check-out beyond this is a forgotten check-in, and recording it as an
 * 84-hour shift puts a false number into every report that reads attendance.
 */
export const MAX_SHIFT_MINUTES = 16 * 60;
