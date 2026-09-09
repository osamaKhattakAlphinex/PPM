import { z } from "zod";

import { roleSchema } from "../../auth/roles";
import {
  notificationKindSchema,
  notificationRefTypeSchema,
  notificationSeveritySchema,
} from "../../domain/notifications";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One thing worth telling somebody about.
 *
 * ## One row per fact, not one row per recipient
 *
 * The obvious model — a notification per user — is wrong here and the reason is
 * arithmetic: a tenant with twelve managers and four hundred overdue visits
 * would produce four thousand eight hundred rows a night for four hundred
 * facts. So a notification is the FACT, it carries the `roles` that should see
 * it, and read state is a `readBy` array of user ids.
 *
 * The cost is that "unread" is a `$nin` on an array rather than a boolean on a
 * row, which is a slightly more expensive count. That is the right trade at
 * this scale: the array is bounded by the size of a tenant's management team,
 * and the alternative multiplies the collection by it.
 *
 * ## clientId is present and nullable
 *
 * Present so the DAL can narrow a CLIENT session to its own notifications
 * rather than refusing the collection outright — a customer being told their
 * own contract is expiring is a legitimate and useful thing. Nullable because
 * most notifications are internal: an overdue visit on the provider's own depot
 * has no counterparty, and `clientId: null` matches no client filter, which is
 * the fail-closed default.
 *
 * ## The body is not stored as a sentence
 *
 * `titleKey` and `params` rather than a rendered string, because the product is
 * bilingual: a notification written in English at 02:00 by a job would be
 * English forever, including for the Arabic-first manager it was written for.
 * The bell menu renders it through `next-intl` in the reader's own locale.
 */
export const notificationInputSchema = entity({
  kind: notificationKindSchema,
  severity: notificationSeveritySchema.default("INFO"),

  /**
   * Who should see it.
   *
   * An array rather than a single role, because the same fact matters to more
   * than one desk — an overdue visit is a supervisor's problem and an FM
   * manager's report. The bell query filters on membership, which MongoDB does
   * with a plain equality against an array field.
   */
  roles: z.array(roleSchema).min(1).max(5),

  /** The counterparty, or null for the provider's own work. See the header. */
  clientId: objectId("Client").nullable().optional(),

  /**
   * The message, as a key and its values.
   *
   * `params` is `Mixed` because its shape varies by kind — an asset name and a
   * date for one, a contract number and a day count for another. It is written
   * ONLY by the job, from data the job read out of the tenant's own scoped
   * collections; nothing from a request reaches it.
   */
  titleKey: mongo(z.string().min(1).max(120), { trim: true }),
  params: mongo(z.record(z.string(), z.union([z.string(), z.number()])).default({}), {
    type: "Mixed",
  }),

  /** What it is about, so the menu can link to it. */
  refType: notificationRefTypeSchema,
  refId: objectId(),

  /**
   * The idempotency key. See `dedupeKeyFor()` for what makes two runs of the
   * job produce one row rather than two.
   */
  dedupeKey: mongo(z.string().min(3).max(160), { trim: true }),

  /**
   * Who has read it.
   *
   * Bounded at 200 — a tenant's whole management team plus room — so a
   * pathological loop cannot grow a document without limit. Past that the
   * notification simply stops recording readers, which degrades to "everyone
   * sees it as unread", and that is the safe direction for a bell.
   */
  readBy: z.array(objectId("User")).max(200).default([]),
});

export type NotificationDocument = DocumentOf<typeof notificationInputSchema>;

export const Notification = defineModel("Notification", notificationInputSchema, {
  collection: "notifications",
  indexes: [
    /**
     * The bell: this tenant's notifications for my role, newest first.
     *
     * `roles` is a multikey index term — MongoDB indexes each element — so an
     * equality against the array is served by the index rather than by a scan.
     */
    { fields: { organizationId: 1, roles: 1, createdAt: -1 } },

    /**
     * The CLIENT-narrowed bell. `{ organizationId, clientId }` is a strict
     * prefix of this, so this one index serves that read too.
     */
    { fields: { organizationId: 1, clientId: 1, createdAt: -1 } },

    /**
     * What makes the job idempotent, enforced by the DATABASE rather than by
     * the job's own read-then-write — which a second concurrent run would
     * defeat. Partial on `deletedAt: null` so a dismissed notification does not
     * suppress the same fact forever.
     */
    {
      fields: { organizationId: 1, dedupeKey: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },
  ],
});
