import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppSession } from "../../auth/session";
import { addUtcDays, startOfUtcDay } from "../../domain/dates";
import { computeInvoiceTotals, VAT_RATE_BASIS_POINTS } from "../../domain/invoicing";
import { invoicesRepository, summariseInvoices } from "../repositories/invoices";
import { getScope, type TenantScope } from "../scope";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";

/**
 * The isolation guarantees for invoices, and the KPI header built on top of
 * them, against a real mongod.
 *
 * `Invoice` is client-partitioned with a REQUIRED `clientId`, like `Contract`,
 * so the guarantee is the hard one rather than the blunt one: a CLIENT session
 * is SERVED, and served only its own documents. A bug in that direction does not
 * throw — it quietly shows one customer another customer's bills, on the one
 * screen in the product where the numbers are money.
 *
 * The VAT arithmetic itself is proved exhaustively without a database in
 * `src/lib/invoicing/__tests__/vat.test.ts`. What is proved HERE is what needs
 * one: that the stored figures survive a round trip as whole halalas, that the
 * header sums the gross and partitions the ledger, and that neither can be
 * reached across a tenant or client boundary.
 *
 * Every scope is built by `getScope()` from a session object rather than
 * assembled by hand, so each test exercises the real path from a cookie to a
 * MongoDB filter.
 */

const ORG_A = new Types.ObjectId();
const ORG_B = new Types.ObjectId();

const ACME = new Types.ObjectId();
const ZENITH = new Types.ObjectId();

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

function baseInvoice(
  clientId: Types.ObjectId,
  invoiceNumber: string,
  overrides: { amount?: number; dueDate?: Date; status?: "PENDING" | "PAID" } = {},
) {
  const amount = overrides.amount ?? UNIT;
  const totals = computeInvoiceTotals(amount, VAT_RATE_BASIS_POINTS);

  return {
    clientId,
    invoiceNumber,
    workRef: `Work for ${invoiceNumber}`,
    amount: totals.amount,
    vatRate: totals.vatRate,
    vat: totals.vat,
    total: totals.total,
    issueDate: day(-10),
    dueDate: overrides.dueDate ?? day(20),
    status: overrides.status ?? ("PENDING" as const),
  };
}

let acmePending: Types.ObjectId;
let zenithOverdue: Types.ObjectId;

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();

  const repository = invoicesRepository.forScope(staffA);

  // Acme: one pending inside terms, one paid.
  const pending = await repository.create(baseInvoice(ACME, "inv-1001"));
  await repository.create(baseInvoice(ACME, "inv-1002", { status: "PAID" }));

  // Zenith: one overdue.
  const overdue = await repository.create(
    baseInvoice(ZENITH, "inv-1003", { dueDate: day(-1) }),
  );

  acmePending = pending._id;
  zenithOverdue = overdue._id;

  // Another tenant's ledger, so every cross-org assertion has something real to
  // fail against — and reusing an invoice NUMBER proves per-org uniqueness is
  // per-org rather than global.
  await invoicesRepository.forScope(staffB).create(baseInvoice(new Types.ObjectId(), "inv-1001"));
});

describe("tenant isolation", () => {
  it("does not serve another organization's invoice by id", async () => {
    expect(await invoicesRepository.forScope(staffA).findById(acmePending)).not.toBeNull();
    expect(await invoicesRepository.forScope(staffB).findById(acmePending)).toBeNull();
  });

  it("does not let another organization settle one", async () => {
    const updated = await invoicesRepository
      .forScope(staffB)
      .update(acmePending, { status: "PAID", paidAt: NOW });
    expect(updated).toBeNull();

    const untouched = await invoicesRepository.forScope(staffA).findById(acmePending);
    expect(untouched?.status).toBe("PENDING");
  });

  it("does not let another organization withdraw one", async () => {
    expect(await invoicesRepository.forScope(staffB).delete(acmePending)).toBe(false);
    expect(await invoicesRepository.forScope(staffA).findById(acmePending)).not.toBeNull();
  });

  it("lets the same invoice number exist in two tenants", async () => {
    const a = await invoicesRepository.forScope(staffA).findOne({ invoiceNumber: "inv-1001" });
    const b = await invoicesRepository.forScope(staffB).findOne({ invoiceNumber: "inv-1001" });

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!._id.toHexString()).not.toBe(b!._id.toHexString());
  });

  it("counts only the caller's own tenant", async () => {
    const totals = await summariseInvoices(staffA, NOW);
    // Three in org A. The neighbour's must not be in this.
    expect(totals.count).toBe(3);
  });
});

describe("client isolation", () => {
  it("shows a client only its own invoices", async () => {
    const rows = await invoicesRepository.forScope(acme).find();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.clientId.toHexString() === ACME.toHexString())).toBe(true);
  });

  it("does not serve one client another client's invoice by id", async () => {
    expect(await invoicesRepository.forScope(acme).findById(zenithOverdue)).toBeNull();
    expect(await invoicesRepository.forScope(zenith).findById(zenithOverdue)).not.toBeNull();
  });

  /**
   * The KPI header is the place a leak would be least visible: it is a number,
   * not a row, so a customer would have no way to tell it included somebody
   * else's money.
   */
  it("aggregates only the client's own money", async () => {
    const acmeTotals = await summariseInvoices(acme, NOW);
    const zenithTotals = await summariseInvoices(zenith, NOW);
    const orgTotals = await summariseInvoices(staffA, NOW);

    expect(acmeTotals.count).toBe(2);
    expect(zenithTotals.count).toBe(1);
    expect(acmeTotals.count + zenithTotals.count).toBe(orgTotals.count);
    expect(acmeTotals.invoicedMinor + zenithTotals.invoicedMinor).toBe(orgTotals.invoicedMinor);
  });

  it("ignores a clientId a client tries to set on create", async () => {
    const created = await invoicesRepository
      .forScope(acme)
      .create({ ...baseInvoice(ZENITH, "inv-9999"), clientId: ZENITH });

    // Stamped from the SCOPE, not from the payload.
    expect(created.clientId.toHexString()).toBe(ACME.toHexString());
  });
});

describe("the stored figures", () => {
  it("survives a round trip as whole halalas", async () => {
    const row = await invoicesRepository.forScope(staffA).findById(acmePending);

    expect(Number.isInteger(row!.amount)).toBe(true);
    expect(Number.isInteger(row!.vat)).toBe(true);
    expect(Number.isInteger(row!.total)).toBe(true);
    expect(row!.amount + row!.vat).toBe(row!.total);
  });

  it("stores the rate the document was raised at", async () => {
    const row = await invoicesRepository.forScope(staffA).findById(acmePending);
    expect(row!.vatRate).toBe(VAT_RATE_BASIS_POINTS);
  });
});

describe("the KPI header", () => {
  it("splits the ledger into paid, pending and overdue with no gap", async () => {
    const totals = await summariseInvoices(staffA, NOW);

    expect(totals.paidCount + totals.pendingCount + totals.overdueCount).toBe(totals.count);
    expect(totals.paidMinor + totals.pendingMinor + totals.overdueMinor).toBe(
      totals.invoicedMinor,
    );
  });

  it("sums the GROSS, not the net", async () => {
    const totals = await summariseInvoices(staffA, NOW);
    // Three invoices of SAR 1,000 + 15% = SAR 1,150 each.
    expect(totals.invoicedMinor).toBe(3 * 115_000);
  });

  it("counts an invoice due today as pending, not overdue", async () => {
    await invoicesRepository
      .forScope(staffA)
      .create(baseInvoice(ACME, "inv-2001", { dueDate: TODAY }));

    const totals = await summariseInvoices(staffA, NOW);
    expect(totals.overdueCount).toBe(1);
    expect(totals.pendingCount).toBe(2);
  });

  it("treats a paid invoice as paid even after its due date", async () => {
    await invoicesRepository
      .forScope(staffA)
      .create(baseInvoice(ACME, "inv-2002", { dueDate: day(-30), status: "PAID" }));

    const totals = await summariseInvoices(staffA, NOW);
    expect(totals.paidCount).toBe(2);
    expect(totals.overdueCount).toBe(1);
  });

  it("excludes soft-deleted invoices from every figure", async () => {
    await invoicesRepository.forScope(staffA).delete(acmePending);

    const totals = await summariseInvoices(staffA, NOW);
    expect(totals.count).toBe(2);
    expect(totals.invoicedMinor).toBe(2 * 115_000);
  });

  it("returns zeroes rather than NaN for an empty ledger", async () => {
    await clearCollections();

    const totals = await summariseInvoices(staffA, NOW);
    expect(totals).toMatchObject({ count: 0, invoicedMinor: 0, overdueMinor: 0 });
  });
});
