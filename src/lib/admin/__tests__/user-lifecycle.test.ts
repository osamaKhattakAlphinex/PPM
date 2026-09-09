import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_USER_STATUSES,
  canTransitionUserStatus,
  USER_STATUSES,
  USER_STATUS_TRANSITIONS,
} from "@/lib/domain/users";
import { ASSIGNABLE_ROLES, canAssignRole } from "@/lib/auth/access";
import { ROLES, type Role } from "@/lib/auth/roles";
import { setUserStatusSchema } from "../schemas";

/**
 * The account lifecycle, and the authority to change it.
 *
 * Pure: no database, no session. The rules under test are the ones that decide
 * whether a person can sign in, so they are asserted exhaustively — over every
 * status pair and every role pair — rather than on the handful of cases the UI
 * happens to draw a button for.
 */

describe("the status machine", () => {
  it("is total: every status has a rule", () => {
    for (const status of USER_STATUSES) {
      expect(
        USER_STATUS_TRANSITIONS[status],
        `${status} has no rule`,
      ).toBeDefined();
    }
  });

  it("names no status that does not exist", () => {
    for (const targets of Object.values(USER_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect(USER_STATUSES).toContain(target);
      }
    }
  });

  /**
   * The property the whole thing exists for. An account that has been used has
   * a history, and returning it to INVITED would say it never had one —
   * withdrawing access is SUSPENDED, which is honest about it.
   */
  it("never allows a return to INVITED", () => {
    for (const status of USER_STATUSES) {
      expect(
        canTransitionUserStatus(status, "INVITED"),
        `${status} -> INVITED`,
      ).toBe(false);
    }
  });

  it("lets an invited account be activated or shut out", () => {
    expect(canTransitionUserStatus("INVITED", "ACTIVE")).toBe(true);
    expect(canTransitionUserStatus("INVITED", "SUSPENDED")).toBe(true);
  });

  it("lets a suspended account be restored", () => {
    expect(canTransitionUserStatus("SUSPENDED", "ACTIVE")).toBe(true);
  });

  it("refuses a move to the status the account already holds", () => {
    for (const status of USER_STATUSES) {
      expect(
        canTransitionUserStatus(status, status),
        `${status} -> ${status}`,
      ).toBe(false);
    }
  });

  it("offers only the two statuses an administrator may choose", () => {
    expect([...ASSIGNABLE_USER_STATUSES].sort()).toEqual([
      "ACTIVE",
      "SUSPENDED",
    ]);
    expect(ASSIGNABLE_USER_STATUSES).not.toContain("INVITED");
  });
});

describe("the payload schema", () => {
  it("accepts a well-formed change", () => {
    const parsed = setUserStatusSchema.safeParse({
      id: "0123456789abcdef01234567",
      status: "SUSPENDED",
    });
    expect(parsed.success).toBe(true);
  });

  /** INVITED is not reachable, so it is not offerable either. */
  it("refuses INVITED as a target", () => {
    const parsed = setUserStatusSchema.safeParse({
      id: "0123456789abcdef01234567",
      status: "INVITED",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an id that is not an ObjectId", () => {
    expect(
      setUserStatusSchema.safeParse({ id: "../../etc", status: "ACTIVE" })
        .success,
    ).toBe(false);
  });

  /**
   * The isolation rule, at the edge. A tenant must never be nameable in a
   * payload — it comes from the session — and `strictObject` is what turns an
   * attempt into a rejection rather than a silently stripped key.
   */
  it("rejects a payload that tries to name a tenant", () => {
    const parsed = setUserStatusSchema.safeParse({
      id: "0123456789abcdef01234567",
      status: "ACTIVE",
      organizationId: "0123456789abcdef01234567",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("who may act on whom", () => {
  /**
   * The action gates a status change on `canAssignRole` — the same table that
   * decides who may CREATE a role. The two must not drift: "can shut this
   * person out" and "could have created this person" are the same authority,
   * and letting them come apart is how a manager disables the only
   * administrator and takes the tenant.
   */
  it("never lets a role act on one above it", () => {
    expect(canAssignRole("FM_MANAGER", "ADMIN")).toBe(false);
    expect(canAssignRole("FM_MANAGER", "FM_MANAGER")).toBe(false);
  });

  it("lets an admin act on every role", () => {
    for (const role of ROLES) {
      expect(canAssignRole("ADMIN", role), `ADMIN -> ${role}`).toBe(true);
    }
  });

  it("gives a manager the three roles below them and nothing more", () => {
    expect([...ASSIGNABLE_ROLES.FM_MANAGER].sort()).toEqual([
      "CLIENT",
      "SUPERVISOR",
      "TECHNICIAN",
    ]);
  });

  it("gives the operational roles no authority over accounts at all", () => {
    for (const role of ["SUPERVISOR", "TECHNICIAN", "CLIENT"] as const) {
      expect(ASSIGNABLE_ROLES[role], `${role} may assign roles`).toEqual([]);

      for (const target of ROLES) {
        expect(canAssignRole(role, target), `${role} -> ${target}`).toBe(false);
      }
    }
  });

  it("is total over every role pair", () => {
    for (const actor of ROLES) {
      for (const target of ROLES) {
        expect(typeof canAssignRole(actor as Role, target as Role)).toBe(
          "boolean",
        );
      }
    }
  });
});
