import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import {
  findIdentityById,
  findSignInCandidate,
  recordSuccessfulLogin,
  updatePasswordHash,
  type SignInCandidate,
} from "../db";
import { getServerEnv } from "../env";
import { authConfig, SESSION_REVALIDATE_AFTER_SECONDS, tokenClaimsSchema } from "./config";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import {
  clientIpFrom,
  loginByEmailRateLimiter,
  loginRateLimiter,
  type RateLimitDecision,
} from "./rate-limit";
import { credentialsSchema } from "./schemas";

/**
 * The Node half of Auth.js: the part that can reach MongoDB and argon2.
 *
 * NEVER import this module from middleware or any other Edge-runtime code —
 * `src/middleware.ts` builds its own instance from the shared config in
 * `config.ts` for exactly that reason.
 */

/**
 * Distinguishes "slow down" from "wrong password" for the login form, without
 * telling an anonymous caller anything about the account. Auth.js surfaces
 * `code` on the error it throws back to the server action.
 */
export class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

/** Every other failure looks identical from outside. */
class InvalidCredentials extends CredentialsSignin {
  code = "invalid_credentials";
}

function logRateLimit(kind: string, key: string, decision: RateLimitDecision): void {
  console.warn(
    `[auth] sign-in rate limit hit (${kind}=${key}); retry in ${decision.retryAfterSeconds}s`,
  );
}

/**
 * Rate-limit the sign-in attempt itself, on both axes.
 *
 * Enforced HERE rather than in the login server action because the credentials
 * callback URL is a real, publicly reachable endpoint: an attacker posts
 * straight to it and never touches our form. This is the only chokepoint every
 * attempt has to pass.
 */
function assertWithinRateLimits(email: string, request: Request | undefined): void {
  const ip = request ? clientIpFrom(request.headers) : "unknown";

  const byIp = loginRateLimiter.consume(ip);
  if (!byIp.allowed) {
    logRateLimit("ip", ip, byIp);
    throw new RateLimitedSignin();
  }

  const byEmail = loginByEmailRateLimiter.consume(email);
  if (!byEmail.allowed) {
    logRateLimit("email", email, byEmail);
    throw new RateLimitedSignin();
  }
}

function clearRateLimits(email: string, request: Request | undefined): void {
  if (request) loginRateLimiter.reset(clientIpFrom(request.headers));
  loginByEmailRateLimiter.reset(email);
}

/** A CLIENT user whose clientId went missing would be scoped to the whole org. */
function isSignInEligible(candidate: SignInCandidate): boolean {
  if (candidate.status !== "ACTIVE") return false;
  if (candidate.organizationStatus !== "ACTIVE") return false;
  if (candidate.role === "CLIENT" && !candidate.clientId) return false;
  return true;
}

/** Upgrade a digest made under weaker parameters, while the plaintext exists. */
async function upgradeHashIfStale(candidate: SignInCandidate, password: string): Promise<void> {
  if (!needsRehash(candidate.passwordHash)) return;

  try {
    await updatePasswordHash(candidate.id, await hashPassword(password));
  } catch (error) {
    // Cosmetic maintenance: it must never cost the user their sign-in.
    console.error("[auth] password re-hash failed", error);
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      // Shown by Auth.js's built-in page, which this app never uses — the login
      // form is ours. Declared because the provider requires the field.
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      /**
       * Returns a user, or null for "no". Null is the ONLY negative answer:
       * unknown address, wrong password, suspended account and suspended tenant
       * are indistinguishable from outside, and all four cost one argon2
       * verification, so they take the same time as well.
       */
      async authorize(raw, request) {
        // Fails loudly at the first sign-in attempt if AUTH_SECRET or the
        // Mongo settings are missing, rather than at some later request.
        getServerEnv();

        // Stripped rather than strict: Auth.js puts csrfToken and callbackUrl
        // in this same body.
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        assertWithinRateLimits(email, request);

        const candidate = await findSignInCandidate(email);

        // Runs against a decoy digest when there is no such user, so the
        // response time does not reveal which addresses have accounts.
        const passwordMatches = await verifyPassword(candidate?.passwordHash, password);

        if (!candidate || !passwordMatches) {
          console.warn(`[auth] failed sign-in for ${email}`);
          throw new InvalidCredentials();
        }

        if (!isSignInEligible(candidate)) {
          console.warn(`[auth] blocked sign-in for ${email} (status=${candidate.status})`);
          throw new InvalidCredentials();
        }

        clearRateLimits(email, request);
        await recordSuccessfulLogin(candidate.id);
        await upgradeHashIfStale(candidate, password);

        // Exactly the claims the session needs — the hash stops here.
        return {
          id: candidate.id,
          email: candidate.email,
          name: candidate.name,
          role: candidate.role,
          organizationId: candidate.organizationId,
          clientId: candidate.clientId,
        };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * The shared callback populates the token at sign-in; this one keeps it
     * honest afterwards.
     *
     * A JWT session cannot be revoked from the server, so a role change or a
     * suspension would otherwise sit unnoticed until the token expired. Every
     * `AUTH_SESSION_REVALIDATE_AFTER` seconds the identity is re-read and the
     * claims are refreshed — or the session is dropped, by returning null.
     *
     * Only definitive answers revoke. If the database is unreachable the token
     * is kept and the error logged: a connection blip must not sign out every
     * user at once, and the request it belongs to will fail on its own when it
     * tries to read data.
     */
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      if (!token) return token;
      if (params.user) return token;

      const checkedAt = typeof token.checkedAt === "number" ? token.checkedAt : 0;
      if (Date.now() - checkedAt < SESSION_REVALIDATE_AFTER_SECONDS * 1_000) return token;

      // Parsed, not read: the claims come back from a cookie, so a token that
      // no longer carries a usable tenant is dropped rather than repaired.
      const claims = tokenClaimsSchema.safeParse(token);
      if (!claims.success) {
        console.warn("[auth] dropping a session token with no usable tenant claims");
        return null;
      }

      try {
        const identity = await findIdentityById(claims.data.sub);

        if (
          !identity ||
          identity.status !== "ACTIVE" ||
          identity.organizationStatus !== "ACTIVE" ||
          // A tenant transfer is not a thing: if one ever appears, treat it as a
          // different person and make them sign in again.
          identity.organizationId !== claims.data.organizationId
        ) {
          console.warn(`[auth] revoking session for user ${claims.data.sub}`);
          return null;
        }

        token.role = identity.role;
        token.clientId = identity.clientId;
        token.name = identity.name;
        token.email = identity.email;
        token.checkedAt = Date.now();
      } catch (error) {
        console.error("[auth] session revalidation failed; keeping the token", error);
      }

      return token;
    },
  },
});
