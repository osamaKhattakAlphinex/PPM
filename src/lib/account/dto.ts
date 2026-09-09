import type { Role } from "@/lib/auth/roles";
import type { UserStatus } from "@/lib/domain/users";

/**
 * What the account screen is allowed to know about its own user.
 *
 * Named explicitly rather than forwarded from the document, for the usual
 * reason plus one specific to this collection: a `User` carries
 * `passwordHash`, and a screen that spread the document would put an argon2
 * digest of the viewer's own password into the page source. It is not here, and
 * the read that feeds it projects, so it is not fetched either.
 */
export interface AccountProfile {
  name: string;
  /** Read-only: the sign-in identity. See the note in `schemas.ts`. */
  email: string;
  role: Role;
  status: UserStatus;
  /** The tenant's display name, so the page says whose account this is. */
  organizationName: string | null;
  /** For a CLIENT user, the customer they are pinned to. Null for staff. */
  clientName: string | null;
  /** ISO 8601, or null for an account that has never signed in. */
  lastLoginAt: string | null;
}
