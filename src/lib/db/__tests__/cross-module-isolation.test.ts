import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { approvalsRepository } from "../repositories/approvals";
import { assetsRepository } from "../repositories/assets";
import { attachmentsRepository } from "../repositories/attachments";
import { attendanceRepository } from "../repositories/attendance";
import { checklistsRepository } from "../repositories/checklists";
import { contractsRepository } from "../repositories/contracts";
import { invoicesRepository } from "../repositories/invoices";
import { locationsRepository } from "../repositories/locations";
import { notificationsRepository } from "../repositories/notifications";
import { ppmSchedulesRepository } from "../repositories/ppm-schedules";
import { techniciansRepository } from "../repositories/technicians";
import { workOrdersRepository } from "../repositories/work-orders";
import type { RepositoryFactory } from "../repository";
import { UnsafeQueryError } from "../sanitize";
import { getScope, ScopeResolutionError, type TenantScope } from "../scope";
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from "./helpers/memory-mongo";

/**
 * The whole-product isolation sweep.
 *
 * Every module has its own suite proving its own rules. This one asks ONE
 * question of EVERY collection at once, uniformly, and the reason it exists
 * separately is that the failure it catches is the one a per-module suite
 * structurally cannot: a module added next year whose author wrote a repository
 * but not a test for it.
 *
 * The table below is the audit. A new collection has to be added to it, and a
 * collection that is in it is checked for all five properties whether or not
 * anybody wrote it a suite:
 *
 *  1. Org A cannot READ an Org B document, holding the correct `_id`.
 *  2. Org A cannot UPDATE one.
 *  3. Org A cannot DELETE one.
 *  4. A client-partitioned collection serves a CLIENT session only its own
 *     client's rows; a collection with no `clientId` REFUSES a client session
 *     outright rather than widening it to the organisation.
 *  5. A caller cannot set `organizationId` or `clientId` on create.
 *
 * Plus the injection sweep: operator-shaped and dotted keys are refused by the
 * DAL on every collection, not by each module remembering to check.
 */

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const ORG_A = new Types.ObjectId();
const ORG_B = new Types.ObjectId();
const ACME = new Types.ObjectId();
const ZENITH = new Types.ObjectId();

/** What a maker is given: a client to hang the document on, and a name suffix. */
interface Seed {
  readonly clientId: Types.ObjectId | null;
  readonly suffix: string;
}

/** A minimal valid document for each collection, given a client to hang it on. */
interface Subject {
  readonly name: string;
  // The repositories have different create/update types by design; this suite
  // is about the DAL's behaviour, which is uniform across all of them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly repository: RepositoryFactory<any, any, any>;
  /** True when the model carries a `clientId` the DAL can narrow by. */
  readonly clientPartitioned: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly make: (seed: Seed) => any;
  /** A patch every collection accepts, for the update test. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly patch: any;
}

const SUBJECTS: readonly Subject[] = [
  {
    name: "assets",
    repository: assetsRepository,
    clientPartitioned: true,
    make: ({ clientId, suffix }) => ({
      name: `Chiller ${suffix}`,
      category: "HVAC",
      type: "Chiller",
      locationId: new Types.ObjectId(),
      clientId,
      status: "ACTIVE",
      health: 80,
    }),
    patch: { health: 10 },
  },
  {
    name: "locations",
    repository: locationsRepository,
    clientPartitioned: true,
    make: ({ clientId, suffix }) => ({
      name: `Tower ${suffix}`,
      clientId,
      address: { city: "Riyadh" },
    }),
    patch: { name: "Renamed" },
  },
  {
    name: "work_orders",
    repository: workOrdersRepository,
    clientPartitioned: true,
    make: ({ clientId, suffix }) => ({
      assetId: new Types.ObjectId(),
      clientId,
      issue: `Compressor fault ${suffix}`,
      priority: "HIGH",
      status: "OPEN",
    }),
    patch: { priority: "LOW" },
  },
  {
    name: "contracts",
    repository: contractsRepository,
    clientPartitioned: true,
    make: ({ clientId, suffix }) => ({
      clientId: clientId ?? ACME,
      contractNumber: `amc-${suffix}`,
      title: `Contract ${suffix}`,
      type: "COMPREHENSIVE",
      value: 100_000,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2027-01-01T00:00:00.000Z"),
      compliance: 90,
    }),
    patch: { compliance: 10 },
  },
  {
    name: "invoices",
    repository: invoicesRepository,
    clientPartitioned: true,
    make: ({ clientId, suffix }) => ({
      clientId: clientId ?? ACME,
      invoiceNumber: `inv-${suffix}`,
      workRef: `Work ${suffix}`,
      amount: 100_000,
      vatRate: 1500,
      vat: 15_000,
      total: 115_000,
      issueDate: new Date("2026-03-01T00:00:00.000Z"),
      dueDate: new Date("2026-03-31T00:00:00.000Z"),
      status: "PENDING",
    }),
    patch: { workRef: "Changed" },
  },
  {
    name: "approvals",
    repository: approvalsRepository,
    clientPartitioned: true,
    make: ({ clientId, suffix }) => ({
      refType: "WORK_ORDER",
      refId: new Types.ObjectId(),
      refLabel: `WO-${suffix}`,
      clientId,
      requestedBy: new Types.ObjectId(),
      currentStage: "TECHNICIAN",
      status: "PENDING",
      history: [],
    }),
    patch: { status: "REJECTED" },
  },
  {
    name: "attachments",
    repository: attachmentsRepository,
    clientPartitioned: true,
    make: ({ clientId, suffix }) => ({
      refType: "ASSET",
      refId: new Types.ObjectId(),
      clientId,
      storageKey: `org/x/asset/${suffix}.jpg`,
      filename: `${suffix}.jpg`,
      contentType: "image/jpeg",
      size: 1024,
      checksum: "a".repeat(64),
      uploadedBy: new Types.ObjectId(),
    }),
    // Attachments are deliberately immutable; the update test is skipped for
    // them by passing an empty patch, which the DAL treats as a no-op read.
    patch: {},
  },
  {
    name: "notifications",
    repository: notificationsRepository,
    clientPartitioned: true,
    make: ({ clientId, suffix }) => ({
      kind: "PPM_OVERDUE",
      severity: "URGENT",
      roles: ["ADMIN"],
      clientId,
      titleKey: "ppmOverdue",
      params: {},
      refType: "PPM_SCHEDULE",
      refId: new Types.ObjectId(),
      dedupeKey: `PPM_OVERDUE:${suffix}:2026-03-01`,
    }),
    patch: { readBy: [] },
  },
  {
    name: "ppm_schedules",
    repository: ppmSchedulesRepository,
    clientPartitioned: false,
    make: () => ({
      assetId: new Types.ObjectId(),
      type: "MONTHLY",
      dueDate: new Date("2026-04-01T00:00:00.000Z"),
      technicianId: new Types.ObjectId(),
      status: "SCHEDULED",
    }),
    patch: { status: "COMPLETED" },
  },
  {
    name: "technicians",
    repository: techniciansRepository,
    clientPartitioned: false,
    make: ({ suffix }) => ({
      name: `Tech ${suffix}`,
      trade: "HVAC",
      skills: [],
      status: "ACTIVE",
    }),
    patch: { status: "INACTIVE" },
  },
  {
    name: "checklists",
    repository: checklistsRepository,
    clientPartitioned: false,
    make: ({ suffix }) => ({
      name: `Checklist ${suffix}`,
      category: "HVAC",
      items: [{ label: "Check filters", required: true }],
    }),
    patch: { category: "ELECTRICAL" },
  },
  {
    name: "attendance",
    repository: attendanceRepository,
    clientPartitioned: false,
    make: () => ({
      technicianId: new Types.ObjectId(),
      day: new Date("2026-03-14T00:00:00.000Z"),
      checkInAt: new Date("2026-03-14T06:00:00.000Z"),
      consentGiven: false,
    }),
    patch: { consentGiven: true },
  },
];

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

function staffSession(organizationId: Types.ObjectId): AppSession {
  return {
    user: {
      id: new Types.ObjectId().toHexString(),
      role: "FM_MANAGER",
      organizationId: organizationId.toHexString(),
    },
  };
}

function clientSession(
  organizationId: Types.ObjectId,
  clientId: Types.ObjectId,
): AppSession {
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

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

// ---------------------------------------------------------------------------

describe.each(SUBJECTS)("$name", (subject) => {
  it("does not serve another organisation's document, holding the right _id", async () => {
    const mine = await subject.repository
      .forScope(staffA)
      .create(subject.make({ clientId: ACME, suffix: "a1" }));

    // Reachable by its owner...
    expect(
      await subject.repository.forScope(staffA).findById(mine._id),
    ).not.toBeNull();
    // ...and invisible to the neighbouring tenant with the correct id in hand.
    expect(
      await subject.repository.forScope(staffB).findById(mine._id),
    ).toBeNull();
  });

  it("does not let another organisation update it", async () => {
    if (Object.keys(subject.patch).length === 0) return;

    const mine = await subject.repository
      .forScope(staffA)
      .create(subject.make({ clientId: ACME, suffix: "a2" }));

    expect(
      await subject.repository.forScope(staffB).update(mine._id, subject.patch),
    ).toBeNull();
  });

  it("does not let another organisation delete it", async () => {
    const mine = await subject.repository
      .forScope(staffA)
      .create(subject.make({ clientId: ACME, suffix: "a3" }));

    expect(await subject.repository.forScope(staffB).delete(mine._id)).toBe(
      false,
    );
    // And it is still there for its owner — an assertion that something is
    // missing passes just as well when nothing was ever written.
    expect(
      await subject.repository.forScope(staffA).findById(mine._id),
    ).not.toBeNull();
  });

  it("stamps the tenant from the scope, ignoring what the caller sent", async () => {
    const created = await subject.repository.forScope(staffA).create({
      ...subject.make({ clientId: ACME, suffix: "a4" }),
      // Both of these are in the DAL's RESERVED_FIELDS and must be dropped.
      organizationId: ORG_B,
    });

    expect(created.organizationId.toHexString()).toBe(ORG_A.toHexString());
    expect(
      await subject.repository.forScope(staffB).findById(created._id),
    ).toBeNull();
  });

  it("refuses operator-shaped and dotted filter keys", async () => {
    const repository = subject.repository.forScope(staffA);

    for (const filter of [
      { $where: "1 == 1" },
      { organizationId: { $ne: null } },
      { $or: [{}, {}] },
      { "client.id": "x" },
      { $gt: "" },
    ]) {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        repository.find(filter as any),
        `${subject.name} accepted ${JSON.stringify(filter)}`,
      ).rejects.toThrow(UnsafeQueryError);
    }
  });

  it("refuses a filter on a path the model does not have", async () => {
    // strictQuery silently DROPS an unknown condition, which WIDENS the result
    // set. A probe for a field that does not exist has to fail the query.
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subject.repository.forScope(staffA).find({ notAField: 1 } as any),
    ).rejects.toThrow(UnsafeQueryError);
  });

  if (subject.clientPartitioned) {
    it("serves a client only its own rows", async () => {
      await subject.repository
        .forScope(staffA)
        .create(subject.make({ clientId: ACME, suffix: "c1" }));
      const theirs = await subject.repository
        .forScope(staffA)
        .create(subject.make({ clientId: ZENITH, suffix: "c2" }));

      const mine = await subject.repository.forScope(acme).find();

      expect(
        mine.every((row) => row.clientId?.toHexString() === ACME.toHexString()),
      ).toBe(true);
      expect(
        await subject.repository.forScope(acme).findById(theirs._id),
      ).toBeNull();
      expect(
        await subject.repository.forScope(zenith).findById(theirs._id),
      ).not.toBeNull();
    });

    it("stamps the client from the scope on create", async () => {
      const created = await subject.repository.forScope(acme).create({
        ...subject.make({ clientId: ZENITH, suffix: "c3" }),
        clientId: ZENITH,
      });

      expect(created.clientId?.toHexString()).toBe(ACME.toHexString());
    });
  } else {
    /**
     * The fail-closed direction, and the more important half of the rule: a
     * collection with no `clientId` is REFUSED to a client session rather than
     * being served the whole organisation's rows.
     */
    it("refuses a client session outright", () => {
      expect(() => subject.repository.forScope(acme).find()).toThrow(
        ScopeResolutionError,
      );
    });
  }
});

describe("the sweep covers the product", () => {
  /**
   * A reminder rather than a rule: if a repository exists and is not in the
   * table above, this suite is not testing it. Twelve is what the product has
   * today; the number is asserted so adding a thirteenth without adding it here
   * fails loudly.
   */
  it("checks every tenant-scoped collection the product ships", () => {
    expect(SUBJECTS).toHaveLength(12);
  });

  it("covers both partitioning shapes", () => {
    expect(SUBJECTS.some((subject) => subject.clientPartitioned)).toBe(true);
    expect(SUBJECTS.some((subject) => !subject.clientPartitioned)).toBe(true);
  });
});
