import { describe, expect, it } from "vitest";

import { canAccessPath, resolveRouteAccess } from "../../auth/access";
import { ROLES, type Role } from "../../auth/roles";
import { activeModuleKey, MODULES, MODULE_KEYS, moduleHref, modulesForRole } from "../modules";

describe("the module table", () => {
  it("has exactly the eleven modules the product ships", () => {
    expect(MODULES).toHaveLength(11);
    expect(MODULES.map((module) => module.key)).toEqual([...MODULE_KEYS]);
  });

  it("gives every module at least one role — an unreachable module is a mistake", () => {
    for (const module of MODULES) {
      expect(module.roles.length, `${module.key} has no roles`).toBeGreaterThan(0);
    }
  });

  it("keeps the mobile bottom bar to four destinations per role", () => {
    for (const role of ROLES) {
      const primary = modulesForRole(role).filter((module) => module.primary);
      expect(primary.length, `${role} has ${primary.length} primary modules`).toBeLessThanOrEqual(4);
    }
  });
});

/**
 * The rule this file exists for.
 *
 * The sidebar and the middleware read the same table, so they cannot drift —
 * but only if the derivation in `ROUTE_ACCESS` actually covers every module.
 * A nav item that answers 403 is a bug the user sees; a route that is reachable
 * by a role the nav never offered it to is a bug nobody sees.
 */
describe("nav and route access agree", () => {
  it("lets every role open every module its sidebar offers", () => {
    for (const role of ROLES) {
      for (const module of modulesForRole(role)) {
        const href = moduleHref(module, role);
        expect(canAccessPath(role, href), `${role} cannot open ${href}`).toBe(true);
      }
    }
  });

  it("refuses every module a role's sidebar does not offer", () => {
    for (const role of ROLES) {
      const offered = new Set(modulesForRole(role).map((module) => moduleHref(module, role)));

      for (const module of MODULES) {
        if (offered.has(module.href)) continue;
        expect(
          canAccessPath(role, module.href),
          `${role} can reach ${module.href} but has no nav entry for it`,
        ).toBe(false);
      }
    }
  });

  it("gives each module its own rule rather than letting it inherit /app", () => {
    for (const module of MODULES) {
      if (module.href === "/app") continue;
      expect(resolveRouteAccess(module.href)?.prefix, module.href).toBe(module.href);
    }
  });

  it("sends a CLIENT to the portal, never the staff dashboard", () => {
    const dashboard = MODULES.find((module) => module.key === "dashboard");
    expect(dashboard).toBeDefined();
    expect(moduleHref(dashboard!, "CLIENT")).toBe("/app/portal");
    expect(moduleHref(dashboard!, "ADMIN")).toBe("/app");
    expect(canAccessPath("CLIENT", "/app")).toBe(false);
  });
});

describe("modulesForRole", () => {
  it("narrows down the staff ladder", () => {
    const counts = Object.fromEntries(
      ROLES.map((role) => [role, modulesForRole(role).length]),
    ) as Record<Role, number>;

    expect(counts.ADMIN).toBe(11);
    expect(counts.FM_MANAGER).toBe(11);
    expect(counts.SUPERVISOR).toBeLessThan(counts.FM_MANAGER);
    expect(counts.TECHNICIAN).toBeLessThan(counts.SUPERVISOR);
  });

  /**
   * CLIENT is deliberately NOT on the ladder above. It is not the bottom rung
   * of staff — it is a different axis: a client sees the commercial modules
   * for its own contracts (AMC, invoicing) that a technician never sees, and
   * none of the internal ones. Counting modules is the wrong way to compare
   * the two; what matters is which ones.
   */
  it("gives a client the commercial modules and none of the internal ones", () => {
    const clientKeys = modulesForRole("CLIENT").map((module) => module.key);
    const technicianKeys = modulesForRole("TECHNICIAN").map((module) => module.key);

    expect(clientKeys).toEqual(
      expect.arrayContaining(["amc", "invoicing", "reports"]),
    );
    expect(technicianKeys).not.toContain("amc");
    expect(technicianKeys).not.toContain("invoicing");
  });

  it("never offers a client the internal modules", () => {
    const clientKeys = modulesForRole("CLIENT").map((module) => module.key);
    expect(clientKeys).not.toContain("technicians");
    expect(clientKeys).not.toContain("approvals");
    expect(clientKeys).not.toContain("aiInsights");
    expect(clientKeys).not.toContain("checklists");
  });
});

describe("activeModuleKey", () => {
  it("highlights the deepest matching module, not the /app catch-all", () => {
    expect(activeModuleKey("/app/assets", "ADMIN")).toBe("assets");
    expect(activeModuleKey("/app/assets/6512f0a4c3b2a1d4e5f60718", "ADMIN")).toBe("assets");
    expect(activeModuleKey("/app", "ADMIN")).toBe("dashboard");
  });

  it("does not match a path that merely starts with the same letters", () => {
    expect(activeModuleKey("/app/assets-archive", "ADMIN")).toBeNull();
  });

  it("keeps the dashboard from lighting up on every page below /app", () => {
    expect(activeModuleKey("/app/account", "ADMIN")).toBeNull();
    expect(activeModuleKey("/app/reports", "ADMIN")).toBe("reports");
  });

  it("resolves the client dashboard from the portal path", () => {
    expect(activeModuleKey("/app/portal", "CLIENT")).toBe("dashboard");
  });

  it("highlights nothing for a path outside every module", () => {
    expect(activeModuleKey("/login", "ADMIN")).toBeNull();
    // Reachable, but it is not a module — the account page has no nav entry.
    expect(activeModuleKey("/style-guide", "ADMIN")).toBeNull();
  });

  it("never highlights a module the role cannot see", () => {
    expect(activeModuleKey("/app/technicians", "TECHNICIAN")).toBeNull();
  });
});
