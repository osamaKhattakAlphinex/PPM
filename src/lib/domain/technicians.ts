import { z } from "zod";

/**
 * The technician vocabulary: trades, statuses, and the bounds on a skills list.
 *
 * This lives outside `src/lib/db` for the reason spelled out in
 * `currency.ts`: it is domain vocabulary, not a storage concern. The Technician
 * model needs it, and so do the directory grid and its form — and those are
 * Client Components. Anything a Client Component imports as a VALUE ends up in
 * the browser bundle, so a trade list re-exported from `@/lib/db` would drag
 * Mongoose (and `fs`, `net`, `tls`) into it and fail the build.
 *
 * Pure: zod and nothing else. Safe from a Client Component, a Server Component
 * and the Edge middleware alike.
 */

/**
 * The trades work is dispatched to.
 *
 * Stable uppercase keys rather than display strings, like every other enum in
 * the app: this product is bilingual, so "Plumbing" and "السباكة" are two
 * renderings of one stored value, and the moment a label is the stored value an
 * Arabic-first tenant cannot filter on it. The labels live in
 * `messages/{en,ar}.json` under `technicians.trades`.
 *
 * ELV — extra-low voltage: CCTV, access control, fire alarm, BMS. It is a
 * separate trade from ELECTRICAL in every Gulf FM contract, and the technicians
 * are certified separately, so it is a separate value here.
 */
export const TRADES = ["HVAC", "PLUMBING", "ELECTRICAL", "ELV", "CIVIL"] as const;

export type Trade = (typeof TRADES)[number];

export const tradeSchema = z.enum(TRADES);

/**
 * ON_LEAVE is a third state rather than "not ACTIVE", because a scheduler has
 * to tell "away until the 14th, do not assign" from "left the company, hide
 * them". Attendance (a later prompt) will drive this field; today it is set by
 * hand, which is why it is a plain status and not a derived one.
 */
export const TECHNICIAN_STATUSES = ["ACTIVE", "ON_LEAVE", "INACTIVE"] as const;

export type TechnicianStatus = (typeof TECHNICIAN_STATUSES)[number];

export const technicianStatusSchema = z.enum(TECHNICIAN_STATUSES);

/**
 * Bounds on the skills list, shared by the model, the action schema and the
 * chip editor — so the form stops at the same number the database would have
 * refused, rather than discovering it after a submit.
 */
export const SKILL_MAX_LENGTH = 48;
export const MAX_SKILLS = 24;
