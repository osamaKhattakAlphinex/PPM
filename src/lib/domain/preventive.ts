import { z } from "zod";

import { addUtcDays, addUtcMonths, startOfUtcDay } from "./dates";

/**
 * The preventive-maintenance vocabulary, and the two pure functions that turn a
 * due date into something a person can act on.
 *
 * This lives outside `src/lib/db` for the reason spelled out in `assets.ts` and
 * `technicians.ts`: it is domain vocabulary, not a storage concern. The PPM
 * model needs it, and so do the schedule list, its filters and its tiles — and
 * those are Client Components. Anything a Client Component imports as a VALUE
 * ends up in the browser bundle, so a frequency list re-exported from
 * `@/lib/db` would drag Mongoose (and `fs`, `net`, `tls`) into it and fail the
 * build.
 *
 * Pure: zod and nothing else. Safe from a Client Component, a Server Component
 * and the Edge middleware alike.
 */

// ---------------------------------------------------------------------------
// Frequency
// ---------------------------------------------------------------------------

/**
 * How often a planned visit recurs.
 *
 * These are the intervals a Gulf FM contract is actually written in — an AMC
 * schedules "quarterly chiller service, annual fire-pump load test" — so the
 * list is the contract's list, not a generic cron vocabulary.
 *
 * Stable uppercase keys rather than display strings, like every other enum in
 * the app: the product is bilingual, so "Half-Yearly" and "نصف سنوي" are two
 * renderings of one stored value, and the moment a label IS the stored value an
 * Arabic-first tenant cannot filter on it. `HALF_YEARLY` also avoids putting a
 * hyphen in a key that ends up in a message path. Labels live in
 * `messages/{en,ar}.json` under `preventive.frequency`.
 */
export const PPM_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUAL",
] as const;

export type PpmFrequency = (typeof PPM_FREQUENCIES)[number];

export const ppmFrequencySchema = z.enum(PPM_FREQUENCIES);

// ---------------------------------------------------------------------------
// Status — stored vs displayed
// ---------------------------------------------------------------------------

/**
 * What is actually STORED on a schedule.
 *
 * Three values, and the omissions are the design. A visit is planned, then
 * someone starts it, then it is done:
 *
 *     SCHEDULED --Start--> IN_PROGRESS --Complete--> COMPLETED
 *
 * `UPCOMING` and `OVERDUE` are deliberately NOT here. They are functions of the
 * clock, not facts about the row: a schedule stored as "upcoming" is wrong the
 * moment its due date passes, and nothing would be running to correct it —
 * there is no scheduler in the product yet. Storing them would mean a list that
 * is accurate only until midnight. They are derived instead, by
 * `effectiveStatus()` below, which cannot go stale because it takes `now` as an
 * argument.
 */
export const PPM_SCHEDULE_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] as const;

export type PpmScheduleStatus = (typeof PPM_SCHEDULE_STATUSES)[number];

export const ppmScheduleStatusSchema = z.enum(PPM_SCHEDULE_STATUSES);

/**
 * What a person SEES — the stored three, with `SCHEDULED` split three ways by
 * how close its due date is.
 *
 * This is the vocabulary the status badge, the status filter and the tiles all
 * speak. It is a superset of the stored one, so a display value is never a
 * legal thing to write to the database; `ppmScheduleStatusSchema` is what
 * guards writes and this is what guards reads and filters.
 */
export const PPM_DISPLAY_STATUSES = [
  "SCHEDULED",
  "UPCOMING",
  "OVERDUE",
  "IN_PROGRESS",
  "COMPLETED",
] as const;

export type PpmDisplayStatus = (typeof PPM_DISPLAY_STATUSES)[number];

export const ppmDisplayStatusSchema = z.enum(PPM_DISPLAY_STATUSES);

/**
 * How far ahead "upcoming" reaches, in days.
 *
 * A week, because that is the horizon a supervisor plans against — the visits
 * they need to have assigned people and parts for before the next toolbox
 * meeting. Anything further out is just `SCHEDULED` and does not need to shout.
 */
export const UPCOMING_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * The calendar arithmetic lives in `src/lib/domain/dates.ts`, because AMC needs
 * the same primitives and a second copy of "add days" is how two screens end up
 * disagreeing about what today is.
 *
 * `startOfUtcDay` is RE-EXPORTED rather than merely imported: it is part of this
 * module's published surface — `ppm-schedules.ts`, `preventive/actions.ts` and
 * `recurrence.test.ts` all import it from here — and a due date normalised to
 * UTC midnight is a preventive-maintenance concept as much as a calendar one.
 */
export { startOfUtcDay } from "./dates";

// ---------------------------------------------------------------------------
// Derived status
// ---------------------------------------------------------------------------

/**
 * The status to SHOW for a schedule, given the clock.
 *
 * Evaluated on the SERVER, in the DTO, and shipped to the browser as a plain
 * field. The client must not recompute it: a device whose clock is a day out
 * would hydrate a different badge than the server rendered, which React reports
 * as a hydration mismatch and a user reports as "it says overdue on my phone".
 *
 * Only `SCHEDULED` is time-sensitive. A row someone has started or finished was
 * moved by a PERSON, and the clock does not get to move it back — a visit
 * completed late is completed, not overdue.
 */
export function effectiveStatus(
  status: PpmScheduleStatus,
  dueDate: Date,
  now: Date = new Date(),
): PpmDisplayStatus {
  if (status !== "SCHEDULED") return status;

  const due = startOfUtcDay(dueDate);
  const today = startOfUtcDay(now);

  // Due today is not yet late: the technician has the whole day.
  if (due.getTime() < today.getTime()) return "OVERDUE";
  if (due.getTime() < addUtcDays(today, UPCOMING_WINDOW_DAYS).getTime()) return "UPCOMING";
  return "SCHEDULED";
}

/**
 * The same rule as `effectiveStatus`, written as a QUERY instead of a branch.
 *
 * A person filters for "overdue", which is not a value any row holds — it is
 * `SCHEDULED` plus a date in the past — so the filter has to be expressed in
 * terms the database can answer. These are the two columns that are stored, and
 * the shape is what the `{ organizationId, status, dueDate }` index serves:
 * equality on the second key, a range on the third.
 *
 * It lives HERE, beside `effectiveStatus`, rather than in the query module, and
 * that is the point of the file. The two are one rule expressed twice — once for
 * a row in hand, once for rows still in the database — and if they ever disagree
 * the list shows the wrong rows with confident badges and nothing throws. Keeping
 * them in the same forty lines is what makes a change to one an obvious prompt to
 * change the other; `list-filter.test.ts` asserts they agree.
 *
 * The returned object is a TRUSTED, code-authored fragment: it carries Mongo
 * operators, so it belongs in the DAL's `where` channel, never in `filter`. The
 * untrusted part of a request is the status NAME, and it only ever selects a
 * branch below — it is never interpolated into one.
 *
 * Pure: a plain object literal. Nothing here imports the driver.
 */
export function statusQueryFragment(
  status: PpmDisplayStatus,
  now: Date = new Date(),
): Record<string, unknown> {
  const today = startOfUtcDay(now);
  const horizon = addUtcDays(today, UPCOMING_WINDOW_DAYS);

  switch (status) {
    case "OVERDUE":
      return { status: "SCHEDULED", dueDate: { $lt: today } };
    case "UPCOMING":
      // Half-open, matching `effectiveStatus`: due today is upcoming, and the
      // seventh day out has already fallen back to plain SCHEDULED.
      return { status: "SCHEDULED", dueDate: { $gte: today, $lt: horizon } };
    case "SCHEDULED":
      // Planned, but not yet close enough to be anyone's problem this week.
      return { status: "SCHEDULED", dueDate: { $gte: horizon } };
    case "IN_PROGRESS":
    case "COMPLETED":
      return { status };
  }
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

/**
 * When the next visit of this frequency falls due.
 *
 * Calendar arithmetic, not `+ N days`. A quarterly service is "the same date
 * three months on", which is 89, 91 or 92 days depending on where in the year
 * it lands — approximating it in days makes an annual schedule drift by a day
 * every leap year and a monthly one by two days a month, and after a year of
 * that the PPM calendar no longer matches the contract it was written from.
 */
export function nextDueDate(type: PpmFrequency, from: Date): Date {
  switch (type) {
    case "DAILY":
      return addUtcDays(from, 1);
    case "WEEKLY":
      return addUtcDays(from, 7);
    case "MONTHLY":
      return addUtcMonths(from, 1);
    case "QUARTERLY":
      return addUtcMonths(from, 3);
    case "HALF_YEARLY":
      return addUtcMonths(from, 6);
    case "ANNUAL":
      return addUtcMonths(from, 12);
  }
}

/** The fields the next occurrence inherits from the one that was completed. */
export interface RecurrenceSource {
  readonly assetId: string;
  readonly type: PpmFrequency;
  readonly dueDate: Date;
  readonly technicianId: string;
}

export interface PlannedOccurrence {
  readonly assetId: string;
  readonly type: PpmFrequency;
  readonly dueDate: Date;
  readonly technicianId: string;
}

/**
 * The next schedule a completed one would regenerate — DESIGN ONLY.
 *
 * Nothing calls this yet, on purpose. The brief asks for the recurrence to be
 * designed rather than driven, because there is no scheduler in the product
 * yet, and this is the shape of the contract between the two:
 *
 *  1. A visit is completed. `completePpmSchedule` sets COMPLETED + completedAt.
 *  2. The regenerator reads the completed row and calls this, getting back
 *     exactly the payload `createPpmSchedule` already accepts.
 *  3. It creates the new row THROUGH THE SAME SCOPED REPOSITORY, so the next
 *     occurrence lands in the tenant the completed one belonged to and the
 *     regeneration cannot become the one write path that skips the DAL.
 *
 * The next date is measured from the PLANNED due date, not from when the work
 * actually happened. A monthly service completed four days late is still due on
 * the 1st next month; measuring from the completion date would let a schedule
 * walk forward through the calendar one late visit at a time.
 *
 * The one thing this function cannot supply is IDEMPOTENCY. Whatever drives it
 * has to guarantee one next occurrence per completion — a retried job that
 * calls this twice writes two identical rows, and a pure function has no way to
 * notice. That belongs to the scheduler, along with catching up a schedule
 * whose due date is already in the past.
 */
export function planNextOccurrence(schedule: RecurrenceSource): PlannedOccurrence {
  return {
    assetId: schedule.assetId,
    type: schedule.type,
    dueDate: nextDueDate(schedule.type, schedule.dueDate),
    technicianId: schedule.technicianId,
  };
}
