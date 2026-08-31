import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `auth()` is the only thing mocked here. Everything else — the session schema,
 * scope resolution, the role check — is the real implementation, because those
 * are the parts that decide whether a request may touch another tenant's data.
 */
vi.mock("../auth", () => ({ auth: vi.fn() }));

import { auth } from "../auth";
import {
  assertRole,
  AuthenticationError,
  AuthorizationError,
  getCurrentUser,
  hasRole,
  isAuthError,
  requireAuth,
  requireRole,
  toAuthErrorResponse,
} from "../guard";
import type { SessionUser } from "../session";

const ORG_A = "5f2b1c4e9d3a7b8c6e0f1a2b";
const CLIENT_A = "6a1b2c3d4e5f60718293a4b5";
const USER_A = "7b2c3d4e5f60718293a4b5c6";

const staffUser: SessionUser = {
  id: USER_A,
  role: "FM_MANAGER",
  organizationId: ORG_A,
  email: "fm@ppm.local",
  name: "Omar Nasser",
};

const clientUser: SessionUser = {
  id: USER_A,
  role: "CLIENT",
  organizationId: ORG_A,
  clientId: CLIENT_A,
  email: "client@ppm.local",
  name: "Nada Al-Sabah",
};

const mockedAuth = vi.mocked(auth);

/** `auth()` has several overloads; the test only ever uses the no-argument one. */
function givenSession(session: unknown): void {
  mockedAuth.mockResolvedValue(session as Awaited<ReturnType<typeof auth>>);
}

beforeEach(() => {
  mockedAuth.mockReset();
});

describe("assertRole", () => {
  it("passes when the role is listed", () => {
    expect(() => assertRole(staffUser, ["ADMIN", "FM_MANAGER"])).not.toThrow();
  });

  it("throws when it is not", () => {
    expect(() => assertRole(staffUser, ["ADMIN"])).toThrow(AuthorizationError);
  });

  it("throws on an empty role list rather than authorising everyone", () => {
    // A guard that permits everything is a silent bug; make it a loud one.
    expect(() => assertRole(staffUser, [])).toThrow(AuthorizationError);
  });

  it("does not leak the reason into the message a user would see", () => {
    try {
      assertRole(staffUser, ["ADMIN"]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as AuthorizationError).message).toBe("You do not have access to this.");
      // The specifics are for the server log only.
      expect((error as AuthorizationError).detail).toContain("FM_MANAGER");
    }
  });
});

describe("requireAuth", () => {
  it("rejects when there is no session at all", async () => {
    givenSession(null);
    await expect(requireAuth()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a session whose user is missing the tenant", async () => {
    givenSession({ user: { id: USER_A, role: "ADMIN" } });
    await expect(requireAuth()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects an id that is not an object id", async () => {
    givenSession({ user: { ...staffUser, organizationId: "not-an-id" } });
    await expect(requireAuth()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a role that is not one of ours", async () => {
    givenSession({ user: { ...staffUser, role: "SUPERADMIN" } });
    await expect(requireAuth()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a CLIENT session with no clientId", async () => {
    // The leak this whole layer exists to prevent: without a clientId, a client
    // user would be scoped to their entire organization.
    givenSession({ user: { ...clientUser, clientId: null } });
    await expect(requireAuth()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("returns a scope carrying the organization for a staff session", async () => {
    givenSession({ user: staffUser });

    const { user, scope } = await requireAuth();

    expect(user.role).toBe("FM_MANAGER");
    expect(scope.organizationId.toHexString()).toBe(ORG_A);
    // Staff see the whole organization, so there is deliberately no clientId.
    expect(scope.clientId).toBeUndefined();
  });

  it("returns a client-narrowed scope for a CLIENT session", async () => {
    givenSession({ user: clientUser });

    const { scope } = await requireAuth();

    expect(scope.organizationId.toHexString()).toBe(ORG_A);
    expect(scope.clientId?.toHexString()).toBe(CLIENT_A);
  });

  it("ignores a clientId smuggled onto a staff session", async () => {
    // Narrowing is a property of the role, not of what the token happens to say.
    givenSession({ user: { ...staffUser, clientId: CLIENT_A } });

    const { scope } = await requireAuth();
    expect(scope.clientId).toBeUndefined();
  });
});

describe("requireRole", () => {
  it("returns the context when the role is allowed", async () => {
    givenSession({ user: staffUser });

    const { user } = await requireRole("ADMIN", "FM_MANAGER");
    expect(user.id).toBe(USER_A);
  });

  it("throws 403 when the session is valid but the role is wrong", async () => {
    givenSession({ user: staffUser });
    await expect(requireRole("ADMIN")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("throws 401, not 403, when there is no session", async () => {
    givenSession(null);
    // The distinction matters: 401 sends the caller to sign in, 403 tells them
    // signing in again will not help.
    await expect(requireRole("ADMIN")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("refuses to authorise when called with no roles", async () => {
    givenSession({ user: staffUser });
    await expect(requireRole()).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("hasRole and getCurrentUser", () => {
  it("answer false/null instead of throwing", async () => {
    givenSession(null);

    expect(await hasRole("ADMIN")).toBe(false);
    expect(await getCurrentUser()).toBeNull();
  });

  it("answer true/user for an allowed session", async () => {
    givenSession({ user: staffUser });

    expect(await hasRole("FM_MANAGER")).toBe(true);
    expect(await hasRole("ADMIN")).toBe(false);
    expect((await getCurrentUser())?.role).toBe("FM_MANAGER");
  });
});

describe("toAuthErrorResponse", () => {
  it("maps the two guard failures onto 401 and 403", async () => {
    const unauthenticated = toAuthErrorResponse(new AuthenticationError());
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "You need to sign in." },
    });

    const forbidden = toAuthErrorResponse(new AuthorizationError("role TECHNICIAN is not ADMIN"));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "You do not have access to this." },
    });
  });

  it("turns anything else into a generic 500 with no internals in it", async () => {
    const response = toAuthErrorResponse(new Error("connect ECONNREFUSED 127.0.0.1:27017"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    });
    expect(JSON.stringify(body)).not.toContain("27017");
  });
});

describe("isAuthError", () => {
  it("recognises the guard's own errors and nothing else", () => {
    expect(isAuthError(new AuthenticationError())).toBe(true);
    expect(isAuthError(new AuthorizationError("nope"))).toBe(true);
    expect(isAuthError(new Error("boom"))).toBe(false);
  });
});
