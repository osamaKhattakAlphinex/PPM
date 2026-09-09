import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "@/lib/auth/roles";
import { MODULES } from "@/lib/nav/modules";
import { REPORT_KINDS, reportKindSchema } from "../kinds";
import { REPORTS_ROUTE_ROLES } from "../route-roles";
import { canRunReport, REPORT_ROLES, reportsForRole } from "../roles";

/**
 * Who may run which report.
 *
 * The reports module has TWO role lists and they are deliberately different: a
 * route list that decides who may open the module at all, and a per-report list
 * that decides what each of them may actually generate. A supervisor may open
 * the module (they run the PM report) and must not be able to reach the
 * financial one by editing a query string.
 *
 * That is only a boundary if the two lists stay in the right relationship, so
 * the relationship is asserted here rather than left to a reader comparing two
 * files. The per-report check itself lives inside `buildReportForScope`, which
 * cannot be imported into a unit test — it pulls the data-access layer — so what
 * is proved here is the policy the check consults.
 *
 * Pure: no database, no session.
 */

describe("the per-report role lists", () => {
  it("covers every report kind", () => {
    expect(Object.keys(REPORT_ROLES).sort()).toEqual([...REPORT_KINDS].sort());
  });

  /**
   * The financial report is the one with money in it, and the split is the same
   * one AMC and invoicing make: a supervisor dispatches work, they do not price
   * it.
   */
  it("keeps a supervisor out of the financial report", () => {
    expect(canRunReport("SUPERVISOR", "FINANCIAL")).toBe(false);
    expect(canRunReport("SUPERVISOR", "PM")).toBe(true);
  });

  /**
   * A customer cannot run the PM report at all, and that is structural rather
   * than a preference: `ppmSchedulesRepository` refuses a client scope outright,
   * because the preventive plan is the provider's internal schedule.
   */
  it("keeps a client out of the PM report", () => {
    expect(canRunReport("CLIENT", "PM")).toBe(false);
    expect(canRunReport("CLIENT", "ASSET")).toBe(true);
    expect(canRunReport("CLIENT", "FINANCIAL")).toBe(true);
  });

  it("keeps a technician out of every report", () => {
    for (const kind of REPORT_KINDS) {
      expect(canRunReport("TECHNICIAN", kind)).toBe(false);
    }
    expect(reportsForRole("TECHNICIAN")).toEqual([]);
  });

  it("lets an admin run all three", () => {
    expect(reportsForRole("ADMIN")).toEqual([...REPORT_KINDS]);
  });

  it("offers a role exactly the reports it may run", () => {
    for (const role of ROLES) {
      const offered = reportsForRole(role);
      for (const kind of REPORT_KINDS) {
        expect(offered.includes(kind)).toBe(canRunReport(role, kind));
      }
    }
  });
});

describe("the route list", () => {
  /**
   * The route list must be the UNION of the per-report lists — no wider, no
   * narrower. Wider would put a sidebar entry in front of somebody with nothing
   * to run; narrower would hide a report from someone entitled to it, and the
   * PDF route would 403 on a link the picker never offered.
   */
  it("is exactly the union of the per-report lists", () => {
    const union = new Set<Role>();
    for (const kind of REPORT_KINDS) {
      for (const role of REPORT_ROLES[kind]) union.add(role);
    }

    expect(new Set(REPORTS_ROUTE_ROLES)).toEqual(union);
  });

  it("matches src/lib/nav/modules.ts", () => {
    // Aliased to a lowercase binding first: the DAL-boundary lint rule matches
    // `Something.find(...)` on a PascalCase receiver, and a nav table is not a
    // Mongoose model but the rule cannot know that.
    const modules = MODULES;
    const navEntry = modules.find((entry) => entry.key === "reports");

    expect(navEntry).toBeDefined();
    expect(new Set(REPORTS_ROUTE_ROLES)).toEqual(new Set(navEntry!.roles));
  });
});

describe("the report kind parser", () => {
  it("accepts only the three known kinds", () => {
    for (const kind of REPORT_KINDS) {
      expect(reportKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  /** What the PDF route and the page both receive straight from a URL. */
  it("refuses anything else, including operator-shaped input", () => {
    for (const bad of ["", "pm", "ALL", "../FINANCIAL", { $ne: null }, null, 7]) {
      expect(reportKindSchema.safeParse(bad).success).toBe(false);
    }
  });
});
