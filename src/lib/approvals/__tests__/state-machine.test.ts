import { describe, expect, it } from "vitest";

import { ROLES, type Role } from "@/lib/auth/roles";
import { MODULES } from "@/lib/nav/modules";
import {
  APPROVAL_ACTIONS,
  APPROVAL_STAGES,
  APPROVAL_STATUSES,
  canActOnStage,
  canTransitionTo,
  FIRST_APPROVAL_STAGE,
  INVOICE_TRIGGER_STAGE,
  isOpen,
  isReadyToInvoice,
  isTerminalStage,
  nextStage,
  requiresReason,
  roleForStage,
  stageIndex,
  stageProgress,
  type ApprovalStage,
} from "@/lib/domain/approvals";
import { APPROVALS_ROUTE_ROLES } from "../route-roles";
import { createApprovalSchema, decideApprovalSchema, listApprovalsSchema } from "../schemas";

/**
 * The approval chain's rules, tested where they actually live.
 *
 * Every rule the product asks for — a supervisor cannot approve an item at the
 * FM stage, an approval cannot skip a stage — is a property of two pure
 * functions, `canActOnStage` and `canTransitionTo`, which the action consults
 * against a row it has just read back from the database. So the exhaustive
 * assertions are here, over EVERY (role, stage) and (from, to) pair rather than
 * over the handful an example test would pick; `src/lib/db/__tests__/approvals.test.ts`
 * then proves the same rules hold end to end against a real mongod.
 *
 * Pure, so it runs anywhere: no database, no session, no next-auth.
 */

const STAFF_STAGES: ApprovalStage[] = ["TECHNICIAN", "SUPERVISOR", "FM_MANAGER"];

describe("the stage order", () => {
  it("runs technician -> supervisor -> FM -> client -> invoice trigger", () => {
    expect([...APPROVAL_STAGES]).toEqual([
      "TECHNICIAN",
      "SUPERVISOR",
      "FM_MANAGER",
      "CLIENT",
      "INVOICE_TRIGGER",
    ]);
  });

  it("starts at the technician and ends at the invoice trigger", () => {
    expect(FIRST_APPROVAL_STAGE).toBe(APPROVAL_STAGES[0]);
    expect(INVOICE_TRIGGER_STAGE).toBe(APPROVAL_STAGES[APPROVAL_STAGES.length - 1]);
  });

  it("advances exactly one stage at a time, and stops at the end", () => {
    for (let index = 0; index < APPROVAL_STAGES.length - 1; index += 1) {
      expect(nextStage(APPROVAL_STAGES[index]!)).toBe(APPROVAL_STAGES[index + 1]);
    }
    expect(nextStage(INVOICE_TRIGGER_STAGE)).toBeNull();
  });

  it("treats only the invoice trigger as terminal", () => {
    for (const stage of APPROVAL_STAGES) {
      expect(isTerminalStage(stage)).toBe(stage === INVOICE_TRIGGER_STAGE);
    }
  });
});

describe("canTransitionTo — an approval cannot skip a stage", () => {
  /**
   * The exhaustive form. Every ordered pair of stages is tested, and exactly
   * those pairs that are one step forward are legal: no jumps, no repeats, no
   * steps backwards.
   */
  it("permits only the single step forward, for every pair", () => {
    for (const from of APPROVAL_STAGES) {
      for (const to of APPROVAL_STAGES) {
        const isOneStepForward = stageIndex(to) === stageIndex(from) + 1;
        expect(canTransitionTo(from, to)).toBe(isOneStepForward);
      }
    }
  });

  it("refuses the specific skips a hand-rolled request would try", () => {
    // Straight to the money, past every signature.
    expect(canTransitionTo("TECHNICIAN", "INVOICE_TRIGGER")).toBe(false);
    // Past the customer, which is the signature an invoice rests on.
    expect(canTransitionTo("FM_MANAGER", "INVOICE_TRIGGER")).toBe(false);
    // Past the supervisor.
    expect(canTransitionTo("TECHNICIAN", "FM_MANAGER")).toBe(false);
    // Backwards, which would let a desk un-approve what it already approved.
    expect(canTransitionTo("CLIENT", "FM_MANAGER")).toBe(false);
    // Standing still.
    expect(canTransitionTo("SUPERVISOR", "SUPERVISOR")).toBe(false);
  });
});

describe("canActOnStage — only the desk the item is on", () => {
  it("lets each stage's own role act, and only at that stage", () => {
    for (const stage of APPROVAL_STAGES) {
      const owner = roleForStage(stage);
      if (owner === null) continue;
      expect(canActOnStage(owner, stage)).toBe(true);
    }
  });

  /** The exact case the product names. */
  it("refuses a supervisor an item sitting at the FM stage", () => {
    expect(canActOnStage("SUPERVISOR", "FM_MANAGER")).toBe(false);
  });

  it("refuses every other cross-desk pairing", () => {
    const nonAdmin = ROLES.filter((role) => role !== "ADMIN");

    for (const role of nonAdmin) {
      for (const stage of APPROVAL_STAGES) {
        expect(canActOnStage(role, stage)).toBe(roleForStage(stage) === role);
      }
    }
  });

  it("lets ADMIN stand in at a staff desk", () => {
    for (const stage of STAFF_STAGES) {
      expect(canActOnStage("ADMIN", stage)).toBe(true);
    }
  });

  /**
   * The one exclusion that carries weight: a provider must not be able to
   * record its own customer's acceptance, or the trail proves nothing.
   */
  it("refuses ADMIN the client desk", () => {
    expect(canActOnStage("ADMIN", "CLIENT")).toBe(false);
  });

  it("lets nobody at all act at the invoice trigger", () => {
    for (const role of ROLES) {
      expect(canActOnStage(role, "INVOICE_TRIGGER")).toBe(false);
    }
  });

  it("gives every acting stage exactly one owning role", () => {
    const owners = APPROVAL_STAGES.map(roleForStage).filter((role): role is Role => role !== null);
    expect(new Set(owners).size).toBe(owners.length);
    expect(owners).toHaveLength(APPROVAL_STAGES.length - 1);
  });
});

describe("status", () => {
  it("treats only PENDING as open", () => {
    for (const status of APPROVAL_STATUSES) {
      expect(isOpen(status)).toBe(status === "PENDING");
    }
  });

  it("is ready to invoice only when APPROVED at the terminal stage", () => {
    for (const status of APPROVAL_STATUSES) {
      for (const stage of APPROVAL_STAGES) {
        const expected = status === "APPROVED" && stage === "INVOICE_TRIGGER";
        expect(isReadyToInvoice(status, stage)).toBe(expected);
      }
    }
  });

  it("asks for a reason on a rejection and nothing else", () => {
    for (const action of APPROVAL_ACTIONS) {
      expect(requiresReason(action)).toBe(action === "REJECTED");
    }
  });
});

describe("stageProgress", () => {
  it("runs 0 at the first desk to 100 at the trigger", () => {
    expect(stageProgress("TECHNICIAN")).toBe(0);
    expect(stageProgress("INVOICE_TRIGGER")).toBe(100);
  });

  it("increases monotonically along the chain", () => {
    const values = APPROVAL_STAGES.map(stageProgress);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeGreaterThan(values[index - 1]!);
    }
  });
});

describe("the payload schemas", () => {
  const id = "0123456789abcdef01234567";

  it("requires a reason on a rejection", () => {
    const result = decideApprovalSchema.safeParse({ id, action: "REJECTED" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "reason")).toBe(true);
    }
  });

  it("accepts a rejection that carries one", () => {
    expect(
      decideApprovalSchema.safeParse({ id, action: "REJECTED", reason: "Filter not replaced" })
        .success,
    ).toBe(true);
  });

  it("refuses a reason on an approval", () => {
    expect(decideApprovalSchema.safeParse({ id, action: "APPROVED", reason: "ok" }).success).toBe(
      false,
    );
  });

  /**
   * There is no field naming a destination stage, anywhere. The stage the item
   * moves to is computed by the server from the stage the item is at, so a
   * request cannot propose one at all — which is a stronger property than
   * validating one would be.
   */
  it("has no way to name a destination stage", () => {
    expect(
      decideApprovalSchema.safeParse({ id, action: "APPROVED", to: "INVOICE_TRIGGER" }).success,
    ).toBe(false);
    expect(
      decideApprovalSchema.safeParse({ id, action: "APPROVED", currentStage: "CLIENT" }).success,
    ).toBe(false);
  });

  it("refuses a tenant, a client or a requester on create", () => {
    const valid = { refType: "WORK_ORDER", refId: id, refLabel: "WO-1183" };
    expect(createApprovalSchema.safeParse(valid).success).toBe(true);

    for (const smuggled of ["organizationId", "clientId", "requestedBy", "status", "history"]) {
      expect(createApprovalSchema.safeParse({ ...valid, [smuggled]: id }).success).toBe(false);
    }
  });

  it("refuses operator-shaped keys on the list filter", () => {
    expect(listApprovalsSchema.safeParse({ status: { $ne: "REJECTED" } }).success).toBe(false);
    expect(listApprovalsSchema.safeParse({ $where: "1" }).success).toBe(false);
  });

  it("caps the page size at the DAL's maximum", () => {
    expect(listApprovalsSchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  });
});

describe("the route roles agree with the nav table", () => {
  /**
   * `page.tsx` cannot import the nav table's row directly without pulling the
   * whole module list into a guard, so the list is restated in
   * `route-roles.ts`. Restating it is only safe if something fails when the two
   * drift — which is this.
   */
  it("matches src/lib/nav/modules.ts", () => {
    // Aliased to a lowercase binding first: the DAL-boundary lint rule matches
    // `Something.find(...)` on a PascalCase receiver, which is the heuristic
    // that catches `Note.find()`. A nav table is not a Mongoose model, but the
    // rule cannot know that, and suppressing it here would suppress it for the
    // next line someone adds too.
    const modules = MODULES;
    const navEntry = modules.find((entry) => entry.key === "approvals");
    expect(navEntry).toBeDefined();
    expect(new Set(APPROVALS_ROUTE_ROLES)).toEqual(new Set(navEntry!.roles));
  });
});
