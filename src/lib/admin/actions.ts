"use server";

import { revalidatePath } from "next/cache";

import { canAssignRole } from "@/lib/auth/access";
import { connectToDatabase, usersRepository, type Page } from "@/lib/db";
import { canTransitionUserStatus } from "@/lib/domain/users";
import { invitePath, issueInvitation } from "@/lib/signup/tokens";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { sensitiveMutationRateLimiter } from "@/lib/security/rate-limit";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "@/lib/security/errors";
import { toUserSummary, type UserSummary } from "./dto";
import { listUsersForScope, USER_ADMINS } from "./queries";
import {
  inviteUserSchema,
  listUsersSchema,
  setUserStatusSchema,
} from "./schemas";

/**
 * The write side of user administration.
 *
 * Creating an account lives in `src/lib/auth/actions.ts` beside the password
 * hashing, and is unchanged. What is here is the second half of the lifecycle:
 * letting a created account in, and shutting one out.
 *
 * Everything above the business rule comes from `defineAction` — authenticate,
 * check the role, resolve the tenant scope, rate limit, parse with zod, in that
 * order. `organizationId` is not a field in any schema here.
 */

const ADMIN_PATH = "/[locale]/app/admin";

const runListUsers = defineAction({
  name: "listUsers",
  roles: USER_ADMINS,
  input: listUsersSchema,
  async handler({ input, scope }): Promise<Page<UserSummary>> {
    return listUsersForScope(scope, input);
  },
});

/**
 * Activate or suspend one account.
 *
 * Four checks, and each one closes a different door:
 *
 *  1. **The id is re-scoped.** `findById` on the scoped repository treats the
 *     id as a filter TERM with `organizationId` layered on top, so an id from
 *     another tenant matches nothing and returns a plain "not found" — never a
 *     message that would confirm the account exists somewhere.
 *  2. **The move must be legal.** Checked against the row's CURRENT status, not
 *     against what the form believed it was. Nothing may return to `INVITED`.
 *  3. **Never yourself.** An administrator suspending their own account locks
 *     themselves out of the screen that would undo it, and an organization can
 *     end up with no way back in. It is refused rather than confirmed.
 *  4. **Never upwards.** An FM_MANAGER may not suspend an ADMIN. The rule is
 *     `canAssignRole` — the same table that says who may CREATE which role —
 *     because "can shut this person out" and "could have created this person"
 *     are the same authority, and letting them diverge is how a manager
 *     disables the only administrator and takes the tenant.
 */
const runSetUserStatus = defineAction({
  name: "setUserStatus",
  roles: USER_ADMINS,
  input: setUserStatusSchema,
  async handler({ input, user, scope }): Promise<UserSummary> {
    await connectToDatabase();

    const users = usersRepository.forScope(scope);

    const existing = await users.findById(input.id, {
      select: [
        "_id",
        "name",
        "email",
        "role",
        "status",
        "clientId",
        "createdAt",
      ],
    });
    if (!existing) throw new NotFoundError("User");

    if (existing._id.toHexString() === user.id) {
      throw new ValidationError(
        "An administrator may not change their own status",
        {
          status: "You cannot change your own account.",
        },
      );
    }

    if (!canAssignRole(user.role, existing.role)) {
      throw new AppError(
        "FORBIDDEN",
        403,
        "You cannot change that account.",
        `${user.role} attempted to set the status of a ${existing.role}`,
      );
    }

    if (!canTransitionUserStatus(existing.status, input.status)) {
      throw new ValidationError(
        `illegal user status transition ${existing.status} -> ${input.status}`,
        {
          status: `An account cannot go from ${existing.status} to ${input.status}.`,
        },
      );
    }

    const updated = await users.update(input.id, { status: input.status });
    if (!updated) throw new NotFoundError("User");

    revalidatePath(ADMIN_PATH, "page");

    // The client name is not re-read: the status change did not touch it, and
    // the row re-renders from the list beneath. Null here means "not shown on
    // this one row until the next load", never "no client".
    return toUserSummary(updated, null);
  },
});

/**
 * Mint a single-use invitation link for one account.
 *
 * The link is the way a colleague sets their OWN password. Without it an
 * administrator has to invent one, tell them what it is, and hope they change
 * it — which means a password known to two people, communicated over whatever
 * channel was to hand.
 *
 * The scheme, all of which is in `src/lib/signup/tokens.ts`:
 *
 *  - 32 bytes of CSPRNG output. The RAW token is returned here, once, and is
 *    never stored: what goes into the database is a SHA-256 digest of it, so a
 *    dump of the users collection contains nothing anybody can redeem.
 *  - Seven days. An invitation that never expired would be a permanent
 *    password-reset link living in an inbox.
 *  - Re-issuing REPLACES the digest, so the previous link stops working. That
 *    is what makes "I forwarded it to the wrong person" recoverable.
 *
 * The same two authority checks as a status change, for the same reason: an
 * FM_MANAGER must not be able to mint a link that sets an ADMIN's password, and
 * nobody needs to invite themselves.
 */
const runInviteUser = defineAction({
  name: "inviteUser",
  roles: USER_ADMINS,
  input: inviteUserSchema,
  // Minting credentials is not an ordinary write. Ten a minute is far above an
  // administrator onboarding a team and far below a script harvesting links.
  rateLimit: sensitiveMutationRateLimiter,
  async handler({ input, user, scope }): Promise<{ path: string }> {
    await connectToDatabase();

    const users = usersRepository.forScope(scope);

    const existing = await users.findById(input.id, {
      select: ["_id", "role", "status"],
    });
    if (!existing) throw new NotFoundError("User");

    if (existing._id.toHexString() === user.id) {
      throw new ValidationError("an administrator may not invite themselves", {
        id: "You already have an account.",
      });
    }

    if (!canAssignRole(user.role, existing.role)) {
      throw new AppError(
        "FORBIDDEN",
        403,
        "You cannot invite that account.",
        `${user.role} attempted to invite a ${existing.role}`,
      );
    }

    if (existing.status === "SUSPENDED") {
      throw new ValidationError("cannot invite a suspended account", {
        id: "Activate the account before sending an invitation.",
      });
    }

    const invitation = issueInvitation();

    const updated = await users.update(input.id, {
      inviteTokenHash: invitation.tokenHash,
      inviteExpiresAt: invitation.expiresAt,
    });
    if (!updated) throw new NotFoundError("User");

    revalidatePath(ADMIN_PATH, "page");

    /**
     * A PATH, not an absolute URL. The origin belongs to whoever is reading —
     * building it here would mean trusting a request header for the host, which
     * is how a link ends up pointing at an attacker's domain with a real token
     * on the end of it. The browser prepends its own origin.
     *
     * The locale is the invitee's starting language, not the administrator's
     * current one; "en" is the safe default, and the invitation page has its
     * own language switch.
     */
    return { path: invitePath("en", invitation.token) };
  },
});

/**
 * Re-exported as plain async functions because every export of a `"use server"`
 * module has to be one — and because every export of such a module is a
 * browser-callable endpoint, nothing that takes a `TenantScope` may appear
 * here. The scope-taking halves live in `queries.ts`, which is `server-only`.
 */
export async function listUsersAction(
  payload: unknown,
): Promise<ActionResult<Page<UserSummary>>> {
  return runListUsers(payload);
}

export async function setUserStatusAction(
  payload: unknown,
): Promise<ActionResult<UserSummary>> {
  return runSetUserStatus(payload);
}

export async function inviteUserAction(
  payload: unknown,
): Promise<ActionResult<{ path: string }>> {
  return runInviteUser(payload);
}
