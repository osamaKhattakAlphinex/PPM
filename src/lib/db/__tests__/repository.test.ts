import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AppSession } from "../../auth/session";
import { defineModel } from "../define-model";
import { createRepository } from "../repository";
import { UnsafeQueryError } from "../sanitize";
import { getScope, ScopeResolutionError, type TenantScope } from "../scope";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Org-scoped only: no clientId, so it cannot be narrowed to a client. */
const noteSchema = entity({
  title: mongo(z.string().min(1).max(120), { trim: true }),
  status: z.enum(["OPEN", "DONE"]).default("OPEN"),
});
type NoteDoc = DocumentOf<typeof noteSchema>;
/** What a caller sends: the zod INPUT type, so defaulted fields are optional. */
type NoteCreate = z.input<typeof noteSchema>;

const Note = defineModel("DalNote", noteSchema, { collection: "dal_notes" });

/** Org- AND client-partitioned: the shape most business entities have. */
const ticketSchema = entity({
  title: z.string().min(1).max(120),
  clientId: mongo(objectId("Client"), { index: true }),
  priority: z.enum(["LOW", "HIGH"]).default("LOW"),
});
type TicketDoc = DocumentOf<typeof ticketSchema>;
/** clientId is optional here: a CLIENT session has it stamped from the scope. */
type TicketCreate = Omit<z.input<typeof ticketSchema>, "clientId"> & {
  clientId?: Types.ObjectId | string;
};

const Ticket = defineModel("DalTicket", ticketSchema, {
  collection: "dal_tickets",
  indexes: [{ fields: { organizationId: 1, clientId: 1, deletedAt: 1 } }],
});

const notes = createRepository<NoteDoc, NoteCreate>(Note);
const tickets = createRepository<TicketDoc, TicketCreate>(Ticket);
/** Same collection as `notes`, but declared readable by client users. */
const sharedNotes = createRepository<NoteDoc, NoteCreate>(Note, { sharedWithClients: true });

const ORG_A = new Types.ObjectId();
const ORG_B = new Types.ObjectId();
const CLIENT_1 = new Types.ObjectId();
const CLIENT_2 = new Types.ObjectId();

function staffSession(organizationId: Types.ObjectId): AppSession {
  return {
    user: {
      id: new Types.ObjectId().toHexString(),
      role: "FM_MANAGER",
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

// Scopes go through getScope(), so every test exercises the real path from a
// session to a filter rather than a hand-built scope object.
const staffA: TenantScope = getScope(staffSession(ORG_A));
const staffB: TenantScope = getScope(staffSession(ORG_B));
const clientOne: TenantScope = getScope(clientSession(ORG_A, CLIENT_1));
const clientTwo: TenantScope = getScope(clientSession(ORG_A, CLIENT_2));

beforeAll(async () => {
  await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

// ---------------------------------------------------------------------------
// (a) Cross-organization isolation
// ---------------------------------------------------------------------------

describe("(a) a user from Org A cannot reach an Org B document, even with its _id", () => {
  let orgBNote: NoteDoc;
  let orgBId: Types.ObjectId;

  beforeEach(async () => {
    orgBNote = await notes.forScope(staffB).create({ title: "Org B chiller PPM" });
    orgBId = orgBNote._id;
  });

  it("the document really exists (so the assertions below are not vacuous)", async () => {
    // Read with the raw model — the only place in the codebase allowed to.
    const raw = await Note.findById(orgBId).lean().exec();

    expect(raw).not.toBeNull();
    expect(raw?.organizationId.equals(ORG_B)).toBe(true);
  });

  it("findById returns null for Org A", async () => {
    await expect(notes.forScope(staffA).findById(orgBId)).resolves.toBeNull();
    // ...and the same id resolves for its own org, proving the id is correct.
    await expect(notes.forScope(staffB).findById(orgBId)).resolves.not.toBeNull();
  });

  it("findById accepts the id as a hex string and still re-applies the scope", async () => {
    await expect(notes.forScope(staffA).findById(orgBId.toHexString())).resolves.toBeNull();
  });

  it("find / findOne / count / exists never surface it", async () => {
    const repo = notes.forScope(staffA);

    await expect(repo.find()).resolves.toEqual([]);
    await expect(repo.findOne({ title: "Org B chiller PPM" })).resolves.toBeNull();
    await expect(repo.count()).resolves.toBe(0);
    await expect(repo.exists({ title: "Org B chiller PPM" })).resolves.toBe(false);
  });

  it("paginate reports a total of zero for Org A", async () => {
    const page = await notes.forScope(staffA).paginate({ page: 1, pageSize: 10 });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(0);
    expect(page.hasNextPage).toBe(false);
  });

  it("update returns null and leaves the document byte-for-byte unchanged", async () => {
    await expect(notes.forScope(staffA).update(orgBId, { title: "hijacked" })).resolves.toBeNull();

    const after = await notes.forScope(staffB).findById(orgBId);
    expect(after?.title).toBe("Org B chiller PPM");
    expect(after?.updatedAt.getTime()).toBe(orgBNote.updatedAt.getTime());
  });

  it("updateMany cannot reach across the org boundary", async () => {
    await expect(
      notes.forScope(staffA).updateMany({ status: "OPEN" }, { title: "hijacked" }),
    ).resolves.toBe(0);

    await expect(notes.forScope(staffB).findById(orgBId)).resolves.toMatchObject({
      title: "Org B chiller PPM",
    });
  });

  it("delete returns false and the document stays live", async () => {
    await expect(notes.forScope(staffA).delete(orgBId)).resolves.toBe(false);

    const after = await notes.forScope(staffB).findById(orgBId);
    expect(after).not.toBeNull();
    expect(after?.deletedAt).toBeNull();
  });

  it("deleteMany cannot reach across the org boundary", async () => {
    await expect(notes.forScope(staffA).deleteMany({})).resolves.toBe(0);
    await expect(notes.forScope(staffB).count()).resolves.toBe(1);
  });

  it("hardDelete cannot purge another org's document", async () => {
    await expect(notes.forScope(staffA).hardDelete(orgBId)).resolves.toBe(false);
    await expect(Note.countDocuments({ _id: orgBId }).exec()).resolves.toBe(1);
  });

  it("restore cannot resurrect another org's document", async () => {
    await notes.forScope(staffB).delete(orgBId);

    await expect(notes.forScope(staffA).restore(orgBId)).resolves.toBeNull();
    await expect(notes.forScope(staffB).findById(orgBId)).resolves.toBeNull();
    await expect(notes.forScope(staffB).restore(orgBId)).resolves.not.toBeNull();
  });

  it("passing the other org's id in the filter does not widen the query", async () => {
    const repo = notes.forScope(staffA);

    // The caller asks for Org B explicitly. Scope is applied last and wins.
    await expect(repo.find({ organizationId: ORG_B })).resolves.toEqual([]);
    expect(repo.matchStage({ organizationId: ORG_B })).toMatchObject({
      organizationId: ORG_A,
    });
  });

  it("passing an operator in the filter is refused, not silently stripped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const repo = notes.forScope(staffA);

    // The classic NoSQL-injection shape: turn an equality into "anything else".
    await expect(
      repo.find({ organizationId: { $ne: ORG_A } } as never),
    ).rejects.toBeInstanceOf(UnsafeQueryError);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it("refuses a filter on a path the schema does not have", async () => {
    // strictQuery would otherwise DROP the condition, widening the result set.
    await expect(
      notes.forScope(staffA).find({ organisationId: ORG_B } as never),
    ).rejects.toBeInstanceOf(UnsafeQueryError);
  });

  it("keeps each org's list to its own rows when both have data", async () => {
    await notes.forScope(staffA).create({ title: "Org A lift PPM" });
    await notes.forScope(staffA).create({ title: "Org A pump PPM" });

    const a = await notes.forScope(staffA).find();
    const b = await notes.forScope(staffB).find();

    expect(a).toHaveLength(2);
    expect(a.every((note) => note.organizationId.equals(ORG_A))).toBe(true);
    expect(b).toHaveLength(1);
    expect(b[0]?.organizationId.equals(ORG_B)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) Client isolation inside one organization
// ---------------------------------------------------------------------------

describe("(b) a CLIENT user cannot see another client's documents in the same org", () => {
  let ticketOne: TicketDoc;
  let ticketTwo: TicketDoc;

  beforeEach(async () => {
    const staff = tickets.forScope(staffA);
    ticketOne = await staff.create({ title: "Client 1 AC fault", clientId: CLIENT_1 });
    ticketTwo = await staff.create({ title: "Client 2 AC fault", clientId: CLIENT_2 });
  });

  it("both tickets exist in the same organization", async () => {
    expect(ticketOne.organizationId.equals(ORG_A)).toBe(true);
    expect(ticketTwo.organizationId.equals(ORG_A)).toBe(true);
    await expect(tickets.forScope(staffA).count()).resolves.toBe(2);
  });

  it("a client's list contains only its own tickets", async () => {
    const list = await tickets.forScope(clientOne).find();

    expect(list).toHaveLength(1);
    expect(list[0]?._id.equals(ticketOne._id)).toBe(true);
  });

  it("findById on another client's ticket returns null", async () => {
    await expect(tickets.forScope(clientOne).findById(ticketTwo._id)).resolves.toBeNull();
    await expect(tickets.forScope(clientTwo).findById(ticketTwo._id)).resolves.not.toBeNull();
  });

  it("update on another client's ticket changes nothing", async () => {
    await expect(
      tickets.forScope(clientOne).update(ticketTwo._id, { title: "hijacked" }),
    ).resolves.toBeNull();

    const after = await tickets.forScope(staffA).findById(ticketTwo._id);
    expect(after?.title).toBe("Client 2 AC fault");
  });

  it("delete on another client's ticket changes nothing", async () => {
    await expect(tickets.forScope(clientOne).delete(ticketTwo._id)).resolves.toBe(false);
    await expect(tickets.forScope(clientOne).hardDelete(ticketTwo._id)).resolves.toBe(false);
    await expect(tickets.forScope(staffA).findById(ticketTwo._id)).resolves.not.toBeNull();
  });

  it("asking for another client's id in the filter still returns only its own", async () => {
    const repo = tickets.forScope(clientOne);

    const list = await repo.find({ clientId: CLIENT_2 });

    expect(list.every((ticket) => ticket.clientId.equals(CLIENT_1))).toBe(true);
    expect(repo.matchStage({ clientId: CLIENT_2 })).toMatchObject({
      organizationId: ORG_A,
      clientId: CLIENT_1,
    });
  });

  it("counts and pagination are client-scoped too", async () => {
    await expect(tickets.forScope(clientOne).count()).resolves.toBe(1);

    const page = await tickets.forScope(clientOne).paginate({ pageSize: 50 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.clientId.equals(CLIENT_1)).toBe(true);
  });

  it("staff in the same org still see every client", async () => {
    const list = await tickets.forScope(staffA).find();

    expect(list).toHaveLength(2);
  });

  it("staff can filter down to one client deliberately", async () => {
    const list = await tickets.forScope(staffA).find({ clientId: CLIENT_2 });

    expect(list).toHaveLength(1);
    expect(list[0]?._id.equals(ticketTwo._id)).toBe(true);
  });

  it("staff in another org see neither", async () => {
    await expect(tickets.forScope(staffB).find()).resolves.toEqual([]);
  });

  it("refuses a client session on a collection that cannot be client-scoped", async () => {
    // DalNote has no clientId. Serving it to a client user would silently mean
    // "this client sees the whole organization", so the DAL refuses instead.
    await expect(notes.forScope(clientOne).find()).rejects.toBeInstanceOf(ScopeResolutionError);
    await expect(notes.forScope(clientOne).create({ title: "x" })).rejects.toBeInstanceOf(
      ScopeResolutionError,
    );
  });

  it("allows it only where the collection is declared shared with clients", async () => {
    await notes.forScope(staffA).create({ title: "Service catalogue entry" });
    await notes.forScope(staffB).create({ title: "Org B catalogue entry" });

    const list = await sharedNotes.forScope(clientOne).find();

    expect(list).toHaveLength(1);
    // Still org-scoped: shared means org-wide, never cross-org.
    expect(list[0]?.organizationId.equals(ORG_A)).toBe(true);

    // Even asking for the other org by name gets this org's rows back.
    const probed = await sharedNotes.forScope(clientOne).find({ organizationId: ORG_B });
    expect(probed.every((note) => note.organizationId.equals(ORG_A))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) Scope cannot be overridden on write
// ---------------------------------------------------------------------------

describe("(c) a caller cannot override organizationId on create", () => {
  it("ignores an organizationId in the create payload", async () => {
    const created = await notes.forScope(staffA).create({
      title: "Planted in Org B",
      organizationId: ORG_B,
    } as never);

    expect(created.organizationId.equals(ORG_A)).toBe(true);

    // And Org B cannot see it, which is the property that actually matters.
    await expect(notes.forScope(staffB).findById(created._id)).resolves.toBeNull();
    await expect(notes.forScope(staffA).findById(created._id)).resolves.not.toBeNull();
  });

  it("rejects a create payload that carries an operator at all", async () => {
    // Reserved keys are ignored; operator-shaped input is refused outright,
    // because nothing legitimate sends one and the attempt is worth surfacing.
    await expect(
      notes.forScope(staffA).create({
        title: "Operator payload",
        organizationId: { $ne: null },
      } as never),
    ).rejects.toBeInstanceOf(UnsafeQueryError);

    await expect(notes.forScope(staffA).count()).resolves.toBe(0);
  });

  it("ignores caller-supplied _id, timestamps and deletedAt", async () => {
    const plantedId = new Types.ObjectId();
    const created = await notes.forScope(staffA).create({
      title: "Reserved fields",
      _id: plantedId,
      createdAt: new Date("1999-01-01"),
      deletedAt: new Date("1999-01-01"),
    } as never);

    expect(created._id.equals(plantedId)).toBe(false);
    expect(created.deletedAt).toBeNull();
    expect(created.createdAt.getFullYear()).toBeGreaterThan(2020);
    // A soft-deleted-on-arrival document would be invisible; this one is not.
    await expect(notes.forScope(staffA).findById(created._id)).resolves.not.toBeNull();
  });

  it("stamps a CLIENT user's own clientId, ignoring the one they sent", async () => {
    const created = await tickets.forScope(clientOne).create({
      title: "Planted against client 2",
      clientId: CLIENT_2,
    });

    expect(created.clientId.equals(CLIENT_1)).toBe(true);
    await expect(tickets.forScope(clientTwo).findById(created._id)).resolves.toBeNull();
  });

  it("cannot move a document between orgs or clients with update", async () => {
    const ticket = await tickets
      .forScope(staffA)
      .create({ title: "Stays put", clientId: CLIENT_1 });

    const updated = await tickets.forScope(staffA).update(ticket._id, {
      title: "Renamed",
      organizationId: ORG_B,
      clientId: CLIENT_2,
    } as never);

    expect(updated?.title).toBe("Renamed");
    expect(updated?.organizationId.equals(ORG_A)).toBe(true);
    expect(updated?.clientId.equals(CLIENT_1)).toBe(true);
  });

  it("cannot move a document with updateMany either", async () => {
    await tickets.forScope(staffA).create({ title: "Bulk", clientId: CLIENT_1 });

    await tickets
      .forScope(staffA)
      .updateMany({ title: "Bulk" }, { organizationId: ORG_B, clientId: CLIENT_2 } as never);

    await expect(tickets.forScope(staffB).count()).resolves.toBe(0);
    await expect(tickets.forScope(clientTwo).count()).resolves.toBe(0);
    await expect(tickets.forScope(clientOne).count()).resolves.toBe(1);
  });

  it("requires staff to name the client on a client-partitioned collection", async () => {
    // Silently storing a ticket against no client would make it invisible to
    // every client user and visible to all of them via a shared repo later.
    await expect(tickets.forScope(staffA).create({ title: "No client" })).rejects.toThrow(
      /clientId/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Soft delete, pagination and query safety
// ---------------------------------------------------------------------------

describe("soft delete", () => {
  it("hides deleted documents from every read by default", async () => {
    const repo = notes.forScope(staffA);
    const note = await repo.create({ title: "To be deleted" });

    await expect(repo.delete(note._id)).resolves.toBe(true);

    await expect(repo.findById(note._id)).resolves.toBeNull();
    await expect(repo.find()).resolves.toEqual([]);
    await expect(repo.count()).resolves.toBe(0);
    await expect(repo.exists({ title: "To be deleted" })).resolves.toBe(false);
    await expect(repo.paginate()).resolves.toMatchObject({ total: 0 });
  });

  it("keeps the row and surfaces it only with includeDeleted", async () => {
    const repo = notes.forScope(staffA);
    const note = await repo.create({ title: "Archived" });
    await repo.delete(note._id);

    const found = await repo.findById(note._id, { includeDeleted: true });

    expect(found?.deletedAt).toBeInstanceOf(Date);
    // The row is still on disk — `withDeleted` is needed even on the raw model,
    // because the base plugin filters soft deletes for everyone.
    await expect(
      Note.countDocuments({ _id: note._id }).setOptions({ withDeleted: true }).exec(),
    ).resolves.toBe(1);
  });

  it("restores a deleted document within scope", async () => {
    const repo = notes.forScope(staffA);
    const note = await repo.create({ title: "Restore me" });
    await repo.delete(note._id);

    const restored = await repo.restore(note._id);

    expect(restored?.deletedAt).toBeNull();
    await expect(repo.findById(note._id)).resolves.not.toBeNull();
  });

  it("does not re-delete an already deleted document", async () => {
    const repo = notes.forScope(staffA);
    const note = await repo.create({ title: "Once" });

    await expect(repo.delete(note._id)).resolves.toBe(true);
    await expect(repo.delete(note._id)).resolves.toBe(false);
  });
});

describe("paginate", () => {
  beforeEach(async () => {
    const repo = notes.forScope(staffA);
    for (let index = 0; index < 5; index += 1) {
      await repo.create({ title: `Note ${index}` });
    }
    await notes.forScope(staffB).create({ title: "Org B note" });
  });

  it("counts and pages only the caller's organization", async () => {
    const page = await notes.forScope(staffA).paginate({ page: 1, pageSize: 2 });

    expect(page.total).toBe(5);
    expect(page.totalPages).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.hasNextPage).toBe(true);
    expect(page.hasPreviousPage).toBe(false);
    expect(page.items.every((note) => note.organizationId.equals(ORG_A))).toBe(true);
  });

  it("does not repeat a row across pages", async () => {
    const repo = notes.forScope(staffA);
    const first = await repo.paginate({ page: 1, pageSize: 2 });
    const second = await repo.paginate({ page: 2, pageSize: 2 });

    const ids = [...first.items, ...second.items].map((note) => note._id.toHexString());
    expect(new Set(ids).size).toBe(4);
  });

  it("rejects a page size above the cap instead of honouring it", async () => {
    await expect(notes.forScope(staffA).paginate({ pageSize: 1_000 })).rejects.toThrow();
  });

  it("projects only the requested paths", async () => {
    const page = await notes.forScope(staffA).paginate({ pageSize: 1, select: ["title"] });

    expect(page.items[0]).toHaveProperty("title");
    expect(page.items[0]).not.toHaveProperty("status");
  });
});

describe("query safety", () => {
  it("allows operators only in the trusted `where` fragment", async () => {
    const repo = notes.forScope(staffA);
    await repo.create({ title: "Open one", status: "OPEN" });
    await repo.create({ title: "Done one", status: "DONE" });
    await notes.forScope(staffB).create({ title: "Org B open", status: "OPEN" });

    const list = await repo.find(undefined, { where: { status: { $in: ["OPEN"] } } });

    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("Open one");
  });

  it("does not let a trusted fragment override the scope either", async () => {
    const repo = notes.forScope(staffA);
    await notes.forScope(staffB).create({ title: "Org B" });

    const list = await repo.find(undefined, { where: { organizationId: ORG_B } });

    expect(list).toEqual([]);
    expect(repo.matchStage(undefined, { where: { organizationId: ORG_B } })).toMatchObject({
      organizationId: ORG_A,
    });
  });

  it("rejects a JavaScript-executing operator even in the trusted fragment", async () => {
    await expect(
      notes.forScope(staffA).find(undefined, { where: { $where: "true" } as never }),
    ).rejects.toBeInstanceOf(UnsafeQueryError);
  });

  it("rejects a sort on an unknown path", async () => {
    await expect(
      notes.forScope(staffA).find(undefined, { sort: { "constructor.prototype": 1 } as never }),
    ).rejects.toBeInstanceOf(UnsafeQueryError);
  });

  it("treats a malformed id as no match rather than an error", async () => {
    const repo = notes.forScope(staffA);

    await expect(repo.findById("not-an-id")).resolves.toBeNull();
    await expect(repo.findById("aaaaaaaaaaaa")).resolves.toBeNull(); // 12 chars: ObjectId.isValid() says yes
    await expect(repo.update("not-an-id", { title: "x" })).resolves.toBeNull();
    await expect(repo.delete("not-an-id")).resolves.toBe(false);
  });

  it("caps an unbounded find so a missing filter cannot stream a collection", async () => {
    const repo = notes.forScope(staffA);
    for (let index = 0; index < 5; index += 1) {
      await repo.create({ title: `Note ${index}` });
    }

    await expect(repo.find(undefined, { limit: 2 })).resolves.toHaveLength(2);
    // Out-of-range limits fall back to the default cap rather than being obeyed.
    await expect(repo.find(undefined, { limit: -1 })).resolves.toHaveLength(5);
  });

  it("always includes the tenant key in the match stage of an aggregation", () => {
    expect(notes.forScope(staffA).matchStage()).toEqual({
      deletedAt: null,
      organizationId: ORG_A,
    });
    expect(tickets.forScope(clientOne).matchStage()).toEqual({
      deletedAt: null,
      organizationId: ORG_A,
      clientId: CLIENT_1,
    });
  });
});

describe("createRepository", () => {
  it("refuses to wrap a model that has no organizationId", () => {
    const globalSchema = entity({ name: z.string() });
    const GlobalThing = defineModel("DalGlobalThing", globalSchema, { tenantScoped: false });

    expect(() => createRepository(GlobalThing as never)).toThrow(/organizationId/);
  });

  it("reports whether the collection can be client-partitioned", () => {
    expect(notes.isClientPartitioned).toBe(false);
    expect(tickets.isClientPartitioned).toBe(true);
  });

  it("forSession resolves the scope and fails closed without one", () => {
    expect(() => notes.forSession(null)).toThrow(ScopeResolutionError);
    expect(notes.forSession(staffSession(ORG_A)).scope.organizationId.equals(ORG_A)).toBe(true);
  });
});
