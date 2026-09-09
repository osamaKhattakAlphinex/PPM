import { createRateLimiter } from "@/lib/security/rate-limit";

/**
 * The limits on the product's two public write endpoints.
 *
 * Everything else that writes is behind a session, so its limiter counts a
 * USER. These two count an IP, because there is nobody signed in to count —
 * which also makes them the two limiters that actually face the open internet.
 *
 * `src/lib/security/rate-limit.ts` records the honest limitation both inherit:
 * the counters live in process memory, so N instances allow roughly N times
 * these numbers.
 */

/**
 * Registering a company: 3 an hour from one address, then locked out for an
 * hour.
 *
 * Deliberately mean. Nobody registers two companies in an afternoon, and the
 * cost of getting it wrong is asymmetric — a real customer who hits this waits
 * an hour and emails somebody, while a script that does not hit it can fill the
 * database with junk tenants for free.
 */
export const signupRateLimiter = createRateLimiter({
  name: "signup",
  limit: 3,
  windowMs: 60 * 60 * 1_000,
  blockMs: 60 * 60 * 1_000,
});

/**
 * Accepting an invitation: 10 an hour.
 *
 * Looser than sign-up, because the failure modes are different. This endpoint
 * creates nothing — it can only complete an invitation somebody was already
 * issued — so the thing being rate-limited is guessing a token. A 32-byte token
 * is not guessable at ten attempts an hour, or at ten million, so this is a
 * bound on noise rather than the defence; the token's own entropy is.
 */
export const inviteRateLimiter = createRateLimiter({
  name: "invite-accept",
  limit: 10,
  windowMs: 60 * 60 * 1_000,
  blockMs: 15 * 60 * 1_000,
});
