import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * `defineAction` reaches two things a unit test has no business booting: the
 * Auth.js session (`requireRole`) and the request headers. Both are mocked at
 * the module boundary so the SEQUENCE — authenticate, scope, rate limit,
 * validate, run — can be asserted on its own.
 */

const requireRole = vi.fn();

vi.mock("../../auth/guard", () => ({
  requireRole: (...roles: string[]) => requireRole(...roles),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.5" }),
}));

const { defineAction, defineFormAction, formDataToObject } = await import("../action");
const { resetAllRateLimits, createRateLimiter } = await import("../rate-limit");

const SCOPE = {
  organizationId: { toHexString: () => "6512f0a4c3b2a1d4e5f60718" },
  role: "ADMIN" as const,
  userId: { toHexString: () => "6512f0a4c3b2a1d4e5f60719" },
};

const CONTEXT = {
  user: {
    id: "6512f0a4c3b2a1d4e5f60719",
    role: "ADMIN" as const,
    organizationId: "6512f0a4c3b2a1d4e5f60718",
    email: "admin@ppm.local",
    name: "Admin",
  },
  scope: SCOPE,
};

const schema = z.strictObject({ title: z.string().min(3) });

beforeEach(() => {
  resetAllRateLimits();
  requireRole.mockReset();
  requireRole.mockResolvedValue(CONTEXT);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAllRateLimits();
});

describe("defineAction", () => {
  it("runs the handler with the parsed input and the resolved scope", async () => {
    const handler = vi.fn(async ({ input }: { input: { title: string } }) => input.title.length);

    const action = defineAction({
      name: "test",
      roles: ["ADMIN"],
      input: schema,
      handler,
    });

    const result = await action({ title: "Chiller repair" });

    expect(result).toEqual({ ok: true, data: 14 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      input: { title: "Chiller repair" },
      scope: SCOPE,
    });
  });

  it("passes the declared roles to the guard, and only those", async () => {
    const action = defineAction({
      name: "test",
      roles: ["ADMIN", "FM_MANAGER"],
      input: schema,
      handler: async () => "ok",
    });

    await action({ title: "abc" });
    expect(requireRole).toHaveBeenCalledWith("ADMIN", "FM_MANAGER");
  });

  it("refuses before parsing when the guard refuses", async () => {
    requireRole.mockRejectedValue({
      code: "FORBIDDEN",
      status: 403,
      message: "You do not have access to this.",
      detail: "role TECHNICIAN is not in [ADMIN]",
    });

    const handler = vi.fn();
    const action = defineAction({ name: "test", roles: ["ADMIN"], input: schema, handler });

    // Input that would ALSO fail validation: the answer must be 403, not 400,
    // or the shape of the payload becomes discoverable without a session.
    const result = await action({ nope: true });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("FORBIDDEN");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects an unknown field rather than dropping it", async () => {
    const handler = vi.fn();
    const action = defineAction({ name: "test", roles: ["ADMIN"], input: schema, handler });

    const result = await action({ title: "abc", organizationId: "someone-elses-org" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("VALIDATION_FAILED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a Mongo operator key before zod sees it", async () => {
    const handler = vi.fn();
    const openEnded = z.object({ filters: z.record(z.string(), z.unknown()) });
    const action = defineAction({
      name: "test",
      roles: ["ADMIN"],
      input: openEnded,
      handler,
    });

    // A schema that legitimately accepts an open record would let this through.
    const result = await action({ filters: { $where: "1 == 1" } });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("VALIDATION_FAILED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns per-field messages a form can render", async () => {
    const action = defineAction({
      name: "test",
      roles: ["ADMIN"],
      input: schema,
      handler: async () => "ok",
    });

    const result = await action({ title: "ab" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.fields).toHaveProperty("title");
  });

  it("applies the rate limit and returns 429 once it is spent", async () => {
    const limiter = createRateLimiter({ name: "action-test", limit: 1, windowMs: 60_000 });
    const handler = vi.fn(async () => "ok");

    const action = defineAction({
      name: "test",
      roles: ["ADMIN"],
      input: schema,
      rateLimit: limiter,
      handler,
    });

    expect((await action({ title: "abc" })).ok).toBe(true);

    const second = await action({ title: "abc" });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error.code).toBe("RATE_LIMITED");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("skips the limiter when an action opts out", async () => {
    const action = defineAction({
      name: "test",
      roles: ["ADMIN"],
      input: schema,
      rateLimit: null,
      handler: async () => "ok",
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await action({ title: "abc" })).ok).toBe(true);
    }
  });

  it("never leaks what the handler threw", async () => {
    const action = defineAction({
      name: "test",
      roles: ["ADMIN"],
      input: schema,
      handler: async () => {
        throw new Error("MongoServerError at db-1.internal:27017");
      },
    });

    const result = await action({ title: "abc" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("27017");
    expect(result.ok === false && result.error.message).toBe("Something went wrong.");
  });
});

describe("formDataToObject", () => {
  it("keeps single values as strings and coerces nothing", () => {
    const form = new FormData();
    form.set("title", "Chiller");
    form.set("count", "0123");

    expect(formDataToObject(form)).toEqual({ title: "Chiller", count: "0123" });
  });

  it("collects repeated names into an array", () => {
    const form = new FormData();
    form.append("site", "a");
    form.append("site", "b");
    form.append("site", "c");

    expect(formDataToObject(form)).toEqual({ site: ["a", "b", "c"] });
  });

  it("drops React's own action bookkeeping fields", () => {
    const form = new FormData();
    form.set("$ACTION_ID_abc", "x");
    form.set("title", "Chiller");

    expect(formDataToObject(form)).toEqual({ title: "Chiller" });
  });
});

describe("defineFormAction", () => {
  it("ignores the previous state — it arrives from the client on every submit", async () => {
    const handler = vi.fn(async ({ input }: { input: { title: string } }) => input.title);
    const action = defineFormAction({
      name: "test",
      roles: ["ADMIN"],
      input: schema,
      rateLimit: null,
      handler,
    });

    const form = new FormData();
    form.set("title", "Chiller");

    const result = await action({ ok: true, data: "smuggled" }, form);

    expect(result).toEqual({ ok: true, data: "Chiller" });
    expect(handler.mock.calls[0][0].input).toEqual({ title: "Chiller" });
  });
});
