import { z } from "zod";

/** Only an ACTIVE user may hold a session. The rest are refused at sign-in. */
export const USER_STATUSES = ["ACTIVE", "INVITED", "SUSPENDED"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * The account lifecycle, as a rule rather than as a set of buttons.
 *
 * Pure: no session, no database, no React. The same predicate is consulted by
 * the action that performs a change and by the screen that decides whether to
 * draw the control, so a button can never offer a move the action would refuse.
 *
 *     INVITED ──activate──▶ ACTIVE ◀──activate── SUSPENDED
 *                              │                     ▲
 *                              └──── suspend ────────┘
 *
 * Three properties are deliberate:
 *
 *  - **`INVITED` is only ever left, never returned to.** An account that has
 *    signed in has a history; putting it back to "invited" would say it never
 *    had one. Withdrawing access is `SUSPENDED`, which is honest about the fact
 *    that the account existed and was used.
 *  - **A status change is not a deletion.** Suspending keeps the row, so the
 *    work orders, approvals and attendance records that point at this person
 *    still resolve to a name.
 *  - **Nothing here touches the role.** Status answers "may this account sign
 *    in"; role answers "what may it do". Conflating them is how a suspension
 *    quietly becomes a demotion.
 */

/** The statuses an administrator may move an account TO. */
export const ASSIGNABLE_USER_STATUSES = ["ACTIVE", "SUSPENDED"] as const;

export type AssignableUserStatus = (typeof ASSIGNABLE_USER_STATUSES)[number];

export const assignableUserStatusSchema = z.enum(ASSIGNABLE_USER_STATUSES);

/** Every legal move, keyed by every status so a new one is a compile error. */
export const USER_STATUS_TRANSITIONS: Readonly<
  Record<UserStatus, readonly UserStatus[]>
> = {
  // Created but never signed in. It can be let in, or it can be shut out.
  INVITED: ["ACTIVE", "SUSPENDED"],
  // Signed in and working. The only move is out.
  ACTIVE: ["SUSPENDED"],
  // Shut out. It can be let back in, but it can never be un-invited.
  SUSPENDED: ["ACTIVE"],
} as const;

export function canTransitionUserStatus(
  from: UserStatus,
  to: UserStatus,
): boolean {
  return USER_STATUS_TRANSITIONS[from].includes(to);
}

/** Every status the model knows, for a filter control. */
export const USER_STATUS_OPTIONS: readonly UserStatus[] = USER_STATUSES;

/**
 * How long a suspension takes to bite.
 *
 * Not immediately, and it matters that this is written down. A session is a
 * signed cookie; the server re-reads the account from the database only when
 * the token is older than `AUTH_SESSION_REVALIDATE_AFTER` (five minutes by
 * default). So a suspended person keeps their access until their next read
 * crosses that window.
 *
 * For a genuine emergency — a compromised account rather than an employee
 * leaving — the immediate lever is rotating `AUTH_SECRET`, which invalidates
 * every session in the deployment at once. That is documented here rather than
 * discovered at the worst possible moment.
 */
export const SUSPENSION_TAKES_EFFECT_WITHIN_SECONDS = 300;
