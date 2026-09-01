import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RateLimitError } from "../errors";
import {
  createRateLimiter,
  enforceRateLimit,
  mutationRateLimiter,
  rateLimitHeaders,
  resetAllRateLimits,
  sensitiveMutationRateLimiter,
} from "../rate-limit";

/**
 * The sliding-window primitive itself is covered by
 * `src/lib/auth/__tests__/rate-limit.test.ts`, which predates the move. This
 * suite covers what was added on top of it for mutations.
 */

describe("enforceRateLimit", () => {
  beforeEach(() => resetAllRateLimits());
  afterEach(() => resetAllRateLimits());

  const limiter = createRateLimiter({ name: "enforce-test", limit: 2, windowMs: 1_000 });

  it("is silent while the caller is inside the limit", () => {
    expect(() => enforceRateLimit(limiter, "user-1")).not.toThrow();
    expect(() => enforceRateLimit(limiter, "user-1")).not.toThrow();
  });

  it("throws a RateLimitError carrying a retry hint once over", () => {
    enforceRateLimit(limiter, "user-1");
    enforceRateLimit(limiter, "user-1");

    try {
      enforceRateLimit(limiter, "user-1");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      const rateLimited = error as RateLimitError;
      expect(rateLimited.status).toBe(429);
      expect(rateLimited.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("counts each key separately, so one user cannot lock out another", () => {
    enforceRateLimit(limiter, "user-1");
    enforceRateLimit(limiter, "user-1");
    expect(() => enforceRateLimit(limiter, "user-1")).toThrow();
    expect(() => enforceRateLimit(limiter, "user-2")).not.toThrow();
  });

  it("keeps the key out of the client-visible message", () => {
    enforceRateLimit(limiter, "user-1:203.0.113.9");
    enforceRateLimit(limiter, "user-1:203.0.113.9");

    try {
      enforceRateLimit(limiter, "user-1:203.0.113.9");
      expect.unreachable("should have thrown");
    } catch (error) {
      const rateLimited = error as RateLimitError;
      expect(rateLimited.message).not.toContain("203.0.113.9");
      expect(rateLimited.detail).not.toContain("203.0.113.9");
    }
  });
});

describe("presets", () => {
  it("limits an ordinary mutation well above human speed and well below a script", () => {
    expect(mutationRateLimiter.rule.limit).toBeGreaterThanOrEqual(60);
    expect(mutationRateLimiter.rule.limit).toBeLessThanOrEqual(300);
  });

  it("limits a sensitive mutation far more tightly", () => {
    expect(sensitiveMutationRateLimiter.rule.limit).toBeLessThan(mutationRateLimiter.rule.limit);
  });
});

describe("rateLimitHeaders", () => {
  beforeEach(() => resetAllRateLimits());

  it("reports the limit and what is left", () => {
    const limiter = createRateLimiter({ name: "headers-test", limit: 5, windowMs: 1_000 });
    const headers = rateLimitHeaders(limiter, limiter.consume("k")) as Record<string, string>;

    expect(headers["RateLimit-Limit"]).toBe("5");
    expect(headers["RateLimit-Remaining"]).toBe("4");
  });
});
