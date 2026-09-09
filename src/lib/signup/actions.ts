"use server";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/auth";
import { hashPassword } from "@/lib/auth/password";
import {
  completeInvitation,
  findInvitedAccount,
  findOrganizationBySlug,
  provisionTenant,
} from "@/lib/db";
import { isSignupEnabled } from "@/lib/env";
import { localeHref } from "@/lib/i18n/config";
import { clientIpFrom, enforceRateLimit } from "@/lib/security/rate-limit";
import { RateLimitError } from "@/lib/security/errors";
import { inviteRateLimiter, signupRateLimiter } from "./rate-limit";
import { acceptInviteSchema, signupSchema } from "./schemas";
import { availableSlug } from "./slug";
import { hashInviteToken } from "./tokens";

/**
 * The product's two public write endpoints.
 *
 * CLAUDE.md says there are none, and these are the deliberate exception, so
 * they are written to be defensible one line at a time rather than to be
 * convenient.
 *
 * Neither uses `defineAction`. That wrapper's first step is authenticating, and
 * the whole point of these two is that nobody is signed in yet — so every step
 * it would have performed is performed here explicitly and in the same order:
 * refuse if disabled, rate limit by IP, parse strictly, then act.
 *
 * What neither of them can do is as important as what they do:
 *
 *  - **Sign-up touches nothing that exists.** It reads two uniqueness
 *    constraints and writes two brand-new rows. There is no path through it
 *    that can read, modify or name a row belonging to an existing tenant.
 *  - **Invitation acceptance creates nothing.** It can only complete an
 *    invitation an administrator already issued, to an account they already
 *    chose the role of, and it burns the token doing so.
 */

const RATE_LIMITED_ERROR = "Too many attempts. Wait a while and try again.";
const UNEXPECTED_ERROR =
  "Something went wrong on our side. Please try again in a moment.";
const CLOSED_ERROR = "Registration is not open on this deployment.";
const TAKEN_ERROR =
  "That email address cannot be used to register. If you already have an account, sign in instead.";
const INVALID_INVITE_ERROR =
  "This invitation link is no longer valid. Ask for a new one.";

export interface PublicFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Collect zod issues into the shape the forms render. */
function fieldErrorsFrom(
  issues: readonly { path: PropertyKey[]; message: string }[],
) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field])
      fieldErrors[field] = issue.message;
  }
  return fieldErrors;
}

async function clientIp(): Promise<string> {
  return clientIpFrom(await headers());
}

/**
 * Turn any unexpected failure into a sentence, the way `defineAction` does for
 * every other mutation in the product.
 *
 * These two actions cannot use that wrapper — its first step is authenticating,
 * and the whole point of these is that nobody is signed in — so the wrapper's
 * error handling has to be repeated here. Without it an unreachable database, a
 * duplicate index or any other surprise escapes the action, React answers the
 * POST with a 500, and the browser replaces the page with a crash screen. From
 * the visitor's side that is indistinguishable from the button doing nothing,
 * which is exactly how it was reported.
 *
 * `unstable_rethrow` is what keeps that from swallowing the framework's own
 * control-flow signals: a successful `signIn` works by THROWING a redirect, so
 * catching it would leave somebody signed in and still looking at the form.
 * Next owns the list of those signals, so this asks Next rather than sniffing
 * for a digest prefix that could change.
 *
 * The message is deliberately generic and the detail goes to the server log.
 * These endpoints are unauthenticated, so anything specific is something an
 * anonymous caller learns about the inside of the system.
 */
async function guarded(
  name: string,
  run: () => Promise<PublicFormState>,
): Promise<PublicFormState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[signup] ${name} failed`, error);
    return { error: UNEXPECTED_ERROR };
  }
}

/**
 * Register a new company and its first administrator.
 *
 * The order below is the security design, so it is worth reading as a sequence:
 *
 *  1. **Closed?** Checked in the action, not only in the page. A hidden form is
 *     not a disabled endpoint — the action is reachable by POST regardless of
 *     what was rendered.
 *  2. **Rate limit, before parsing.** Three an hour per address. Limiting after
 *     validation would let an attacker spend our CPU on argon2 and zod for free
 *     by sending garbage.
 *  3. **Parse strictly.** Unknown keys rejected, the honeypot required empty,
 *     the terms box required ticked.
 *  4. **Derive a handle**, and give up rather than invent a twelfth numbered
 *     variant.
 *  5. **Provision**, which is the only unscoped write in the product besides
 *     the seed, and answers one neutral outcome for both kinds of collision.
 *  6. **Sign them in**, so the first thing they see is their own empty
 *     workspace rather than a login form asking for credentials they typed
 *     thirty seconds ago.
 */
export async function signupAction(
  _previous: PublicFormState,
  formData: FormData,
): Promise<PublicFormState> {
  return guarded("signup", () => runSignup(formData));
}

async function runSignup(formData: FormData): Promise<PublicFormState> {
  if (!isSignupEnabled()) return { error: CLOSED_ERROR };

  try {
    enforceRateLimit(signupRateLimiter, await clientIp());
  } catch (error) {
    if (error instanceof RateLimitError) return { error: RATE_LIMITED_ERROR };
    throw error;
  }

  const parsed = signupSchema.safeParse({
    organizationName: formData.get("organizationName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale") ?? undefined,
    companyReference: formData.get("companyReference") ?? undefined,
    acceptTerms: formData.get("acceptTerms") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors = fieldErrorsFrom(parsed.error.issues);

    /**
     * A filled honeypot is answered as though it succeeded — no error, no
     * field message, no account. Telling a bot which field gave it away is
     * how the next version of the bot stops filling that field.
     */
    if (fieldErrors.companyReference) return {};

    return { error: undefined, fieldErrors };
  }

  const { organizationName, name, email, password, locale } = parsed.data;

  const slug = await availableSlug(
    organizationName,
    async (candidate) => (await findOrganizationBySlug(candidate)) !== null,
  );

  if (!slug) {
    return {
      fieldErrors: {
        organizationName:
          "We could not make a web address from that name. Try adding a Latin-letter version.",
      },
    };
  }

  const outcome = await provisionTenant({
    organizationName,
    slug,
    name,
    email,
    passwordHash: await hashPassword(password),
    defaultLocale: locale,
  });

  if (!outcome.ok) {
    /**
     * One message for "that email exists" and "that company exists" alike.
     * Email is unique system-wide, so a specific answer would make this an
     * oracle for who already uses the product — worth more to a competitor
     * than the extra clarity is to a customer who can simply sign in.
     */
    return { fieldErrors: { email: TAKEN_ERROR } };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: localeHref("/app/start", locale),
    });
  } catch (error) {
    // A successful sign-in throws NEXT_REDIRECT, which MUST bubble — catching
    // it would leave them signed in and still looking at the form.
    if (error instanceof AuthError) {
      // The account exists; only the automatic sign-in failed. Send them to
      // the login page rather than pretending nothing worked.
      return { error: "Your company is ready. Please sign in." };
    }
    throw error;
  }

  return {};
}

/**
 * Accept an invitation: set a password and activate the account.
 *
 * The token is hashed before anything is looked up, so the raw value never
 * reaches a query. `completeInvitation` matches on the digest INSIDE its
 * update, which is what makes two people racing the same link safe: the second
 * update matches nothing, because the first already cleared the field.
 *
 * Every failure — unknown token, expired token, suspended account, already
 * redeemed — answers the same sentence. They are genuinely indistinguishable
 * to the caller, which is the only way to be sure the endpoint cannot be used
 * to probe which invitations exist.
 */
export async function acceptInviteAction(
  _previous: PublicFormState,
  formData: FormData,
): Promise<PublicFormState> {
  return guarded("acceptInvite", () => runAcceptInvite(formData));
}

async function runAcceptInvite(formData: FormData): Promise<PublicFormState> {
  try {
    enforceRateLimit(inviteRateLimiter, await clientIp());
  } catch (error) {
    if (error instanceof RateLimitError) return { error: RATE_LIMITED_ERROR };
    throw error;
  }

  const parsed = acceptInviteSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const fieldErrors = fieldErrorsFrom(parsed.error.issues);
    if (fieldErrors.token) return { error: INVALID_INVITE_ERROR };
    return { fieldErrors };
  }

  const tokenHash = hashInviteToken(parsed.data.token);

  // Read first, only to learn the email needed for the sign-in below. The
  // update that follows re-checks the digest and the expiry itself, so this
  // read is not what authorises anything.
  const invited = await findInvitedAccount(tokenHash);
  if (!invited) return { error: INVALID_INVITE_ERROR };

  const completed = await completeInvitation(
    tokenHash,
    await hashPassword(parsed.data.password),
  );
  if (!completed) return { error: INVALID_INVITE_ERROR };

  const locale = formData.get("locale");

  try {
    await signIn("credentials", {
      email: invited.email,
      password: parsed.data.password,
      redirectTo: localeHref("/app/start", locale === "ar" ? "ar" : "en"),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Your password is set. Please sign in." };
    }
    throw error;
  }

  return {};
}
