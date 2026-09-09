"use server";

import { revalidatePath } from "next/cache";

import { canAssignRole } from "@/lib/auth/access";
import { connectToDatabase, usersRepository, type Page } from "@/lib/db";
import { canTransitionUserStatus } from "@/lib/domain/users";
import { defineAction, type ActionResult } from "@/lib/security/action";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "@/lib/security/errors";
import { toUserSummary, type UserSummary } from "./dto";
import { listUsersForScope, USER_ADMINS } from "./queries";
import { listUsersSchema, setUserStatusSchema } from "./schemas";

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
