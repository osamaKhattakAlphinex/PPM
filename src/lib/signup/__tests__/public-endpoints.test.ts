import { describe, expect, it } from "vitest";

import { acceptInviteSchema, signupSchema } from "../schemas";
import { availableSlug, MAX_SLUG_ATTEMPTS, slugify } from "../slug";
import {
  digestsMatch,
  hashInviteToken,
  INVITE_TTL_DAYS,
  issueInvitation,
  invitePath,
} from "../tokens";

/**
 * The two public write endpoints.
 *
 * CLAUDE.md forbids public writes; these are the deliberate exception, which
 * makes them the code in the product that most deserves an exhaustive test of
 * what it REFUSES. Pure — no database, no session, no server.
 */

const VALID_SIGNUP = {
  organizationName: "Gulf Facility Services",
  name: "Layla Al-Harbi",
  email: "layla@gulf-fs.com",
  password: "a-long-enough-passphrase",
  acceptTerms: "on",
};

describe("signupSchema", () => {
  it("accepts a well-formed registration", () => {
    expect(signupSchema.safeParse(VALID_SIGNUP).success).toBe(true);
  });

  /**
   * The single most important assertion in this file. `role` in a public
   * payload would let anybody ask to be an ADMIN of something — and the
   * endpoint mints an ADMIN, so a stripped-but-accepted key would be worse
   * than a rejected one.
   */
  it.each(["role", "status", "organizationId", "clientId", "slug", "id"])(
    "refuses a registration carrying %s",
    (field) => {
      expect(
        signupSchema.safeParse({ ...VALID_SIGNUP, [field]: "ADMIN" }).success,
      ).toBe(false);
    },
  );

  it("requires the terms box, and an unticked box submits nothing", () => {
    // An unchecked HTML checkbox is absent from the form data entirely, so
    // "absent" and "refused" are the same thing and both have to fail.
    const withoutTerms = { ...VALID_SIGNUP, acceptTerms: undefined };
    expect(signupSchema.safeParse(withoutTerms).success).toBe(false);
    expect(
      signupSchema.safeParse({ ...VALID_SIGNUP, acceptTerms: "false" }).success,
    ).toBe(false);
  });

  it("refuses a filled honeypot", () => {
    expect(
      signupSchema.safeParse({
        ...VALID_SIGNUP,
        website: "http://spam.example",
      }).success,
    ).toBe(false);
  });

  it("accepts an empty or absent honeypot", () => {
    expect(
      signupSchema.safeParse({ ...VALID_SIGNUP, website: "" }).success,
    ).toBe(true);
    expect(signupSchema.safeParse(VALID_SIGNUP).success).toBe(true);
  });

  it("holds the password to the policy", () => {
    expect(
      signupSchema.safeParse({ ...VALID_SIGNUP, password: "short" }).success,
    ).toBe(false);
  });

  it("refuses an address that is not one", () => {
    expect(
      signupSchema.safeParse({ ...VALID_SIGNUP, email: "not-an-email" })
        .success,
    ).toBe(false);
  });

  /** A tampered locale degrades to the default rather than failing sign-up. */
  it("falls back to English on a locale it does not know", () => {
    const parsed = signupSchema.parse({ ...VALID_SIGNUP, locale: "de" });
    expect(parsed.locale).toBe("en");
  });

  it("keeps a locale it does know", () => {
    expect(signupSchema.parse({ ...VALID_SIGNUP, locale: "ar" }).locale).toBe(
      "ar",
    );
  });
});

describe("acceptInviteSchema", () => {
  const token = "a".repeat(64);

  it("accepts a well-formed acceptance", () => {
    const parsed = acceptInviteSchema.safeParse({
      token,
      password: "a-long-enough-passphrase",
      confirmPassword: "a-long-enough-passphrase",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a mismatched confirmation", () => {
    const parsed = acceptInviteSchema.safeParse({
      token,
      password: "a-long-enough-passphrase",
      confirmPassword: "something-else-here",
    });
    expect(parsed.success).toBe(false);
  });

  it.each(["", "not-hex", "A".repeat(64), "a".repeat(63), "a".repeat(65)])(
    "refuses a token of the wrong shape: %s",
    (bad) => {
      const parsed = acceptInviteSchema.safeParse({
        token: bad,
        password: "a-long-enough-passphrase",
        confirmPassword: "a-long-enough-passphrase",
      });
      expect(parsed.success).toBe(false);
    },
  );

  /**
   * The absence that matters. If the form could name an account, anybody
   * holding one valid token could set anybody's password.
   */
  it.each(["email", "userId", "id", "role"])(
    "refuses an acceptance carrying %s",
    (field) => {
      const parsed = acceptInviteSchema.safeParse({
        token,
        password: "a-long-enough-passphrase",
        confirmPassword: "a-long-enough-passphrase",
        [field]: "someone@else.com",
      });
      expect(parsed.success).toBe(false);
    },
  );
});

describe("slugify", () => {
  it.each([
    ["Gulf Facility Services", "gulf-facility-services"],
    ["  Al-Faisaliah   FM  ", "al-faisaliah-fm"],
    ["Gulf & Co. L.L.C.", "gulf-co-l-l-c"],
    ["Café Maintenance", "cafe-maintenance"],
    ["ACME---123", "acme-123"],
  ])("turns %s into %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  /**
   * A company named only in Arabic is normal in this market, and there is no
   * honest transliteration to guess. Null means "ask them", which is what the
   * action does — rather than "org-1", which they would have to live with.
   */
  it("returns null for a name with no Latin letters", () => {
    expect(slugify("شركة الخليج")).toBeNull();
    expect(slugify("!!!")).toBeNull();
  });

  it("never produces a leading or trailing hyphen", () => {
    for (const input of ["--acme--", " acme ", "&acme&"]) {
      const slug = slugify(input);
      expect(slug).not.toMatch(/^-|-$/);
    }
  });

  it("keeps within the model's 64-character bound", () => {
    const slug = slugify("a".repeat(200));
    expect(slug).not.toBeNull();
    expect(slug!.length).toBeLessThanOrEqual(64);
  });

  /** The model's own rule, restated as the thing the output must satisfy. */
  it("always matches the organization model's slug pattern", () => {
    for (const input of [
      "Gulf & Co.",
      "  spaced  out  ",
      "ACME---123",
      "Café",
    ]) {
      const slug = slugify(input);
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe("availableSlug", () => {
  it("returns the plain handle when nothing holds it", async () => {
    expect(await availableSlug("Gulf FM", async () => false)).toBe("gulf-fm");
  });

  it("walks past collisions", async () => {
    const taken = new Set(["gulf-fm", "gulf-fm-2"]);
    expect(
      await availableSlug("Gulf FM", async (slug) => taken.has(slug)),
    ).toBe("gulf-fm-3");
  });

  it("gives up rather than looping forever", async () => {
    expect(await availableSlug("Gulf FM", async () => true)).toBeNull();
  });

  it("keeps a suffixed handle inside the length bound", async () => {
    const slug = await availableSlug(
      "a".repeat(200),
      async (candidate) => candidate.length > 64,
    );
    expect(slug === null || slug.length <= 64).toBe(true);
  });

  it("tries no more than the stated number of times", async () => {
    let calls = 0;
    await availableSlug("Gulf FM", async () => {
      calls += 1;
      return true;
    });
    expect(calls).toBe(MAX_SLUG_ATTEMPTS);
  });
});

describe("invitation tokens", () => {
  it("issues a 64-character hex token", () => {
    expect(issueInvitation().token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never stores the token itself", () => {
    const invitation = issueInvitation();
    expect(invitation.tokenHash).not.toBe(invitation.token);
    expect(invitation.tokenHash).toBe(hashInviteToken(invitation.token));
  });

  it("issues a different token every time", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => issueInvitation().token),
    );
    expect(tokens.size).toBe(50);
  });

  it("expires after the stated number of days", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const invitation = issueInvitation(now);
    const days =
      (invitation.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1_000);
    expect(days).toBe(INVITE_TTL_DAYS);
  });

  it("hashes deterministically, so a lookup can find it", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"));
  });

  it("compares digests without a length oracle", () => {
    expect(digestsMatch("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(digestsMatch("a".repeat(64), "b".repeat(64))).toBe(false);
    expect(digestsMatch("a".repeat(64), "a".repeat(63))).toBe(false);
  });

  it("builds a path, never an absolute URL", () => {
    const path = invitePath("ar", "a".repeat(64));
    expect(path).toBe(`/ar/invite/${"a".repeat(64)}`);
    // An origin here would mean trusting a host header for the link somebody
    // is about to paste a live token into.
    expect(path).not.toMatch(/^https?:/);
  });
});
