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
  clientsRepository,
  connectToDatabase,
  disconnectFromDatabase,
  ensureOrganization,
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
  contactEmail: "facilities@faisaliah.example",
};

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
      contactEmail: CLIENT.contactEmail,
      status: "ACTIVE",
    }));
  console.log(`client        ${client.name}  ${client._id.toHexString()}`);

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
