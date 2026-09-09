"use server";

import { z } from "zod";

import { requireObjectId, notificationsRepository, connectToDatabase } from "@/lib/db";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError } from "@/lib/security/errors";
import { ROLES } from "@/lib/auth/roles";
import { objectIdString } from "@/lib/validation/primitives";
import { loadFeedForScope, type NotificationFeed } from "./queries";

/**
 * Marking notifications read.
 *
 * The only mutation the bell has, and the only field on a notification anybody
 * may change — see `NotificationUpdateInput` for why the message, the severity
 * and the reference are all fixed once written.
 *
 * Open to every role, because every role has a bell. What each session can
 * actually touch is narrowed by the DAL: `findById` re-applies the tenant (and
 * client) filter, so a notification id from another organisation matches
 * nothing and 404s.
 */

const markReadSchema = z.strictObject({ id: objectIdString });
const markAllReadSchema = z.strictObject({});

/**
 * Add this reader to `readBy`, if they are not already in it.
 *
 * A read-modify-write rather than a `$addToSet`, because the DAL deliberately
 * exposes no operator channel for a payload — `update()` takes a `$set` and
 * nothing else, which is what stops feature code composing an update document
 * MongoDB would interpret. The cost is a lost update if the same person marks
 * the same notification read from two tabs in the same instant, and the effect
 * of losing it is that they mark it read again. That is an acceptable outcome
 * for a bell; it would not be for anything that counted.
 */
const runMarkRead = defineAction({
  name: "markNotificationRead",
  roles: ROLES,
  input: markReadSchema,
  async handler({ input, scope, user }): Promise<NotificationFeed> {
    await connectToDatabase();

    const repository = notificationsRepository.forScope(scope);
    const notification = await repository.findById(input.id);
    if (!notification) throw new NotFoundError(`notification ${input.id} not in scope`);

    const me = requireObjectId(user.id);
    const already = notification.readBy.some(
      (reader) => reader.toHexString() === me.toHexString(),
    );

    if (!already) {
      await repository.update(input.id, { readBy: [...notification.readBy, me] });
    }

    return loadFeedForScope(scope, user.role, user.id);
  },
});

/**
 * Mark everything currently in the bell read.
 *
 * Reads the same list the menu shows and writes each one, rather than an
 * `updateMany` — for the same reason as above, and because "everything" here
 * means "everything this person can see", which is a scoped read rather than a
 * filter this action could compose.
 */
const runMarkAllRead = defineAction({
  name: "markAllNotificationsRead",
  roles: ROLES,
  input: markAllReadSchema,
  async handler({ scope, user }): Promise<NotificationFeed> {
    await connectToDatabase();

    const repository = notificationsRepository.forScope(scope);
    const me = requireObjectId(user.id);

    const feed = await loadFeedForScope(scope, user.role, user.id);
    const unread = feed.items.filter((item) => !item.isRead);

    for (const item of unread) {
      const document = await repository.findById(item.id);
      if (!document) continue;
      if (document.readBy.some((reader) => reader.toHexString() === me.toHexString())) continue;

      await repository.update(item.id, { readBy: [...document.readBy, me] });
    }

    return loadFeedForScope(scope, user.role, user.id);
  },
});

export async function markNotificationReadAction(
  payload: unknown,
): Promise<ActionResult<NotificationFeed>> {
  return runMarkRead(payload);
}

export async function markAllNotificationsReadAction(
  payload: unknown,
): Promise<ActionResult<NotificationFeed>> {
  return runMarkAllRead(payload);
}
