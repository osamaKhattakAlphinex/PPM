import type { Types } from "mongoose";

import type { Role } from "../../auth/roles";
import {
  MAX_UNREAD_COUNT,
  type NotificationKind,
  type NotificationRefType,
  type NotificationSeverity,
} from "../../domain/notifications";
import { Notification, type NotificationDocument } from "../models/notification";
import { toObjectId } from "../object-id";
import { createRepository } from "../repository";
import type { TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach notifications.
 *
 * Client-partitioned, which follows from the model: `Notification` has a
 * nullable `clientId`, so `createRepository()` narrows a CLIENT session to its
 * own rows — a customer told their own contract is expiring — while the
 * provider's internal notifications, which carry `null`, match no client filter
 * and stay internal.
 */

export interface NotificationCreateInput {
  kind: NotificationKind;
  severity?: NotificationSeverity;
  roles: readonly Role[];
  clientId?: Types.ObjectId | string | null;
  titleKey: string;
  params?: Record<string, string | number>;
  refType: NotificationRefType;
  refId: Types.ObjectId | string;
  dedupeKey: string;
}

/**
 * The only thing that is ever patched.
 *
 * Not the message, not the severity, not the reference: a notification is a
 * record of a fact at a moment, and editing one after the fact would change
 * what somebody was told. Marking it read is the whole of the mutable state.
 */
export interface NotificationUpdateInput {
  readBy?: readonly Types.ObjectId[];
}

export const notificationsRepository = createRepository<
  NotificationDocument,
  NotificationCreateInput,
  NotificationUpdateInput
>(Notification);

/**
 * How many notifications this session has not read.
 *
 * A `countDocuments` through the scoped repository rather than an aggregation,
 * because that is all it is: the scope supplies the tenant (and the client),
 * `roles` narrows to this person's desk, and `readBy` excludes the ones they
 * have already seen.
 *
 * The `$nin` and the `$ne` are code-authored and go in the DAL's TRUSTED
 * `where` channel; the only value from outside is the session's own user id,
 * which is cast through `toObjectId` and would match nothing if it were
 * malformed.
 *
 * Capped at `MAX_UNREAD_COUNT` (a domain constant, because the badge renders
 * "99+" from the same number): past ninety-nine the badge says "99+" anyway,
 * and counting to four thousand to render that is work nobody sees.
 */

export async function countUnreadNotifications(
  scope: TenantScope,
  role: Role,
  userId: string,
): Promise<number> {
  const me = toObjectId(userId);
  if (!me) return 0;

  /**
   * A capped `find` projecting `_id`, not `count()`.
   *
   * The DAL's `count()` issues `countDocuments`, which has no limit — so a
   * tenant with four thousand unread rows would count all four thousand to
   * render a badge that says "99+". Reading at most a hundred index entries and
   * taking the length answers the same question and stops where the display
   * does.
   */
  const rows = await notificationsRepository.forScope(scope).find(undefined, {
    where: { roles: role, readBy: { $ne: me } },
    select: ["_id"],
    limit: MAX_UNREAD_COUNT,
  });

  return rows.length;
}

/**
 * The bell menu's list: this person's notifications, newest first.
 *
 * Read AND unread, because a bell that empties itself the moment it is opened
 * loses the thing somebody came back for. The unread ones are marked in the
 * DTO, not filtered out here.
 */
export async function listNotificationsFor(
  scope: TenantScope,
  role: Role,
  limit = 20,
): Promise<NotificationDocument[]> {
  return notificationsRepository.forScope(scope).find(undefined, {
    where: { roles: role },
    sort: { createdAt: -1 },
    limit,
  });
}
