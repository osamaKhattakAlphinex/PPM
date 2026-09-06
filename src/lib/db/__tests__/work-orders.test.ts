import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { WorkOrder } from "../models/work-order";
import { countWorkOrdersByPriority, workOrdersRepository } from "../repositories/work-orders";
import { getScope, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for work orders, against a real mongod.
 *
 * This suite asks the half that `ppm-schedules.test.ts` cannot.
 *
 * `PpmSchedule` has no `clientId`, so its guarantee is the blunt one — a CLIENT
 * session is REFUSED outright, and that suite asserts the throw. `WorkOrder`
 * has a `clientId`, because `nav/modules.ts` gives corrective maintenance to
 * EVERYONE and a customer must be able to report a fault. So the guarantee here
 * is the harder one to get right: a client session is SERVED, and served only
 * its own rows. A bug in this direction does not throw — it quietly hands one
 * customer another customer's faults.
 *
 * Three tenants' worth of fixtures, because two are not enough to catch it:
 * organization A holds work orders for two different clients plus one at an
 * org-wide site, and organization B holds one of its own. A filter that leaked
 * would show up as Acme seeing Zenith's ticket, or the depot's, or B's.
 *
 * Every scope is built by `getScope()` from a session object rather than
 * assembled by hand, so each test exercises the real path from a cookie to a
 * MongoDB filter.
 *
 * Where a test asserts an absence, it also asserts that the row exists and is
 * reachable by whoever *should* see it. An assertion that something is missing
 * passes just as well when nothing was ever written.
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

/** Ids of the plant and the people the tickets point at. Not under test here. */
const CHILLER = new Types.ObjectId();
const LIFT = new Types.ObjectId();
const COMPRESSOR = new Types.ObjectId();
const TECHNICIAN = new Types.ObjectId();

/** Rebuilt per test: ids are created by the DAL, so they cannot be constants. */
let acmeTicket: Types.ObjectId;
let zenithTicket: Types.ObjectId;
let depotTicket: Types.ObjectId;

beforeAll(async () => {
  await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const repository = workOrdersRepository.forScope(staffA);

  const forAcme = await repository.create({
    assetId: CHILLER,
    clientId: ACME,
    issue: "Chiller 2 is tripping on high head pressure.",
    priority: "CRITICAL",
  });
  acmeTicket = forAcme._id;

  const forZenith = await repository.create({
    assetId: LIFT,
    clientId: ZENITH,
    issue: "Passenger lift 3 is overshooting the fourth floor.",
    priority: "HIGH",
  });
  zenithTicket = forZenith._id;

  // An org-wide site (the depot) has no client. Invisible to every CLIENT.
  const forDepot = await repository.create({
    assetId: COMPRESSOR,
    clientId: null,
    issue: "Workshop compressor will not build pressure.",
    priority: "MEDIUM",
  });
  depotTicket = forDepot._id;

  // Another organization entirely, to prove the outer boundary still holds.
  await workOrdersRepository.forScope(staffB).create({
    assetId: new Types.ObjectId(),
    clientId: null,
    issue: "Generator failed its monthly load test.",
    priority: "CRITICAL",
  });
});

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

describe("the WorkOrder schema", () => {
  it("stores the fields the module reads, with the base plugin's on top", () => {
    const paths = WorkOrder.schema.paths;

    expect(paths.assetId.instance).toBe("ObjectId");
    expect(paths.clientId.instance).toBe("ObjectId");
    expect(paths.technicianId.instance).toBe("ObjectId");
    expect(paths.issue.instance).toBe("String");
    expect(paths.priority.instance).toBe("String");
    expect(paths.status.instance).toBe("String");
    expect(paths.assignedAt.instance).toBe("Date");
    expect(paths.startedAt.instance).toBe("Date");
    expect(paths.closedAt.instance).toBe("Date");

    // Added by the global base plugin, never declared on the model.
    expect(paths.organizationId.instance).toBe("ObjectId");
    expect(paths.deletedAt.instance).toBe("Date");
  });

  /**
   * The single most important assertion in this file.
   *
   * The `clientId` PATH is what makes `createRepository()` narrow a CLIENT
   * session instead of refusing it. Remove the path and every test below still
   * passes for staff while a client's session starts throwing on the one screen
   * they are guaranteed to open; remove the flag and the narrowing silently
   * stops.
   */
  it("is client-partitioned, unlike PpmSchedule", () => {
    expect(WorkOrder.schema.path("clientId")).toBeDefined();
    expect(workOrdersRepository.isClientPartitioned).toBe(true);
  });

  it("starts every work order OPEN and unassigned", async () => {
    const created = await workOrdersRepository.forScope(staffA).create({
      assetId: CHILLER,
      clientId: ACME,
      issue: "Cooling tower fan is making a new noise.",
      priority: "LOW",
    });

    expect(created.status).toBe("OPEN");
    expect(created.technicianId ?? null).toBeNull();
    expect(created.closedAt ?? null).toBeNull();
  });

  /**
   * Every index on a tenant-scoped collection must lead with `organizationId`,
   * or the planner may choose it and scan across every organization's tickets
   * before the tenant term filters them out.
   */
  it("leads every declared index with organizationId", () => {
    const indexes = WorkOrder.schema.indexes();
    expect(indexes.length).toBeGreaterThan(0);

    for (const [fields] of indexes) {
      expect(Object.keys(fields)[0]).toBe("organizationId");
    }
  });

  it("declares the index the module's list and tiles are built on", () => {
    const shapes = WorkOrder.schema.indexes().map(([fields]) => Object.keys(fields).join(","));
    expect(shapes).toContain("organizationId,status,priority");
  });
});

// ---------------------------------------------------------------------------
// A CLIENT session is served, and narrowed
// ---------------------------------------------------------------------------

describe("a CLIENT session sees only its own faults", () => {
  /**
   * Served, not refused — the opposite of the PPM guarantee, and the reason
   * `WorkOrder` carries a `clientId` at all.
   */
  it("reads its own work orders", async () => {
    const items = await workOrdersRepository.forScope(acme).find();

    expect(items).toHaveLength(1);
    expect(items[0]._id.toHexString()).toBe(acmeTicket.toHexString());
  });

  it("cannot see another client's, though staff can see both", async () => {
    const forAcme = await workOrdersRepository.forScope(acme).findById(zenithTicket);
    expect(forAcme).toBeNull();

    // The row exists and is reachable by whoever should see it.
    expect(await workOrdersRepository.forScope(zenith).findById(zenithTicket)).not.toBeNull();
    expect(await workOrdersRepository.forScope(staffA).findById(zenithTicket)).not.toBeNull();
  });

  /**
   * A ticket at an org-wide site has `clientId: null`. The filter the DAL builds
   * for a client is `clientId: <theirs>`, which matches no null — so the depot's
   * problems stay the provider's business.
   */
  it("cannot see an org-wide site's work orders", async () => {
    expect(await workOrdersRepository.forScope(acme).findById(depotTicket)).toBeNull();
    expect(await workOrdersRepository.forScope(zenith).findById(depotTicket)).toBeNull();

    expect(await workOrdersRepository.forScope(staffA).findById(depotTicket)).not.toBeNull();
  });

  it("counts only its own", async () => {
    expect(await workOrdersRepository.forScope(acme).count()).toBe(1);
    expect(await workOrdersRepository.forScope(zenith).count()).toBe(1);
    // Two clients plus the depot; org B's ticket is not in this organization.
    expect(await workOrdersRepository.forScope(staffA).count()).toBe(3);
  });

  it("paginates within its own partition", async () => {
    const page = await workOrdersRepository.forScope(acme).paginate({ page: 1 });

    expect(page.total).toBe(1);
    expect(page.items.every((item) => item.clientId?.equals(ACME))).toBe(true);
  });

  it("cannot update or delete another client's", async () => {
    expect(
      await workOrdersRepository.forScope(acme).update(zenithTicket, { priority: "LOW" }),
    ).toBeNull();
    expect(await workOrdersRepository.forScope(acme).delete(zenithTicket)).toBe(false);

    // Untouched, and still the priority it was created with.
    const survivor = await workOrdersRepository.forScope(staffA).findById(zenithTicket);
    expect(survivor?.priority).toBe("HIGH");
  });

  /**
   * A client cannot file into someone else's partition even by naming it: the
   * DAL overwrites `clientId` with the session's own for a client-scoped
   * create, the same way it overwrites `organizationId`.
   */
  it("cannot raise a ticket into another client's partition", async () => {
    const created = await workOrdersRepository.forScope(acme).create({
      assetId: CHILLER,
      clientId: ZENITH,
      issue: "Reception air handling unit is blowing warm.",
      priority: "MEDIUM",
    });

    expect(created.clientId?.toHexString()).toBe(ACME.toHexString());
    expect(await workOrdersRepository.forScope(zenith).findById(created._id)).toBeNull();
  });

  it("cannot widen its own filter by naming a clientId", async () => {
    const items = await workOrdersRepository.forScope(acme).find({ clientId: ZENITH } as never);

    // Not empty: the scope's own clientId is applied LAST and overwrites the one
    // the caller named, so the query answers "Acme's" rather than "none".
    expect(items).toHaveLength(1);
    expect(items.every((item) => item.clientId?.equals(ACME))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

describe("work orders never cross an organization boundary", () => {
  it("does not read another organization's", async () => {
    expect(await workOrdersRepository.forScope(staffB).findById(acmeTicket)).toBeNull();
    expect(await workOrdersRepository.forScope(staffA).findById(acmeTicket)).not.toBeNull();
  });

  it("lists only its own", async () => {
    const items = await workOrdersRepository.forScope(staffB).find();

    expect(items).toHaveLength(1);
    expect(items[0].organizationId.equals(ORG_B)).toBe(true);
  });

  it("does not update or delete another organization's", async () => {
    expect(
      await workOrdersRepository.forScope(staffB).update(acmeTicket, { priority: "LOW" }),
    ).toBeNull();
    expect(await workOrdersRepository.forScope(staffB).delete(acmeTicket)).toBe(false);

    const survivor = await workOrdersRepository.forScope(staffA).findById(acmeTicket);
    expect(survivor?.priority).toBe("CRITICAL");
  });

  it("stamps the scope's organization even when the payload names another", async () => {
    const created = await workOrdersRepository.forScope(staffB).create({
      assetId: new Types.ObjectId(),
      clientId: null,
      issue: "Sump pump B1 has stopped responding to its float switch.",
      priority: "HIGH",
      // A caller trying to file a fault into another tenant. `cleanPayload`
      // drops it; the scope's own id is stamped afterwards.
      organizationId: ORG_A,
    } as never);

    expect(created.organizationId.equals(ORG_B)).toBe(true);
    expect(await workOrdersRepository.forScope(staffA).findById(created._id)).toBeNull();
  });

  it("cannot be widened by a filter naming another organizationId", async () => {
    const items = await workOrdersRepository
      .forScope(staffB)
      .find({ organizationId: ORG_A } as never);

    expect(items).toHaveLength(1);
    expect(items.every((item) => item.organizationId.equals(ORG_B))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

describe("soft delete", () => {
  it("hides a deleted work order from ordinary reads but keeps the record", async () => {
    expect(await workOrdersRepository.forScope(staffA).delete(acmeTicket)).toBe(true);

    expect(await workOrdersRepository.forScope(staffA).findById(acmeTicket)).toBeNull();
    expect(await workOrdersRepository.forScope(acme).find()).toHaveLength(0);

    const kept = await workOrdersRepository
      .forScope(staffA)
      .findById(acmeTicket, { includeDeleted: true });
    expect(kept?.issue).toContain("high head pressure");
  });

  it("leaves a deleted work order out of the tiles", async () => {
    await workOrdersRepository.forScope(staffA).delete(acmeTicket);

    const counts = await countWorkOrdersByPriority(staffA);
    expect(counts.find((row) => row.priority === "CRITICAL")?.open).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The priority tiles
// ---------------------------------------------------------------------------

describe("countWorkOrdersByPriority", () => {
  it("returns every priority in vocabulary order, including the empty ones", async () => {
    const counts = await countWorkOrdersByPriority(staffA);

    expect(counts.map((row) => row.priority)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    expect(counts.find((row) => row.priority === "LOW")).toEqual({
      priority: "LOW",
      open: 0,
      unassigned: 0,
    });
  });

  it("counts the tenant's unfinished work", async () => {
    const counts = await countWorkOrdersByPriority(staffA);
    const byPriority = new Map(counts.map((row) => [row.priority, row]));

    expect(byPriority.get("CRITICAL")?.open).toBe(1);
    expect(byPriority.get("HIGH")?.open).toBe(1);
    expect(byPriority.get("MEDIUM")?.open).toBe(1);
  });

  it("counts an unassigned ticket as unassigned, and an assigned one as not", async () => {
    const before = await countWorkOrdersByPriority(staffA);
    expect(before.find((row) => row.priority === "CRITICAL")?.unassigned).toBe(1);

    await workOrdersRepository.forScope(staffA).update(acmeTicket, {
      status: "ASSIGNED",
      technicianId: TECHNICIAN,
      assignedAt: new Date(),
    });

    const after = await countWorkOrdersByPriority(staffA);
    const critical = after.find((row) => row.priority === "CRITICAL");
    // Still open — it is not finished — but no longer nobody's.
    expect(critical?.open).toBe(1);
    expect(critical?.unassigned).toBe(0);
  });

  it("excludes closed work orders", async () => {
    await workOrdersRepository.forScope(staffA).update(acmeTicket, {
      status: "CLOSED",
      closedAt: new Date(),
    });

    const counts = await countWorkOrdersByPriority(staffA);
    expect(counts.find((row) => row.priority === "CRITICAL")?.open).toBe(0);
  });

  /**
   * The aggregation's `$match` starts from `matchStage()`, so it inherits the
   * same scoping as every other read. A pipeline that restated the filter would
   * be the one place a tenant's tiles could count someone else's work.
   */
  it("is scoped like every other read", async () => {
    const forB = await countWorkOrdersByPriority(staffB);
    expect(forB.find((row) => row.priority === "CRITICAL")?.open).toBe(1);
    // Org B has no HIGH or MEDIUM work; org A's must not leak in.
    expect(forB.find((row) => row.priority === "HIGH")?.open).toBe(0);
    expect(forB.find((row) => row.priority === "MEDIUM")?.open).toBe(0);
  });

  it("narrows to one client for a client session", async () => {
    const forAcme = await countWorkOrdersByPriority(acme);

    expect(forAcme.find((row) => row.priority === "CRITICAL")?.open).toBe(1);
    // Zenith's HIGH ticket and the depot's MEDIUM one are not Acme's business.
    expect(forAcme.find((row) => row.priority === "HIGH")?.open).toBe(0);
    expect(forAcme.find((row) => row.priority === "MEDIUM")?.open).toBe(0);
  });
});
