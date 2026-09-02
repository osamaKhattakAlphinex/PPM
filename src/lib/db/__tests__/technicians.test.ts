import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { Technician } from "../models/technician";
import { techniciansRepository } from "../repositories/technicians";
import { getScope, ScopeResolutionError, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for the technician directory, against a real mongod.
 *
 * The questions this file answers are the two the product depends on:
 * **can one tenant see another's workforce?** and **can a CLIENT user see any
 * of it?** Both are asked from the outside — through the same repository the
 * feature code uses, with scopes built by `getScope()` from a session object
 * rather than assembled by hand — so every test exercises the real path from a
 * cookie to a MongoDB filter.
 *
 * Where a test asserts an absence, it also asserts the row exists and is
 * reachable by whoever *should* see it. An assertion that something is missing
 * passes just as well when nothing was ever written.
 */

const ORG_A = new Types.ObjectId();
const ORG_B = new Types.ObjectId();

function staffSession(organizationId: Types.ObjectId, role = "FM_MANAGER"): AppSession {
  return {
    user: {
      id: new Types.ObjectId().toHexString(),
      role: role as "FM_MANAGER",
      organizationId: organizationId.toHexString(),
    },
  };
}

function clientSession(organizationId: Types.ObjectId, clientId: Types.ObjectId): AppSession {
  return {
    user: {
      id: new Types.ObjectId().toHexString(),
      role: "CLIENT",
      organizationId: organizationId.toHexString(),
      clientId: clientId.toHexString(),
    },
  };
}

const staffA: TenantScope = getScope(staffSession(ORG_A));
const staffB: TenantScope = getScope(staffSession(ORG_B));
const clientA: TenantScope = getScope(clientSession(ORG_A, new Types.ObjectId()));

beforeAll(async () => {
  await startMemoryMongo();
  // Index assertions below read the built indexes, not the schema declaration —
  // so they have to exist on the server.
  await Technician.syncIndexes();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("a technician belongs to exactly one organization", () => {
  it("stamps the organizationId from the scope, never from the payload", async () => {
    const created = await techniciansRepository
      .forScope(staffA)
      // The cast is the point of the test: a caller who *did* send a tenant key
      // must not get it. The DAL strips it as a reserved field.
      .create({ name: "Ahmed Nasser", trade: "HVAC", organizationId: ORG_B } as never);

    expect(created.organizationId.toHexString()).toBe(ORG_A.toHexString());
  });

  it("hides another tenant's technicians from every read", async () => {
    const mine = await techniciansRepository
      .forScope(staffA)
      .create({ name: "Ahmed Nasser", trade: "HVAC" });

    // Reachable by the organization that owns it...
    expect(await techniciansRepository.forScope(staffA).findById(mine._id)).not.toBeNull();

    // ...and invisible to every read from the other one, including a read that
    // names the id directly.
    expect(await techniciansRepository.forScope(staffB).findById(mine._id)).toBeNull();
    expect(await techniciansRepository.forScope(staffB).find()).toEqual([]);
    expect(await techniciansRepository.forScope(staffB).count()).toBe(0);
    expect((await techniciansRepository.forScope(staffB).paginate()).total).toBe(0);
  });

  it("refuses to update or delete across the tenant boundary", async () => {
    const mine = await techniciansRepository
      .forScope(staffA)
      .create({ name: "Ahmed Nasser", trade: "HVAC" });

    expect(await techniciansRepository.forScope(staffB).update(mine._id, { name: "Owned" })).toBeNull();
    expect(await techniciansRepository.forScope(staffB).delete(mine._id)).toBe(false);

    // Still ours, still named what we named it.
    const after = await techniciansRepository.forScope(staffA).findById(mine._id);
    expect(after?.name).toBe("Ahmed Nasser");
  });

  it("keeps organizationId in the filter even when a caller supplies one", async () => {
    await techniciansRepository.forScope(staffA).create({ name: "Ahmed Nasser", trade: "HVAC" });

    // The scope key is applied LAST, so a filter naming another tenant narrows
    // the result to nothing rather than reaching it.
    const stage = techniciansRepository
      .forScope(staffA)
      .matchStage({ organizationId: ORG_B } as never);

    expect(stage.organizationId).toStrictEqual(ORG_A);
  });
});

// ---------------------------------------------------------------------------
// The CLIENT refusal
// ---------------------------------------------------------------------------

describe("a CLIENT session cannot reach the technicians collection at all", () => {
  /**
   * The collection has no `clientId` — a technician works across every site the
   * organization maintains — so there is nothing to narrow it by.
   * `createRepository` refuses rather than widening to the organization, which
   * would hand a customer its provider's entire workforce, including the people
   * who never work on that customer's sites.
   */
  it.each([
    ["find", () => techniciansRepository.forScope(clientA).find()],
    ["findById", () => techniciansRepository.forScope(clientA).findById(new Types.ObjectId())],
    ["paginate", () => techniciansRepository.forScope(clientA).paginate()],
    ["count", () => techniciansRepository.forScope(clientA).count()],
    [
      "create",
      () => techniciansRepository.forScope(clientA).create({ name: "Mine", trade: "HVAC" }),
    ],
    [
      "update",
      () => techniciansRepository.forScope(clientA).update(new Types.ObjectId(), { name: "x" }),
    ],
    ["delete", () => techniciansRepository.forScope(clientA).delete(new Types.ObjectId())],
  ])("%s throws ScopeResolutionError", async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ScopeResolutionError);
  });

  it("is a refusal, not an empty result — the row is there for staff", async () => {
    await techniciansRepository.forScope(staffA).create({ name: "Ahmed Nasser", trade: "HVAC" });
    expect(await techniciansRepository.forScope(staffA).count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The account link
// ---------------------------------------------------------------------------

describe("the link to a sign-in account", () => {
  it("allows many unlinked technicians in one organization", async () => {
    // The partial unique index filters on `$type: "objectId"`, so a stored
    // `null` does not reserve the slot. `$exists: true` would have, because it
    // matches a present-but-null field — the bug this asserts against.
    await techniciansRepository.forScope(staffA).create({ name: "Ahmed Nasser", trade: "HVAC" });
    await techniciansRepository.forScope(staffA).create({ name: "Bilal Karim", trade: "ELV" });

    expect(await techniciansRepository.forScope(staffA).count()).toBe(2);
  });

  it("refuses to link one account to two technicians in the same organization", async () => {
    const account = new Types.ObjectId();

    await techniciansRepository
      .forScope(staffA)
      .create({ name: "Ahmed Nasser", trade: "HVAC", userId: account });

    await expect(
      techniciansRepository
        .forScope(staffA)
        .create({ name: "Impostor", trade: "HVAC", userId: account }),
    ).rejects.toThrow();
  });

  it("scopes that uniqueness per organization", async () => {
    // The same account id in two tenants is not a real scenario — a user
    // belongs to one org — but the index must be tenant-first regardless, or it
    // would be a cross-tenant existence oracle.
    const account = new Types.ObjectId();

    await techniciansRepository
      .forScope(staffA)
      .create({ name: "Ahmed Nasser", trade: "HVAC", userId: account });
    await techniciansRepository
      .forScope(staffB)
      .create({ name: "Other Tenant", trade: "HVAC", userId: account });

    expect(await techniciansRepository.forScope(staffA).count()).toBe(1);
    expect(await techniciansRepository.forScope(staffB).count()).toBe(1);
  });

  it("releases the account when the technician is soft-deleted", async () => {
    const account = new Types.ObjectId();

    const leaver = await techniciansRepository
      .forScope(staffA)
      .create({ name: "Ahmed Nasser", trade: "HVAC", userId: account });

    await techniciansRepository.forScope(staffA).delete(leaver._id);

    // A returning employee's login attaches to a fresh record rather than being
    // reserved forever by a row nobody can see.
    const rehired = await techniciansRepository
      .forScope(staffA)
      .create({ name: "Ahmed Nasser", trade: "HVAC", userId: account });

    expect(rehired._id.toHexString()).not.toBe(leaver._id.toHexString());
  });

  it("is patchable in both directions, unlike a location's client", async () => {
    const account = new Types.ObjectId();

    const technician = await techniciansRepository
      .forScope(staffA)
      .create({ name: "Ahmed Nasser", trade: "HVAC" });

    const linked = await techniciansRepository
      .forScope(staffA)
      .update(technician._id, { userId: account });
    expect(linked?.userId?.toHexString()).toBe(account.toHexString());

    const unlinked = await techniciansRepository
      .forScope(staffA)
      .update(technician._id, { userId: null });
    expect(unlinked?.userId ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

describe("soft delete", () => {
  it("hides the record without erasing it", async () => {
    const technician = await techniciansRepository
      .forScope(staffA)
      .create({ name: "Ahmed Nasser", trade: "HVAC" });

    expect(await techniciansRepository.forScope(staffA).delete(technician._id)).toBe(true);
    expect(await techniciansRepository.forScope(staffA).findById(technician._id)).toBeNull();

    // Still there for audit, and restorable — the work orders that name this
    // technician did not stop existing.
    const restored = await techniciansRepository.forScope(staffA).restore(technician._id);
    expect(restored?.name).toBe("Ahmed Nasser");
  });
});

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

describe("indexes", () => {
  /**
   * Asserted against the built indexes rather than the schema declaration,
   * because a declaration that never reaches the server is exactly the failure
   * mode worth catching. Every one of these must start with organizationId:
   * an index that does not is one MongoDB cannot use for a tenant-scoped
   * query, so the query scans the whole collection across every tenant.
   */
  it("are all tenant-first", async () => {
    const indexes = await Technician.collection.indexes();

    for (const index of indexes) {
      if (index.name === "_id_") continue;
      expect(Object.keys(index.key)[0]).toBe("organizationId");
    }
  });

  it("includes { organizationId, trade } — the dispatch question", async () => {
    const indexes = await Technician.collection.indexes();
    const keys = indexes.map((index) => Object.keys(index.key).join(","));

    expect(keys).toContain("organizationId,trade");
  });

  it("indexes skills as a multikey, so the chip filter is not a collection scan", async () => {
    const indexes = await Technician.collection.indexes();
    const keys = indexes.map((index) => Object.keys(index.key).join(","));

    expect(keys).toContain("organizationId,skills");
  });
});
