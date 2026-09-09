import type { UserDocument, UserStatus } from "@/lib/db";
import type { Role } from "@/lib/auth/roles";

/**
 * The shapes that cross the server/client boundary.
 *
 * The reason this file exists at all, for users more than for any other module:
 * a `User` document carries `passwordHash`. Forwarding a document wholesale
 * would put an argon2 hash of somebody's password in the RSC payload — visible
 * in the page source, cached by whatever caches the page, and available to a
 * cracker who never had to breach the database.
 *
 * Nothing reaches the browser unless it is named below, and `passwordHash` is
 * not. The read that produces these also projects, so the field is not even
 * fetched.
 */

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  /** The client this account belongs to, for CLIENT users. Null otherwise. */
  clientId: string | null;
  /** Resolved through a second SCOPED read, never a populate. */
  clientName: string | null;
  /** ISO 8601. Rendered with the viewer's locale, not the server's. */
  createdAt: string;
}

export function toUserSummary(
  document: Pick<
    UserDocument,
    "_id" | "name" | "email" | "role" | "status" | "clientId"
  > & {
    createdAt?: Date;
  },
  clientName: string | null,
): UserSummary {
  return {
    id: document._id.toHexString(),
    name: document.name,
    email: document.email,
    role: document.role,
    status: document.status,
    clientId: document.clientId ? document.clientId.toHexString() : null,
    clientName,
    createdAt: (document.createdAt ?? new Date(0)).toISOString(),
  };
}
