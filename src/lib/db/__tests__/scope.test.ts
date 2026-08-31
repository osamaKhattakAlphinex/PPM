import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { describeScope, getScope, isClientScope, ScopeResolutionError } from "../scope";

const ORG = new Types.ObjectId().toHexString();
const CLIENT = new Types.ObjectId().toHexString();
const USER = new Types.ObjectId().toHexString();

function session(user: Record<string, unknown> | null): AppSession {
  return { user: user as AppSession["user"], expires: "2099-01-01T00:00:00.000Z" };
}

describe("getScope — resolves tenant identity from the session only", () => {
  it("derives organizationId for a staff session", () => {
    const scope = getScope(session({ id: USER, role: "FM_MANAGER", organizationId: ORG }));

    expect(scope.organizationId).toBeInstanceOf(Types.ObjectId);
    expect(scope.organizationId.toHexString()).toBe(ORG);
    expect(scope.role).toBe("FM_MANAGER");
    expect(scope.userId.toHexString()).toBe(USER);
  });

  it("leaves clientId undefined for staff roles", () => {
    for (const role of ["ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN"]) {
      const scope = getScope(session({ id: USER, role, organizationId: ORG }));

      expect(scope.clientId).toBeUndefined();
      expect(isClientScope(scope)).toBe(false);
    }
  });

  it("narrows a CLIENT session to its clientId", () => {
    const scope = getScope(
      session({ id: USER, role: "CLIENT", organizationId: ORG, clientId: CLIENT }),
    );

    expect(isClientScope(scope)).toBe(true);
    expect(scope.clientId?.toHexString()).toBe(CLIENT);
  });

  it("does NOT narrow a staff session that happens to carry a clientId", () => {
    // Narrowing is a property of the role, not of what the token contains — so
    // a stale or forged clientId claim on a staff token changes nothing.
    const scope = getScope(
      session({ id: USER, role: "SUPERVISOR", organizationId: ORG, clientId: CLIENT }),
    );

    expect(scope.clientId).toBeUndefined();
  });
});

describe("getScope — fails closed", () => {
  const rejected: ReadonlyArray<[string, AppSession | null | undefined]> = [
    ["a null session", null],
    ["an undefined session", undefined],
    ["a session with no user", session(null)],
    ["a user with no organizationId", session({ id: USER, role: "ADMIN" })],
    ["a null organizationId", session({ id: USER, role: "ADMIN", organizationId: null })],
    ["an empty organizationId", session({ id: USER, role: "ADMIN", organizationId: "" })],
    [
      "a non-hex organizationId",
      session({ id: USER, role: "ADMIN", organizationId: "not-an-object-id" }),
    ],
    [
      "an organizationId that is an operator object",
      session({ id: USER, role: "ADMIN", organizationId: { $ne: null } }),
    ],
    ["a role that is not one of ours", session({ id: USER, role: "SUPERADMIN", organizationId: ORG })],
    ["a missing role", session({ id: USER, organizationId: ORG })],
    ["a CLIENT with no clientId", session({ id: USER, role: "CLIENT", organizationId: ORG })],
    [
      "a CLIENT with a malformed clientId",
      session({ id: USER, role: "CLIENT", organizationId: ORG, clientId: "12" }),
    ],
    ["a missing user id", session({ role: "ADMIN", organizationId: ORG })],
  ];

  for (const [label, input] of rejected) {
    it(`throws on ${label}`, () => {
      expect(() => getScope(input)).toThrow(ScopeResolutionError);
    });
  }

  it("keeps the reason server-side and the message generic", () => {
    try {
      getScope(session({ id: USER, role: "CLIENT", organizationId: ORG }));
      expect.unreachable("expected getScope to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScopeResolutionError);
      const scopeError = error as ScopeResolutionError;

      expect(scopeError.message).toBe("Not authorised.");
      expect(scopeError.code).toBe("SCOPE_UNRESOLVED");
      expect(scopeError.detail).toContain("clientId");
    }
  });

  it("ignores extra session keys rather than trusting them", () => {
    const scope = getScope(
      session({
        id: USER,
        role: "TECHNICIAN",
        organizationId: ORG,
        // A caller who managed to influence the token cannot add scope keys.
        isAdmin: true,
        tenant: new Types.ObjectId().toHexString(),
      }),
    );

    expect(scope.organizationId.toHexString()).toBe(ORG);
    expect(Object.keys(scope).sort()).toEqual(["organizationId", "role", "userId"]);
  });
});

describe("describeScope", () => {
  it("names the org and role for a log line", () => {
    const scope = getScope(
      session({ id: USER, role: "CLIENT", organizationId: ORG, clientId: CLIENT }),
    );

    expect(describeScope(scope)).toBe(`org=${ORG} role=CLIENT client=${CLIENT}`);
  });
});
