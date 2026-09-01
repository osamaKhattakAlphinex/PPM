/**
 * The auth-specific rate limits.
 *
 * The sliding-window primitive itself now lives in `src/lib/security/rate-limit.ts`,
 * because mutations need it too and it was never really an auth concern. It is
 * re-exported here so `createRateLimiter`/`clientIpFrom` keep resolving from
 * their original path.
 */

export {
  clientIpFrom,
  createRateLimiter,
  enforceRateLimit,
  rateLimitHeaders,
  resetAllRateLimits,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitRule,
} from "../security/rate-limit";

import { createRateLimiter } from "../security/rate-limit";

/**
 * Sign-in, limited on two axes at once because they stop different attacks:
 *
 *  - by IP, against one host trying many accounts (credential stuffing);
 *  - by email, against many hosts trying one account (a targeted brute force,
 *    where a per-IP limit alone never triggers).
 *
 * The per-email counter is the tighter of the two. Both are cleared on a
 * successful sign-in, so a user who mistypes twice and then succeeds starts
 * clean.
 */
export const loginRateLimiter = createRateLimiter({
  name: "login",
  limit: 10,
  windowMs: 10 * 60 * 1_000,
  blockMs: 15 * 60 * 1_000,
});

export const loginByEmailRateLimiter = createRateLimiter({
  name: "login:email",
  limit: 5,
  windowMs: 10 * 60 * 1_000,
  blockMs: 15 * 60 * 1_000,
});

/**
 * User provisioning. Already behind an ADMIN/FM_MANAGER session, so this is
 * not an anti-brute-force measure — it caps the damage a stolen staff session
 * can do in one burst, and keeps a scripted mistake from filling the
 * collection.
 */
export const registerRateLimiter = createRateLimiter({
  name: "register",
  limit: 20,
  windowMs: 60 * 60 * 1_000,
});
