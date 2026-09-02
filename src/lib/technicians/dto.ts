import type { TechnicianDocument } from "@/lib/db";
import type { TechnicianStatus, Trade } from "@/lib/domain/technicians";

/**
 * The shapes that cross the server/client boundary.
 *
 * Same two reasons as `master-data/dto.ts`:
 *
 *  1. React cannot serialise an `ObjectId` or a `Date` into a client payload.
 *     Mapping here makes that a type error at build time instead of a runtime
 *     "Only plain objects can be passed" in a page nobody has opened yet.
 *  2. It is an explicit answer to "what does the browser get?". A document
 *     forwarded wholesale ships whatever field is added to the model next.
 *     Nothing reaches the client unless it is named below.
 */

export interface TechnicianSummary {
  id: string;
  name: string;
  trade: Trade;
  skills: string[];
  status: TechnicianStatus;
  /** The linked `User`, or null when this person has no sign-in account. */
  userId: string | null;
  /**
   * Resolved through a second SCOPED read, never a populate. Null when there is
   * no link, and also null when the link points at an account the caller's
   * scope cannot see — which is the safe direction: a name that could not be
   * read is simply not shown.
   */
  userName: string | null;
  userEmail: string | null;
  /** ISO 8601. Rendered with the viewer's locale, not the server's. */
  createdAt: string;
}

/** The sign-in accounts a technician may be linked to, for the form's picker. */
export interface TechnicianAccountOption {
  id: string;
  name: string;
  email: string;
  /**
   * The technician already holding this account, if any. The form disables
   * those rather than hiding them, so an admin can see *why* an account is
   * unavailable instead of wondering where it went. The uniqueness itself is
   * enforced by a partial unique index, not by this flag.
   */
  linkedTechnicianId: string | null;
}

export function toTechnicianSummary(
  document: TechnicianDocument,
  account: { name: string; email: string } | null,
): TechnicianSummary {
  return {
    id: document._id.toHexString(),
    name: document.name,
    trade: document.trade,
    // Copied rather than passed through: the lean document's array is the one
    // the driver handed us, and it must not become a live reference in a
    // client payload.
    skills: [...(document.skills ?? [])],
    status: document.status,
    userId: document.userId ? document.userId.toHexString() : null,
    userName: account?.name ?? null,
    userEmail: account?.email ?? null,
    createdAt: document.createdAt.toISOString(),
  };
}
