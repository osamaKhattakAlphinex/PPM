import { loadEnvConfig } from "@next/env";
import { z } from "zod";

/**
 * `.env.local` is read exactly the way `next dev` reads it, so the script and
 * the app always talk to the same database. It runs before the imports below
 * touch anything, though nothing in the data layer reads the environment until
 * it actually connects.
 */
loadEnvConfig(process.cwd());

import type { Role } from "../src/lib/auth/roles";
import { hashPassword } from "../src/lib/auth/password";
import {
  assetsRepository,
  clientsRepository,
  connectToDatabase,
  disconnectFromDatabase,
  ensureOrganization,
  locationsRepository,
  requireObjectId,
  usersRepository,
} from "../src/lib/db";

/**
 * Local development seed.
 *
 *     pnpm seed
 *
 * Creates one organization, one client, and one user per role the app is
 * exercised with. Idempotent: re-running updates the existing rows instead of
 * failing on the unique email index, so it is safe after any schema change.
 *
 * The users are written THROUGH the tenant-scoped repository rather than
 * straight into Mongoose. That is deliberate — it makes the seed the first real
 * proof that the data-access layer stamps organizationId correctly, and a seed
 * that bypassed the DAL could quietly create rows the app can never read back.
 */

const DEFAULT_PASSWORD = "ChangeMe!2026";

const ORGANIZATION = {
  name: "Gulf Facilities Co.",
  slug: "gulf-facilities",
  defaultLocale: "en" as const,
  timezone: "Asia/Riyadh",
};

const CLIENT = {
  name: "Al Faisaliah Tower",
  code: "faisaliah",
  contactInfo: {
    name: "Nada Al-Sabah",
    email: "facilities@faisaliah.example",
    phone: "+966 11 273 2000",
  },
};

/**
 * Two sites, and the difference between them is the point.
 *
 * The first belongs to the seeded client; the second is the organization's own
 * depot and belongs to nobody. Sign in as `client@ppm.local` and only the first
 * one is there — not because a page filtered it out, but because the data-access
 * layer appends `clientId` to the query and null matches no client id. That
 * split is asserted in `src/lib/db/__tests__/master-data.test.ts`; seeding both
 * makes it visible in a browser on the first run too.
 */
const LOCATIONS = [
  {
    name: "Al Faisaliah Tower",
    building: "Main Tower",
    forClient: true,
    address: {
      line1: "King Fahd Road",
      district: "Al Olaya",
      city: "Riyadh",
      region: "Riyadh Province",
      postalCode: "11564",
      country: "SA",
    },
  },
  {
    name: "Central Stores & Workshop",
    building: null,
    forClient: false,
    address: {
      line1: "Exit 18, Eastern Ring Road",
      district: "Al Nasiriyah",
      city: "Riyadh",
      region: "Riyadh Province",
      postalCode: "12811",
      country: "SA",
    },
  },
] as const;

/**
 * Equipment, spread deliberately rather than randomly.
 *
 * Two things are being made visible on a first run:
 *
 *  - every category, every status, and all three health bands (green ≥70,
 *    amber 40–69, red <40), so the list, the filters and the bar's tones can
 *    all be seen without inventing data by hand;
 *  - assets at BOTH sites. Those at the tower inherit its client; those at the
 *    depot inherit null. Sign in as `client@ppm.local` and only the tower's
 *    appear — the same isolation the locations above demonstrate, one level
 *    further down.
 */
const ASSETS: ReadonlyArray<{
  name: string;
  category: "HVAC" | "ELECTRICAL" | "ELV" | "CIVIL" | "PLUMBING";
  type: string;
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
  health: number;
  /** Which of the two seeded sites this stands at. */
  site: "Al Faisaliah Tower" | "Central Stores & Workshop";
}> = [
  // --- The client's tower ---------------------------------------------------
  { name: "Chiller Plant A", category: "HVAC", type: "Centrifugal Chiller", status: "ACTIVE", health: 92, site: "Al Faisaliah Tower" },
  { name: "Chiller Plant B", category: "HVAC", type: "Centrifugal Chiller", status: "MAINTENANCE", health: 48, site: "Al Faisaliah Tower" },
  { name: "AHU-02 Rooftop", category: "HVAC", type: "Air Handling Unit", status: "ACTIVE", health: 76, site: "Al Faisaliah Tower" },
  { name: "Cooling Tower 1", category: "HVAC", type: "Cooling Tower", status: "ACTIVE", health: 64, site: "Al Faisaliah Tower" },
  { name: "Main Switchgear", category: "ELECTRICAL", type: "LV Switchboard", status: "ACTIVE", health: 88, site: "Al Faisaliah Tower" },
  { name: "Standby Generator", category: "ELECTRICAL", type: "Diesel Generator", status: "ACTIVE", health: 71, site: "Al Faisaliah Tower" },
  { name: "Distribution Board 4F", category: "ELECTRICAL", type: "Distribution Board", status: "INACTIVE", health: 31, site: "Al Faisaliah Tower" },
  { name: "Fire Alarm Panel", category: "ELV", type: "Addressable Panel", status: "ACTIVE", health: 95, site: "Al Faisaliah Tower" },
  { name: "CCTV Head End", category: "ELV", type: "NVR Rack", status: "ACTIVE", health: 57, site: "Al Faisaliah Tower" },
  { name: "Passenger Lift 3", category: "CIVIL", type: "Traction Lift", status: "MAINTENANCE", health: 23, site: "Al Faisaliah Tower" },
  { name: "Domestic Water Pump", category: "PLUMBING", type: "Booster Set", status: "ACTIVE", health: 82, site: "Al Faisaliah Tower" },
  { name: "Sump Pump B1", category: "PLUMBING", type: "Submersible Pump", status: "ACTIVE", health: 39, site: "Al Faisaliah Tower" },

  // --- The organization's own depot (clientId null, invisible to CLIENT) ----
  { name: "Workshop Compressor", category: "HVAC", type: "Air Compressor", status: "ACTIVE", health: 68, site: "Central Stores & Workshop" },
  { name: "Depot Distribution Board", category: "ELECTRICAL", type: "Distribution Board", status: "ACTIVE", health: 90, site: "Central Stores & Workshop" },
  { name: "Access Control Server", category: "ELV", type: "Controller", status: "ACTIVE", health: 45, site: "Central Stores & Workshop" },
  { name: "Loading Bay Door", category: "CIVIL", type: "Roller Shutter", status: "INACTIVE", health: 18, site: "Central Stores & Workshop" },
];

const USERS: ReadonlyArray<{ name: string; email: string; role: Role }> = [
  { name: "Layla Al-Harbi", email: "admin@ppm.local", role: "ADMIN" },
  { name: "Omar Nasser", email: "fm@ppm.local", role: "FM_MANAGER" },
  { name: "Yousef Karim", email: "tech@ppm.local", role: "TECHNICIAN" },
  { name: "Nada Al-Sabah", email: "client@ppm.local", role: "CLIENT" },
];

function assertNotProduction(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NODE_ENV is production.");
  }
}

/** A known password is fine locally; a weak one in a shared environment is not. */
function resolvePassword(): string {
  const supplied = process.env.SEED_PASSWORD;
  if (!supplied) return DEFAULT_PASSWORD;

  const parsed = z.string().min(12).max(128).safeParse(supplied);
  if (!parsed.success) throw new Error("SEED_PASSWORD must be 12-128 characters.");
  return parsed.data;
}

async function main(): Promise<void> {
  assertNotProduction();

  const password = resolvePassword();
  await connectToDatabase();

  // 1. The tenant. Untenanted by definition, so it is created through the
  //    identity store — `createRepository()` refuses a model with no
  //    organizationId, which is the correct refusal.
  const organization = await ensureOrganization(ORGANIZATION);
  console.log(`organization  ${organization.name}  ${organization.id}`);

  // 2. Everything from here is scoped. This is the seed's own scope: an ADMIN
  //    acting inside the organization it just created, assembled by hand
  //    because there is no session to derive it from. That is what `forScope()`
  //    exists for, and a script is the only place it is legitimate.
  const organizationId = requireObjectId(organization.id);
  const bootstrapScope = {
    organizationId,
    role: "ADMIN" as const,
    // No acting user exists yet. Audit trails start once real users do.
    userId: organizationId,
  };

  const clients = clientsRepository.forScope(bootstrapScope);
  const users = usersRepository.forScope(bootstrapScope);

  // 3. The client that the CLIENT user is pinned to.
  const existingClient = await clients.findOne({ code: CLIENT.code });
  const client =
    existingClient ??
    (await clients.create({
      name: CLIENT.name,
      code: CLIENT.code,
      contactInfo: { ...CLIENT.contactInfo },
      status: "ACTIVE",
    }));
  console.log(`client        ${client.name}  ${client._id.toHexString()}`);

  // 3b. The sites. One belongs to the client above, one to the organization.
  const locations = locationsRepository.forScope(bootstrapScope);

  for (const seed of LOCATIONS) {
    const existing = await locations.findOne({ name: seed.name });
    if (existing) {
      console.log(`location      ${seed.name.padEnd(28)} exists   ${existing._id.toHexString()}`);
      continue;
    }

    const created = await locations.create({
      name: seed.name,
      building: seed.building,
      // Null means org-wide. `clientId` is not patchable afterwards — a site's
      // customer is fixed at creation, so the seed is the only place it is set.
      clientId: seed.forClient ? client._id : null,
      address: { ...seed.address },
      status: "ACTIVE",
    });
    console.log(`location      ${seed.name.padEnd(28)} created  ${created._id.toHexString()}`);
  }

  // 3c. The assets. Written through the scoped repository like everything else,
  //     with `clientId` DERIVED from the site — exactly as `createAsset` does,
  //     so the seed cannot produce a row the application could not have.
  const assets = assetsRepository.forScope(bootstrapScope);

  for (const seed of ASSETS) {
    const existing = await assets.findOne({ name: seed.name });
    if (existing) {
      console.log(`asset         ${seed.name.padEnd(28)} exists   ${existing._id.toHexString()}`);
      continue;
    }

    // The site was created above; re-read rather than remembered, so this stays
    // idempotent on a re-run where the locations already existed.
    const site = await locations.findOne({ name: seed.site });
    if (!site) {
      console.warn(`asset         ${seed.name.padEnd(28)} SKIPPED  no site "${seed.site}"`);
      continue;
    }

    const created = await assets.create({
      name: seed.name,
      category: seed.category,
      type: seed.type,
      locationId: site._id,
      // Derived, never chosen: an asset belongs to whoever owns the site it
      // stands at. Null for the depot, which is why a CLIENT never sees those.
      clientId: site.clientId ?? null,
      status: seed.status,
      health: seed.health,
    });
    console.log(`asset         ${seed.name.padEnd(28)} created  ${created._id.toHexString()}`);
  }

  // 4. The users. One hash for all four: argon2 is deliberately slow, and four
  //    separate hashes would cost seconds for nothing.
  const passwordHash = await hashPassword(password);

  for (const seed of USERS) {
    const existing = await users.findOne({ email: seed.email });

    if (existing) {
      await users.update(existing._id, {
        name: seed.name,
        role: seed.role,
        status: "ACTIVE",
        passwordHash,
      });
      console.log(
        `user          ${seed.email.padEnd(17)} ${seed.role.padEnd(11)} updated  ${existing._id.toHexString()}`,
      );
      continue;
    }

    const created = await users.create({
      name: seed.name,
      email: seed.email,
      passwordHash,
      role: seed.role,
      // Required for CLIENT, rejected for everyone else — the model enforces it.
      clientId: seed.role === "CLIENT" ? client._id : null,
      // Seeded accounts can sign in immediately; one created through the app
      // starts INVITED instead.
      status: "ACTIVE",
    });
    console.log(
      `user          ${seed.email.padEnd(17)} ${seed.role.padEnd(11)} created  ${created._id.toHexString()}`,
    );
  }

  console.log(`\nAll four accounts share the password:  ${password}`);
  console.log("Sign in at http://localhost:3000/login\n");
}

main()
  .catch((error: unknown) => {
    console.error("\nSeed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
