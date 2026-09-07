import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { Checklist } from "../models/checklist";
import { ChecklistRun } from "../models/checklist-run";
import { checklistRunsRepository } from "../repositories/checklist-runs";
import { checklistsRepository } from "../repositories/checklists";
import { getScope, ScopeResolutionError, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for checklists and their runs, against a real mongod.
 *
 * Two shapes of guarantee are asserted here, and they are different claims:
 *
 *  1. The BLUNT one, which these collections share with `PpmSchedule` and
 *     `Technician`: neither model has a `clientId`, so a CLIENT session is
 *     REFUSED rather than served. That is the fail-closed direction, and it has
 *     to be tested because the mechanism is an ABSENCE — nobody writing the
 *     model wrote a line that produces it, so nobody editing the model later
 *     would see a line to be careful about. Adding a `clientId` path for some
 *     unrelated reason would silently turn a refusal into a service.
 *  2. The ordinary tenant one: two organizations cannot see each other's
 *     procedures or each other's evidence.
 *
 * Every scope is built by `getScope()` from a session object rather than
 * assembled by hand, so each test exercises the real path from a cookie to a
 * MongoDB filter.
 *
 * Where a test asserts an absence, it also asserts the row exists and is
 * reachable by whoever SHOULD see it. An assertion that something is missing
 * passes just as well when nothing was ever written.
 */

const ORG_A = new Types.ObjectId();
const ORG_B = new Types.ObjectId();
const ACME = new Types.ObjectId();

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

/** The job a run points at. Its own collection is not under test here. */
const JOB = new Types.ObjectId();
const OTHER_JOB = new Types.ObjectId();

const STEPS = [
  { label: "Isolate the supply", required: true },
  { label: "Check refrigerant pressures", required: true },
  { label: "Photograph the nameplate", required: false },
];

/** Rebuilt per test: ids are created by the DAL, so they cannot be constants. */
let checklistA: Types.ObjectId;
let checklistB: Types.ObjectId;

beforeAll(async () => {
  await startMemoryMongo();

  /**
   * Index creation is lazy, and two of the guarantees below ARE indexes — the
   * per-organization unique name, and one attachment per template per job.
   * Without this the duplicate-rejection tests would pass silently by never
   * having a constraint to violate, which is the failure mode that makes a
   * uniqueness test worse than none. `identity.test.ts` and `technicians.test.ts`
   * do the same thing for the same reason.
   */
  await Promise.all([Checklist.syncIndexes(), ChecklistRun.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const a = await checklistsRepository.forScope(staffA).create({
    name: "Monthly chiller service",
    category: "HVAC",
    items: STEPS,
    lastUsedAt: null,
  });

  const b = await checklistsRepository.forScope(staffB).create({
    name: "Monthly chiller service",
    category: "HVAC",
    items: STEPS,
    lastUsedAt: null,
  });

  checklistA = a._id;
  checklistB = b._id;
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("a checklist belongs to exactly one organization", () => {
  it("stamps organizationId from the scope", async () => {
    const checklist = await checklistsRepository.forScope(staffA).findById(checklistA);
    expect(checklist?.organizationId.equals(ORG_A)).toBe(true);
  });

  it("hides another tenant's checklist from a list", async () => {
    const listed = await checklistsRepository.forScope(staffA).find();

    expect(listed).toHaveLength(1);
    expect(listed[0]._id.equals(checklistA)).toBe(true);

    // The other row exists and is reachable by its owner, so the absence above
    // is a filter doing its job rather than an empty collection.
    const theirs = await checklistsRepository.forScope(staffB).find();
    expect(theirs).toHaveLength(1);
    expect(theirs[0]._id.equals(checklistB)).toBe(true);
  });

  it("refuses to read another tenant's checklist by id", async () => {
    // The id is a FILTER TERM with organizationId layered on top, so a known id
    // from another tenant matches nothing rather than reaching across.
    expect(await checklistsRepository.forScope(staffA).findById(checklistB)).toBeNull();
  });

  it("refuses to update or delete another tenant's checklist", async () => {
    expect(
      await checklistsRepository.forScope(staffA).update(checklistB, { name: "Hijacked" }),
    ).toBeNull();
    expect(await checklistsRepository.forScope(staffA).delete(checklistB)).toBe(false);

    const untouched = await checklistsRepository.forScope(staffB).findById(checklistB);
    expect(untouched?.name).toBe("Monthly chiller service");
    expect(untouched?.deletedAt).toBeNull();
  });

  it("ignores an organizationId supplied in a create payload", async () => {
    const created = await checklistsRepository.forScope(staffA).create({
      name: "Smuggled",
      category: "SAFETY",
      items: STEPS,
      // Not part of the create type; a JSON body could still carry it, and the
      // DAL drops reserved fields before the payload reaches the model.
      organizationId: ORG_B,
    } as never);

    expect(created.organizationId.equals(ORG_A)).toBe(true);
    expect(await checklistsRepository.forScope(staffB).findById(created._id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The CLIENT refusal
// ---------------------------------------------------------------------------

describe("neither collection can be narrowed to a client, so a client is refused", () => {
  /**
   * The mechanism is the ABSENCE of a `clientId` path, which
   * `createRepository()` reads to decide whether a collection is
   * client-partitioned. With none, and without `sharedWithClients`, serving a
   * client-scoped session would mean serving it the whole organization — so it
   * throws instead.
   *
   * This is the test that would catch someone adding a `clientId` to either
   * model for an unrelated reason: the refusal would quietly become a service,
   * and nothing else in the stack would notice.
   */
  it("refuses a client-scoped read of the library", () => {
    expect(() => checklistsRepository.forScope(acme)).not.toThrow();
    // The throw happens when a filter is built, which is where the decision to
    // widen or refuse would actually be taken.
    expect(() => checklistsRepository.forScope(acme).matchStage()).toThrow(ScopeResolutionError);
  });

  it("refuses a client-scoped read of the runs", () => {
    expect(() => checklistRunsRepository.forScope(acme).matchStage()).toThrow(
      ScopeResolutionError,
    );
  });

  it("refuses a client-scoped write", async () => {
    await expect(
      checklistsRepository.forScope(acme).create({
        name: "From a customer",
        category: "GENERAL",
        items: STEPS,
      }),
    ).rejects.toThrow(ScopeResolutionError);
  });

  it("serves the same data to a staff session in the same organization", async () => {
    // The other half of the assertion: the refusal is about the ROLE, not about
    // the data being missing.
    const listed = await checklistsRepository.forScope(staffA).find();
    expect(listed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Uniqueness
// ---------------------------------------------------------------------------

describe("a checklist name is unique per organization, not globally", () => {
  it("lets two tenants use the same name", async () => {
    // Already proved by the fixtures — both organizations hold "Monthly chiller
    // service" — but asserted explicitly because it is the property a bare
    // `unique: true` on the field would have broken.
    const a = await checklistsRepository.forScope(staffA).findById(checklistA);
    const b = await checklistsRepository.forScope(staffB).findById(checklistB);

    expect(a?.name).toBe(b?.name);
    expect(a?.organizationId.equals(b!.organizationId)).toBe(false);
  });

  it("refuses a duplicate inside one organization", async () => {
    await expect(
      checklistsRepository.forScope(staffA).create({
        name: "Monthly chiller service",
        category: "HVAC",
        items: STEPS,
      }),
    ).rejects.toThrow();
  });

  it("releases the name when the checklist is soft-deleted", async () => {
    // The index is partial on `deletedAt: null`. A procedure retired and then
    // rewritten under the same name is an ordinary thing to want, and would
    // otherwise be blocked forever by its own history.
    await checklistsRepository.forScope(staffA).delete(checklistA);

    const replacement = await checklistsRepository.forScope(staffA).create({
      name: "Monthly chiller service",
      category: "HVAC",
      items: STEPS,
    });

    expect(replacement._id.equals(checklistA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

async function startRun(scope: TenantScope, checklistId: Types.ObjectId, jobId = JOB) {
  return checklistRunsRepository.forScope(scope).create({
    checklistId,
    checklistName: "Monthly chiller service",
    category: "HVAC",
    jobType: "PPM",
    jobId,
    items: STEPS.map((step) => ({
      label: step.label,
      required: step.required,
      done: false,
      note: null,
      completedAt: null,
    })),
    status: "IN_PROGRESS",
  });
}

describe("a run is isolated the same way its template is", () => {
  it("hides another tenant's run", async () => {
    const mine = await startRun(staffA, checklistA);
    await startRun(staffB, checklistB);

    const listed = await checklistRunsRepository.forScope(staffA).find();
    expect(listed).toHaveLength(1);
    expect(listed[0]._id.equals(mine._id)).toBe(true);
  });

  it("refuses to read another tenant's run by id, even with the job id", async () => {
    // Both tenants have a run against the SAME jobId here, which is the case a
    // filter that forgot the tenant would get wrong.
    const theirs = await startRun(staffB, checklistB);
    await startRun(staffA, checklistA);

    expect(await checklistRunsRepository.forScope(staffA).findById(theirs._id)).toBeNull();

    const byJob = await checklistRunsRepository.forScope(staffA).find({ jobId: JOB });
    expect(byJob).toHaveLength(1);
    expect(byJob[0].organizationId.equals(ORG_A)).toBe(true);
  });
});

describe("one attachment per template per job", () => {
  it("refuses a second run of the same checklist on the same job", async () => {
    await startRun(staffA, checklistA);

    await expect(startRun(staffA, checklistA)).rejects.toThrow();
  });

  it("allows the same checklist on a different job", async () => {
    await startRun(staffA, checklistA);
    const second = await startRun(staffA, checklistA, OTHER_JOB);

    expect(second.jobId.equals(OTHER_JOB)).toBe(true);
  });

  it("does not collide across organizations", async () => {
    // Same template name, same job id, different tenants. A unique index that
    // was not tenant-first would refuse the second of these.
    await startRun(staffA, checklistA);
    const theirs = await startRun(staffB, checklistB);

    expect(theirs.organizationId.equals(ORG_B)).toBe(true);
  });

  it("releases the slot when a run is discarded", async () => {
    // COMPLETED is terminal, so discarding and re-attaching is the module's only
    // correction path. The partial index is what keeps it open.
    const first = await startRun(staffA, checklistA);
    await checklistRunsRepository.forScope(staffA).delete(first._id);

    const replacement = await startRun(staffA, checklistA);
    expect(replacement._id.equals(first._id)).toBe(false);
  });
});

describe("the snapshot is a copy, not a reference", () => {
  it("survives an edit to the template", async () => {
    const run = await startRun(staffA, checklistA);

    await checklistsRepository.forScope(staffA).update(checklistA, {
      items: [{ label: "Something else entirely", required: false }],
    });

    const after = await checklistRunsRepository.forScope(staffA).findById(run._id);

    // The whole reason the run carries its own items: rewording a template must
    // not rewrite what a technician already confirmed.
    expect(after?.items.map((item) => item.label)).toEqual(STEPS.map((step) => step.label));
  });

  it("survives deletion of the template", async () => {
    const run = await startRun(staffA, checklistA);
    await checklistsRepository.forScope(staffA).delete(checklistA);

    const after = await checklistRunsRepository.forScope(staffA).findById(run._id);

    expect(after).not.toBeNull();
    expect(after?.checklistName).toBe("Monthly chiller service");
    expect(after?.items).toHaveLength(STEPS.length);
  });
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

describe("soft delete hides rows without erasing them", () => {
  it("removes a checklist from reads but keeps the document", async () => {
    await checklistsRepository.forScope(staffA).delete(checklistA);

    expect(await checklistsRepository.forScope(staffA).findById(checklistA)).toBeNull();
    expect(await checklistsRepository.forScope(staffA).find()).toHaveLength(0);

    const withDeleted = await checklistsRepository
      .forScope(staffA)
      .findById(checklistA, { includeDeleted: true });
    expect(withDeleted?.deletedAt).toBeInstanceOf(Date);
  });

  it("restores one", async () => {
    await checklistsRepository.forScope(staffA).delete(checklistA);
    const restored = await checklistsRepository.forScope(staffA).restore(checklistA);

    expect(restored?.deletedAt).toBeNull();
    expect(await checklistsRepository.forScope(staffA).find()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The models themselves
// ---------------------------------------------------------------------------

describe("the models declare what the isolation rules depend on", () => {
  /**
   * These assert the SHAPE the repositories reason about, so a change to a
   * model that would flip a refusal into a service fails here rather than in
   * production.
   */
  it("neither model has a clientId path", () => {
    expect(Checklist.schema.path("clientId")).toBeUndefined();
    expect(ChecklistRun.schema.path("clientId")).toBeUndefined();
  });

  it("both are tenant-scoped, so the base plugin added organizationId", () => {
    expect(Checklist.schema.path("organizationId")).toBeDefined();
    expect(ChecklistRun.schema.path("organizationId")).toBeDefined();
  });

  it("every index starts with organizationId", () => {
    // A bare index on a tenant-scoped collection is one the planner may choose
    // before the organizationId term has filtered anything.
    for (const model of [Checklist, ChecklistRun]) {
      for (const [fields] of model.schema.indexes()) {
        expect(Object.keys(fields)[0]).toBe("organizationId");
      }
    }
  });

  /**
   * The storage half of the `min(1)` in the action schema.
   *
   * It needs a path validator, and this test is why: Mongoose's `required` does
   * NOT mean non-empty for an array — an empty array is a present value and
   * passes it. The first version of this model relied on that and stored a
   * zero-step checklist without complaint.
   *
   * Both paths are asserted, because a path validator is worth having precisely
   * where a document hook is not: update validators run it, so a checklist
   * cannot be emptied by an edit either.
   */
  it("refuses an empty item array on create", async () => {
    await expect(
      checklistsRepository.forScope(staffA).create({
        name: "Empty",
        category: "GENERAL",
        items: [],
      }),
    ).rejects.toThrow();
  });

  it("refuses an empty item array on update", async () => {
    await expect(
      checklistsRepository.forScope(staffA).update(checklistA, { items: [] }),
    ).rejects.toThrow();

    const untouched = await checklistsRepository.forScope(staffA).findById(checklistA);
    expect(untouched?.items).toHaveLength(STEPS.length);
  });
});
