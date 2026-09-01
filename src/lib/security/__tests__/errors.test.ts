import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AppError,
  ConflictError,
  handleApiError,
  NotFoundError,
  normaliseError,
  RateLimitError,
  toApiErrorBody,
  ValidationError,
  withApiErrorHandling,
} from "../errors";

/**
 * The rule under test is the one from CLAUDE.md: nothing internal reaches the
 * client. Most of these assertions are `not.toContain` for that reason — the
 * interesting property of this module is what it refuses to say.
 */

describe("normaliseError", () => {
  it("passes an AppError through unchanged", () => {
    const original = new NotFoundError("work order 1 is in another org");
    expect(normaliseError(original)).toBe(original);
  });

  it("turns a ZodError into a 400 with per-field messages", () => {
    const schema = z.strictObject({ email: z.email(), age: z.number().min(18) });
    const parsed = schema.safeParse({ email: "nope", age: 4 });
    expect(parsed.success).toBe(false);

    const error = normaliseError(parsed.success ? null : parsed.error);

    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(error.fields ?? {})).toEqual(["email", "age"]);
  });

  it("never echoes the submitted value in a validation failure", () => {
    const schema = z.strictObject({ password: z.string().min(12) });
    const parsed = schema.safeParse({ password: "hunter2" });
    const error = normaliseError(parsed.success ? null : parsed.error);

    expect(JSON.stringify(toApiErrorBody(error, "req-1"))).not.toContain("hunter2");
  });

  it("maps a Mongo duplicate key to a 409 that names no value", () => {
    const mongoError = Object.assign(new Error("E11000 duplicate key: admin@tenant-b.example"), {
      code: 11000,
    });

    const error = normaliseError(mongoError);

    expect(error.status).toBe(409);
    expect(error.message).toBe("That value is already in use.");
    // The colliding address would let one tenant probe another's user list.
    expect(error.message).not.toContain("tenant-b");
  });

  it("adopts the status and code of a guard error", () => {
    // The structural shape of AuthorizationError in src/lib/auth/guard.ts.
    const authorization = {
      code: "FORBIDDEN",
      status: 403,
      message: "You do not have access to this.",
      detail: "role TECHNICIAN is not in [ADMIN]",
    };

    const error = normaliseError(authorization);

    expect(error.status).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
    expect(error.detail).toContain("TECHNICIAN");
    // …but the detail is not what the client is told.
    expect(error.message).toBe("You do not have access to this.");
  });

  it("collapses anything unrecognised into a generic 500", () => {
    const driverError = new Error("MongoServerError: connection <db-1.internal:27017> closed");
    const error = normaliseError(driverError);

    expect(error.status).toBe(500);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).toBe("Something went wrong.");
    expect(error.message).not.toContain("27017");
    // The real text survives for the log, and only for the log.
    expect(error.detail).toContain("27017");
  });

  it("handles a thrown non-Error without crashing", () => {
    expect(normaliseError("boom").status).toBe(500);
    expect(normaliseError(undefined).status).toBe(500);
    expect(normaliseError({ nope: true }).status).toBe(500);
  });
});

describe("toApiErrorBody", () => {
  it("never serialises the detail or the cause", () => {
    const error = new AppError("INTERNAL_ERROR", 500, "Something went wrong.", "secret detail", {
      cause: new Error("stack with /home/deploy/app/src/lib/db/connect.ts"),
    });

    const serialised = JSON.stringify(toApiErrorBody(error, "req-1"));

    expect(serialised).not.toContain("secret detail");
    expect(serialised).not.toContain("connect.ts");
    expect(serialised).toContain("req-1");
  });

  it("omits `fields` unless there are some", () => {
    expect(toApiErrorBody(new NotFoundError("x"), "r").error).not.toHaveProperty("fields");
    expect(
      toApiErrorBody(new ValidationError("x", { name: "Required" }), "r").error.fields,
    ).toEqual({ name: "Required" });
  });
});

describe("handleApiError", () => {
  beforeEach(() => {
    // The handler logs by design; the suite should not print it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the error's status and a JSON envelope", async () => {
    const response = handleApiError(new ConflictError("Already scheduled.", "detail"));
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it("sets Retry-After on a rate-limit failure", () => {
    const response = handleApiError(new RateLimitError(42, "mutation limit"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("never caches an error response", () => {
    expect(handleApiError(new NotFoundError("x")).headers.get("Cache-Control")).toBe("no-store");
  });

  it("logs 5xx as an error and 4xx as a warning", () => {
    handleApiError(new NotFoundError("x"));
    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();

    handleApiError(new Error("kaboom"));
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("logs the request id it returned, so the two can be correlated", async () => {
    const response = handleApiError(new Error("kaboom"), { operation: "POST /api/x" });
    const body = await response.json();

    const logged = vi.mocked(console.error).mock.calls[0]?.[0] as string;
    expect(logged).toContain(body.error.requestId);
    expect(logged).toContain("POST /api/x");
  });
});

describe("withApiErrorHandling", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets a successful response through untouched", async () => {
    const handler = withApiErrorHandling("GET /x", async () => Response.json({ ok: true }));
    expect((await handler()).status).toBe(200);
  });

  it("catches anything the handler throws", async () => {
    const handler = withApiErrorHandling("GET /x", async () => {
      throw new Error("mongo exploded at db-1.internal");
    });

    const response = await handler();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("db-1.internal");
  });
});
