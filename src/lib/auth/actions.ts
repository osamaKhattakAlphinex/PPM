"use server";

import { AuthError } from "next-auth";

import { clientBelongsToOrganization, usersRepository } from "../db";
import { localeHref } from "../i18n/config";
import { defineFormAction, type ActionResult } from "../security/action";
import { AppError, ValidationError } from "../security/errors";
import { canAssignRole } from "./access";
import { signIn, signOut } from "./auth";
import { hashPassword } from "./password";
import { registerRateLimiter } from "./rate-limit";
import { loginFormSchema, registerUserSchema, safeRedirectPath } from "./schemas";

/**
 * The write side of authentication.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md: route handlers are
 * reserved for webhooks, files and AI endpoints.
 *
 * Note the split. `registerAction` runs behind a session, so it goes through
 * `defineFormAction` — the wrapper that authenticates, resolves scope, rate
 * limits, and parses with zod before the handler is entered. `loginAction`
 * cannot: it is the thing that CREATES the session, so there is nobody to
 * authenticate and nothing to scope. It keeps its own hand-written shape, and
 * that asymmetry is the point of the wrapper — everything downstream of
 * sign-in gets the same four checks for free.
 */

const GENERIC_SIGN_IN_ERROR = "That email and password combination is not valid.";
const RATE_LIMITED_ERROR = "Too many attempts. Wait a few minutes and try again.";

export interface LoginState {
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
}

/**
 * Sign in.
 *
 * Note what is NOT here: no rate limiting, no user lookup, no password
 * comparison. All of that lives in `authorize()` in `auth.ts`, because the
 * credentials endpoint Auth.js exposes is reachable without this action — a
 * check here would guard the polite path only. This function's job is to
 * validate the form, pick a safe redirect, and turn a failure into a sentence.
 */
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
    locale: formData.get("locale") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "email" || field === "password") fieldErrors[field] = issue.message;
    }
    return { error: GENERIC_SIGN_IN_ERROR, fieldErrors };
  }

  const { email, password, callbackUrl, locale } = parsed.data;

  // `/app/start` reads the freshly-issued session and forwards each role to its
  // own landing page. Anything arriving in `callbackUrl` is checked first: it
  // comes from a query string, so it is attacker-controlled. The fallback is
  // built with `localeHref` so a sign-in from the Arabic page does not bounce
  // through the middleware and land in English.
  const redirectTo = safeRedirectPath(callbackUrl, localeHref("/app/start", locale));

  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    // A successful sign-in throws NEXT_REDIRECT, which is not an AuthError and
    // MUST bubble — catching it would swallow the redirect and leave the user
    // signed in but still looking at the form.
    if (error instanceof AuthError) {
      return {
        error: signInErrorCode(error) === "rate_limited" ? RATE_LIMITED_ERROR : GENERIC_SIGN_IN_ERROR,
      };
    }
    throw error;
  }

  return {};
}

/**
 * `CredentialsSignin` carries a `code`, but `AuthError` does not declare one —
 * so it is read defensively rather than asserted. Only "rate_limited" changes
 * the message; every other code collapses into the generic one.
 */
function signInErrorCode(error: AuthError): string | undefined {
  const code = (error as unknown as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Sign out and drop the session cookie. */
export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export interface RegisteredUser {
  readonly userId: string;
}

/**
 * Create a user inside the caller's organization.
 *
 * The wrapper supplies everything above the business rule:
 *
 *   roles      -> the session must be ADMIN or FM_MANAGER, re-checked here and
 *                 not inherited from whatever page called it
 *   rateLimit  -> not a brute-force defence (the caller is signed in) but a cap
 *                 on what a stolen staff session can create in one burst
 *   input      -> parsed by zod, unknown fields rejected, before the handler runs
 *   scope      -> the actor's organizationId, which is where the new user's
 *                 tenant comes from. It is deliberately NOT a field in the
 *                 schema: a payload must never be able to choose a tenant.
 *
 * What is left is the part that is actually about creating a user.
 */
const runRegister = defineFormAction({
  name: "registerUser",
  roles: ["ADMIN", "FM_MANAGER"],
  input: registerUserSchema,
  rateLimit: registerRateLimiter,
  async handler({ input, user, scope }): Promise<RegisteredUser> {
    // Nobody may mint a role above their own: an FM_MANAGER creating an ADMIN
    // would be a one-step takeover of the tenant.
    if (!canAssignRole(user.role, input.role)) {
      throw new AppError(
        "FORBIDDEN",
        403,
        "You cannot create a user with that role.",
        `${user.role} attempted to create a ${input.role}`,
        { fields: { role: "Not allowed." } },
      );
    }

    // A clientId from a form is never trusted to belong to the actor's tenant.
    if (input.role === "CLIENT") {
      const belongs = await clientBelongsToOrganization(input.clientId, scope.organizationId);
      if (!belongs) {
        throw new ValidationError(`clientId ${input.clientId} is outside the actor's organization`, {
          clientId: "Unknown client.",
        });
      }
    }

    const created = await usersRepository.forScope(scope).create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      clientId: input.role === "CLIENT" ? input.clientId : null,
      // The account exists but cannot sign in until it is activated: a created
      // user is not an active one.
      status: "INVITED",
    });

    // A duplicate email throws 11000 here and is normalised into a neutral
    // 409 by the error handler. It is neutral on purpose — email is unique
    // system-wide, so "already taken" would let staff in one tenant probe for
    // addresses in another.
    return { userId: created._id.toHexString() };
  },
});

/**
 * Re-exported as a plain async function because every export of a `"use server"`
 * module has to be one — the wrapper's return value is assigned to a module
 * constant instead.
 */
export async function registerAction(
  previous: ActionResult<RegisteredUser> | undefined,
  formData: FormData,
): Promise<ActionResult<RegisteredUser>> {
  return runRegister(previous, formData);
}
