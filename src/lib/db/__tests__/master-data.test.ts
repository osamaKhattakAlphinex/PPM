import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { Client } from "../models/client";
import { Location } from "../models/location";
import { Organization } from "../models/organization";
import {
  clientExistsInScope,
  clientsRepository,
  findOwnClientForScope,
} from "../repositories/clients";
import { locationsRepository } from "../repositories/locations";
import {
  getOrganizationForScope,
  updateOrganizationForScope,
} from "../repositories/organizations";
import { getScope, ScopeResolutionError, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for the three master entities, against a real mongod.
 *
 * The question this file answers is the one the product actually depends on:
 * **can a CLIENT user see anything that is not theirs?** It is asked from the
 * outside — through the same repositories the feature code uses, with scopes
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

const address = {
  line1: "King Fahd Road",
  city: "Riyadh",
  country: "SA",
};

/** Rebuilt per test: ids are created by the DAL, so they cannot be constants. */
let acmeId: Types.ObjectId;
let rivalId: Types.ObjectId;
let acmeScope: TenantScope;
let rivalScope: TenantScope;

beforeAll(async () => {
  await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  // Two customers of the same organization. Everything below is about whether
  // one of them can reach the other.
  const acme = await clientsRepository
    .forScope(staffA)
    .create({ name: "Acme Holdings", code: "acme" });
  const rival = await clientsRepository
    .forScope(staffA)
    .create({ name: "Rival Estates", code: "rival" });

  acmeId = acme._id;
  rivalId = rival._id;
  acmeScope = getScope(clientSession(ORG_A, acmeId));
  rivalScope = getScope(clientSession(ORG_A, rivalId));
});

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

describe("a CLIENT session cannot reach the clients collection at all", () => {
  /**
   * The collection has no `clientId` of its own — a client row IS the client —
   * so there is nothing to narrow it by. `createRepository` refuses rather than
   * widening to the organization, which would hand one customer the list of
   * every other customer the organization works for.
   */
  it.each([
    ["find", () => clientsRepository.forScope(acmeScope).find()],
    ["findById", () => clientsRepository.forScope(acmeScope).findById(rivalId)],
    ["paginate", () => clientsRepository.forScope(acmeScope).paginate()],
    ["count", () => clientsRepository.forScope(acmeScope).count()],
    ["create", () => clientsRepository.forScope(acmeScope).create({ name: "Mine", code: "mine" })],
    ["update", () => clientsRepository.forScope(acmeScope).update(rivalId, { name: "Owned" })],
    ["delete", () => clientsRepository.forScope(acmeScope).delete(rivalId)],
  ])("%s throws ScopeResolutionError", async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ScopeResolutionError);
  });

  it("staff in the same organization can do all of it, so the refusal is about the role", async () => {
    const page = await clientsRepository.forScope(staffA).paginate();
    expect(page.total).toBe(2);
  });
});

describe("findOwnClientForScope is the only way a client reaches a client row", () => {
  it("returns exactly the caller's own record", async () => {
    const own = await findOwnClientForScope(acmeScope);

    expect(own?._id.equals(acmeId)).toBe(true);
    expect(own?.name).toBe("Acme Holdings");
  });

  it("never returns another client of the same organization", async () => {
    const own = await findOwnClientForScope(rivalScope);

    expect(own?._id.equals(rivalId)).toBe(true);
    expect(own?._id.equals(acmeId)).toBe(false);
  });

  it("returns null for a session whose clientId belongs to another organization", async () => {
    // A stale or forged token: the clientId is real, the organizationId is not
    // the one it lives in. organizationId is still applied, so nothing matches.
    const crossOrg = getScope(clientSession(ORG_B, acmeId));

    await expect(findOwnClientForScope(crossOrg)).resolves.toBeNull();
  });

  it("returns null for a staff scope, which has no own client", async () => {
    await expect(findOwnClientForScope(staffA)).resolves.toBeNull();
  });

  it("returns null once the client is soft-deleted", async () => {
    await clientsRepository.forScope(staffA).delete(acmeId);

    await expect(findOwnClientForScope(acmeScope)).resolves.toBeNull();
  });
});

describe("clientExistsInScope re-scopes an id that arrived in a request", () => {
  it("accepts an id inside the caller's organization", async () => {
    await expect(clientExistsInScope(staffA, acmeId)).resolves.toBe(true);
  });

  it("rejects the same id for another organization", async () => {
    await expect(clientExistsInScope(staffB, acmeId)).resolves.toBe(false);
  });

  it("rejects a malformed id instead of throwing", async () => {
    await expect(clientExistsInScope(staffA, "not-an-id")).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Locations — the client-partitioned collection
// ---------------------------------------------------------------------------

describe("a CLIENT session sees only its own locations", () => {
  let acmeTower: Types.ObjectId;
  let rivalPlaza: Types.ObjectId;
  let depot: Types.ObjectId;

  beforeEach(async () => {
    const locations = locationsRepository.forScope(staffA);

    acmeTower = (await locations.create({ name: "Acme Tower", clientId: acmeId, address }))._id;
    rivalPlaza = (await locations.create({ name: "Rival Plaza", clientId: rivalId, address }))._id;
    // No clientId: the organization's own site, belonging to no customer.
    depot = (await locations.create({ name: "Central Depot", address }))._id;
  });

  it("the three sites really exist for staff (so the assertions below are not vacuous)", async () => {
    const page = await locationsRepository.forScope(staffA).paginate();

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.name).sort()).toEqual([
      "Acme Tower",
      "Central Depot",
      "Rival Plaza",
    ]);
  });

  it("lists only its own", async () => {
    const page = await locationsRepository.forScope(acmeScope).paginate();

    expect(page.total).toBe(1);
    expect(page.items[0]?._id.equals(acmeTower)).toBe(true);
  });

  it("cannot findById another client's location, even holding its id", async () => {
    await expect(locationsRepository.forScope(acmeScope).findById(rivalPlaza)).resolves.toBeNull();
    // ...and the id is correct, because its owner resolves it.
    await expect(
      locationsRepository.forScope(rivalScope).findById(rivalPlaza),
    ).resolves.not.toBeNull();
  });

  it("cannot update another client's location", async () => {
    await expect(
      locationsRepository.forScope(acmeScope).update(rivalPlaza, { name: "Taken" }),
    ).resolves.toBeNull();

    const untouched = await locationsRepository.forScope(staffA).findById(rivalPlaza);
    expect(untouched?.name).toBe("Rival Plaza");
  });

  it("cannot soft-delete another client's location", async () => {
    await expect(locationsRepository.forScope(acmeScope).delete(rivalPlaza)).resolves.toBe(false);

    const alive = await locationsRepository.forScope(staffA).findById(rivalPlaza);
    expect(alive).not.toBeNull();
  });

  it("cannot see an org-wide location, because null matches no client id", async () => {
    await expect(locationsRepository.forScope(acmeScope).findById(depot)).resolves.toBeNull();
    await expect(locationsRepository.forScope(rivalScope).findById(depot)).resolves.toBeNull();
    // Staff see it, so the row is there and the absence is about scoping.
    await expect(locationsRepository.forScope(staffA).findById(depot)).resolves.not.toBeNull();
  });

  it("cannot widen its own scope by passing another client's id as a filter", async () => {
    // The scope keys are spread LAST, so this filter is overwritten, not honoured.
    const found = await locationsRepository.forScope(acmeScope).find({ clientId: rivalId });

    expect(found).toHaveLength(0);
  });

  it("has its own clientId stamped on create, whatever it asks for", async () => {
    const created = await locationsRepository
      .forScope(acmeScope)
      .create({ name: "Smuggled", clientId: rivalId, address });

    expect(created.clientId?.equals(acmeId)).toBe(true);
    expect(created.organizationId.equals(ORG_A)).toBe(true);
  });
});

describe("a location's client is fixed at creation", () => {
  it("update() strips clientId, so a site cannot be moved between customers", async () => {
    const locations = locationsRepository.forScope(staffA);
    const tower = await locations.create({ name: "Acme Tower", clientId: acmeId, address });

    // `clientId` is in RESERVED_FIELDS, so it is ignored rather than rejected.
    await locations.update(tower._id, {
      name: "Acme Tower (renamed)",
      clientId: rivalId,
    } as never);

    const after = await locations.findById(tower._id);
    expect(after?.name).toBe("Acme Tower (renamed)");
    expect(after?.clientId?.equals(acmeId)).toBe(true);

    // And the other client still cannot see it.
    await expect(locationsRepository.forScope(rivalScope).findById(tower._id)).resolves.toBeNull();
  });
});

describe("cross-organization isolation holds for the new entities", () => {
  it("Org B staff cannot reach an Org A client or location", async () => {
    const tower = await locationsRepository
      .forScope(staffA)
      .create({ name: "Acme Tower", clientId: acmeId, address });

    await expect(clientsRepository.forScope(staffB).findById(acmeId)).resolves.toBeNull();
    await expect(locationsRepository.forScope(staffB).findById(tower._id)).resolves.toBeNull();
    await expect(clientsRepository.forScope(staffB).delete(acmeId)).resolves.toBe(false);
    await expect(locationsRepository.forScope(staffB).delete(tower._id)).resolves.toBe(false);

    // The rows are untouched and still belong to Org A.
    const rawClient = await Client.findById(acmeId).lean().exec();
    const rawLocation = await Location.findById(tower._id).lean().exec();
    expect(rawClient?.organizationId.equals(ORG_A)).toBe(true);
    expect(rawLocation?.organizationId.equals(ORG_A)).toBe(true);
    expect(rawLocation?.deletedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

describe("the organization store only ever touches the caller's own tenant", () => {
  beforeEach(async () => {
    await Organization.create([
      { _id: ORG_A, name: "Gulf Facilities Co.", slug: "gulf-facilities" },
      { _id: ORG_B, name: "Rival FM", slug: "rival-fm" },
    ]);
  });

  it("reads the organization named by the scope, and applies its defaults", async () => {
    const profile = await getOrganizationForScope(staffA);

    expect(profile?.name).toBe("Gulf Facilities Co.");
    expect(profile?.defaultCurrency).toBe("SAR");
    expect(profile?.settings.vatRate).toBe(15);
    expect(profile?.settings.workWeekStartsOn).toBe("SUN");
  });

  it("updates only the caller's own tenant", async () => {
    await updateOrganizationForScope(staffA, { name: "Gulf Facilities Group" });

    await expect(getOrganizationForScope(staffA)).resolves.toMatchObject({
      name: "Gulf Facilities Group",
    });
    await expect(getOrganizationForScope(staffB)).resolves.toMatchObject({ name: "Rival FM" });
  });

  it("ignores fields outside the allow-list, including slug and status", async () => {
    await updateOrganizationForScope(staffA, {
      name: "Renamed",
      // Not in OrganizationPatch. Passed anyway, the way a hand-rolled caller
      // or a widened schema eventually would.
      slug: "hijacked",
      status: "SUSPENDED",
      _id: ORG_B,
    } as never);

    const profile = await getOrganizationForScope(staffA);
    expect(profile?.name).toBe("Renamed");
    expect(profile?.slug).toBe("gulf-facilities");
    expect(profile?.status).toBe("ACTIVE");

    // Org B is untouched — the `_id` in the payload went nowhere.
    await expect(getOrganizationForScope(staffB)).resolves.toMatchObject({ name: "Rival FM" });
  });

  it("stores VAT number, currency and settings", async () => {
    await updateOrganizationForScope(staffA, {
      vatNumber: "300000000000003",
      defaultCurrency: "AED",
      settings: {
        vatRate: 5,
        workWeekStartsOn: "MON",
        contactEmail: "ops@gulf.example",
        contactPhone: "+966 11 000 0000",
      },
    });

    const profile = await getOrganizationForScope(staffA);
    expect(profile?.vatNumber).toBe("300000000000003");
    expect(profile?.defaultCurrency).toBe("AED");
    expect(profile?.settings.vatRate).toBe(5);
    expect(profile?.settings.contactEmail).toBe("ops@gulf.example");
  });

  it("rejects a malformed VAT number at the storage layer", async () => {
    await expect(
      updateOrganizationForScope(staffA, { vatNumber: "12345" }),
    ).rejects.toThrow();
  });
});
