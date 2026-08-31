import { describe, expect, it } from "vitest";

import { hashPassword, isPasswordHash, needsRehash, verifyPassword } from "../password";

describe("hashPassword", () => {
  it("produces an argon2id digest, never the password", async () => {
    const digest = await hashPassword("correct horse battery staple");

    expect(digest).not.toContain("correct horse");
    expect(isPasswordHash(digest)).toBe(true);
    expect(digest.startsWith("$argon2id$")).toBe(true);
  });

  it("salts every digest, so the same password hashes differently", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same password twice"),
      hashPassword("same password twice"),
    ]);

    expect(first).not.toBe(second);
    // ...and both still verify.
    expect(await verifyPassword(first, "same password twice")).toBe(true);
    expect(await verifyPassword(second, "same password twice")).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const digest = await hashPassword("a valid passphrase");

    expect(await verifyPassword(digest, "a valid passphrase")).toBe(true);
    expect(await verifyPassword(digest, "a valid passphras")).toBe(false);
    expect(await verifyPassword(digest, "")).toBe(false);
  });

  it("returns false for a missing hash instead of throwing", async () => {
    // The "no such user" path: it must answer, not crash, or the caller would
    // have to branch on it — which is what leaks whether the account exists.
    expect(await verifyPassword(null, "anything")).toBe(false);
    expect(await verifyPassword(undefined, "anything")).toBe(false);
  });

  it("returns false for a corrupt digest instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("$argon2id$broken", "anything")).toBe(false);
  });

  it("does the same work for a missing user as for a wrong password", async () => {
    // Timing is environment-dependent, so this asserts the shape of the
    // guarantee rather than a stopwatch: the decoy path is a real argon2
    // verification, so it costs the same order of magnitude as a real one.
    const digest = await hashPassword("a valid passphrase");

    const startReal = performance.now();
    await verifyPassword(digest, "wrong password");
    const real = performance.now() - startReal;

    const startDecoy = performance.now();
    await verifyPassword(null, "wrong password");
    const decoy = performance.now() - startDecoy;

    // An early `return false` would come back in microseconds against argon2's
    // milliseconds; anything within 10x is the same code path.
    expect(decoy).toBeGreaterThan(real / 10);
  });
});

describe("needsRehash", () => {
  it("is false for a digest made with the current parameters", async () => {
    expect(needsRehash(await hashPassword("current parameters"))).toBe(false);
  });

  it("is true for a weaker digest and for anything unrecognised", () => {
    // Same algorithm, a quarter of the memory.
    expect(needsRehash("$argon2id$v=19$m=4096,t=2,p=1$c29tZXNhbHQ$abc")).toBe(true);
    expect(needsRehash("$2b$12$bcryptdigestwouldlooklikethis")).toBe(true);
    expect(needsRehash("")).toBe(true);
  });
});
