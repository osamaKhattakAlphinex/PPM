import { describe, expect, it } from "vitest";

import {
  canAccessPath,
  canAssignRole,
  isProtectedPath,
  landingPathForRole,
  resolveRouteAccess,
} from "../access";
import { ROLES } from "../roles";

describe("isProtectedPath", () => {
  it("covers /app and everything under it", () => {
    expect(isProtectedPath("/app")).toBe(true);
    expect(isProtectedPath("/app/")).toBe(true);
    expect(isProtectedPath("/app/work-orders/123")).toBe(true);
  });

  it("does not treat a path that merely starts with the letters as protected", () => {
    // "/apple" must not match "/app" — a prefix check without the segment
    // boundary would either over- or under-protect.
    expect(isProtectedPath("/apple")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
  });
});

describe("resolveRouteAccess", () => {
  it("returns null for a public path, so the middleware waves it through", () => {
    expect(resolveRouteAccess("/")).toBeNull();
    expect(resolveRouteAccess("/login")).toBeNull();
    expect(resolveRouteAccess("/style-guide")).toBeNull();
  });

  it("gives the longest matching prefix, not the first", () => {
    expect(resolveRouteAccess("/app/admin/users")?.roles).toEqual(["ADMIN"]);
    expect(resolveRouteAccess("/app/settings")?.roles).toEqual(["ADMIN", "FM_MANAGER"]);
    expect(resolveRouteAccess("/app/portal/requests")?.roles).toEqual(["CLIENT"]);
  });

  it("ignores a trailing slash", () => {
    expect(resolveRouteAccess("/app/admin/")?.roles).toEqual(["ADMIN"]);
  });
});

describe("canAccessPath", () => {
  it("lets staff into the shell and keeps clients out of it", () => {
    expect(canAccessPath("TECHNICIAN", "/app")).toBe(true);
    expect(canAccessPath("SUPERVISOR", "/app/work-orders")).toBe(true);
    // The catch-all grants staff only: a CLIENT has to be given a path
    // explicitly, so a newly added area is never client-visible by accident.
    expect(canAccessPath("CLIENT", "/app")).toBe(false);
    expect(canAccessPath("CLIENT", "/app/work-orders")).toBe(false);
  });

  it("keeps staff out of the client portal and non-admins out of admin", () => {
    expect(canAccessPath("CLIENT", "/app/portal")).toBe(true);
    expect(canAccessPath("FM_MANAGER", "/app/portal")).toBe(false);

    expect(canAccessPath("ADMIN", "/app/admin")).toBe(true);
    for (const role of ["FM_MANAGER", "SUPERVISOR", "TECHNICIAN", "CLIENT"] as const) {
      expect(canAccessPath(role, "/app/admin")).toBe(false);
    }
  });

  it("lets every signed-in role through the post-login dispatcher", () => {
    for (const role of ROLES) {
      expect(canAccessPath(role, "/app/start")).toBe(true);
    }
  });

  it("allows any role onto a public path", () => {
    for (const role of ROLES) {
      expect(canAccessPath(role, "/login")).toBe(true);
    }
  });
});

describe("landingPathForRole", () => {
  it("sends a client to the portal and everyone else to the shell", () => {
    expect(landingPathForRole("CLIENT")).toBe("/app/portal");
    for (const role of ["ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN"] as const) {
      expect(landingPathForRole(role)).toBe("/app");
    }
  });

  it("sends every role somewhere that role may actually go", () => {
    // Otherwise signing in would land on an immediate 403.
    for (const role of ROLES) {
      expect(canAccessPath(role, landingPathForRole(role))).toBe(true);
    }
  });
});

describe("canAssignRole", () => {
  it("lets an admin create anything", () => {
    for (const role of ROLES) {
      expect(canAssignRole("ADMIN", role)).toBe(true);
    }
  });

  it("stops an FM manager from minting peers or admins", () => {
    expect(canAssignRole("FM_MANAGER", "ADMIN")).toBe(false);
    expect(canAssignRole("FM_MANAGER", "FM_MANAGER")).toBe(false);
    expect(canAssignRole("FM_MANAGER", "SUPERVISOR")).toBe(true);
    expect(canAssignRole("FM_MANAGER", "TECHNICIAN")).toBe(true);
    expect(canAssignRole("FM_MANAGER", "CLIENT")).toBe(true);
  });

  it("gives everyone below FM manager no provisioning rights at all", () => {
    for (const actor of ["SUPERVISOR", "TECHNICIAN", "CLIENT"] as const) {
      for (const target of ROLES) {
        expect(canAssignRole(actor, target)).toBe(false);
      }
    }
  });
});
