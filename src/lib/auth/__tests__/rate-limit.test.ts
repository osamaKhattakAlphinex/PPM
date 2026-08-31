import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientIpFrom, createRateLimiter, resetAllRateLimits } from "../rate-limit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    resetAllRateLimits();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T09:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAllRateLimits();
  });

  const rule = { name: "test", limit: 3, windowMs: 60_000, blockMs: 300_000 };

  it("allows exactly `limit` attempts, then blocks", () => {
    const limiter = createRateLimiter(rule);

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);

    const blocked = limiter.consume("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(300);
  });

  it("counts each key separately", () => {
    const limiter = createRateLimiter(rule);

    for (let attempt = 0; attempt < 3; attempt += 1) limiter.consume("a");

    expect(limiter.consume("a").allowed).toBe(false);
    expect(limiter.consume("b").allowed).toBe(true);
  });

  it("namespaces by rule, so two limiters never share a counter", () => {
    const login = createRateLimiter({ ...rule, name: "login" });
    const register = createRateLimiter({ ...rule, name: "register" });

    for (let attempt = 0; attempt < 3; attempt += 1) login.consume("same-key");

    expect(login.consume("same-key").allowed).toBe(false);
    expect(register.consume("same-key").allowed).toBe(true);
  });

  it("keeps the key blocked for blockMs, not just for the window", () => {
    const limiter = createRateLimiter(rule);

    for (let attempt = 0; attempt < 4; attempt += 1) limiter.consume("a");

    // Past the window but not past the block: a burst has to cost real time,
    // otherwise an attacker just paces themselves at exactly the limit.
    vi.advanceTimersByTime(61_000);
    expect(limiter.consume("a").allowed).toBe(false);

    vi.advanceTimersByTime(300_000);
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("forgets attempts that slide out of the window", () => {
    const limiter = createRateLimiter(rule);

    limiter.consume("a");
    limiter.consume("a");
    vi.advanceTimersByTime(61_000);

    // The first two aged out, so three more are available.
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("peeks without consuming", () => {
    const limiter = createRateLimiter(rule);

    expect(limiter.peek("a").remaining).toBe(3);
    expect(limiter.peek("a").remaining).toBe(3);
    limiter.consume("a");
    expect(limiter.peek("a").remaining).toBe(2);
  });

  it("resets a key, which is what a successful sign-in does", () => {
    const limiter = createRateLimiter(rule);

    for (let attempt = 0; attempt < 4; attempt += 1) limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);

    limiter.reset("a");
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("reports how long the caller has to wait", () => {
    const limiter = createRateLimiter(rule);

    for (let attempt = 0; attempt < 4; attempt += 1) limiter.consume("a");
    expect(limiter.consume("a").retryAfterSeconds).toBe(300);

    vi.advanceTimersByTime(120_000);
    expect(limiter.consume("a").retryAfterSeconds).toBe(180);
  });
});

describe("clientIpFrom", () => {
  it("takes the original client from x-forwarded-for, not a proxy hop", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientIpFrom(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });

  it("truncates a header long enough to be an attack on the key space", () => {
    const headers = new Headers({ "x-forwarded-for": "9".repeat(500) });
    expect(clientIpFrom(headers).length).toBe(64);
  });
});
