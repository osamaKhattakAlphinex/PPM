import { z } from "zod";

/**
 * The notification vocabulary.
 *
 * Pure — zod and three lists — so the bell menu, a Client Component, can import
 * these as VALUES. The same rule every `src/lib/domain/*` file follows.
 */

/**
 * What a notification is about.
 *
 * Two kinds, matching the two things the job actually computes. The list is
 * short on purpose: a bell that fires for everything is a bell nobody reads,
 * and the two below are the only events in this product where NOT knowing costs
 * money — an overdue visit is a contract breach, an expiring contract is
 * revenue about to stop.
 *
 * `INVOICE_OVERDUE` is deliberately absent even though the data supports it.
 * The invoicing screen already leads with an overdue tile and a filter, and a
 * daily bell for every unpaid invoice would bury the two events above within a
 * week.
 */
export const NOTIFICATION_KINDS = ["PPM_OVERDUE", "CONTRACT_EXPIRING"] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);

/**
 * How loud it is.
 *
 * Two levels, not five. A person triaging a bell menu is deciding "now or
 * later", and a scale with more steps than that decision has answers gets used
 * inconsistently within a month.
 */
export const NOTIFICATION_SEVERITIES = ["INFO", "URGENT"] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);

/**
 * What a notification points at, so the bell menu can link to it.
 *
 * A discriminator and an id rather than a URL, for the same reason `Approval`
 * uses one: a stored URL is a stored routing decision, and it is wrong the
 * first time a path changes. The menu builds the href from the pair.
 */
export const NOTIFICATION_REF_TYPES = ["PPM_SCHEDULE", "CONTRACT"] as const;

export type NotificationRefType = (typeof NOTIFICATION_REF_TYPES)[number];

export const notificationRefTypeSchema = z.enum(NOTIFICATION_REF_TYPES);

/** Where the bell menu sends someone for each kind of reference. */
export const REF_HREF: Readonly<Record<NotificationRefType, string>> = Object.freeze({
  PPM_SCHEDULE: "/app/preventive",
  CONTRACT: "/app/amc",
});

/**
 * The most unread notifications the badge will ever count.
 *
 * A display decision as much as a performance one, and it lives HERE rather
 * than beside the query because the bell — a Client Component — renders "99+"
 * from it, and anything reachable from `@/lib/db` drags Mongoose into the
 * browser bundle.
 */
export const MAX_UNREAD_COUNT = 100;

/**
 * The idempotency key for one notifiable fact.
 *
 * The job runs daily and must not produce a second row for the same overdue
 * visit every morning — a bell showing the same thing thirty times is a bell
 * that gets muted. The key is `<kind>:<refId>:<bucket>`, where the bucket is
 * what makes "the same fact" precise:
 *
 *  - For an overdue visit the bucket is the DUE DATE. The visit is one fact
 *    however long it stays late, so it notifies once and then stops.
 *  - For an expiring contract the bucket is the END DATE. A contract renewed
 *    for another year has a new end date and is therefore a new fact, which is
 *    exactly right: it should notify again when the new term approaches.
 *
 * Combined with the partial unique index on `{ organizationId, dedupeKey }`,
 * this makes the job safe to run twice, or ten times, in a day.
 */
export function dedupeKeyFor(kind: NotificationKind, refId: string, bucket: Date): string {
  return `${kind}:${refId}:${bucket.toISOString().slice(0, 10)}`;
}

/**
 * How far ahead the contract-expiry job looks.
 *
 * Deliberately the SAME window AMC uses for its EXPIRING badge
 * (`EXPIRING_WINDOW_DAYS`, sixty days) — imported rather than restated at the
 * call site so a bell can never fire for a contract the screen still calls
 * healthy, or stay silent about one the screen has already flagged.
 */
export { EXPIRING_WINDOW_DAYS as CONTRACT_NOTICE_DAYS } from "./amc";
