import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import {
  assertNoDangerousOperators,
  assertNoUnsafeKeys,
  findUnsafeKeys,
  isUnsafeKey,
  sanitize,
  UnsafeQueryError,
} from "../sanitize";

describe("sanitize — operator injection", () => {
  it('blocks the classic { "$gt": "" } auth-bypass payload', () => {
    // Exactly what an attacker POSTs to a login route.
    const body: unknown = JSON.parse('{"email":{"$gt":""},"password":{"$ne":null}}');

    const clean = sanitize(body);

    // The operators are gone, so `findOne({ email: clean.email })` becomes an
    // equality match against `{}` — it matches no document instead of the
    // first user in the collection.
    expect(clean).toEqual({ email: {}, password: {} });
    expect(JSON.stringify(clean)).not.toContain("$gt");
    expect(JSON.stringify(clean)).not.toContain("$ne");
  });

  it("reports the stripped operator paths for server-side logging", () => {
    const body: unknown = JSON.parse('{"email":{"$gt":""},"password":{"$ne":null}}');

    expect(findUnsafeKeys(body)).toEqual(["email.$gt", "password.$ne"]);
  });

  it("leaves a legitimate scalar login payload untouched", () => {
    const body = { email: "tech@example.com", password: "correct horse" };

    expect(sanitize(body)).toEqual(body);
    expect(findUnsafeKeys(body)).toEqual([]);
  });

  it("strips an operator at the top level of a filter", () => {
    expect(sanitize({ $where: "1 == 1", name: "Riyadh Tower" })).toEqual({
      name: "Riyadh Tower",
    });
  });

  it("strips operators nested inside arrays and deep objects", () => {
    const body: unknown = JSON.parse(
      '{"assets":[{"tag":"AC-1","meta":{"$ne":null}}],"filter":{"a":{"b":{"$regex":".*"}}}}',
    );

    expect(sanitize(body)).toEqual({
      assets: [{ tag: "AC-1", meta: {} }],
      filter: { a: { b: {} } },
    });
    expect(findUnsafeKeys(body)).toEqual(["assets[0].meta.$ne", "filter.a.b.$regex"]);
  });

  it("strips dotted keys that would reach into a nested path", () => {
    const body: unknown = JSON.parse('{"organizationId.0":"other-tenant","title":"Quarterly PPM"}');

    // A dotted key could otherwise overwrite a scoped field on an update.
    expect(sanitize(body)).toEqual({ title: "Quarterly PPM" });
  });

  it("strips prototype-pollution keys", () => {
    const body: unknown = JSON.parse('{"__proto__":{"isAdmin":true},"name":"ok"}');

    const clean = sanitize(body) as Record<string, unknown>;

    expect(clean).toEqual({ name: "ok" });
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});

describe("sanitize — data preservation", () => {
  it("does not mutate the input", () => {
    const body = { email: { $gt: "" } };

    sanitize(body);

    expect(body.email.$gt).toBe("");
  });

  it("passes non-plain objects through untouched", () => {
    const id = new Types.ObjectId();
    const when = new Date("2026-01-01T00:00:00.000Z");

    const clean = sanitize({ authorId: id, dueAt: when, count: 3, done: false, note: null });

    expect(clean.authorId).toBe(id);
    expect(clean.dueAt).toBe(when);
    expect(clean).toEqual({ authorId: id, dueAt: when, count: 3, done: false, note: null });
  });

  it("survives a cyclic payload", () => {
    const body: Record<string, unknown> = { name: "loop", $evil: 1 };
    body.self = body;

    const clean = sanitize(body) as Record<string, unknown>;

    expect(clean.name).toBe("loop");
    expect(clean).not.toHaveProperty("$evil");
    expect(clean.self).toBe(clean);
  });

  it("rejects a payload nested deeper than the limit", () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 10; i += 1) deep = { nested: deep };

    expect(() => sanitize(deep, { maxDepth: 4 })).toThrow(UnsafeQueryError);
  });
});

describe("isUnsafeKey / assertNoUnsafeKeys", () => {
  it("classifies keys", () => {
    expect(isUnsafeKey("$gt")).toBe(true);
    expect(isUnsafeKey("a.b")).toBe(true);
    expect(isUnsafeKey("__proto__")).toBe(true);
    expect(isUnsafeKey("constructor")).toBe(true);
    expect(isUnsafeKey("title")).toBe(false);
    expect(isUnsafeKey("organizationId")).toBe(false);
  });

  it("throws rather than stripping when told to", () => {
    expect(() => assertNoUnsafeKeys({ email: { $gt: "" } })).toThrow(UnsafeQueryError);
    expect(() => assertNoUnsafeKeys({ email: "tech@example.com" })).not.toThrow();
  });
});

describe("assertNoDangerousOperators", () => {
  it("rejects JavaScript-executing operators wherever they appear", () => {
    expect(() => assertNoDangerousOperators({ $where: "this.a === 1" })).toThrow(UnsafeQueryError);
    expect(() => assertNoDangerousOperators({ a: { $function: {} } })).toThrow(UnsafeQueryError);
    expect(() => assertNoDangerousOperators([{ $accumulator: {} }])).toThrow(UnsafeQueryError);
  });

  it("rejects aggregation stages that write to another collection", () => {
    expect(() => assertNoDangerousOperators([{ $match: {} }, { $out: "leak" }])).toThrow(
      UnsafeQueryError,
    );
    expect(() => assertNoDangerousOperators([{ $merge: { into: "leak" } }])).toThrow(
      UnsafeQueryError,
    );
  });

  it("rejects a dangerous operator named in a value position", () => {
    expect(() => assertNoDangerousOperators({ pipelineStage: "$where" })).toThrow(UnsafeQueryError);
  });

  it("allows ordinary operators in a query we authored", () => {
    expect(() =>
      assertNoDangerousOperators({
        organizationId: new Types.ObjectId(),
        status: { $in: ["DRAFT", "PUBLISHED"] },
        createdAt: { $gte: new Date("2026-01-01") },
        deletedAt: null,
      }),
    ).not.toThrow();
  });

  it("does not leak the offending value into the error message", () => {
    try {
      assertNoDangerousOperators({ $where: "secret-payload" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeQueryError);
      expect((error as Error).message).not.toContain("secret-payload");
    }
  });
});
