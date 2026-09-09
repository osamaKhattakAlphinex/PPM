import "server-only";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";
import {
  assetNamesFor,
  attendanceRepository,
  connectToDatabase,
  findAttendanceForDay,
  ppmSchedulesRepository,
  requireObjectId,
  techniciansRepository,
  workOrdersRepository,
  type AttendanceDocument,
  type TechnicianDocument,
  type TenantScope,
} from "@/lib/db";
import {
  attendanceDayOf,
  attendanceStatusOf,
  shiftMinutes,
  type AttendanceStatus,
} from "@/lib/domain/attendance";
import { isOpenStatus, WORK_ORDER_STATUSES, type WorkOrderPriority } from "@/lib/domain/corrective";
import { addUtcDays, startOfUtcDay } from "@/lib/domain/dates";
import { effectiveStatus, type PpmDisplayStatus } from "@/lib/domain/preventive";

/**
 * The technician's own screen: their shift, and their work.
 *
 * The guarantee this module exists to provide is narrower than the tenancy one
 * and sits on top of it: **a technician sees only the jobs assigned to them.**
 * The data-access layer scopes every query to the organization; what is added
 * here is a `technicianId` filter derived from the SESSION, never from a
 * request — `resolveOwnTechnician()` looks the record up by the session's own
 * user id, so there is no parameter anywhere in this module by which one
 * technician could ask for another's list.
 */

/** Who has a "my jobs" screen at all. */
export const MY_JOBS_ROLES: readonly [Role, ...Role[]] = ["TECHNICIAN"];

/**
 * Who may look at the attendance board.
 *
 * Wider than the personal screen, because a supervisor dispatching this
 * morning's work has to know who turned up. It is a different read
 * (`listAttendanceForDay`) rather than a widening of the personal one.
 */
export const ATTENDANCE_VIEWERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
];

/**
 * The technician record belonging to this session, or null.
 *
 * The whole of the personal-scope story. `userId` is a filter term with
 * organizationId layered on top by the DAL, and the value comes from the
 * session's own `user.id` — a caller has no way to supply a different one,
 * because no function in this module takes one.
 *
 * Null is a real state and not an error: a person can hold a TECHNICIAN login
 * before anybody links them to a directory record. The screen says so rather
 * than throwing, because throwing would make a data-entry gap look like a bug
 * in the app.
 */
export async function resolveOwnTechnician(
  scope: TenantScope,
  user: SessionUser,
): Promise<TechnicianDocument | null> {
  await connectToDatabase();

  return techniciansRepository.forScope(scope).findOne({
    userId: requireObjectId(user.id) as TechnicianDocument["userId"],
  });
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface MyShift {
  status: AttendanceStatus;
  /** ISO 8601, or null. A Date does not survive the boundary. */
  checkInAt: string | null;
  checkOutAt: string | null;
  /** Whole minutes, or null while the shift is open. */
  minutes: number | null;
  /** Whether a position was captured — never the position itself. See below. */
  locationCaptured: boolean;
  consentGiven: boolean;
}

export interface MyJob {
  id: string;
  kind: "PPM" | "WORK_ORDER";
  assetId: string;
  assetName: string | null;
  /** The PPM frequency, or the work order's priority. */
  label: string;
  /** ISO 8601 — a due date for a visit, a raised date for a fault. */
  date: string;
  /** Derived on the SERVER so a phone's clock cannot change a badge. */
  status: PpmDisplayStatus | string;
  /** Work orders only. */
  priority?: WorkOrderPriority;
  /** Work orders only — the fault, as reported. */
  issue?: string;
  /** True when the job is late, computed against the server's midnight. */
  isOverdue: boolean;
}

export interface MyJobsData {
  technicianName: string | null;
  /** Null when this login is not linked to a technician record. */
  hasTechnicianRecord: boolean;
  shift: MyShift;
  jobs: MyJob[];
}

/**
 * The shift, shaped for the browser.
 *
 * `locationCaptured` is a BOOLEAN and the coordinates are deliberately not in
 * the DTO. The technician knows where they were; shipping the stored latitude
 * back to the phone adds nothing they do not already have, and it would put a
 * person's position into a payload, a browser cache and a screenshot for no
 * gain. Where the position IS needed — a supervisor reviewing a disputed
 * check-in — is a different screen with a different read and a different
 * conversation about consent.
 */
function toMyShift(record: AttendanceDocument | null): MyShift {
  return {
    status: attendanceStatusOf(record),
    checkInAt: record?.checkInAt ? record.checkInAt.toISOString() : null,
    checkOutAt: record?.checkOutAt ? record.checkOutAt.toISOString() : null,
    minutes: record ? shiftMinutes(record) : null,
    locationCaptured: Boolean(record?.checkInLocation ?? record?.checkOutLocation),
    consentGiven: record?.consentGiven ?? false,
  };
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * How far ahead the personal list reaches.
 *
 * Fourteen days. A technician's screen is "what am I doing now and next", not a
 * calendar — the full schedule is in the preventive module. It is also a cap on
 * an unbounded read from a screen that loads on every shift.
 */
const HORIZON_DAYS = 14;

/** How many rows of each kind. A phone list, not a report. */
const JOB_LIMIT = 25;

export async function loadMyJobsForScope(
  scope: TenantScope,
  user: SessionUser,
  now: Date = new Date(),
): Promise<MyJobsData> {
  await connectToDatabase();

  const technician = await resolveOwnTechnician(scope, user);

  if (!technician) {
    return {
      technicianName: user.name ?? null,
      hasTechnicianRecord: false,
      shift: toMyShift(null),
      jobs: [],
    };
  }

  const today = startOfUtcDay(now);
  const horizon = addUtcDays(today, HORIZON_DAYS);
  const day = attendanceDayOf(now);

  const [attendance, visits, tickets] = await Promise.all([
    findAttendanceForDay(scope, technician._id, day),

    /**
     * Planned visits assigned to THIS technician, still open, due within the
     * horizon or already late.
     *
     * `technicianId` is in the sanitized `filter` channel — it is an ObjectId
     * this function resolved from the session, not a request value, but it goes
     * through the same door everything else does.
     */
    ppmSchedulesRepository.forScope(scope).find(
      { technicianId: technician._id },
      {
        where: { status: { $ne: "COMPLETED" }, dueDate: { $lt: horizon } },
        sort: { dueDate: 1 },
        limit: JOB_LIMIT,
        select: ["_id", "assetId", "type", "dueDate", "status"],
      },
    ),

    /** Open faults assigned to this technician, most urgent first. */
    workOrdersRepository.forScope(scope).find(
      { technicianId: technician._id },
      {
        where: { status: { $in: WORK_ORDER_STATUSES.filter(isOpenStatus) } },
        sort: { createdAt: -1 },
        limit: JOB_LIMIT,
        select: ["_id", "assetId", "issue", "priority", "status", "createdAt"],
      },
    ),
  ]);

  const names = await assetNamesFor(scope, [
    ...visits.map((visit) => visit.assetId),
    ...tickets.map((ticket) => ticket.assetId),
  ]);

  const jobs: MyJob[] = [
    ...visits.map((visit): MyJob => {
      const status = effectiveStatus(visit.status, visit.dueDate, now);
      return {
        id: visit._id.toHexString(),
        kind: "PPM",
        assetId: visit.assetId.toHexString(),
        assetName: names.get(visit.assetId.toHexString()) ?? null,
        label: visit.type,
        date: visit.dueDate.toISOString(),
        status,
        isOverdue: status === "OVERDUE",
      };
    }),
    ...tickets.map(
      (ticket): MyJob => ({
        id: ticket._id.toHexString(),
        kind: "WORK_ORDER",
        assetId: ticket.assetId.toHexString(),
        assetName: names.get(ticket.assetId.toHexString()) ?? null,
        label: ticket.priority,
        date: ticket.createdAt.toISOString(),
        status: ticket.status,
        priority: ticket.priority,
        issue: ticket.issue,
        // A fault has no due date; "overdue" for one means critical and still
        // open, which is the thing that should sort to the top of a phone.
        isOverdue: ticket.priority === "CRITICAL",
      }),
    ),
  ];

  /**
   * One list rather than two, sorted so the top of the screen is what to do
   * next: everything late first, then by date.
   *
   * A technician holding a phone in one hand does not want two lists and a
   * decision about which to read first.
   */
  jobs.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return {
    technicianName: technician.name,
    hasTechnicianRecord: true,
    shift: toMyShift(attendance),
    jobs,
  };
}

export async function loadMyJobs(): Promise<MyJobsData> {
  const { scope, user } = await requireRole(...MY_JOBS_ROLES);
  return loadMyJobsForScope(scope, user);
}

// ---------------------------------------------------------------------------
// The attendance board
// ---------------------------------------------------------------------------

export interface AttendanceRow {
  technicianId: string;
  technicianName: string | null;
  status: AttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  minutes: number | null;
  locationCaptured: boolean;
}

/**
 * Who is on site today.
 *
 * Names are resolved through the SCOPED technicians repository rather than a
 * `$lookup`, for the reason the DAL's header gives — a join is reached under
 * MongoDB's rules rather than ours.
 */
export async function loadAttendanceBoard(now: Date = new Date()): Promise<AttendanceRow[]> {
  const { scope } = await requireRole(...ATTENDANCE_VIEWERS);
  await connectToDatabase();

  const day = attendanceDayOf(now);
  const records = await attendanceRepository
    .forScope(scope)
    .find({ day }, { sort: { checkInAt: 1 }, limit: 100 });

  if (records.length === 0) return [];

  const ids = new Map<string, AttendanceDocument["technicianId"]>();
  for (const record of records) ids.set(record.technicianId.toHexString(), record.technicianId);

  const technicians = await techniciansRepository.forScope(scope).find(undefined, {
    where: { _id: { $in: [...ids.values()] } },
    select: ["_id", "name"],
    limit: ids.size,
  });

  const names = new Map(technicians.map((person) => [person._id.toHexString(), person.name]));

  return records.map((record) => ({
    technicianId: record.technicianId.toHexString(),
    technicianName: names.get(record.technicianId.toHexString()) ?? null,
    status: attendanceStatusOf(record),
    checkInAt: record.checkInAt ? record.checkInAt.toISOString() : null,
    checkOutAt: record.checkOutAt ? record.checkOutAt.toISOString() : null,
    minutes: shiftMinutes(record),
    locationCaptured: Boolean(record.checkInLocation ?? record.checkOutLocation),
  }));
}
