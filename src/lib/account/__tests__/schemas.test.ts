import { describe, expect, it } from "vitest";

import { changePasswordSchema, updateProfileSchema } from "../schemas";

/**
 * The account payloads.
 *
 * Pure: no session, no database. What is asserted here is mostly what these
 * schemas REFUSE, because the account module's security rests on the shape of
 * its input — both actions act on the signed-in user and take no user id, so
 * the schema is where "edit my profile" is stopped from becoming "edit
 * anybody's".
 */

const VALID = {
  currentPassword: "old-passphrase-1",
  newPassword: "a-much-longer-passphrase",
  confirmPassword: "a-much-longer-passphrase",
};

describe("updateProfileSchema", () => {
  it("accepts and trims a name", () => {
    const parsed = updateProfileSchema.parse({ name: "  Layla Al-Harbi  " });
    expect(parsed.name).toBe("Layla Al-Harbi");
  });

  it("refuses a name too short to be one", () => {
    expect(updateProfileSchema.safeParse({ name: "L" }).success).toBe(false);
  });

  /**
   * The property the module depends on. A payload that could name a user, a
   * role, a tenant or a status would turn a self-service form into an
   * administration endpoint the first time a handler forgot to check.
   */
  it.each(["id", "role", "status", "clientId", "organizationId", "email"])(
    "refuses a payload carrying %s",
    (field) => {
      const parsed = updateProfileSchema.safeParse({
        name: "Layla Al-Harbi",
        [field]: "0123456789abcdef01234567",
      });
      expect(parsed.success).toBe(false);
    },
  );
});

describe("changePasswordSchema", () => {
  it("accepts a well-formed change", () => {
    expect(changePasswordSchema.safeParse(VALID).success).toBe(true);
  });

  it("refuses a confirmation that does not match", () => {
    const parsed = changePasswordSchema.safeParse({
      ...VALID,
      confirmPassword: "something-else-entirely",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses reusing the current password", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "a-much-longer-passphrase",
      newPassword: "a-much-longer-passphrase",
      confirmPassword: "a-much-longer-passphrase",
    });
    expect(parsed.success).toBe(false);
  });

  it("holds the new password to the policy", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "old-passphrase-1",
      newPassword: "short",
      confirmPassword: "short",
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * The current password is being CHECKED, not chosen. Holding it to the
   * current policy would lock out exactly the accounts that most need to
   * change: the ones whose password predates the rules.
   */
  it("does not hold the current password to the policy", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "short",
      newPassword: "a-much-longer-passphrase",
      confirmPassword: "a-much-longer-passphrase",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a payload that names a user", () => {
    const parsed = changePasswordSchema.safeParse({
      ...VALID,
      id: "0123456789abcdef01234567",
    });
    expect(parsed.success).toBe(false);
  });
});
