/**
 * UTC calendar arithmetic, shared by every module that reasons about a DAY
 * rather than a moment.
 *
 * These lived in `src/lib/domain/preventive.ts` until AMC needed them too. A due
 * date and a contract term are the same kind of value — "the 14th", never "14:32
 * on the 14th" — and they have to be compared the same way or two screens
 * disagree about what today is. Copying `addUtcDays` into a second module is
 * exactly the drift `preventive.ts`'s own header rails against, and having AMC
 * import a calendar primitive from PPM would be a dependency between two modules
 * that have nothing else to say to each other. So they moved down here.
 *
 * `preventive.ts` re-exports `startOfUtcDay` so its existing import sites keep
 * working unchanged.
 *
 * Pure: no imports at all. Safe from a Client Component, a Server Component and
 * the Edge middleware alike.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Midnight UTC on the day the given instant falls in.
 *
 * A due date is a DAY, not a moment: "the chiller service is due on the 14th",
 * never "due at 14:32"; "the contract runs to 31 December", never "to 31
 * December at 09:15". Normalising both ends of every comparison to UTC midnight
 * is what stops a row created at 23:00 local from reading as overdue an hour
 * later, and what makes these values comparable at all across the timezones a
 * Gulf FM tenant's staff actually sign in from.
 *
 * The write path normalises on the way in and this normalises the clock on the
 * way out, so the two sides of `<` are always the same kind of value.
 */
export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** `days` whole days after the UTC midnight of `value`. */
export function addUtcDays(value: Date, days: number): Date {
  return new Date(startOfUtcDay(value).getTime() + days * MS_PER_DAY);
}

/**
 * Add whole months, clamped to the end of the target month.
 *
 * The reason this is not `setUTCMonth(month + n)` is that the native setter
 * OVERFLOWS: 31 January plus one month becomes 3 March, because there is no 31
 * February. A monthly PPM that drifts forward three days every short month is a
 * schedule nobody trusts, so the day is clamped to the last of the target month
 * instead — 31 Jan + 1 month is 28 Feb, or 29 in a leap year.
 */
export function addUtcMonths(value: Date, months: number): Date {
  const start = startOfUtcDay(value);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();

  // Day 0 of the FOLLOWING month is the last day of the target month.
  const lastDayOfTarget = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month + months, Math.min(day, lastDayOfTarget)));
}
