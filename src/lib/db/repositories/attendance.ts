import type { Types } from "mongoose";

import type { Coordinates } from "../../domain/attendance";
import { Attendance, type AttendanceDocument } from "../models/attendance";
import { createRepository } from "../repository";
import { isClientScope, type TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach attendance.
 *
 * NOT client-partitioned and NOT `sharedWithClients`, so `createRepository()`
 * refuses a CLIENT session outright — the fail-closed direction, and the same
 * decision `techniciansRepository` makes. Who was on site, and when, is the
 * provider's employment record; a customer is entitled to know the work was
 * done, which is what the work order says, and not to a roster of their
 * provider's staff movements.
 */

export interface AttendanceCreateInput {
  technicianId: Types.ObjectId | string;
  userId?: Types.ObjectId | string | null;
  day: Date;
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  checkInLocation?: Coordinates | null;
  checkOutLocation?: Coordinates | null;
  consentGiven?: boolean;
  note?: string | null;
}

/**
 * Patchable fields.
 *
 * No `technicianId` and no `day`: moving a shift to a different person or a
 * different date is a different record, and the unique index would refuse it
 * anyway. `checkInAt` is patchable only so a supervisor correction has a path;
 * nothing in the technician-facing flow writes it twice.
 */
export interface AttendanceUpdateInput {
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  checkInLocation?: Coordinates | null;
  checkOutLocation?: Coordinates | null;
  consentGiven?: boolean;
  note?: string | null;
}

export const attendanceRepository = createRepository<
  AttendanceDocument,
  AttendanceCreateInput,
  AttendanceUpdateInput
>(Attendance);

/**
 * Today's record for one technician, or null.
 *
 * A named read rather than a filter at each call site, because both actions and
 * the my-jobs screen ask exactly this question and a divergence between them
 * would mean a check-out that cannot find the check-in it is closing.
 *
 * Scoped like everything else: `technicianId` is a filter term with
 * organizationId layered on top by the DAL, so an id from another tenant
 * matches nothing.
 */
export async function findAttendanceForDay(
  scope: TenantScope,
  technicianId: Types.ObjectId | string,
  day: Date,
): Promise<AttendanceDocument | null> {
  // A client scope cannot reach this collection at all; the repository would
  // throw. Returning null keeps the failure a policy decision rather than a 500
  // three layers down — the same guard the analytics module uses for PPM.
  if (isClientScope(scope)) return null;

  return attendanceRepository.forScope(scope).findOne({
    technicianId: technicianId as AttendanceDocument["technicianId"],
    day,
  });
}

/** Everyone's record for one day — the supervisor's attendance board. */
export async function listAttendanceForDay(
  scope: TenantScope,
  day: Date,
  limit = 100,
): Promise<AttendanceDocument[]> {
  if (isClientScope(scope)) return [];

  return attendanceRepository.forScope(scope).find({ day }, { sort: { checkInAt: 1 }, limit });
}
