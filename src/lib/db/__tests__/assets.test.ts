import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { Asset } from "../models/asset";
import { assetsRepository } from "../repositories/assets";
import { clientsRepository } from "../repositories/clients";
import { locationsRepository } from "../repositories/locations";
import { getScope, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for assets, against a real mongod.
 *
 * The question this file answers is the one the product depends on: **can a
 * CLIENT user see, or touch, an asset that is not theirs?** It is asked from
 * the outside — through the same repository the feature code uses, with scopes
 * built by `getScope()` from a session object rather than assembled by hand, so
 * every test exercises the real path from a cookie to a MongoDB filter.
 *
 * Where a test asserts an absence, it also asserts that the row exists and is
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

const address = { line1: "King Fahd Road", city: "Riyadh", country: "SA" };

/** Rebuilt per test: ids are created by the DAL, so they cannot be constants. */
let acmeId: Types.ObjectId;
let rivalId: Types.ObjectId;
let acmeScope: TenantScope;
let rivalScope: TenantScope;
/** Acme's tower, the rival's tower, and the organization's own depot. */
let acmeSiteId: Types.ObjectId;
let rivalSiteId: Types.ObjectId;
let depotSiteId: Types.ObjectId;

beforeAll(async () => {
  await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const acme = await clientsRepository.forScope(staffA).create({ name: "Acme", code: "acme" });
  const rival = await clientsRepository.forScope(staffA).create({ name: "Rival", code: "rival" });

  acmeId = acme._id;
  rivalId = rival._id;
  acmeScope = getScope(clientSession(ORG_A, acmeId));
  rivalScope = getScope(clientSession(ORG_A, rivalId));

  const sites = locationsRepository.forScope(staffA);
  acmeSiteId = (await sites.create({ name: "Acme Tower", clientId: acmeId, address }))._id;
  rivalSiteId = (await sites.create({ name: "Rival Plaza", clientId: rivalId, address }))._id;
  // No clientId: the organization's own site, belonging to no customer.
  depotSiteId = (await sites.create({ name: "Central Depot", clientId: null, address }))._id;
});

/** Create an asset the way `createAsset` does — clientId derived from the site. */
async function seedAsset(
  scope: TenantScope,
  name: string,
  locationId: Types.ObjectId,
  clientId: Types.ObjectId | null,
) {
  return assetsRepository.forScope(scope).create({
    name,
    category: "HVAC",
    type: "Chiller",
    locationId,
    clientId,
    health: 80,
  });
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

describe("the Asset schema", () => {
  /**
   * `type` is a reserved-ish key in a Mongoose schema definition: `{ type: {
   * type: String } }` is how you declare a field actually CALLED type, and
   * getting it wrong produces a schema with no such path and no error. The
   * generator emits a full descriptor, so it resolves correctly — this asserts
   * that, because the failure mode is silent.
   */
  it("has a real String path called `type`", () => {
    const path = Asset.schema.path("type");
    expect(path).toBeDefined();
    expect(path.instance).toBe("String");
  });

  it("is client-partitioned, which is what makes the DAL narrow it", () => {
    expect(assetsRepository.isClientPartitioned).toBe(true);
  });

  it("declares the text index the search path depends on", () => {
    const hasTextIndex = Asset.schema
      .indexes()
      .some(([fields]) => Object.values(fields).includes("text"));
    expect(hasTextIndex).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Client isolation
// ---------------------------------------------------------------------------

describe("a CLIENT session sees only its own assets", () => {
  beforeEach(async () => {
    await seedAsset(staffA, "Acme Chiller", acmeSiteId, acmeId);
    await seedAsset(staffA, "Rival Chiller", rivalSiteId, rivalId);
    await seedAsset(staffA, "Depot Compressor", depotSiteId, null);
  });

  it("lists its own and nothing else", async () => {
    const mine = await assetsRepository.forScope(acmeScope).find();
    expect(mine.map((a) => a.name)).toEqual(["Acme Chiller"]);

    // Paired presence assertion: staff can see all three, so the absences
    // above are narrowing rather than an empty collection.
    const all = await assetsRepository.forScope(staffA).find();
    expect(all).toHaveLength(3);
  });

  it("cannot see the organization's own depot assets", async () => {
    const mine = await assetsRepository.forScope(acmeScope).find();
    expect(mine.some((a) => a.name === "Depot Compressor")).toBe(false);

    // Null matches no client id — the fail-closed direction. A shared asset is
    // withheld from a customer rather than leaked to one.
    const depot = await assetsRepository.forScope(staffA).findOne({ name: "Depot Compressor" });
    expect(depot?.clientId ?? null).toBeNull();
  });

  it("cannot reach another client's asset by id", async () => {
    const rivalAsset = await assetsRepository.forScope(staffA).findOne({ name: "Rival Chiller" });
    expect(rivalAsset).not.toBeNull();

    expect(await assetsRepository.forScope(acmeScope).findById(rivalAsset!._id)).toBeNull();
    // ...while its actual owner can.
    expect(await assetsRepository.forScope(rivalScope).findById(rivalAsset!._id)).not.toBeNull();
  });

  it("cannot update or delete another client's asset", async () => {
    const rivalAsset = await assetsRepository.forScope(staffA).findOne({ name: "Rival Chiller" });

    expect(
      await assetsRepository.forScope(acmeScope).update(rivalAsset!._id, { name: "Owned" }),
    ).toBeNull();
    expect(await assetsRepository.forScope(acmeScope).delete(rivalAsset!._id)).toBe(false);

    // The row is untouched and still the rival's.
    const after = await assetsRepository.forScope(staffA).findById(rivalAsset!._id);
    expect(after?.name).toBe("Rival Chiller");
    expect(after?.deletedAt).toBeNull();
  });

  it("cannot widen its scope by passing another client's id as a filter", async () => {
    /**
     * The scope keys are spread LAST in `buildFilter`, so a `clientId` the
     * caller supplied is OVERWRITTEN rather than combined. The query that runs
     * is the caller's own scope, and the smuggled id has no effect at all.
     *
     * So the guarantee is not "returns nothing" — it is "returns exactly what
     * this client would have seen anyway". Asserting an empty result would pass
     * just as well if the filter had been honoured and simply matched no rows,
     * which is the weaker claim and not the one that keeps tenants apart.
     */
    const found = await assetsRepository.forScope(acmeScope).find({ clientId: rivalId });

    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Acme Chiller");
    expect(found[0].clientId?.toHexString()).toBe(acmeId.toHexString());
    // The thing that would matter if this ever broke: no row of the rival's.
    expect(found.some((a) => a.clientId?.toHexString() === rivalId.toHexString())).toBe(false);
  });

  it("has its own clientId stamped on create, whatever it passes", async () => {
    const created = await assetsRepository.forScope(acmeScope).create({
      name: "Client Filed",
      category: "PLUMBING",
      type: "Pump",
      locationId: acmeSiteId,
      // A deliberate attempt to file this against the rival.
      clientId: rivalId,
    });

    expect(created.clientId?.toHexString()).toBe(acmeId.toHexString());
    expect(await assetsRepository.forScope(rivalScope).findById(created._id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cross-organization isolation
// ---------------------------------------------------------------------------

describe("assets never cross an organization boundary", () => {
  it("is invisible to another tenant, by list and by id", async () => {
    const asset = await seedAsset(staffA, "Acme Chiller", acmeSiteId, acmeId);

    expect(await assetsRepository.forScope(staffB).find()).toEqual([]);
    expect(await assetsRepository.forScope(staffB).findById(asset._id)).toBeNull();
    expect(await assetsRepository.forScope(staffB).update(asset._id, { name: "Stolen" })).toBeNull();
    expect(await assetsRepository.forScope(staffB).delete(asset._id)).toBe(false);

    // Paired presence assertion.
    expect(await assetsRepository.forScope(staffA).findById(asset._id)).not.toBeNull();
  });

  it("ignores an organizationId supplied in a create payload", async () => {
    const created = await assetsRepository.forScope(staffA).create({
      name: "Smuggled",
      category: "CIVIL",
      type: "Door",
      locationId: depotSiteId,
      // Not part of the input type; sent anyway, as a hostile client would.
      organizationId: ORG_B,
    } as Parameters<typeof assetsRepository.forScope>[0] extends never
      ? never
      : Parameters<ReturnType<typeof assetsRepository.forScope>["create"]>[0]);

    expect(created.organizationId.toHexString()).toBe(ORG_A.toHexString());
    expect(await assetsRepository.forScope(staffB).findById(created._id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The derived clientId
// ---------------------------------------------------------------------------

describe("clientId is not patchable, so the derivation cannot be invalidated", () => {
  /**
   * `clientId` is derived from the asset's location at creation. It is in the
   * DAL's `RESERVED_FIELDS`, so an update silently drops it — which is why
   * `updateAsset` refuses a move to a site belonging to a different client
   * rather than trying to recompute it.
   */
  it("strips clientId from an update patch", async () => {
    const asset = await seedAsset(staffA, "Acme Chiller", acmeSiteId, acmeId);

    const updated = await assetsRepository.forScope(staffA).update(asset._id, {
      name: "Renamed",
      clientId: rivalId,
    } as Parameters<ReturnType<typeof assetsRepository.forScope>["update"]>[1]);

    expect(updated?.name).toBe("Renamed");
    expect(updated?.clientId?.toHexString()).toBe(acmeId.toHexString());
    // Still the rival's blind spot, and still Acme's.
    expect(await assetsRepository.forScope(rivalScope).findById(asset._id)).toBeNull();
    expect(await assetsRepository.forScope(acmeScope).findById(asset._id)).not.toBeNull();
  });

  it("allows locationId itself to be patched — assets do get relocated", async () => {
    const asset = await seedAsset(staffA, "Acme Chiller", acmeSiteId, acmeId);
    const second = await locationsRepository
      .forScope(staffA)
      .create({ name: "Acme Annex", clientId: acmeId, address });

    const updated = await assetsRepository
      .forScope(staffA)
      .update(asset._id, { locationId: second._id });

    expect(updated?.locationId.toHexString()).toBe(second._id.toHexString());
  });
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

describe("soft delete", () => {
  it("hides the asset from every scope without erasing it", async () => {
    const asset = await seedAsset(staffA, "Acme Chiller", acmeSiteId, acmeId);

    expect(await assetsRepository.forScope(staffA).delete(asset._id)).toBe(true);

    expect(await assetsRepository.forScope(staffA).findById(asset._id)).toBeNull();
    expect(await assetsRepository.forScope(acmeScope).find()).toEqual([]);

    // Still there, for audit and for the work orders that will point at it.
    const withDeleted = await assetsRepository
      .forScope(staffA)
      .findById(asset._id, { includeDeleted: true });
    expect(withDeleted?.name).toBe("Acme Chiller");
    expect(withDeleted?.deletedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Search, as the queries layer drives it
// ---------------------------------------------------------------------------

describe("search stays inside the tenant", () => {
  beforeEach(async () => {
    await seedAsset(staffA, "Rooftop Chiller", acmeSiteId, acmeId);
    await seedAsset(staffA, "Rooftop Chiller", rivalSiteId, rivalId);
    await Asset.createIndexes();
  });

  it("a prefix search is still narrowed to the caller's client", async () => {
    const mine = await assetsRepository
      .forScope(acmeScope)
      .find(undefined, { where: { name: { $regex: "^Rooftop", $options: "i" } } });

    expect(mine).toHaveLength(1);
    expect(mine[0].clientId?.toHexString()).toBe(acmeId.toHexString());

    // Paired: staff searching the same term see both.
    const all = await assetsRepository
      .forScope(staffA)
      .find(undefined, { where: { name: { $regex: "^Rooftop", $options: "i" } } });
    expect(all).toHaveLength(2);
  });

  it("a $text search is still narrowed to the caller's client", async () => {
    const mine = await assetsRepository
      .forScope(acmeScope)
      .find(undefined, { where: { $text: { $search: "rooftop chiller" } } });

    expect(mine).toHaveLength(1);
    expect(mine[0].clientId?.toHexString()).toBe(acmeId.toHexString());

    const all = await assetsRepository
      .forScope(staffA)
      .find(undefined, { where: { $text: { $search: "rooftop chiller" } } });
    expect(all).toHaveLength(2);

    // And it does not leak across organizations either.
    expect(
      await assetsRepository
        .forScope(staffB)
        .find(undefined, { where: { $text: { $search: "rooftop chiller" } } }),
    ).toEqual([]);
  });
});
