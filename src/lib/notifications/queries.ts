import "server-only";

import { requireAuth } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import {
  connectToDatabase,
  countUnreadNotifications,
  listNotificationsFor,
  type NotificationDocument,
  type TenantScope,
} from "@/lib/db";
import type {
  NotificationKind,
  NotificationRefType,
  NotificationSeverity,
} from "@/lib/domain/notifications";

/**
 * The bell's reads.
 *
 * Open to EVERY signed-in role — `requireAuth()` rather than `requireRole()` —
 * because the bell is part of the shell and every role has one. That is not a
 * widening: what each person sees is narrowed twice over, by the DAL's tenant
 * (and client) scope and by the `roles` array on each notification, and a role
 * with nothing addressed to it simply gets an empty list.
 */

/** What crosses to the browser. Rendered through `next-intl` in the reader's locale. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  /** A messages key, not a sentence — see the model header for why. */
  titleKey: string;
  params: Record<string, string | number>;
  refType: NotificationRefType;
  refId: string;
  /** ISO 8601. A Date does not survive the boundary. */
  createdAt: string;
  /** Computed per reader on the server; `readBy` itself never ships. */
  isRead: boolean;
}

export interface NotificationFeed {
  items: NotificationView[];
  /** Capped at `MAX_UNREAD_COUNT`; the badge renders "99+" past that. */
  unread: number;
}

/**
 * `readBy` is reduced to one boolean before anything leaves the server.
 *
 * Shipping the array would tell every reader which of their colleagues had read
 * what, which is a small piece of workplace surveillance nobody asked for and
 * which the bell does not need.
 */
function toView(document: NotificationDocument, userId: string): NotificationView {
  return {
    id: document._id.toHexString(),
    kind: document.kind,
    severity: document.severity,
    titleKey: document.titleKey,
    params: document.params as Record<string, string | number>,
    refType: document.refType,
    refId: document.refId.toHexString(),
    createdAt: document.createdAt.toISOString(),
    isRead: document.readBy.some((reader) => reader.toHexString() === userId),
  };
}

export async function loadFeedForScope(
  scope: TenantScope,
  role: Role,
  userId: string,
): Promise<NotificationFeed> {
  await connectToDatabase();

  const [documents, unread] = await Promise.all([
    listNotificationsFor(scope, role),
    countUnreadNotifications(scope, role, userId),
  ]);

  return { items: documents.map((document) => toView(document, userId)), unread };
}

/** The authenticating entry point, for the shell. */
export async function loadFeed(): Promise<NotificationFeed> {
  const { scope, user } = await requireAuth();
  return loadFeedForScope(scope, user.role, user.id);
}
