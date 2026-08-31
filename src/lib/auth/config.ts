import type { NextAuthConfig } from "next-auth";
import { z } from "zod";

import { LOGIN_PATH } from "./access";
import { roleSchema } from "./roles";

/**
 * The Edge-safe half of the Auth.js configuration.
 *
 * `src/middleware.ts` runs on the Edge runtime, where Mongoose, argon2 and
 * `node:*` do not exist. So the config is split: everything the middleware
 * needs to READ a session lives here, and everything needed to ISSUE one (the
 * Credentials provider, the database, password verification) lives in
 * `auth.ts`, which only ever runs in Node.
 *
 * Both halves must agree on the cookie name, the secret and the session
 * lifetime — they are two readers of one cookie — which is exactly why those
 * settings live in this shared module and not in either half.
 */

/** Seconds. Read from `process.env` directly: see the note in `src/lib/env.ts`. */
function secondsFromEnv(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < minimum) return fallback;
  return parsed;
}

/** One working shift. A field technician should not be signed out mid-job. */
export const SESSION_MAX_AGE_SECONDS = secondsFromEnv(
  process.env.AUTH_SESSION_MAX_AGE,
  8 * 60 * 60,
  300,
);

/**
 * How stale a token may be before the next Node-side read re-checks the user
 * against the database. This is the upper bound on how long a suspended user,
 * or one whose role was just downgraded, keeps their old access.
 */
export const SESSION_REVALIDATE_AFTER_SECONDS = secondsFromEnv(
  process.env.AUTH_SESSION_REVALIDATE_AFTER,
  5 * 60,
  0,
);

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * The tenant claims a session token has to carry.
 *
 * The token is signed, but it is still the one input to a session that lives
 * outside this server between requests — so it is parsed rather than trusted.
 * A token minted by an older deploy, or one that lost a claim in a callback
 * that forgot to copy it, fails here and yields a session with no scope, which
 * the data layer refuses. Deny by default, one layer up.
 */
export const tokenClaimsSchema = z.object({
  /** Auth.js's own subject claim: the user id. */
  sub: objectIdString,
  role: roleSchema,
  organizationId: objectIdString,
  clientId: objectIdString.nullish(),
});

export type TokenClaims = z.infer<typeof tokenClaimsSchema>;

/**
 * `secure` cannot be decided from NODE_ENV alone: `next start` behind a TLS
 * terminator is production, a preview over plain HTTP is not. A `__Secure-`
 * cookie is simply dropped by the browser over HTTP, which would look like a
 * login that silently does nothing — so it follows the actual origin scheme,
 * defaulting to secure when there is nothing to read.
 */
const publicOrigin = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
const useSecureCookies = publicOrigin
  ? publicOrigin.startsWith("https://")
  : process.env.NODE_ENV === "production";

const cookiePrefix = useSecureCookies ? "__Secure-" : "";

export const authConfig = {
  /**
   * JWT rather than a database session: the middleware has to make an
   * authorisation decision on the Edge, where it cannot query MongoDB. The
   * trade-off — a token that outlives a change made to the user — is bounded by
   * the revalidation in `auth.ts`.
   */
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
    // Refresh the cookie at most once every 15 minutes of activity.
    updateAge: 15 * 60,
  },

  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },

  cookies: {
    sessionToken: {
      name: `${cookiePrefix}authjs.session-token`,
      options: {
        // Not readable from JavaScript: an XSS bug cannot walk off with the
        // session.
        httpOnly: true,
        // "lax" still sends the cookie on a top-level GET navigation (so a
        // bookmarked /app link works) but not on a cross-site POST, which is
        // the CSRF case. "strict" would break the OAuth-style return flow if a
        // provider is ever added.
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },

  pages: {
    signIn: LOGIN_PATH,
    // Auth.js's own error page would show provider internals; the login page
    // renders a generic message instead.
    error: LOGIN_PATH,
  },

  // Populated in `auth.ts`. The Edge instance never signs anyone in — it only
  // reads the cookie the Node instance issued.
  providers: [],

  callbacks: {
    /**
     * Copy the tenant identity into the token at sign-in.
     *
     * This runs in both runtimes, so it must stay free of I/O. `auth.ts` wraps
     * it with the database revalidation, which can only run in Node.
     */
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.clientId = user.clientId ?? null;
        token.checkedAt = Date.now();
      }
      return token;
    },

    /**
     * Project the token onto the session object.
     *
     * The result is what `getScope()` reads, so the four tenant claims are
     * mandatory: a token missing any of them yields a session that fails scope
     * resolution and therefore returns no data at all.
     */
    session({ session, token }) {
      const claims = tokenClaimsSchema.safeParse(token);

      if (!claims.success) {
        // Leave the session without tenant claims rather than filling in
        // blanks: `getScope()` will refuse it, and refusing is the right
        // outcome for a token this server can no longer make sense of.
        console.warn("[auth] session token carries no usable tenant claims");
        return session;
      }

      session.user = {
        ...session.user,
        id: claims.data.sub,
        role: claims.data.role,
        organizationId: claims.data.organizationId,
        clientId: claims.data.clientId ?? null,
      };
      return session;
    },
  },

  // Auth.js logs the full error server-side; the client only ever sees the
  // generic message the login form renders.
  debug: false,
} satisfies NextAuthConfig;
