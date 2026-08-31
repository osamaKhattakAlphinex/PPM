import { z } from "zod";

import { roleSchema } from "./roles";

/**
 * Every value that enters authentication is parsed here first.
 *
 * Two shapes of object, parsed two different ways on purpose:
 *
 *  - Payloads WE define (the login form, the register action) are strict:
 *    an unknown key is an error, per CLAUDE.md.
 *  - The credentials object Auth.js hands to `authorize()` is stripped, not
 *    rejected, because Auth.js puts its own `csrfToken`/`callbackUrl` fields in
 *    that body. Being strict there would fail every real sign-in.
 *
 * Parsing also normalises: emails are trimmed and lowercased BEFORE the format
 * check (hence the `.pipe()`), so the value that reaches the database is
 * byte-identical to the one stored, and " Admin@Ppm.local " signs in.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

/**
 * Length over composition rules, per NIST SP 800-63B: a 12-character
 * passphrase beats "one uppercase, one digit, one symbol" at 8. The upper
 * bound is a denial-of-service guard — argon2 will happily hash a megabyte.
 */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters");

/** What `authorize()` reads out of the sign-in POST body. */
export const credentialsSchema = z.object({
  email: emailSchema,
  // NOT `passwordSchema`: the policy applies when a password is CHOSEN. At
  // sign-in a short password is simply a wrong password, and rejecting it early
  // would tell an attacker which stored passwords predate the current rules.
  password: z.string().min(1).max(128),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** What the login form submits. Strict — we own this shape. */
export const loginFormSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(128),
  /** Validated again by `safeRedirectPath()` before it is ever followed. */
  callbackUrl: z.string().max(2_048).optional(),
});

export type LoginFormInput = z.input<typeof loginFormSchema>;

/**
 * Creating a user inside an existing organization.
 *
 * There is no self-service registration: CLAUDE.md forbids public write
 * endpoints, and in a multi-tenant CMMS an account only means something
 * relative to a tenant. The organizationId is taken from the actor's session,
 * never from this payload — which is why it is not a field here.
 */
export const registerUserSchema = z
  .strictObject({
    name: z.string().trim().min(2, "Enter a full name").max(120),
    email: emailSchema,
    password: passwordSchema,
    role: roleSchema,
    /** A 24-character id, re-checked against the actor's org before it is used. */
    clientId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Select a client")
      .optional(),
  })
  .refine((value) => (value.role === "CLIENT" ? Boolean(value.clientId) : !value.clientId), {
    // Mirrors the invariant enforced on the User model itself, so a bad payload
    // is rejected with a field message instead of a database validation error.
    path: ["clientId"],
    message: "A CLIENT user needs a client; other roles must not have one.",
  });

export type RegisterUserInput = z.input<typeof registerUserSchema>;

/**
 * Restrict a post-login redirect to a path inside this app.
 *
 * `callbackUrl` arrives in a query string, so it is attacker-controlled: left
 * unchecked it turns the login page into an open redirect ("log in, then get
 * sent to a phishing clone"). Only a single-slash absolute path survives —
 * "//evil.com" and "https://evil.com" and "/\evil.com" do not.
 */
export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return fallback;
  if (!value.startsWith("/")) return fallback;
  // "//host" is protocol-relative and "/\host" is treated as such by browsers.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // A control character can split a header or smuggle a second URL. Checked
  // by code point rather than a regex so the source carries no raw control bytes.
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  return value;
}
