"use server";

import { revalidatePath } from "next/cache";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { connectToDatabase, usersRepository } from "@/lib/db";
import { defineFormAction, type ActionResult } from "@/lib/security/action";
import { sensitiveMutationRateLimiter } from "@/lib/security/rate-limit";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { changePasswordSchema, updateProfileSchema } from "./schemas";

/**
 * The write side of the account screen.
 *
 * Both actions act on `user.id` — the SIGNED-IN user, taken from the session —
 * and neither accepts a user id in its payload. That is the whole security
 * design of this module, and it is why there is no ownership check in either
 * handler: there is no way to name somebody else's account, so there is nothing
 * to check.
 */

const ACCOUNT_PATH = "/[locale]/app/account";

const runUpdateProfile = defineFormAction({
  name: "updateProfile",
  // Every signed-in role may edit their own name. There is no role that should
  // be unable to correct the spelling of their own name.
  roles: ["ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN", "CLIENT"],
  input: updateProfileSchema,
  async handler({ input, user, scope }): Promise<{ name: string }> {
    await connectToDatabase();

    const updated = await usersRepository
      .forScope(scope)
      .update(user.id, { name: input.name });

    if (!updated) throw new NotFoundError("User");

    revalidatePath(ACCOUNT_PATH, "page");

    /**
     * The session still carries the OLD name until the token revalidates
     * (`AUTH_SESSION_REVALIDATE_AFTER`, five minutes by default), so the top
     * bar lags the form by up to that long. Deliberate: re-minting a session
     * on a cosmetic change would mean a write path that issues credentials,
     * which is a much larger thing to get right than a stale display name.
     */
    return { name: updated.name };
  },
});

/**
 * Change your own password.
 *
 * The current password is required, and that is not a formality: a session
 * cookie is a bearer token, so without this check anyone who borrowed an
 * unlocked laptop for thirty seconds could set a password of their own and
 * convert temporary physical access into permanent remote access. Requiring
 * the old one means they need something the session alone does not carry.
 *
 * Three further details:
 *
 *  - **The stored hash is fetched explicitly.** `passwordHash` is `select:
 *    false` on the model, so it has to be asked for by name — a projection
 *    that forgot it would make this check compare against nothing.
 *  - **A wrong current password is a validation error on that field**, not a
 *    403. There is no enumeration risk here (the caller already holds the
 *    account) and telling them which field is wrong is the difference between
 *    a usable form and a mystery.
 *  - **Rate-limited on the sensitive limiter** (10/min, then a five-minute
 *    block) rather than the ordinary mutation one. This is a password oracle
 *    if it is left cheap: an attacker with a borrowed session could otherwise
 *    guess the account's password at 120 attempts a minute.
 */
const runChangePassword = defineFormAction({
  name: "changePassword",
  roles: ["ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN", "CLIENT"],
  input: changePasswordSchema,
  rateLimit: sensitiveMutationRateLimiter,
  async handler({ input, user, scope }): Promise<{ changed: true }> {
    await connectToDatabase();

    const users = usersRepository.forScope(scope);

    const existing = await users.findById(user.id, {
      select: ["_id", "passwordHash"],
    });
    if (!existing) throw new NotFoundError("User");

    const matches = await verifyPassword(
      existing.passwordHash,
      input.currentPassword,
    );
    if (!matches) {
      throw new ValidationError("current password did not match", {
        currentPassword: "That is not your current password.",
      });
    }

    const updated = await users.update(user.id, {
      passwordHash: await hashPassword(input.newPassword),
      /**
       * A password change also clears any outstanding invitation. If one is
       * still live, somebody holds a link that can set this account's password
       * without knowing the current one — which is exactly what the check above
       * exists to prevent.
       */
      inviteTokenHash: null,
      inviteExpiresAt: null,
    });

    if (!updated) throw new NotFoundError("User");

    /**
     * Existing sessions are NOT invalidated, and that is a real limitation
     * rather than an oversight: sessions are stateless JWEs, so revoking them
     * individually needs a server-side session store or a per-user token
     * version. It is written down in `docs/SECURITY.md` §8 rather than left to
     * be discovered. The lever that does work today is rotating `AUTH_SECRET`,
     * which signs out the whole deployment.
     */
    return { changed: true };
  },
});

/**
 * Re-exported as plain async functions because every export of a `"use server"`
 * module has to be one — and because every one of them is a browser-callable
 * endpoint, nothing taking a `TenantScope` may appear here.
 */
export async function updateProfileAction(
  previous: ActionResult<{ name: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ name: string }>> {
  return runUpdateProfile(previous, formData);
}

export async function changePasswordAction(
  previous: ActionResult<{ changed: true }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ changed: true }>> {
  return runChangePassword(previous, formData);
}
