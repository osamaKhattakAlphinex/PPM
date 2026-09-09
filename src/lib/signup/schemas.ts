import { z } from "zod";

import { emailSchema, passwordSchema } from "@/lib/auth/schemas";
import { localeSchema } from "@/lib/i18n/config";

/**
 * The two public write payloads in the product.
 *
 * CLAUDE.md says "no public write endpoints", and these are the deliberate
 * exception — so they are the two schemas in the codebase that most need to be
 * exact about what they will not accept.
 *
 * Both are `strictObject`, so an unknown key is a rejection rather than a
 * silently stripped field. Neither carries a `role`: sign-up mints an ADMIN
 * because it is creating the tenant that admin will own, and an invitation
 * carries whatever role the administrator already chose. A role in either
 * payload would be a role anybody could ask for.
 */

/**
 * A honeypot.
 *
 * The field is rendered, hidden from people by CSS and from screen readers by
 * `aria-hidden`, and left empty by anyone who is not a form-filling bot. It
 * stops the low-effort majority of automated submissions for the price of one
 * input, and it costs a real visitor nothing — no puzzle, no third-party
 * script, no image of squashed letters.
 *
 * It is NOT a security control, and nothing downstream depends on it. Anyone
 * who reads the page source defeats it in a minute; the rate limit is what
 * holds against somebody actually trying.
 */
export const honeypotSchema = z
  .string()
  .max(0, "Rejected.")
  .optional()
  .or(z.literal("").optional());

export const signupSchema = z.strictObject({
  organizationName: z
    .string()
    .trim()
    .min(2, "Enter your company name")
    .max(120),
  name: z.string().trim().min(2, "Enter your full name").max(120),
  email: emailSchema,
  password: passwordSchema,
  /**
   * The tenant's default language. Taken from the page the person signed up on
   * rather than asked for — somebody registering on the Arabic site wants an
   * Arabic workspace, and one fewer question on a sign-up form is worth more
   * than the setting being explicit. `catch` rather than `optional` so a
   * tampered value degrades to the default instead of failing the whole
   * registration.
   */
  locale: localeSchema.catch("en").default("en"),
  /** Must be empty. See above. */
  website: honeypotSchema,
  /**
   * Explicit consent, rather than a pre-ticked box or a line of small print.
   * `literal(true)` because an unchecked HTML checkbox submits nothing at all,
   * so "absent" and "refused" are the same thing and both must fail.
   */
  acceptTerms: z.literal("on", {
    message: "Please accept the terms to continue.",
  }),
});

export type SignupInput = z.input<typeof signupSchema>;

/**
 * Accepting an invitation.
 *
 * The token arrives in the URL and is passed through as a field, so it is
 * validated to shape here — 64 hex characters, being 32 bytes of CSPRNG output
 * — before anything hashes it or looks it up. What is STORED is a digest of
 * this, never this.
 *
 * There is no email field, and that is the important absence: who the
 * invitation is for was decided when it was issued. A form that could name an
 * account would let anyone holding any valid token set anybody's password.
 */
export const acceptInviteSchema = z
  .strictObject({
    token: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "This invitation link is not valid."),
    password: passwordSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords do not match.",
  });

export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;
