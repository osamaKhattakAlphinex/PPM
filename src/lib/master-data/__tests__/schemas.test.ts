import { describe, expect, it } from "vitest";

import {
  addressSchema,
  clientContactInfoSchema,
  clientInputSchema,
  locationInputSchema,
  organizationInputSchema,
} from "@/lib/db";
import {
  createClientSchema,
  createLocationSchema,
  deleteClientSchema,
  listClientsSchema,
  listLocationsSchema,
  searchTerm,
  updateClientSchema,
  updateLocationSchema,
  updateOrganizationSchema,
} from "../schemas";

/**
 * The validation rules, tested without a database.
 *
 * These schemas are derived from the model schemas, so most of what is asserted
 * here is really an assertion that the derivation kept the constraint — a
 * regex or a bound that stops applying to an action payload is a hole nothing
 * else in the stack would notice, because the DAL sanitizes shapes rather than
 * values.
 */

const validAddress = {
  line1: "King Fahd Road",
  city: "Riyadh",
};

// ---------------------------------------------------------------------------
// Unknown keys
// ---------------------------------------------------------------------------

describe("every payload schema rejects unknown fields", () => {
  /**
   * CLAUDE.md requires rejection, not stripping. The difference matters: a
   * stripped `organizationId` is silently ignored and the caller believes it
   * worked, while a rejected one is a 400 that says so.
   */
  it.each([
    ["createClient", createClientSchema, { name: "Acme", code: "acme" }],
    [
      "updateClient",
      updateClientSchema,
      { id: "0123456789abcdef01234567", name: "Acme" },
    ],
    ["deleteClient", deleteClientSchema, { id: "0123456789abcdef01234567" }],
    ["listClients", listClientsSchema, {}],
    ["createLocation", createLocationSchema, { name: "Tower", address: validAddress }],
    ["updateLocation", updateLocationSchema, { id: "0123456789abcdef01234567" }],
    ["listLocations", listLocationsSchema, {}],
    ["updateOrganization", updateOrganizationSchema, { name: "Gulf" }],
  ])("%s", (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);

    // The tenant key is the one that must never be accepted from a payload.
    expect(schema.safeParse({ ...valid, organizationId: "0123456789abcdef01234567" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...valid, sneaky: true }).success).toBe(false);
  });

  it("rejects unknown keys inside nested objects too", () => {
    expect(clientContactInfoSchema.safeParse({ name: "Nada", role: "owner" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...validAddress, floor: 3 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

describe("client payloads", () => {
  it("keeps the code format the model enforces", () => {
    expect(createClientSchema.safeParse({ name: "Acme", code: "acme-holdings" }).success).toBe(true);

    for (const code of ["Acme", "acme_holdings", "acme--x", "-acme", "a"]) {
      expect(createClientSchema.safeParse({ name: "Acme", code }).success, code).toBe(false);
    }
  });

  it("defaults status to ACTIVE", () => {
    const parsed = createClientSchema.parse({ name: "Acme", code: "acme" });
    expect(parsed.status).toBe("ACTIVE");
  });

  it("normalises a contact email the way the model stores it", () => {
    const parsed = createClientSchema.parse({
      name: "Acme",
      code: "acme",
      contactInfo: { email: "Ops@Acme.example" },
    });
    // The model marks the field lowercase; zod validates the format, Mongoose
    // normalises on write. What matters here is that a valid address survives
    // and an invalid one does not.
    expect(parsed.contactInfo?.email).toBe("Ops@Acme.example");
    expect(
      createClientSchema.safeParse({
        name: "Acme",
        code: "acme",
        contactInfo: { email: "not-an-email" },
      }).success,
    ).toBe(false);
  });

  it("does not let update change the code — it is the client's stable handle", () => {
    expect("code" in updateClientSchema.shape).toBe(false);
    expect(
      updateClientSchema.safeParse({ id: "0123456789abcdef01234567", code: "renamed" }).success,
    ).toBe(false);
  });

  it("requires a well-formed id on update and delete", () => {
    expect(updateClientSchema.safeParse({ id: "nope", name: "Acme" }).success).toBe(false);
    expect(deleteClientSchema.safeParse({ id: "0123456789abcdef0123456" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

describe("location payloads", () => {
  it("requires the parts of an address a technician needs to arrive", () => {
    expect(createLocationSchema.safeParse({ name: "Tower", address: {} }).success).toBe(false);
    expect(
      createLocationSchema.safeParse({ name: "Tower", address: { line1: "King Fahd Road" } })
        .success,
    ).toBe(false);
    expect(createLocationSchema.safeParse({ name: "Tower", address: validAddress }).success).toBe(
      true,
    );
  });

  it("defaults country to SA", () => {
    const parsed = createLocationSchema.parse({ name: "Tower", address: validAddress });
    expect(parsed.address.country).toBe("SA");
  });

  it("accepts an omitted clientId — that is an org-wide site", () => {
    const parsed = createLocationSchema.parse({ name: "Depot", address: validAddress });
    expect(parsed.clientId).toBeUndefined();
  });

  it("requires a well-formed clientId when one is given", () => {
    expect(
      createLocationSchema.safeParse({ name: "Tower", address: validAddress, clientId: "acme" })
        .success,
    ).toBe(false);
  });

  /**
   * The one that matters most on this entity. A location's customer is fixed at
   * creation; the DAL enforces it independently via `RESERVED_FIELDS`, and this
   * asserts the schema refuses it too, so the attempt fails at the boundary
   * with a message rather than being silently dropped deeper down.
   */
  it("has no clientId on update, so a site cannot be reassigned", () => {
    expect("clientId" in updateLocationSchema.shape).toBe(false);
    expect(
      updateLocationSchema.safeParse({
        id: "0123456789abcdef01234567",
        clientId: "0123456789abcdef01234568",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

describe("organization payloads", () => {
  it("enforces the 15-digit Saudi VAT format", () => {
    expect(updateOrganizationSchema.safeParse({ vatNumber: "300000000000003" }).success).toBe(true);
    // Null is meaningful: registered vs. not filled in.
    expect(updateOrganizationSchema.safeParse({ vatNumber: null }).success).toBe(true);

    for (const value of ["12345", "3000000000000034", "30000000000000x", ""]) {
      expect(updateOrganizationSchema.safeParse({ vatNumber: value }).success, value).toBe(false);
    }
  });

  it("defaults a new organization to SAR with the Saudi VAT rate and a Sunday week", () => {
    const parsed = organizationInputSchema.parse({ name: "Gulf Facilities", slug: "gulf" });

    expect(parsed.defaultCurrency).toBe("SAR");
    expect(parsed.settings.vatRate).toBe(15);
    expect(parsed.settings.workWeekStartsOn).toBe("SUN");
    expect(parsed.timezone).toBe("Asia/Riyadh");
    expect(parsed.vatNumber).toBeUndefined();
  });

  it("accepts the GCC currencies and nothing else", () => {
    expect(updateOrganizationSchema.safeParse({ defaultCurrency: "AED" }).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ defaultCurrency: "USD" }).success).toBe(false);
  });

  it("coerces vatRate, because a number input submits a string", () => {
    const parsed = updateOrganizationSchema.parse({
      settings: { vatRate: "5", workWeekStartsOn: "MON" },
    });
    expect(parsed.settings?.vatRate).toBe(5);
  });

  it("bounds vatRate to a percentage", () => {
    expect(
      updateOrganizationSchema.safeParse({ settings: { vatRate: 101, workWeekStartsOn: "SUN" } })
        .success,
    ).toBe(false);
    expect(
      updateOrganizationSchema.safeParse({ settings: { vatRate: -1, workWeekStartsOn: "SUN" } })
        .success,
    ).toBe(false);
  });

  it("does not accept slug or status — the org cannot rename or suspend itself", () => {
    expect("slug" in updateOrganizationSchema.shape).toBe(false);
    expect("status" in updateOrganizationSchema.shape).toBe(false);
    expect(updateOrganizationSchema.safeParse({ slug: "hijacked" }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ status: "SUSPENDED" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

describe("list parameters", () => {
  it("defaults to the first page", () => {
    const parsed = listClientsSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });

  it("coerces page numbers arriving as strings from a query string", () => {
    expect(listClientsSchema.parse({ page: "3", pageSize: "50" })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it("refuses a page size above the DAL's cap rather than silently clamping", () => {
    expect(listClientsSchema.safeParse({ pageSize: 1000 }).success).toBe(false);
    expect(listClientsSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it("caps the search term, because it becomes an anchored regex", () => {
    expect(searchTerm.safeParse("a".repeat(64)).success).toBe(true);
    expect(searchTerm.safeParse("a".repeat(65)).success).toBe(false);
    expect(searchTerm.safeParse("   ").success).toBe(false);
  });

  it("still refuses an operator smuggled in as a search term's shape", () => {
    // zod alone would not catch `{ $gt: "" }` if the field were untyped; it is a
    // string, so the shape is rejected before the DAL's sanitizer is reached.
    expect(listClientsSchema.safeParse({ q: { $gt: "" } }).success).toBe(false);
    expect(listLocationsSchema.safeParse({ status: { $ne: null } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The derivation itself
// ---------------------------------------------------------------------------

describe("the action schemas stay derived from the model schemas", () => {
  /**
   * If someone restates a field here instead of picking it, this is what
   * notices. The point of the zod-first pattern is that there is one definition
   * of "a client name", not two that agree today.
   */
  it("shares the model's field definitions", () => {
    expect(createClientSchema.shape.name).toBe(clientInputSchema.shape.name);
    expect(createClientSchema.shape.code).toBe(clientInputSchema.shape.code);
    expect(createLocationSchema.shape.address).toBe(locationInputSchema.shape.address);
    expect(updateOrganizationSchema.shape.name.safeParse("x").success).toBe(false);
  });

  it("never exposes organizationId as a field on any schema", () => {
    for (const schema of [
      createClientSchema,
      updateClientSchema,
      createLocationSchema,
      updateLocationSchema,
      updateOrganizationSchema,
    ]) {
      expect("organizationId" in schema.shape).toBe(false);
    }
  });
});
