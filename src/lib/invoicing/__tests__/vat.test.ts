import { describe, expect, it } from "vitest";

import { halalasToSar, sarInputSchema } from "@/lib/domain/currency";
import { startOfUtcDay } from "@/lib/domain/dates";
import {
  BASIS_POINTS_PER_UNIT,
  computeInvoiceTotals,
  effectiveInvoiceStatus,
  INVOICE_DISPLAY_STATUSES,
  INVOICE_STATUSES,
  invoiceStatusQueryFragment,
  VAT_RATE_BASIS_POINTS,
} from "@/lib/domain/invoicing";
import {
  createInvoiceFromApprovalSchema,
  createInvoiceSchema,
  listInvoicesSchema,
  settleInvoiceSchema,
  updateInvoiceSchema,
} from "../schemas";

/**
 * The money arithmetic, and the promise that no client figure can reach it.
 *
 * Two separate claims are tested here, and they are the two the product asks to
 * be verified:
 *
 *  1. **Totals are computed server-side.** The strong form of that is not "the
 *     server recalculates and compares" — it is that there is no wire
 *     representation for a VAT figure or a total ANYWHERE, so a client has
 *     nothing to send. That is asserted directly against the payload schemas.
 *  2. **The arithmetic is integer arithmetic, and the three figures always add
 *     up.** Asserted over a wide sweep of amounts rather than a handful of
 *     round ones, because the failure mode is a one-halala discrepancy that
 *     only appears at particular values.
 *
 * Pure, so it runs anywhere: no database, no session.
 */

describe("computeInvoiceTotals", () => {
  it("applies 15% by default", () => {
    // SAR 1,000.00 -> SAR 150.00 VAT -> SAR 1,150.00
    expect(computeInvoiceTotals(100_000)).toEqual({
      amount: 100_000,
      vatRate: VAT_RATE_BASIS_POINTS,
      vat: 15_000,
      total: 115_000,
    });
  });

  it("returns whole halalas for every amount, and never a float", () => {
    for (let amount = 0; amount <= 20_000; amount += 7) {
      const totals = computeInvoiceTotals(amount);
      expect(Number.isInteger(totals.vat)).toBe(true);
      expect(Number.isInteger(totals.total)).toBe(true);
    }
  });

  /**
   * The invariant that matters on a document somebody pays against: the lines
   * add up. `total` is derived from the ROUNDED vat, so this holds by
   * construction — the test is here to stop someone "simplifying" it into
   * `round(amount * 1.15)`, which differs by a halala at some amounts.
   */
  it("always satisfies amount + vat === total", () => {
    for (let amount = 0; amount <= 50_000; amount += 13) {
      const totals = computeInvoiceTotals(amount);
      expect(totals.amount + totals.vat).toBe(totals.total);
    }
  });

  it("rounds a half halala up", () => {
    // 10 halalas at 15% is exactly 1.5 halalas.
    expect(computeInvoiceTotals(10).vat).toBe(2);
  });

  it("honours a stored rate other than the current one", () => {
    // A document raised at 5% still says 5%, whatever the constant says today.
    expect(computeInvoiceTotals(100_000, 500)).toMatchObject({ vat: 5_000, total: 105_000 });
    expect(computeInvoiceTotals(100_000, 0)).toMatchObject({ vat: 0, total: 100_000 });
  });

  it("agrees with the riyal/halala conversion at the boundary", () => {
    /**
     * Through `sarInputSchema`, which is what a form actually goes through —
     * integer arithmetic on the decimal string rather than `sar * 100`. Using
     * the float helper here would test a path no request takes.
     */
    const amount = sarInputSchema.parse("1234.56");
    const totals = computeInvoiceTotals(amount);

    expect(halalasToSar(totals.amount)).toBeCloseTo(1234.56, 2);
    // 123456 * 1500 / 10000 = 18518.4 -> 18518
    expect(totals.vat).toBe(18_518);
    expect(totals.total).toBe(141_974);
  });

  it("uses basis points, so the rate is an integer", () => {
    expect(Number.isInteger(VAT_RATE_BASIS_POINTS)).toBe(true);
    expect(VAT_RATE_BASIS_POINTS / BASIS_POINTS_PER_UNIT).toBe(0.15);
  });
});

describe("no payload schema can carry a total", () => {
  const base = {
    clientId: "0123456789abcdef01234567",
    invoiceNumber: "inv-1001",
    workRef: "WO-1183 chiller",
    amount: "1000.00",
  };

  it("accepts the net alone", () => {
    expect(createInvoiceSchema.safeParse(base).success).toBe(true);
  });

  /** The claim in its strongest form: these fields do not exist. */
  it("rejects vat, total and vatRate on every write schema", () => {
    for (const smuggled of ["vat", "total", "vatRate", "status", "paidAt", "organizationId"]) {
      expect(
        createInvoiceSchema.safeParse({ ...base, [smuggled]: "1" }).success,
        `createInvoice accepted ${smuggled}`,
      ).toBe(false);

      expect(
        updateInvoiceSchema.safeParse({ id: base.clientId, [smuggled]: "1" }).success,
        `updateInvoice accepted ${smuggled}`,
      ).toBe(false);

      expect(
        createInvoiceFromApprovalSchema.safeParse({
          approvalId: base.clientId,
          invoiceNumber: "inv-1002",
          amount: "10.00",
          [smuggled]: "1",
        }).success,
        `createInvoiceFromApproval accepted ${smuggled}`,
      ).toBe(false);
    }
  });

  /** The approval path takes no client at all — it copies one from the chain. */
  it("refuses a clientId on the approval path", () => {
    expect(
      createInvoiceFromApprovalSchema.safeParse({
        approvalId: base.clientId,
        invoiceNumber: "inv-1003",
        amount: "10.00",
        clientId: base.clientId,
      }).success,
    ).toBe(false);
  });

  it("refuses a half-changed term", () => {
    const id = base.clientId;
    expect(updateInvoiceSchema.safeParse({ id, issueDate: "2026-01-01" }).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({ id, dueDate: "2026-01-31" }).success).toBe(false);
    expect(
      updateInvoiceSchema.safeParse({ id, issueDate: "2026-01-01", dueDate: "2026-01-31" })
        .success,
    ).toBe(true);
  });

  it("refuses a due date before the issue date", () => {
    const result = updateInvoiceSchema.safeParse({
      id: base.clientId,
      issueDate: "2026-01-31",
      dueDate: "2026-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "dueDate")).toBe(true);
    }
  });

  it("refuses operator-shaped keys on the list filter", () => {
    expect(listInvoicesSchema.safeParse({ status: { $ne: "PAID" } }).success).toBe(false);
    expect(listInvoicesSchema.safeParse({ $where: "1" }).success).toBe(false);
    expect(listInvoicesSchema.safeParse({ "client.id": "x" }).success).toBe(false);
  });

  it("takes only a boolean on settle — there is no arbitrary status to set", () => {
    const id = base.clientId;
    expect(settleInvoiceSchema.safeParse({ id, paid: true }).success).toBe(true);
    expect(settleInvoiceSchema.safeParse({ id, status: "PAID" }).success).toBe(false);
  });
});

describe("effectiveInvoiceStatus", () => {
  const now = new Date("2026-03-14T09:00:00.000Z");
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("is PAID whatever the dates say", () => {
    expect(effectiveInvoiceStatus("PAID", day("2020-01-01"), now)).toBe("PAID");
  });

  it("is OVERDUE only strictly after the due date", () => {
    expect(effectiveInvoiceStatus("PENDING", day("2026-03-13"), now)).toBe("OVERDUE");
    // Due TODAY is due today, not late.
    expect(effectiveInvoiceStatus("PENDING", day("2026-03-14"), now)).toBe("PENDING");
    expect(effectiveInvoiceStatus("PENDING", day("2026-03-15"), now)).toBe("PENDING");
  });

  it("compares whole UTC days, not instants", () => {
    // An invoice due today, checked at 23:59 UTC, is still not overdue.
    const lateInTheDay = new Date("2026-03-14T23:59:59.000Z");
    expect(effectiveInvoiceStatus("PENDING", day("2026-03-14"), lateInTheDay)).toBe("PENDING");
  });

  it("keeps the stored vocabulary a subset of the displayed one", () => {
    for (const stored of INVOICE_STATUSES) {
      expect(INVOICE_DISPLAY_STATUSES).toContain(stored);
    }
    // And the display-only value is genuinely not storable.
    expect(INVOICE_STATUSES as readonly string[]).not.toContain("OVERDUE");
  });
});

describe("invoiceStatusQueryFragment", () => {
  const now = new Date("2026-03-14T09:00:00.000Z");
  const today = startOfUtcDay(now);

  it("translates each display status into a code-authored filter", () => {
    expect(invoiceStatusQueryFragment("PAID", now)).toEqual({ status: "PAID" });
    expect(invoiceStatusQueryFragment("OVERDUE", now)).toEqual({
      status: "PENDING",
      dueDate: { $lt: today },
    });
    expect(invoiceStatusQueryFragment("PENDING", now)).toEqual({
      status: "PENDING",
      dueDate: { $gte: today },
    });
  });

  /**
   * The two PENDING branches partition the pending ledger exactly — no invoice
   * is in both, none is in neither — which is what makes the KPI counts sum to
   * the total.
   */
  it("partitions the pending ledger with no overlap and no gap", () => {
    const overdue = invoiceStatusQueryFragment("OVERDUE", now) as {
      dueDate: { $lt: Date };
    };
    const pending = invoiceStatusQueryFragment("PENDING", now) as {
      dueDate: { $gte: Date };
    };

    expect(overdue.dueDate.$lt.getTime()).toBe(pending.dueDate.$gte.getTime());
  });
});
