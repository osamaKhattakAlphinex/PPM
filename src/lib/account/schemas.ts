import { z } from "zod";

import { passwordSchema } from "@/lib/auth/schemas";

/**
 * Every payload that reaches an account action is parsed here first.
 *
 * Pure — no `server-only`, no session — so the same schema validates on the
 * server and can be imported by the form component or a test.
 *
 * What is deliberately NOT a field in either schema:
 *
 *  - **`id`.** Both actions act on the SIGNED-IN user and take no user
 *    parameter at all. That is the security property of this whole module: the
 *    worst a stolen session can do here is change the account it already
 *    holds. An id in the payload would turn "edit my profile" into "edit
 *    anybody's profile" the first time a check was forgotten.
 *  - **`role`, `status`, `clientId`, `organizationId`.** What an account may do
 *    and which tenant it belongs to are decided by an administrator, in
 *    `src/lib/admin/`. A self-service screen that could raise its own role is a
 *    privilege-escalation endpoint with a friendly name.
 *  - **`email`.** The sign-in identity. Changing it needs a verification round
 *    trip to the new address — otherwise a typo locks the account out, and a
 *    hijacked session can quietly take the account over by moving it to an
 *    address the real owner does not read. There is no mail delivery in the
 *    product yet, so it is read-only rather than badly done.
 */

export const updateProfileSchema = z.strictObject({
  name: z.string().trim().min(2, "Enter your full name").max(120),
});

export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

/**
 * Changing your own password.
 *
 * `currentPassword` is validated as non-empty rather than against the policy —
 * it is being CHECKED, not chosen, and an account whose password predates the
 * current rules must still be able to change it. `newPassword` gets the full
 * policy, because that one is being chosen.
 *
 * The confirmation is compared here rather than in the browser so that the
 * mismatch is caught even when the request never went through the form.
 */
export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, "Enter your current password").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords do not match.",
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you have not used here before.",
  });

export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
