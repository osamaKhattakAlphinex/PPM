import { describe, expect, it } from "vitest";

import {
  createContractSchema,
  deleteContractSchema,
  listContractsSchema,
  transitionContractSchema,
  updateContractSchema,
} from "@/lib/amc/schemas";
import { contractInputSchema } from "@/lib/db";
import { MAX_MONEY_MINOR_UNITS } from "@/lib/domain/currency";

/**
 * The payload boundary for AMC contracts.
 *
 * Two things are being asserted, and they pull in opposite directions:
 *
 *  1. The schemas are DERIVED from `contractInputSchema`, so a bound that
 *     changes on the model changes here too. The derivation-identity checks
 *     below are what make that mechanical rather than aspirational.
 *  2. `value` deliberately BREAKS the derivation, because the model stores
 *     halalas and a person types riyals. That break is asserted too, so nobody
 *     "fixes" the file back into a pure `.pick()` and silently starts storing
 *     riyals as halalas — a hundredfold error that throws nothing.
 *
 * The money cases are the reason this file exists. `4.35 * 100` is
 * `434.99999999999994` and `0.29 * 100` is `28.999999999999996` — ordinary
 * amounts, each a halala short the moment anything truncates them.
 */

const VALID = {
  clientId: "0123456789abcdef00000001",
  contractNumber: "amc-2026-001",
  title: "Chiller plant maintenance",
  type: "COMPREHENSIVE",
  value: "120000.00",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  compliance: 100,
} as const;

describe("createContractSchema", () => {
  it("accepts a well-formed payload", () => {
    const parsed = createContractSchema.parse(VALID);
    expect(parsed.title).toBe("Chiller plant maintenance");
    expect(parsed.startDate).toBeInstanceOf(Date);
  });

  it("rejects unknown fields", () => {
    // `entity()` builds a strict object and `pick`/`extend`/`superRefine` all
    // preserve that, so a field nobody meant to accept cannot ride along.
    expect(() => createContractSchema.parse({ ...VALID, isAdmin: true })).toThrow();
  });

  it("rejects organizationId", () => {
    // It comes from the session's scope. A payload that could name a tenant
    // would defeat data isolation entirely.
    expect(() =>
      createContractSchema.parse({ ...VALID, organizationId: "0123456789abcdef00000002" }),
    ).toThrow();
  });

  it("rejects status, so a contract cannot be created already cancelled", () => {
    expect(() => createContractSchema.parse({ ...VALID, status: "CANCELLED" })).toThrow();
  });

  it("rejects the timestamps a transition stamps", () => {
    expect(() =>
      createContractSchema.parse({ ...VALID, suspendedAt: "2026-02-01" }),
    ).toThrow();
    expect(() =>
      createContractSchema.parse({ ...VALID, cancelledAt: "2026-02-01" }),
    ).toThrow();
  });

  it("requires a clientId", () => {
    // The inversion of `createWorkOrderSchema`, where the client is derived from
    // the asset and may be null. A contract is an agreement WITH somebody, so
    // there is no counterpart to the depot work order here.
    const withoutClient = Object.fromEntries(
      Object.entries(VALID).filter(([key]) => key !== "clientId"),
    );

    expect(() => createContractSchema.parse(withoutClient)).toThrow();
  });

  it("requires the clientId to be 24 hex characters and refuses an operator", () => {
    expect(() => createContractSchema.parse({ ...VALID, clientId: "acme" })).toThrow();
    expect(() =>
      createContractSchema.parse({ ...VALID, clientId: { $ne: null } }),
    ).toThrow();
  });

  it("derives title, type and compliance from the model rather than restating them", () => {
    // Identity, not equivalence: these are the very schemas the model declares,
    // so a bound that changes there changes here with no second edit.
    expect(createContractSchema.shape.title).toBe(contractInputSchema.shape.title);
    expect(createContractSchema.shape.type).toBe(contractInputSchema.shape.type);
    expect(createContractSchema.shape.compliance).toBe(contractInputSchema.shape.compliance);
  });

  it("deliberately does NOT derive value from the model", () => {
    // The model stores halalas; this takes riyals. If these two ever became the
    // same schema, a person typing 120000 would file a contract worth SAR 1,200.
    expect(createContractSchema.shape.value).not.toBe(contractInputSchema.shape.value);
  });
});

describe("the money field", () => {
  const valueOf = (value: unknown) => createContractSchema.parse({ ...VALID, value }).value;

  it("converts riyals to halalas exactly", () => {
    expect(valueOf("12.34")).toBe(1234);
    expect(valueOf("0")).toBe(0);
    expect(valueOf("1")).toBe(100);
  });

  it("pads a single decimal place", () => {
    // "1200.5" is one thousand two hundred riyals and fifty halalas, not five.
    expect(valueOf("1200.5")).toBe(120050);
  });

  it("is exact on amounts whose float product is not", () => {
    // Every amount here has a `riyals * 100` that lands just below a whole
    // number, so any conversion that truncates is a halala short on all of them.
    // The string arithmetic never multiplies a fraction at all.
    for (const [riyals, halalas] of [
      ["4.35", 435],
      ["1.15", 115],
      ["16.08", 1608],
      ["0.29", 29],
      ["1.13", 113],
    ] as const) {
      const naive = Number(riyals) * 100;

      // The premise: these really are the awkward ones, not a decorative list.
      expect(Number.isInteger(naive)).toBe(false);
      expect(Math.trunc(naive)).toBe(halalas - 1);

      expect(valueOf(riyals)).toBe(halalas);
    }
  });

  it("is exact on large amounts too", () => {
    expect(valueOf("1000000.07")).toBe(100000007);
    expect(valueOf("999999999.99")).toBe(99999999999);
  });

  it("refuses a third decimal place rather than rounding it", () => {
    // SAR 1.005 is not representable in halalas at all, so the right answer is a
    // refusal, not a rounding — silently turning it into either 1.00 or 1.01 is
    // a decision the person typing it did not make. (`Math.round(1.005 * 100)`
    // picks 100, the DOWN one, which is not even the conventional choice.)
    expect(() => valueOf("1.005")).toThrow();
    expect(() => valueOf("12.345")).toThrow();
  });

  it("accepts a number as well as a string, through the same gate", () => {
    // A JSON caller sends a number; a form sends a string. Both are stringified
    // and put through the same regex, so neither is quietly rounded.
    expect(valueOf(1200.5)).toBe(120050);
    expect(() => valueOf(12.345)).toThrow();
  });

  it("rejects anything that is not a plain positive decimal", () => {
    for (const bad of ["-1", "1e5", "abc", "", " ", "12.", ".5", "1,200"]) {
      expect(() => valueOf(bad)).toThrow();
    }
  });

  it("rejects an operator object", () => {
    expect(() => valueOf({ $gt: 0 })).toThrow();
  });

  it("accepts the ceiling and refuses one halala more", () => {
    // SAR 1,000,000,000.00 exactly.
    expect(valueOf("1000000000")).toBe(MAX_MONEY_MINOR_UNITS);
    expect(() => valueOf("1000000000.01")).toThrow();
  });
});

describe("the term rule", () => {
  it("rejects an end date before the start date", () => {
    expect(() =>
      createContractSchema.parse({ ...VALID, startDate: "2026-12-31", endDate: "2026-01-01" }),
    ).toThrow();
  });

  it("rejects a zero-length term", () => {
    // Strictly after, not on-or-after: EXPIRING and EXPIRED would both be true
    // of a one-day contract on its only day.
    expect(() =>
      createContractSchema.parse({ ...VALID, startDate: "2026-06-01", endDate: "2026-06-01" }),
    ).toThrow();
  });

  it("accepts a term one day long", () => {
    expect(() =>
      createContractSchema.parse({ ...VALID, startDate: "2026-06-01", endDate: "2026-06-02" }),
    ).not.toThrow();
  });

  it("reports the failure on endDate, where the form can render it", () => {
    // `fieldErrorsFrom()` keys its map on `issue.path.join(".") || "_"`. An
    // issue with an empty path lands under `_`, where the sheet has nowhere to
    // put it — the field goes un-highlighted and the message vanishes. This
    // assertion is what makes `fieldErrors.endDate` true rather than hoped for.
    const result = createContractSchema.safeParse({
      ...VALID,
      startDate: "2026-12-31",
      endDate: "2026-01-01",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.join(".") === "endDate")).toBe(true);
  });
});

describe("updateContractSchema", () => {
  const base = { id: "0123456789abcdef00000009" } as const;

  it("accepts a patch that touches neither date", () => {
    expect(() => updateContractSchema.parse({ ...base, title: "Renamed" })).not.toThrow();
  });

  it("accepts a patch that carries both dates", () => {
    expect(() =>
      updateContractSchema.parse({ ...base, startDate: "2027-01-01", endDate: "2027-12-31" }),
    ).not.toThrow();
  });

  it("rejects a patch carrying only the start date, pointing at the missing one", () => {
    // A term is a PAIR and this layer only sees the payload, so half a term
    // cannot be checked here at all. Refusing it keeps ONE rule rather than
    // splitting it between this file and the action.
    const result = updateContractSchema.safeParse({ ...base, startDate: "2027-01-01" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.join(".") === "endDate")).toBe(true);
  });

  it("rejects a patch carrying only the end date, pointing at the missing one", () => {
    const result = updateContractSchema.safeParse({ ...base, endDate: "2027-12-31" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.join(".") === "startDate")).toBe(true);
  });

  it("still checks the order when both dates are present", () => {
    const result = updateContractSchema.safeParse({
      ...base,
      startDate: "2027-12-31",
      endDate: "2027-01-01",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.join(".") === "endDate")).toBe(true);
  });

  it("rejects clientId — a contract is not moved between customers", () => {
    expect(() =>
      updateContractSchema.parse({ ...base, clientId: "0123456789abcdef00000001" }),
    ).toThrow();
  });

  it("rejects contractNumber — it goes on invoices", () => {
    expect(() => updateContractSchema.parse({ ...base, contractNumber: "amc-2026-002" })).toThrow();
  });

  it("rejects status — that is the transition action's business", () => {
    expect(() => updateContractSchema.parse({ ...base, status: "CANCELLED" })).toThrow();
  });

  it("requires an id", () => {
    expect(() => updateContractSchema.parse({ title: "Renamed" })).toThrow();
  });

  it("takes riyals for value, like create", () => {
    const parsed = updateContractSchema.parse({ ...base, value: "50.25" });
    expect(parsed.value).toBe(5025);
  });
});

describe("transitionContractSchema", () => {
  it("accepts the STORED vocabulary only", () => {
    for (const to of ["ACTIVE", "SUSPENDED", "CANCELLED"]) {
      expect(() =>
        transitionContractSchema.parse({ id: "0123456789abcdef00000009", to }),
      ).not.toThrow();
    }
  });

  it("refuses a derived status, which is not a thing a row can be moved to", () => {
    for (const to of ["EXPIRING", "EXPIRED", "UPCOMING"]) {
      expect(() =>
        transitionContractSchema.parse({ id: "0123456789abcdef00000009", to }),
      ).toThrow();
    }
  });
});

describe("listContractsSchema", () => {
  it("defaults the page parameters", () => {
    const parsed = listContractsSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBeGreaterThan(0);
  });

  it("coerces query-string numbers", () => {
    expect(listContractsSchema.parse({ page: "3" }).page).toBe(3);
  });

  it("caps the page size at the DAL's maximum", () => {
    expect(() => listContractsSchema.parse({ pageSize: 5000 })).toThrow();
  });

  it("accepts the DISPLAY vocabulary, including the derived statuses", () => {
    // The opposite of `listWorkOrdersSchema`, which takes stored values. A
    // person filters for "expiring", which is not a value any row holds.
    for (const status of ["UPCOMING", "ACTIVE", "EXPIRING", "EXPIRED", "SUSPENDED", "CANCELLED"]) {
      expect(() => listContractsSchema.parse({ status })).not.toThrow();
    }
  });

  it("rejects a status that is not in the vocabulary", () => {
    expect(() => listContractsSchema.parse({ status: "DONE" })).toThrow();
  });

  it("rejects an operator in every filter value", () => {
    // These go into the DAL's UNTRUSTED `filter` channel, which sanitizes them
    // anyway — this is the outer half of the same rule.
    expect(() => listContractsSchema.parse({ status: { $ne: "CANCELLED" } })).toThrow();
    expect(() => listContractsSchema.parse({ type: { $ne: null } })).toThrow();
    expect(() => listContractsSchema.parse({ clientId: { $ne: null } })).toThrow();
  });

  it("rejects unknown filters", () => {
    expect(() => listContractsSchema.parse({ organizationId: "0123456789abcdef00000002" })).toThrow();
  });
});

describe("deleteContractSchema", () => {
  it("takes an id and nothing else", () => {
    expect(() => deleteContractSchema.parse({ id: "0123456789abcdef00000009" })).not.toThrow();
    expect(() =>
      deleteContractSchema.parse({ id: "0123456789abcdef00000009", hard: true }),
    ).toThrow();
  });
});
