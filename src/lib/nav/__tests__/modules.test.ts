import { describe, expect, it } from "vitest";

import { canAccessPath, resolveRouteAccess } from "../../auth/access";
import { ROLES, type Role } from "../../auth/roles";
import { activeModuleKey, MODULES, MODULE_KEYS, moduleHref, modulesForRole } from "../modules";

describe("the module table", () => {
  it("has exactly the thirteen modules the product ships", () => {
    expect(MODULES).toHaveLength(13);
    expect(MODULES.map((entry) => entry.key)).toEqual([...MODULE_KEYS]);
  });

  it("gives every module at least one role — an unreachable module is a mistake", () => {
    for (const entry of MODULES) {
      expect(entry.roles.length, `${entry.key} has no roles`).toBeGreaterThan(0);
    }
  });

  it("keeps the mobile bottom bar to four destinations per role", () => {
    for (const role of ROLES) {
      const primary = modulesForRole(role).filter((entry) => entry.primary);
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
      for (const entry of modulesForRole(role)) {
        const href = moduleHref(entry, role);
        expect(canAccessPath(role, href), `${role} cannot open ${href}`).toBe(true);
      }
    }
  });

  it("refuses every module a role's sidebar does not offer", () => {
    for (const role of ROLES) {
      const offered = new Set(modulesForRole(role).map((entry) => moduleHref(entry, role)));

      for (const entry of MODULES) {
        if (offered.has(entry.href)) continue;
        expect(
          canAccessPath(role, entry.href),
          `${role} can reach ${entry.href} but has no nav entry for it`,
        ).toBe(false);
      }
    }
  });

  it("gives each module its own rule rather than letting it inherit /app", () => {
    for (const entry of MODULES) {
      if (entry.href === "/app") continue;
      expect(resolveRouteAccess(entry.href)?.prefix, entry.href).toBe(entry.href);
    }
  });

  it("sends a CLIENT to the portal, never the staff dashboard", () => {
    const [dashboard] = MODULES.filter((entry) => entry.key === "dashboard");
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

    expect(counts.ADMIN).toBe(13);
    expect(counts.FM_MANAGER).toBe(13);
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
    const clientKeys = modulesForRole("CLIENT").map((entry) => entry.key);
    const technicianKeys = modulesForRole("TECHNICIAN").map((entry) => entry.key);

    expect(clientKeys).toEqual(
      expect.arrayContaining(["amc", "invoicing", "reports"]),
    );
    expect(technicianKeys).not.toContain("amc");
    expect(technicianKeys).not.toContain("invoicing");
  });

  it("never offers a client the internal modules", () => {
    const clientKeys = modulesForRole("CLIENT").map((entry) => entry.key);
    expect(clientKeys).not.toContain("technicians");
    expect(clientKeys).not.toContain("approvals");
    expect(clientKeys).not.toContain("aiInsights");
    expect(clientKeys).not.toContain("checklists");
  });

  /**
   * The master-data split, from the navigation side.
   *
   * A client gets Locations because that collection carries a `clientId` and
   * the data-access layer narrows it to their own sites. It never gets Clients,
   * because that collection has nothing to narrow by — offering it would mean
   * offering one customer the organization's entire customer list. The route
   * table is derived from this one, so the sidebar and the middleware agree.
   */
  it("gives a client its locations but never the client list", () => {
    const clientKeys = modulesForRole("CLIENT").map((entry) => entry.key);

    expect(clientKeys).toContain("locations");
    expect(clientKeys).not.toContain("clients");

    expect(canAccessPath("CLIENT", "/app/locations")).toBe(true);
    expect(canAccessPath("CLIENT", "/app/clients")).toBe(false);
    // Staff read both; who may WRITE is checked in the actions, not here.
    expect(canAccessPath("TECHNICIAN", "/app/clients")).toBe(true);
    expect(canAccessPath("TECHNICIAN", "/app/locations")).toBe(true);
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
    // Reachable, but it is not a entry — the account page has no nav entry.
    expect(activeModuleKey("/style-guide", "ADMIN")).toBeNull();
  });

  it("never highlights a module the role cannot see", () => {
    expect(activeModuleKey("/app/technicians", "TECHNICIAN")).toBeNull();
  });
});
