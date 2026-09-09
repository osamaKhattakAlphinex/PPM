import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import {
  APPROVAL_STAGES,
  canActOnStage,
  canTransitionTo,
  nextStage,
  type ApprovalStage,
} from "../../domain/approvals";
import { approvalsRepository, countApprovalsByStage } from "../repositories/approvals";
import { getScope, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for approvals, and the stage machine on top of them,
 * against a real mongod.
 *
 * `Approval` is client-partitioned like `WorkOrder`, so the guarantee is the
 * hard one rather than the blunt one: a CLIENT session is SERVED, and served
 * only its own chains. A bug in that direction does not throw — it quietly shows
 * one customer what another customer has been asked to accept, and lets them
 * accept it.
 *
 * The stage rules themselves are proved exhaustively over every (role, stage)
 * pair in `src/lib/approvals/__tests__/state-machine.test.ts`, which needs no
 * database. What is proved HERE is the part that needs one: that the guard is
 * evaluated against the stage the database actually holds, that a decision
 * writes exactly one history entry and never rewrites an older one, and that
 * the queue counts are scoped.
 *
 * Every scope is built by `getScope()` from a session object rather than
 * assembled by hand, so each test exercises the real path from a cookie to a
 * MongoDB filter. Where a test asserts an absence it also asserts the row is
 * reachable by whoever should see it — an assertion that something is missing
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

const NOW = new Date("2026-03-14T09:00:00.000Z");

function baseApproval(clientId: Types.ObjectId | null, label: string) {
  return {
    refType: "WORK_ORDER" as const,
    refId: new Types.ObjectId(),
    refLabel: label,
    clientId,
    requestedBy: new Types.ObjectId(),
    currentStage: "TECHNICIAN" as const,
    status: "PENDING" as const,
    history: [],
  };
}

/**
 * Walk a chain forward the way `decideApproval` does: read the row, check the
 * guard against the stage the DATABASE holds, compute the destination, write.
 *
 * A local helper rather than the action itself, because the action pulls
 * `requireRole` and therefore next-auth, which does not resolve under vitest.
 * The two pure predicates it consults are the ones the action consults, in the
 * same order, so what is exercised here is the same rule reaching the same
 * database.
 */
async function approveAs(
  scope: TenantScope,
  role: "TECHNICIAN" | "SUPERVISOR" | "FM_MANAGER" | "CLIENT" | "ADMIN",
  id: Types.ObjectId,
): Promise<{ ok: boolean; stage: ApprovalStage }> {
  const repository = approvalsRepository.forScope(scope);
  const current = await repository.findById(id);
  if (!current) return { ok: false, stage: "TECHNICIAN" };

  if (!canActOnStage(role, current.currentStage)) {
    return { ok: false, stage: current.currentStage };
  }

  const destination = nextStage(current.currentStage);
  if (!destination || !canTransitionTo(current.currentStage, destination)) {
    return { ok: false, stage: current.currentStage };
  }

  const updated = await repository.update(id, {
    currentStage: destination,
    ...(destination === "INVOICE_TRIGGER"
      ? { status: "APPROVED" as const, approvedAt: NOW }
      : {}),
    history: [
      ...current.history,
      {
        stage: current.currentStage,
        action: "APPROVED" as const,
        actorId: new Types.ObjectId(),
        actorRole: role,
        reason: null,
        at: NOW,
      },
    ],
  });

  return { ok: updated !== null, stage: updated?.currentStage ?? current.currentStage };
}

let acmeApproval: Types.ObjectId;
let zenithApproval: Types.ObjectId;
let depotApproval: Types.ObjectId;

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const repository = approvalsRepository.forScope(staffA);

  const acmeRow = await repository.create(baseApproval(ACME, "WO-1001 · Acme tower"));
  const zenithRow = await repository.create(baseApproval(ZENITH, "WO-1002 · Zenith mall"));
  // No counterparty: the provider's own depot. See the model header.
  const depotRow = await repository.create(baseApproval(null, "PPM-2001 · Depot compressor"));

  acmeApproval = acmeRow._id;
  zenithApproval = zenithRow._id;
  depotApproval = depotRow._id;

  // Another tenant's chain, so every cross-org assertion has something real to
  // fail against.
  await approvalsRepository.forScope(staffB).create(baseApproval(null, "WO-9001 · Other tenant"));
});

describe("tenant isolation", () => {
  it("does not serve another organization's chain by id", async () => {
    // Reachable by its owner...
    expect(await approvalsRepository.forScope(staffA).findById(acmeApproval)).not.toBeNull();
    // ...and invisible to the neighbouring tenant holding the correct _id.
    expect(await approvalsRepository.forScope(staffB).findById(acmeApproval)).toBeNull();
  });

  it("does not let another organization decide a chain", async () => {
    const result = await approveAs(staffB, "TECHNICIAN", acmeApproval);
    expect(result.ok).toBe(false);

    const untouched = await approvalsRepository.forScope(staffA).findById(acmeApproval);
    expect(untouched?.currentStage).toBe("TECHNICIAN");
    expect(untouched?.history).toHaveLength(0);
  });

  it("counts only the caller's own tenant", async () => {
    const rows = await countApprovalsByStage(staffA, APPROVAL_STAGES);
    const technician = rows.find((row) => row.stage === "TECHNICIAN");
    // Three in org A, one in org B. The neighbour's row must not be in this.
    expect(technician?.count).toBe(3);
  });
});

describe("client isolation", () => {
  it("shows a client only its own chains", async () => {
    const rows = await approvalsRepository.forScope(acme).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]!._id.toHexString()).toBe(acmeApproval.toHexString());
  });

  it("does not serve one client another client's chain by id", async () => {
    expect(await approvalsRepository.forScope(acme).findById(zenithApproval)).toBeNull();
    expect(await approvalsRepository.forScope(zenith).findById(zenithApproval)).not.toBeNull();
  });

  it("hides a chain that has no counterparty from every client", async () => {
    // `clientId: null` matches no client filter, which is the point: the
    // provider's own work is not a customer's business.
    expect(await approvalsRepository.forScope(acme).findById(depotApproval)).toBeNull();
    expect(await approvalsRepository.forScope(zenith).findById(depotApproval)).toBeNull();
    expect(await approvalsRepository.forScope(staffA).findById(depotApproval)).not.toBeNull();
  });

  it("counts only the client's own chains", async () => {
    const rows = await countApprovalsByStage(acme, APPROVAL_STAGES);
    expect(rows.find((row) => row.stage === "TECHNICIAN")?.count).toBe(1);
  });

  it("ignores a clientId a client tries to set on create", async () => {
    const created = await approvalsRepository
      .forScope(acme)
      .create({ ...baseApproval(ZENITH, "WO-1003 · smuggled"), clientId: ZENITH });

    // Stamped from the SCOPE, not from the payload.
    expect(created.clientId?.toHexString()).toBe(ACME.toHexString());
  });
});

describe("the stage guard, against the stage the database holds", () => {
  it("refuses a supervisor an item sitting at the FM desk", async () => {
    // Walk it to the FM desk first, legitimately.
    expect((await approveAs(staffA, "TECHNICIAN", acmeApproval)).stage).toBe("SUPERVISOR");
    expect((await approveAs(staffA, "SUPERVISOR", acmeApproval)).stage).toBe("FM_MANAGER");

    const refused = await approveAs(staffA, "SUPERVISOR", acmeApproval);
    expect(refused.ok).toBe(false);

    const row = await approvalsRepository.forScope(staffA).findById(acmeApproval);
    expect(row?.currentStage).toBe("FM_MANAGER");
    // Two decisions so far, and the refused one added nothing.
    expect(row?.history).toHaveLength(2);
  });

  it("refuses a technician an item that has moved past their desk", async () => {
    await approveAs(staffA, "TECHNICIAN", acmeApproval);
    const refused = await approveAs(staffA, "TECHNICIAN", acmeApproval);
    expect(refused.ok).toBe(false);
  });

  it("walks the whole chain when each desk acts in turn", async () => {
    const walked: ApprovalStage[] = [];
    for (const role of ["TECHNICIAN", "SUPERVISOR", "FM_MANAGER", "CLIENT"] as const) {
      walked.push((await approveAs(staffA, role, acmeApproval)).stage);
    }

    expect(walked).toEqual(["SUPERVISOR", "FM_MANAGER", "CLIENT", "INVOICE_TRIGGER"]);

    const row = await approvalsRepository.forScope(staffA).findById(acmeApproval);
    expect(row?.status).toBe("APPROVED");
    expect(row?.approvedAt).not.toBeNull();
  });

  it("cannot be advanced past the invoice trigger", async () => {
    for (const role of ["TECHNICIAN", "SUPERVISOR", "FM_MANAGER", "CLIENT"] as const) {
      await approveAs(staffA, role, acmeApproval);
    }

    for (const role of ["ADMIN", "FM_MANAGER", "CLIENT"] as const) {
      expect((await approveAs(staffA, role, acmeApproval)).ok).toBe(false);
    }
  });
});

describe("the audit trail", () => {
  it("appends one entry per decision and rewrites none", async () => {
    await approveAs(staffA, "TECHNICIAN", acmeApproval);
    const afterFirst = await approvalsRepository.forScope(staffA).findById(acmeApproval);
    const firstEntry = afterFirst!.history[0]!;

    await approveAs(staffA, "SUPERVISOR", acmeApproval);
    const afterSecond = await approvalsRepository.forScope(staffA).findById(acmeApproval);

    expect(afterSecond!.history).toHaveLength(2);
    // The first entry is byte-for-byte what it was: same desk, same actor, same
    // instant. Nothing rewrites history.
    expect(afterSecond!.history[0]!.stage).toBe(firstEntry.stage);
    expect(afterSecond!.history[0]!.actorId.toHexString()).toBe(firstEntry.actorId.toHexString());
    expect(afterSecond!.history[0]!.at.getTime()).toBe(firstEntry.at.getTime());
    // And the second records the desk it was decided AT, not the one it moved to.
    expect(afterSecond!.history[1]!.stage).toBe("SUPERVISOR");
  });

  it("records the role held at the time, not the role held now", async () => {
    await approveAs(staffA, "TECHNICIAN", acmeApproval);
    const row = await approvalsRepository.forScope(staffA).findById(acmeApproval);
    expect(row!.history[0]!.actorRole).toBe("TECHNICIAN");
  });
});

describe("the queue counts", () => {
  it("returns a row per stage, including the empty ones", async () => {
    const rows = await countApprovalsByStage(staffA, APPROVAL_STAGES);
    expect(rows.map((row) => row.stage)).toEqual([...APPROVAL_STAGES]);
    expect(rows.find((row) => row.stage === "CLIENT")?.count).toBe(0);
  });

  it("counts only PENDING chains", async () => {
    // Walk one to the end, which flips its status to APPROVED.
    for (const role of ["TECHNICIAN", "SUPERVISOR", "FM_MANAGER", "CLIENT"] as const) {
      await approveAs(staffA, role, acmeApproval);
    }

    const rows = await countApprovalsByStage(staffA, APPROVAL_STAGES);
    expect(rows.find((row) => row.stage === "INVOICE_TRIGGER")?.count).toBe(0);
    expect(rows.find((row) => row.stage === "TECHNICIAN")?.count).toBe(2);
  });

  it("excludes soft-deleted chains", async () => {
    await approvalsRepository.forScope(staffA).delete(depotApproval);

    const rows = await countApprovalsByStage(staffA, APPROVAL_STAGES);
    expect(rows.find((row) => row.stage === "TECHNICIAN")?.count).toBe(2);
    expect(await approvalsRepository.forScope(staffA).findById(depotApproval)).toBeNull();
  });
});
