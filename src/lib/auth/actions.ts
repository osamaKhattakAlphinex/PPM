"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";

import { clientBelongsToOrganization, usersRepository } from "../db";
import { canAssignRole } from "./access";
import { signIn, signOut } from "./auth";
import { requireRole } from "./guard";
import { hashPassword } from "./password";
import { clientIpFrom, registerRateLimiter } from "./rate-limit";
import { loginFormSchema, registerUserSchema, safeRedirectPath } from "./schemas";

/**
 * The write side of authentication.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md: route handlers are
 * reserved for webhooks, files and AI endpoints. Both actions return a plain
 * result object instead of throwing, because they are consumed by
 * `useActionState` in a form — and because the message a user sees must be a
 * deliberate choice, never an exception's own text.
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
  });

  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "email" || field === "password") fieldErrors[field] = issue.message;
    }
    return { error: GENERIC_SIGN_IN_ERROR, fieldErrors };
  }

  const { email, password, callbackUrl } = parsed.data;

  // `/app/start` reads the freshly-issued session and forwards each role to its
  // own landing page. Anything arriving in `callbackUrl` is checked first: it
  // comes from a query string, so it is attacker-controlled.
  const redirectTo = safeRedirectPath(callbackUrl, "/app/start");

  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    // A successful sign-in throws NEXT_REDIRECT, which is not an AuthError and
    // MUST bubble — catching it would swallow the redirect and leave the user
    // signed in but still looking at the form.
    if (error instanceof AuthError) {
      return { error: signInErrorCode(error) === "rate_limited" ? RATE_LIMITED_ERROR : GENERIC_SIGN_IN_ERROR };
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

export interface RegisterState {
  ok?: true;
  userId?: string;
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password" | "role" | "clientId", string>>;
}

/**
 * Create a user inside the caller's organization.
 *
 * There is no public sign-up. An account is only meaningful relative to a
 * tenant, and CLAUDE.md rules out public write endpoints — so provisioning is
 * an authenticated staff action, and the new user's `organizationId` comes from
 * the actor's scope rather than from the payload.
 */
export async function registerAction(
  _previous: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  let context;
  try {
    context = await requireRole("ADMIN", "FM_MANAGER");
  } catch {
    // Same answer for "not signed in" and "not allowed": an unauthorised caller
    // learns nothing about what this action does.
    return { error: "You do not have access to this." };
  }

  const { user, scope } = context;

  // Not a brute-force defence — the caller is already authenticated. It caps
  // what a stolen staff session, or a runaway script, can create in one burst.
  const requestHeaders = await headers();
  const decision = registerRateLimiter.consume(`${user.id}:${clientIpFrom(requestHeaders)}`);
  if (!decision.allowed) {
    console.warn(`[auth] register rate limit hit for user ${user.id}`);
    return { error: RATE_LIMITED_ERROR };
  }

  const parsed = registerUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    clientId: formData.get("clientId") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors: RegisterState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (
        field === "name" ||
        field === "email" ||
        field === "password" ||
        field === "role" ||
        field === "clientId"
      ) {
        fieldErrors[field] = issue.message;
      }
    }
    return { error: "Check the details and try again.", fieldErrors };
  }

  const input = parsed.data;

  // Nobody may mint a role above their own: an FM_MANAGER creating an ADMIN
  // would be a one-step privilege escalation.
  if (!canAssignRole(user.role, input.role)) {
    console.warn(`[auth] ${user.role} attempted to create a ${input.role}`);
    return { error: "You cannot create a user with that role.", fieldErrors: { role: "Not allowed." } };
  }

  // A clientId from a form is never trusted to belong to the actor's tenant.
  if (input.role === "CLIENT") {
    const belongs = await clientBelongsToOrganization(input.clientId, scope.organizationId);
    if (!belongs) {
      return { error: "That client is not available.", fieldErrors: { clientId: "Unknown client." } };
    }
  }

  try {
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

    return { ok: true, userId: created._id.toHexString() };
  } catch (error) {
    // Email is unique system-wide, so a plain "already taken" would let staff
    // in one tenant probe for addresses in another. The message stays neutral.
    if (isDuplicateKeyError(error)) {
      return { error: "That email address is not available.", fieldErrors: { email: "Not available." } };
    }

    console.error("[auth] failed to create user", error);
    return { error: "Something went wrong. Try again." };
  }
}

/** MongoDB's duplicate-key error, without letting the driver's type leak out. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 11000
  );
}
