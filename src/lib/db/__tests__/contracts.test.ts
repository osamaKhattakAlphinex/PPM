import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { EXPIRING_WINDOW_DAYS } from "../../domain/amc";
import { addUtcDays, startOfUtcDay } from "../../domain/dates";
import { Contract } from "../models/contract";
import { contractsRepository, summariseContracts } from "../repositories/contracts";
import { getScope, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for AMC contracts, and the KPI header built on top
 * of them, against a real mongod.
 *
 * `Contract` is client-partitioned like `WorkOrder`, so the guarantee is the
 * hard one rather than the blunt one: a CLIENT session is SERVED, and served
 * only its own rows. A bug in that direction does not throw — it quietly hands
 * one customer another customer's contract values.
 *
 * The difference from `work-orders.test.ts` is that `clientId` here is
 * REQUIRED. There is no org-wide contract, so the depot case is replaced by its
 * inverse: a contract with no client must be refused outright, because a
 * nullable path would create rows no customer could ever see on the one module
 * built to be seen by the customer.
 *
 * `summariseContracts` gets its own block, and it is the longest, because it is
 * where the derived statuses and the scope meet. Six counts that must partition
 * the total, two subsets chosen for commercial reasons, and a `null` that must
 * not become a zero.
 *
 * Every scope is built by `getScope()` from a session object rather than
 * assembled by hand, so each test exercises the real path from a cookie to a
 * MongoDB filter. Where a test asserts an absence, it also asserts the row
 * exists and is reachable by whoever should see it — an assertion that something
 * is missing passes just as well when nothing was ever written.
 */

const ORG_A = new Types.ObjectId();
const ORG_B = new Types.ObjectId();

const ACME = new Types.ObjectId();
const ZENITH = new Types.ObjectId();

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
const acme: TenantScope = getScope(clientSession(ORG_A, ACME));
const zenith: TenantScope = getScope(clientSession(ORG_A, ZENITH));

/** Fixed "now", so every fixture sits at a known distance from it. */
const NOW = new Date("2026-03-14T09:00:00.000Z");
const TODAY = startOfUtcDay(NOW);
const day = (offset: number) => addUtcDays(TODAY, offset);

/** SAR 1,000.00 in halalas — small enough that sums are readable in failures. */
const UNIT = 100_000;

/** Rebuilt per test: ids are created by the DAL, so they cannot be constants. */
let acmeContract: Types.ObjectId;
let zenithContract: Types.ObjectId;

function baseContract(clientId: Types.ObjectId, contractNumber: string) {
  return {
    clientId,
    contractNumber,
    title: `Contract ${contractNumber}`,
    type: "COMPREHENSIVE" as const,
    value: UNIT,
    startDate: day(-30),
    endDate: day(365),
    compliance: 90,
  };
}

beforeAll(async () => {
  await startMemoryMongo();

  /**
   * Build the indexes before the uniqueness tests run.
   *
   * `connectToDatabase` sets `autoIndex` from the environment because index
   * builds belong in migrations, and the memory server inherits that — so
   * without this the unique index on `{ organizationId, contractNumber }`
   * simply would not exist and the duplicate-rejection test below would pass by
   * never having anything to reject, which is worse than no test at all. Same
   * reasoning, and same call, as `technicians.test.ts` and `checklists.test.ts`.
   */
  await Contract.syncIndexes();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const repository = contractsRepository.forScope(staffA);

  const forAcme = await repository.create(baseContract(ACME, "amc-acme-1"));
  const forZenith = await repository.create(baseContract(ZENITH, "amc-zenith-1"));

  acmeContract = forAcme._id;
  zenithContract = forZenith._id;

  // Organization B's own contract, so a leak across tenants has something to
  // leak.
  await contractsRepository.forScope(staffB).create(baseContract(ACME, "amc-b-1"));
});

// ---------------------------------------------------------------------------

describe("the Contract schema", () => {
  it("stores the paths the module reads", () => {
    const paths = Contract.schema.paths;
    expect(paths.clientId.instance).toBe("ObjectId");
    expect(paths.contractNumber.instance).toBe("String");
    expect(paths.title.instance).toBe("String");
    expect(paths.type.instance).toBe("String");
    expect(paths.value.instance).toBe("Number");
    expect(paths.startDate.instance).toBe("Date");
    expect(paths.endDate.instance).toBe("Date");
    expect(paths.compliance.instance).toBe("Number");
    expect(paths.status.instance).toBe("String");
    // From the base plugin, on every tenant-scoped model.
    expect(paths.organizationId.instance).toBe("ObjectId");
    expect(paths.deletedAt.instance).toBe("Date");
  });

  it("requires clientId, unlike WorkOrder", () => {
    // The presence of the path makes the collection client-partitioned; its
    // REQUIREDness is what stops a contract existing that no customer can see.
    expect(Contract.schema.path("clientId").isRequired).toBe(true);
    expect(contractsRepository.isClientPartitioned).toBe(true);
  });

  it("refuses a contract with no client", async () => {
    // `as never` rather than a `@ts-expect-error`, matching the widening tests
    // below: the type already forbids this, and the point of the test is that
    // the DATABASE forbids it too — a caller reaching the DAL from untyped JSON
    // gets the same answer.
    const orphan = {
      contractNumber: "amc-orphan",
      title: "Orphan",
      type: "COMPREHENSIVE",
      value: UNIT,
      startDate: day(0),
      endDate: day(30),
    } as never;

    await expect(contractsRepository.forScope(staffA).create(orphan)).rejects.toThrow();
  });

  it("starts every contract ACTIVE with full compliance", async () => {
    const created = await contractsRepository.forScope(staffA).create({
      clientId: ACME,
      contractNumber: "amc-defaults",
      title: "Defaults",
      type: "LABOUR_ONLY",
      value: UNIT,
      startDate: day(0),
      endDate: day(30),
    });

    expect(created.status).toBe("ACTIVE");
    // 100, not 0: a contract signed this morning has had no work fall due, and
    // a fresh row reading "0% compliant" accuses a provider of failing at
    // something not yet asked of them.
    expect(created.compliance).toBe(100);
    expect(created.suspendedAt ?? null).toBeNull();
  });

  it("carries the numeric bounds from the zod schema onto the Mongoose paths", async () => {
    // `zodToSchemaDefinition` mirrors INCLUSIVE bounds, which is what makes
    // `runValidators: true` enforce them on findOneAndUpdate as well as create.
    await expect(
      contractsRepository.forScope(staffA).update(acmeContract, { compliance: 101 }),
    ).rejects.toThrow();
    await expect(
      contractsRepository.forScope(staffA).update(acmeContract, { value: -1 }),
    ).rejects.toThrow();
  });

  it("leads every declared index with organizationId", () => {
    // The rule for every index on a tenant-scoped collection: without the tenant
    // in front, the planner may walk another organization's rows before the
    // organizationId term filters them out.
    for (const [fields] of Contract.schema.indexes()) {
      expect(Object.keys(fields)[0]).toBe("organizationId");
    }
  });

  it("declares the two indexes the derived-status filters need", () => {
    const shapes = Contract.schema.indexes().map(([fields]) => Object.keys(fields).join(","));

    // Equality on status, range on endDate: EXPIRING, EXPIRED and ACTIVE.
    expect(shapes).toContain("organizationId,status,endDate");
    // UPCOMING, whose only range is on startDate and whose endDate is unbounded.
    expect(shapes).toContain("organizationId,status,startDate");
    // The client-narrowed list, in list order. `{ organizationId, clientId }` is
    // a strict prefix of this, so it is not declared separately.
    expect(shapes).toContain("organizationId,clientId,status,endDate");
  });

  it("keeps contract numbers unique per organization, not globally", async () => {
    // Both tenants already hold "amc-acme-1"-shaped numbers; B has its own.
    await expect(
      contractsRepository.forScope(staffB).create(baseContract(ACME, "amc-acme-1")),
    ).resolves.toBeTruthy();

    await expect(
      contractsRepository.forScope(staffA).create(baseContract(ZENITH, "amc-acme-1")),
    ).rejects.toThrow();
  });

  it("frees a contract number once the row is soft-deleted", async () => {
    // The unique index is partial on `deletedAt: null`, so a removed contract
    // does not reserve its reference forever.
    await contractsRepository.forScope(staffA).delete(acmeContract);

    await expect(
      contractsRepository.forScope(staffA).create(baseContract(ACME, "amc-acme-1")),
    ).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe("a CLIENT session sees only its own contracts", () => {
  it("reads its own", async () => {
    const found = await contractsRepository.forScope(acme).findById(acmeContract);
    expect(found?._id.equals(acmeContract)).toBe(true);
  });

  it("cannot see another client's, though staff can see both", async () => {
    expect(await contractsRepository.forScope(acme).findById(zenithContract)).toBeNull();

    // The row exists and is reachable by whoever should see it.
    expect(await contractsRepository.forScope(zenith).findById(zenithContract)).not.toBeNull();
    expect(await contractsRepository.forScope(staffA).findById(zenithContract)).not.toBeNull();
  });

  it("counts and lists only its own", async () => {
    expect(await contractsRepository.forScope(acme).count()).toBe(1);
    expect(await contractsRepository.forScope(staffA).count()).toBe(2);

    const page = await contractsRepository.forScope(acme).paginate({ pageSize: 50 });
    expect(page.total).toBe(1);
    expect(page.items.every((item) => item.clientId.equals(ACME))).toBe(true);
  });

  it("cannot update or delete another client's", async () => {
    expect(
      await contractsRepository.forScope(acme).update(zenithContract, { compliance: 1 }),
    ).toBeNull();
    expect(await contractsRepository.forScope(acme).delete(zenithContract)).toBe(false);

    // Untouched.
    const survivor = await contractsRepository.forScope(staffA).findById(zenithContract);
    expect(survivor?.compliance).toBe(90);
  });

  it("cannot widen its own filter by naming another client", async () => {
    const rows = await contractsRepository.forScope(acme).find({ clientId: ZENITH });

    // Not empty: the scope keys are applied LAST in `buildFilter`, so the
    // session's own clientId overwrites the one the caller named and the query
    // answers "Acme's" rather than "none". The leak this rules out is the row
    // coming back at all, not the query returning something.
    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.clientId.equals(ACME))).toBe(true);
  });

  it("cannot file a contract into another client's partition", async () => {
    const created = await contractsRepository
      .forScope(acme)
      .create({ ...baseContract(ZENITH, "amc-acme-2") });

    // The DAL overwrites the payload's clientId with the session's own.
    expect(created.clientId.equals(ACME)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("contracts never cross an organization boundary", () => {
  it("cannot be read, updated or deleted from another tenant", async () => {
    expect(await contractsRepository.forScope(staffB).findById(acmeContract)).toBeNull();
    expect(
      await contractsRepository.forScope(staffB).update(acmeContract, { compliance: 1 }),
    ).toBeNull();
    expect(await contractsRepository.forScope(staffB).delete(acmeContract)).toBe(false);

    expect(await contractsRepository.forScope(staffA).findById(acmeContract)).not.toBeNull();
  });

  it("lists only the tenant's own", async () => {
    expect(await contractsRepository.forScope(staffA).count()).toBe(2);
    expect(await contractsRepository.forScope(staffB).count()).toBe(1);
  });

  it("stamps the scope's organization even when the payload names another", async () => {
    const created = await contractsRepository.forScope(staffB).create({
      ...baseContract(ACME, "amc-b-2"),
      // @ts-expect-error organizationId is reserved and must be ignored
      organizationId: ORG_A,
    });

    expect(created.organizationId.equals(ORG_B)).toBe(true);
  });

  it("cannot be widened by a filter naming another organizationId", async () => {
    const rows = await contractsRepository
      .forScope(staffB)
      .find({ organizationId: ORG_A } as never);

    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.organizationId.equals(ORG_B))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("soft delete", () => {
  it("hides the row from ordinary reads but keeps the record", async () => {
    expect(await contractsRepository.forScope(staffA).delete(acmeContract)).toBe(true);

    expect(await contractsRepository.forScope(staffA).findById(acmeContract)).toBeNull();
    expect(await contractsRepository.forScope(staffA).count()).toBe(1);

    const kept = await contractsRepository
      .forScope(staffA)
      .findById(acmeContract, { includeDeleted: true });
    expect(kept).not.toBeNull();
    expect(kept?.deletedAt).toBeInstanceOf(Date);
  });

  it("moves none of the four header figures", async () => {
    const before = await summariseContracts(staffA, NOW);
    await contractsRepository.forScope(staffA).delete(acmeContract);
    const after = await summariseContracts(staffA, NOW);

    // The base plugin does NOT filter aggregations — only `matchStage()`'s
    // `deletedAt: null` keeps a removed contract out of these. A deleted row
    // that still moved the average is the version of this bug nobody looks for.
    expect(after.total).toBe(before.total - 1);
    expect(after.active).toBe(before.active - 1);
    expect(after.totalValueMinor).toBe(before.totalValueMinor - UNIT);
    expect(after.averageCompliance).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("summariseContracts", () => {
  /** Replace the seeded fixtures with one row per derived status. */
  async function seedEveryStatus(): Promise<void> {
    await clearCollections();
    const repository = contractsRepository.forScope(staffA);

    // UPCOMING — signed, not started.
    await repository.create({
      ...baseContract(ACME, "amc-upcoming"),
      startDate: day(10),
      endDate: day(400),
      compliance: 100,
    });

    // ACTIVE — begun, ends beyond the window.
    await repository.create({
      ...baseContract(ACME, "amc-active"),
      startDate: day(-100),
      endDate: day(EXPIRING_WINDOW_DAYS),
      compliance: 80,
    });

    // EXPIRING — begun, ends inside the window.
    await repository.create({
      ...baseContract(ACME, "amc-expiring"),
      startDate: day(-100),
      endDate: day(EXPIRING_WINDOW_DAYS - 1),
      compliance: 60,
    });

    // EXPIRED — term run out, still stored ACTIVE.
    await repository.create({
      ...baseContract(ACME, "amc-expired"),
      startDate: day(-400),
      endDate: day(-1),
      compliance: 0,
    });

    // SUSPENDED, with a term that ALSO ran out. The ordering case.
    const suspended = await repository.create({
      ...baseContract(ZENITH, "amc-suspended"),
      startDate: day(-400),
      endDate: day(-1),
      compliance: 10,
    });
    await repository.update(suspended._id, { status: "SUSPENDED", suspendedAt: NOW });

    // CANCELLED, with a term still running.
    const cancelled = await repository.create({
      ...baseContract(ZENITH, "amc-cancelled"),
      startDate: day(-100),
      endDate: day(400),
      compliance: 20,
    });
    await repository.update(cancelled._id, { status: "CANCELLED", cancelledAt: NOW });
  }

  it("returns one object, not a per-enum array", async () => {
    const totals = await summariseContracts(staffA, NOW);
    expect(Array.isArray(totals)).toBe(false);
    expect(totals).toHaveProperty("totalValueMinor");
  });

  it("returns zeroes and a null average on an empty scope", async () => {
    await clearCollections();

    // `$group` with `_id: null` over an empty `$match` emits NO document at all,
    // so this is the path a brand-new tenant takes.
    const totals = await summariseContracts(staffA, NOW);

    expect(totals.total).toBe(0);
    expect(totals.totalValueMinor).toBe(0);
    // null, not 0. "0% compliant" and "no contracts" are opposite statements.
    expect(totals.averageCompliance).toBeNull();
  });

  it("partitions the total between the six derived statuses", async () => {
    await seedEveryStatus();
    const t = await summariseContracts(staffA, NOW);

    expect(t.total).toBe(6);
    expect(t.upcoming + t.active + t.expiring + t.expired + t.suspended + t.cancelled).toBe(t.total);
    expect([t.upcoming, t.active, t.expiring, t.expired, t.suspended, t.cancelled]).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it("counts a suspended contract with a past end date as suspended, not expired", async () => {
    await seedEveryStatus();
    const t = await summariseContracts(staffA, NOW);

    // The aggregation's `isLive` guard, mirroring `effectiveContractStatus`'s
    // early return. Without it this row lands in both buckets and the six stop
    // summing to the total.
    expect(t.suspended).toBe(1);
    expect(t.expired).toBe(1); // the stored-ACTIVE one only
  });

  it("counts a cancelled contract with a live term as cancelled, not active", async () => {
    await seedEveryStatus();
    const t = await summariseContracts(staffA, NOW);
    expect(t.cancelled).toBe(1);
    expect(t.active).toBe(1);
  });

  it("values the book over what is neither cancelled nor already ended", async () => {
    await seedEveryStatus();
    const t = await summariseContracts(staffA, NOW);

    // In: upcoming, active, expiring. Out: expired, suspended-and-ended,
    // cancelled. The suspended fixture is excluded here because its term ran
    // out, not because it is suspended — see the next test.
    expect(t.totalValueMinor).toBe(3 * UNIT);
  });

  it("keeps a suspended contract in the book while its term is still running", async () => {
    await seedEveryStatus();
    const repository = contractsRepository.forScope(staffA);

    const live = await repository.create({
      ...baseContract(ZENITH, "amc-suspended-live"),
      startDate: day(-10),
      endDate: day(400),
    });
    await repository.update(live._id, { status: "SUSPENDED", suspendedAt: NOW });

    const t = await summariseContracts(staffA, NOW);

    // A suspension is temporary and the money is still owed. A tile that
    // dropped by the contract's value the moment a client went on payment hold
    // would hide the figure precisely when it is wanted.
    expect(t.totalValueMinor).toBe(4 * UNIT);
  });

  it("averages compliance over ACTIVE and EXPIRING only", async () => {
    await seedEveryStatus();
    const t = await summariseContracts(staffA, NOW);

    // 80 and 60. The 0-compliance EXPIRED row and the 10 and 20 of the suspended
    // and cancelled ones are excluded — `$avg` ignores the nulls the `$cond`
    // maps them to, so they leave both the sum and the divisor alone.
    expect(t.averageCompliance).toBe(70);
  });

  it("is not dragged toward zero by an expired contract", async () => {
    await seedEveryStatus();
    const before = await summariseContracts(staffA, NOW);

    await contractsRepository.forScope(staffA).create({
      ...baseContract(ACME, "amc-expired-2"),
      startDate: day(-400),
      endDate: day(-2),
      compliance: 0,
    });

    const after = await summariseContracts(staffA, NOW);
    expect(after.averageCompliance).toBe(before.averageCompliance);
  });

  it("returns a null average when nothing is being delivered", async () => {
    await clearCollections();
    const repository = contractsRepository.forScope(staffA);

    const only = await repository.create({
      ...baseContract(ACME, "amc-only"),
      startDate: day(-100),
      endDate: day(400),
    });
    await repository.update(only._id, { status: "CANCELLED", cancelledAt: NOW });

    const t = await summariseContracts(staffA, NOW);

    // The collection is NOT empty, so the `$group` emitted a row — but `$avg`
    // saw no numeric input and returned null. Both paths have to survive.
    expect(t.total).toBe(1);
    expect(t.averageCompliance).toBeNull();
  });

  it("rounds the average to a whole number", async () => {
    await clearCollections();
    const repository = contractsRepository.forScope(staffA);

    for (const [index, compliance] of [70, 71].entries()) {
      await repository.create({
        ...baseContract(ACME, `amc-round-${index}`),
        startDate: day(-10),
        endDate: day(400),
        compliance,
      });
    }

    const t = await summariseContracts(staffA, NOW);
    expect(t.averageCompliance).toBe(71); // 70.5 rounds up
    expect(Number.isInteger(t.averageCompliance)).toBe(true);
  });

  it("is scoped like every other read", async () => {
    // The seeded fixtures: two in A, one in B.
    expect((await summariseContracts(staffA, NOW)).total).toBe(2);
    expect((await summariseContracts(staffB, NOW)).total).toBe(1);
  });

  it("narrows to one client for a client session", async () => {
    const t = await summariseContracts(acme, NOW);

    // `matchStage()` supplies the clientId for a client scope, so the header a
    // customer sees counts and values only their own contracts.
    expect(t.total).toBe(1);
    expect(t.totalValueMinor).toBe(UNIT);
  });

  it("uses the caller's midnight, not the server's clock", async () => {
    await seedEveryStatus();

    const before = await summariseContracts(staffA, NOW);
    expect([before.upcoming, before.active, before.expiring, before.expired]).toEqual([1, 1, 1, 1]);

    /**
     * Wind the clock forward sixty days and read the same rows again. Nothing is
     * written between the two calls: every contract shifts one step along the
     * term purely because `now` moved.
     *
     *  - the UPCOMING one has started            -> ACTIVE
     *  - the ACTIVE one (ending on day 60) is now inside the window -> EXPIRING
     *  - the EXPIRING one (day 59) has run out   -> EXPIRED
     *
     * This is the whole argument for deriving rather than storing: a stored
     * status would still read the same three labels, wrongly, with nothing
     * running to correct it.
     */
    const later = addUtcDays(NOW, EXPIRING_WINDOW_DAYS);
    const t = await summariseContracts(staffA, later);

    expect([t.upcoming, t.active, t.expiring, t.expired]).toEqual([0, 1, 1, 2]);

    // The two stored states are untouched by the clock, and the six still
    // partition the same six rows.
    expect(t.suspended).toBe(1);
    expect(t.cancelled).toBe(1);
    expect(t.upcoming + t.active + t.expiring + t.expired + t.suspended + t.cancelled).toBe(6);
  });
});
