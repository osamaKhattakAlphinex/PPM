import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { PpmSchedule } from "../models/ppm-schedule";
import { countPpmSchedulesByType, ppmSchedulesRepository } from "../repositories/ppm-schedules";
import { getScope, ScopeResolutionError, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for PPM schedules, against a real mongod.
 *
 * Two questions, and they are different from the ones the asset suite asks.
 * Assets are client-partitioned, so the interesting case there is "does a CLIENT
 * see only their own?". Schedules are NOT: the collection has no `clientId` at
 * all, and the guarantee is the stronger, blunter one — **a CLIENT session is
 * refused outright rather than served a narrowed result.** That is what makes it
 * safe for `nav/modules.ts` to keep the route at STAFF, and it is the first
 * thing tested below.
 *
 * The second is the ordinary one: can org B reach org A's maintenance plan.
 *
 * It is asked from the outside — through the same repository the feature code
 * uses, with scopes built by `getScope()` from a session object rather than
 * assembled by hand, so every test exercises the real path from a cookie to a
 * MongoDB filter.
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
const acmeScope: TenantScope = getScope(clientSession(ORG_A, new Types.ObjectId()));

/** Ids of the plant and the people the schedules point at. Not under test here. */
const CHILLER = new Types.ObjectId();
const FIRE_PUMP = new Types.ObjectId();
const TECHNICIAN = new Types.ObjectId();

const NOW = new Date("2026-03-14T09:00:00.000Z");
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Rebuilt per test: ids are created by the DAL, so they cannot be constants. */
let orgASchedule: Types.ObjectId;

beforeAll(async () => {
  await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const created = await ppmSchedulesRepository.forScope(staffA).create({
    assetId: CHILLER,
    type: "QUARTERLY",
    dueDate: utc("2026-03-01"),
    technicianId: TECHNICIAN,
  });
  orgASchedule = created._id;
});

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

describe("the PpmSchedule schema", () => {
  it("stores the fields the module reads, with the base plugin's on top", () => {
    const paths = PpmSchedule.schema.paths;

    expect(paths.assetId.instance).toBe("ObjectId");
    expect(paths.technicianId.instance).toBe("ObjectId");
    expect(paths.dueDate.instance).toBe("Date");
    expect(paths.type.instance).toBe("String");
    expect(paths.status.instance).toBe("String");

    // Added by the global base plugin, never declared on the model.
    expect(paths.organizationId.instance).toBe("ObjectId");
    expect(paths.deletedAt.instance).toBe("Date");
  });

  /**
   * The absence that carries the tenancy guarantee.
   *
   * `createRepository()` decides a collection is client-partitionable by looking
   * for a `clientId` PATH. There is none here, which is what makes the refusal
   * below possible — so if someone ever adds one, this test fails first and the
   * refusal test fails second, rather than the module silently starting to serve
   * customers their provider's whole plan.
   */
  it("has no clientId, and so is not client-partitioned", () => {
    expect(PpmSchedule.schema.path("clientId")).toBeUndefined();
    expect(ppmSchedulesRepository.isClientPartitioned).toBe(false);
  });

  it("declares the tenant-first indexes the list and the tiles are served by", () => {
    const declared = PpmSchedule.schema
      .indexes()
      .map(([fields]) => Object.keys(fields).join(","));

    expect(declared).toContain("organizationId,status,dueDate");
    expect(declared).toContain("organizationId,assetId");
    expect(declared).toContain("organizationId,technicianId,dueDate");
    expect(declared).toContain("organizationId,dueDate");
    expect(declared).toContain("organizationId,type,dueDate");

    // Every index on a tenant-scoped collection starts with the tenant.
    for (const index of declared) {
      expect(index.startsWith("organizationId"), index).toBe(true);
    }
  });

  it("defaults a new schedule to SCHEDULED, whatever the caller says", async () => {
    const created = await ppmSchedulesRepository.forScope(staffA).create({
      assetId: FIRE_PUMP,
      type: "ANNUAL",
      dueDate: utc("2026-11-01"),
      technicianId: TECHNICIAN,
    });

    expect(created.status).toBe("SCHEDULED");
    expect(created.startedAt ?? null).toBeNull();
    expect(created.completedAt ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A CLIENT session is refused, not narrowed
// ---------------------------------------------------------------------------

describe("a CLIENT session is refused outright", () => {
  /**
   * The guarantee the whole module's role policy rests on.
   *
   * A collection with no `clientId` cannot be narrowed to one customer, and the
   * DAL will not fall back to "the whole organization" — it throws. That matters
   * because the failure mode of the alternative is silent and total: a customer
   * handed every planned visit at every other customer's site.
   *
   * It is asserted as a THROW rather than an empty list on purpose. An empty
   * list would be indistinguishable from "this tenant has no schedules", and the
   * day someone marks the repository `sharedWithClients` by mistake, an
   * emptiness assertion would keep passing.
   */
  const forbidden: ReadonlyArray<[string, () => Promise<unknown>]> = [
    ["find", () => ppmSchedulesRepository.forScope(acmeScope).find()],
    ["paginate", () => ppmSchedulesRepository.forScope(acmeScope).paginate()],
    ["findById", () => ppmSchedulesRepository.forScope(acmeScope).findById(orgASchedule)],
    ["count", () => ppmSchedulesRepository.forScope(acmeScope).count()],
    [
      "create",
      () =>
        ppmSchedulesRepository.forScope(acmeScope).create({
          assetId: CHILLER,
          type: "MONTHLY",
          dueDate: utc("2026-04-01"),
          technicianId: TECHNICIAN,
        }),
    ],
    [
      "update",
      () =>
        ppmSchedulesRepository.forScope(acmeScope).update(orgASchedule, { type: "DAILY" }),
    ],
    ["delete", () => ppmSchedulesRepository.forScope(acmeScope).delete(orgASchedule)],
  ];

  it.each(forbidden)("refuses %s", async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ScopeResolutionError);
  });

  it("refuses the tile aggregation too, so no count leaks either", async () => {
    await expect(countPpmSchedulesByType(acmeScope, NOW)).rejects.toBeInstanceOf(
      ScopeResolutionError,
    );
  });

  it("but the row is there, and staff in the same organization can read it", async () => {
    const found = await ppmSchedulesRepository.forScope(staffA).findById(orgASchedule);
    expect(found?.type).toBe("QUARTERLY");
  });
});

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

describe("schedules never cross an organization boundary", () => {
  it("does not list another organization's plan", async () => {
    await expect(ppmSchedulesRepository.forScope(staffB).find()).resolves.toHaveLength(0);
    // ...and the row is genuinely there for its owner.
    await expect(ppmSchedulesRepository.forScope(staffA).find()).resolves.toHaveLength(1);
  });

  it("cannot reach one by id", async () => {
    await expect(
      ppmSchedulesRepository.forScope(staffB).findById(orgASchedule),
    ).resolves.toBeNull();
    await expect(
      ppmSchedulesRepository.forScope(staffA).findById(orgASchedule),
    ).resolves.not.toBeNull();
  });

  it("cannot update or delete one", async () => {
    await expect(
      ppmSchedulesRepository.forScope(staffB).update(orgASchedule, { type: "DAILY" }),
    ).resolves.toBeNull();
    await expect(ppmSchedulesRepository.forScope(staffB).delete(orgASchedule)).resolves.toBe(false);

    // Untouched, and still owned by A.
    const after = await ppmSchedulesRepository.forScope(staffA).findById(orgASchedule);
    expect(after?.type).toBe("QUARTERLY");
    expect(after?.deletedAt ?? null).toBeNull();
  });

  /**
   * The spread order in `buildFilter` is the security property: scope keys are
   * applied LAST, so an organizationId in the caller's own filter is overwritten
   * rather than honoured.
   */
  it("cannot widen itself by naming another organization in the filter", async () => {
    const filter = { organizationId: ORG_A } as unknown as Parameters<
      typeof ppmSchedulesRepository.forScope
    >[0] extends never
      ? never
      : Record<string, unknown>;

    await expect(
      ppmSchedulesRepository.forScope(staffB).find(filter as never),
    ).resolves.toHaveLength(0);
  });

  it("stamps the creating scope's organization, not one from the payload", async () => {
    const created = await ppmSchedulesRepository.forScope(staffB).create({
      assetId: CHILLER,
      type: "WEEKLY",
      dueDate: utc("2026-03-20"),
      technicianId: TECHNICIAN,
      // A caller trying to file a schedule into another tenant. `cleanPayload`
      // drops it; the scope's own id is stamped afterwards.
      organizationId: ORG_A,
    } as never);

    expect(created.organizationId.equals(ORG_B)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

describe("soft delete", () => {
  it("hides a cancelled visit from reads but keeps it for audit", async () => {
    await expect(ppmSchedulesRepository.forScope(staffA).delete(orgASchedule)).resolves.toBe(true);

    await expect(ppmSchedulesRepository.forScope(staffA).find()).resolves.toHaveLength(0);
    await expect(
      ppmSchedulesRepository.forScope(staffA).find(undefined, { includeDeleted: true }),
    ).resolves.toHaveLength(1);

    const restored = await ppmSchedulesRepository.forScope(staffA).restore(orgASchedule);
    expect(restored?.deletedAt ?? null).toBeNull();
  });

  it("keeps a deleted schedule out of the tiles", async () => {
    const before = await countPpmSchedulesByType(staffA, NOW);
    expect(before.find((row) => row.type === "QUARTERLY")?.open).toBe(1);

    await ppmSchedulesRepository.forScope(staffA).delete(orgASchedule);

    const after = await countPpmSchedulesByType(staffA, NOW);
    expect(after.find((row) => row.type === "QUARTERLY")?.open).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The frequency summary
// ---------------------------------------------------------------------------

describe("countPpmSchedulesByType", () => {
  beforeEach(async () => {
    const a = ppmSchedulesRepository.forScope(staffA);

    // Two more for A: one monthly and overdue, one monthly and not yet due.
    await a.create({
      assetId: FIRE_PUMP,
      type: "MONTHLY",
      dueDate: utc("2026-02-01"),
      technicianId: TECHNICIAN,
    });
    await a.create({
      assetId: FIRE_PUMP,
      type: "MONTHLY",
      dueDate: utc("2026-04-01"),
      technicianId: TECHNICIAN,
    });

    // One for B, at the same frequency, to prove the counts do not bleed.
    await ppmSchedulesRepository.forScope(staffB).create({
      assetId: CHILLER,
      type: "MONTHLY",
      dueDate: utc("2026-02-01"),
      technicianId: TECHNICIAN,
    });
  });

  it("returns every frequency, including the ones with no work", async () => {
    const counts = await countPpmSchedulesByType(staffA, NOW);

    expect(counts.map((row) => row.type)).toEqual([
      "DAILY",
      "WEEKLY",
      "MONTHLY",
      "QUARTERLY",
      "HALF_YEARLY",
      "ANNUAL",
    ]);
    expect(counts.find((row) => row.type === "DAILY")).toEqual({
      type: "DAILY",
      open: 0,
      overdue: 0,
    });
  });

  it("counts open work per frequency and how much of it is late", async () => {
    const counts = await countPpmSchedulesByType(staffA, NOW);

    // Two monthly, one of them due before 14 March.
    expect(counts.find((row) => row.type === "MONTHLY")).toEqual({
      type: "MONTHLY",
      open: 2,
      overdue: 1,
    });
    // The quarterly from the outer setup, due 1 March.
    expect(counts.find((row) => row.type === "QUARTERLY")).toEqual({
      type: "QUARTERLY",
      open: 1,
      overdue: 1,
    });
  });

  it("counts only the caller's own organization", async () => {
    const forB = await countPpmSchedulesByType(staffB, NOW);

    // B has exactly its own one monthly row, and none of A's four.
    expect(forB.find((row) => row.type === "MONTHLY")).toEqual({
      type: "MONTHLY",
      open: 1,
      overdue: 1,
    });
    expect(forB.find((row) => row.type === "QUARTERLY")?.open).toBe(0);
  });

  it("drops completed work, because a tile is a count of what is left to do", async () => {
    await ppmSchedulesRepository
      .forScope(staffA)
      .update(orgASchedule, { status: "COMPLETED", completedAt: NOW });

    const counts = await countPpmSchedulesByType(staffA, NOW);
    expect(counts.find((row) => row.type === "QUARTERLY")?.open).toBe(0);
    // The monthly pair is untouched, so this is not "everything vanished".
    expect(counts.find((row) => row.type === "MONTHLY")?.open).toBe(2);
  });
});
