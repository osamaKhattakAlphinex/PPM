import { MongoMemoryServer } from "mongodb-memory-server";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetServerEnvCache } from "../../env";
import { connectToDatabase, disconnectFromDatabase } from "../connect";
import {
  clientBelongsToOrganization,
  completeInvitation,
  ensureOrganization,
  findIdentityById,
  findInvitedAccount,
  findOrganizationBySlug,
  findSignInCandidate,
  recordSuccessfulLogin,
  updatePasswordHash,
} from "../identity-store";
import { Client } from "../models/client";
import { Organization } from "../models/organization";
import { User } from "../models/user";
import { clientsRepository } from "../repositories/clients";
import { usersRepository } from "../repositories/users";
import { ScopeResolutionError } from "../scope";
import { hashInviteToken, issueInvitation } from "../../signup/tokens";
import { clearCollections } from "./helpers/memory-mongo";

/**
 * The identity collections against a real mongod.
 *
 * Two things are being proved, and they are the two that would be catastrophic
 * to get wrong: the tenant boundary holds for users and clients, and the one
 * module allowed to query them unscoped cannot be turned into a way around it.
 *
 * `connectToDatabase()` does the connecting rather than a bare
 * `mongoose.connect`, because the identity store calls it — so the test
 * exercises the same connection path the app uses.
 */

let server: MongoMemoryServer;

/** A plausible-looking digest. Real argon2 belongs in the password suite. */
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";

beforeAll(async () => {
  server = await MongoMemoryServer.create();

  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB_NAME = "ppm_identity_test";
  process.env.MONGODB_AUTO_INDEX = "true";
  // Required by the env schema since auth landed; the value is never used here.
  process.env.AUTH_SECRET ??= "x".repeat(32);
  resetServerEnvCache();

  await connectToDatabase();

  // The unique constraints are the point of two of these tests, and index
  // builds are asynchronous, so wait for them rather than racing them.
  await Promise.all([User.syncIndexes(), Client.syncIndexes(), Organization.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await disconnectFromDatabase();
  await server?.stop();
  resetServerEnvCache();
});

beforeEach(async () => {
  await clearCollections();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedTenant(slug: string) {
  const organization = await ensureOrganization({ name: `Org ${slug}`, slug });
  const organizationId = new Types.ObjectId(organization.id);

  const scope = { organizationId, role: "ADMIN" as const, userId: organizationId };

  const client = await clientsRepository
    .forScope(scope)
    .create({ name: `Client ${slug}`, code: `client-${slug}` });

  return { organization, organizationId, scope, client };
}

// ---------------------------------------------------------------------------

describe("the User model's role/clientId invariant", () => {
  it("refuses a CLIENT user with no client", async () => {
    const { scope } = await seedTenant("alpha");

    await expect(
      usersRepository.forScope(scope).create({
        name: "Nada",
        email: "nada@ppm.local",
        passwordHash: HASH,
        role: "CLIENT",
      }),
    ).rejects.toThrow(/must be attached to a client/i);
  });

  it("refuses a staff user that carries one", async () => {
    const { scope, client } = await seedTenant("alpha");

    await expect(
      usersRepository.forScope(scope).create({
        name: "Omar",
        email: "omar@ppm.local",
        passwordHash: HASH,
        role: "FM_MANAGER",
        clientId: client._id,
      }),
    ).rejects.toThrow(/only a CLIENT user/i);
  });

  it("accepts a CLIENT user with one", async () => {
    const { scope, client } = await seedTenant("alpha");

    const created = await usersRepository.forScope(scope).create({
      name: "Nada",
      email: "nada@ppm.local",
      passwordHash: HASH,
      role: "CLIENT",
      clientId: client._id,
    });

    expect(created.clientId?.toHexString()).toBe(client._id.toHexString());
  });
});

describe("email uniqueness", () => {
  it("is system-wide, not per organization", async () => {
    // Sign-in takes an email and nothing else, so the address has to identify
    // exactly one account across every tenant.
    const alpha = await seedTenant("alpha");
    const beta = await seedTenant("beta");

    await usersRepository
      .forScope(alpha.scope)
      .create({ name: "A", email: "shared@ppm.local", passwordHash: HASH, role: "TECHNICIAN" });

    await expect(
      usersRepository
        .forScope(beta.scope)
        .create({ name: "B", email: "shared@ppm.local", passwordHash: HASH, role: "TECHNICIAN" }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("releases the address when the account is soft-deleted", async () => {
    const { scope } = await seedTenant("alpha");
    const users = usersRepository.forScope(scope);

    const first = await users.create({
      name: "A",
      email: "reused@ppm.local",
      passwordHash: HASH,
      role: "TECHNICIAN",
    });
    await users.delete(first._id);

    // The unique index is partial on `deletedAt: null`, so a removed user does
    // not reserve their address forever.
    const second = await users.create({
      name: "B",
      email: "reused@ppm.local",
      passwordHash: HASH,
      role: "TECHNICIAN",
    });

    expect(second._id.toHexString()).not.toBe(first._id.toHexString());
  });
});

describe("tenant isolation for users", () => {
  it("hides another organization's user, even given its exact id", async () => {
    const alpha = await seedTenant("alpha");
    const beta = await seedTenant("beta");

    const theirs = await usersRepository
      .forScope(alpha.scope)
      .create({ name: "A", email: "a@ppm.local", passwordHash: HASH, role: "TECHNICIAN" });

    // An id from outside is a filter term, never a lookup key: organizationId
    // is still applied on top of it.
    expect(await usersRepository.forScope(beta.scope).findById(theirs._id)).toBeNull();
    expect(await usersRepository.forScope(beta.scope).count()).toBe(0);
    expect(await usersRepository.forScope(alpha.scope).count()).toBe(1);
  });

  it("ignores an organizationId supplied by the caller", async () => {
    const alpha = await seedTenant("alpha");
    const beta = await seedTenant("beta");

    const created = await usersRepository.forScope(alpha.scope).create({
      name: "A",
      email: "a@ppm.local",
      passwordHash: HASH,
      role: "TECHNICIAN",
      // Not part of the input type; a hand-built payload could still carry it.
      organizationId: beta.organizationId,
    } as never);

    expect(created.organizationId.toHexString()).toBe(alpha.organizationId.toHexString());
  });

  it("narrows a CLIENT session to its own client's users", async () => {
    const { scope, organizationId, client } = await seedTenant("alpha");
    const staff = usersRepository.forScope(scope);

    const otherClient = await clientsRepository
      .forScope(scope)
      .create({ name: "Other", code: "other" });

    const mine = await staff.create({
      name: "Nada",
      email: "nada@ppm.local",
      passwordHash: HASH,
      role: "CLIENT",
      clientId: client._id,
    });
    await staff.create({
      name: "Someone else",
      email: "other@ppm.local",
      passwordHash: HASH,
      role: "CLIENT",
      clientId: otherClient._id,
    });
    await staff.create({
      name: "Omar",
      email: "omar@ppm.local",
      passwordHash: HASH,
      role: "FM_MANAGER",
    });

    const asClient = usersRepository.forScope({
      organizationId,
      clientId: client._id,
      role: "CLIENT",
      userId: mine._id,
    });

    const visible = await asClient.find();
    expect(visible).toHaveLength(1);
    expect(visible[0]._id.toHexString()).toBe(mine._id.toHexString());
  });

  it("never returns the password hash through a repository", async () => {
    const { scope } = await seedTenant("alpha");

    const created = await usersRepository
      .forScope(scope)
      .create({ name: "A", email: "a@ppm.local", passwordHash: HASH, role: "TECHNICIAN" });

    const read = await usersRepository.forScope(scope).findById(created._id);

    expect(read).not.toBeNull();
    // `select: false` on the model: a forgotten projection cannot leak it.
    expect(read).not.toHaveProperty("passwordHash");
  });
});

describe("the clients repository", () => {
  it("refuses a CLIENT session rather than widening it to the organization", async () => {
    const { organizationId, client } = await seedTenant("alpha");

    // The collection has no clientId to narrow by, so serving a client user
    // would hand them every other customer of the organization. The refusal
    // lands when a query is built, not when the repository is created.
    const asClient = clientsRepository.forScope({
      organizationId,
      clientId: client._id,
      role: "CLIENT",
      userId: client._id,
    });

    await expect(asClient.find()).rejects.toBeInstanceOf(ScopeResolutionError);
    await expect(asClient.findById(client._id)).rejects.toBeInstanceOf(ScopeResolutionError);
    await expect(asClient.create({ name: "Sneaky", code: "sneaky" })).rejects.toBeInstanceOf(
      ScopeResolutionError,
    );
  });

  it("keeps a client code unique inside one organization but free across two", async () => {
    const alpha = await seedTenant("alpha");
    const beta = await seedTenant("beta");

    await expect(
      clientsRepository.forScope(alpha.scope).create({ name: "Dup", code: "client-alpha" }),
    ).rejects.toMatchObject({ code: 11000 });

    // Same code, different tenant: allowed.
    await expect(
      clientsRepository.forScope(beta.scope).create({ name: "Same code", code: "client-alpha" }),
    ).resolves.toMatchObject({ code: "client-alpha" });
  });
});

describe("findSignInCandidate", () => {
  it("finds the account and hands back the hash the verifier needs", async () => {
    const { scope, organizationId } = await seedTenant("alpha");
    await usersRepository.forScope(scope).create({
      name: "Layla",
      email: "layla@ppm.local",
      passwordHash: HASH,
      role: "ADMIN",
      status: "ACTIVE",
    });

    const candidate = await findSignInCandidate("layla@ppm.local");

    expect(candidate).not.toBeNull();
    expect(candidate?.passwordHash).toBe(HASH);
    expect(candidate?.role).toBe("ADMIN");
    expect(candidate?.organizationId).toBe(organizationId.toHexString());
    expect(candidate?.organizationStatus).toBe("ACTIVE");
  });

  it("normalises the address, so case and stray spaces still sign in", async () => {
    const { scope } = await seedTenant("alpha");
    await usersRepository
      .forScope(scope)
      .create({ name: "Layla", email: "layla@ppm.local", passwordHash: HASH, role: "ADMIN" });

    expect(await findSignInCandidate("  LAYLA@PPM.Local ")).not.toBeNull();
  });

  it("returns null for an operator object instead of matching the first user", async () => {
    const { scope } = await seedTenant("alpha");
    await usersRepository
      .forScope(scope)
      .create({ name: "Layla", email: "layla@ppm.local", passwordHash: HASH, role: "ADMIN" });

    // The classic NoSQL injection: `{"email": {"$gt": ""}}` would otherwise
    // return whichever user sorts first.
    expect(await findSignInCandidate({ $gt: "" })).toBeNull();
    expect(await findSignInCandidate({ $ne: null })).toBeNull();
    expect(await findSignInCandidate(null)).toBeNull();
    expect(await findSignInCandidate("not-an-email")).toBeNull();
  });

  it("does not find a soft-deleted account", async () => {
    const { scope } = await seedTenant("alpha");
    const users = usersRepository.forScope(scope);

    const user = await users.create({
      name: "Layla",
      email: "layla@ppm.local",
      passwordHash: HASH,
      role: "ADMIN",
    });
    await users.delete(user._id);

    expect(await findSignInCandidate("layla@ppm.local")).toBeNull();
  });

  it("returns a suspended account rather than hiding it", async () => {
    // The caller has to verify the password before it may act on status, or
    // failed sign-ins become a user-enumeration oracle.
    const { scope } = await seedTenant("alpha");
    await usersRepository.forScope(scope).create({
      name: "Layla",
      email: "layla@ppm.local",
      passwordHash: HASH,
      role: "ADMIN",
      status: "SUSPENDED",
    });

    expect((await findSignInCandidate("layla@ppm.local"))?.status).toBe("SUSPENDED");
  });

  it("reports a suspended organization, which locks out every one of its users", async () => {
    const { scope, organizationId } = await seedTenant("alpha");
    await usersRepository
      .forScope(scope)
      .create({ name: "Layla", email: "layla@ppm.local", passwordHash: HASH, role: "ADMIN" });

    await Organization.updateOne({ _id: organizationId }, { $set: { status: "SUSPENDED" } });

    expect((await findSignInCandidate("layla@ppm.local"))?.organizationStatus).toBe("SUSPENDED");
  });
});

describe("findIdentityById", () => {
  it("returns the session claims and never the hash", async () => {
    const { scope, client } = await seedTenant("alpha");
    const user = await usersRepository.forScope(scope).create({
      name: "Nada",
      email: "nada@ppm.local",
      passwordHash: HASH,
      role: "CLIENT",
      clientId: client._id,
    });

    const identity = await findIdentityById(user._id.toHexString());

    expect(identity).toMatchObject({
      role: "CLIENT",
      clientId: client._id.toHexString(),
      status: "INVITED",
    });
    expect(identity).not.toHaveProperty("passwordHash");
  });

  it("returns null for a malformed id rather than throwing a cast error", async () => {
    expect(await findIdentityById("not-an-id")).toBeNull();
    expect(await findIdentityById({ $gt: "" })).toBeNull();
    expect(await findIdentityById(new Types.ObjectId().toHexString())).toBeNull();
  });
});

describe("provisioning helpers", () => {
  it("ensureOrganization is idempotent on the slug", async () => {
    const first = await ensureOrganization({ name: "Gulf Facilities", slug: "gulf" });
    const second = await ensureOrganization({ name: "Different name", slug: "gulf" });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Gulf Facilities");
  });

  it("findOrganizationBySlug refuses a filter-shaped argument", async () => {
    await ensureOrganization({ name: "Gulf Facilities", slug: "gulf" });

    expect(await findOrganizationBySlug("gulf")).not.toBeNull();
    expect(await findOrganizationBySlug({ $ne: "" })).toBeNull();
    expect(await findOrganizationBySlug("")).toBeNull();
  });

  it("clientBelongsToOrganization is how a clientId from a form gets checked", async () => {
    const alpha = await seedTenant("alpha");
    const beta = await seedTenant("beta");

    expect(await clientBelongsToOrganization(alpha.client._id, alpha.organizationId)).toBe(true);
    // The whole point: a real client id, but not this tenant's.
    expect(await clientBelongsToOrganization(alpha.client._id, beta.organizationId)).toBe(false);
    expect(await clientBelongsToOrganization("not-an-id", alpha.organizationId)).toBe(false);
    expect(await clientBelongsToOrganization({ $gt: "" }, alpha.organizationId)).toBe(false);
  });
});

describe("sign-in bookkeeping", () => {
  it("stamps lastLoginAt and can replace the hash", async () => {
    const { scope } = await seedTenant("alpha");
    const user = await usersRepository
      .forScope(scope)
      .create({ name: "Layla", email: "layla@ppm.local", passwordHash: HASH, role: "ADMIN" });

    await recordSuccessfulLogin(user._id);
    await updatePasswordHash(user._id, `${HASH}-upgraded`);

    const after = await usersRepository.forScope(scope).findById(user._id);
    expect(after?.lastLoginAt).toBeInstanceOf(Date);

    const candidate = await findSignInCandidate("layla@ppm.local");
    expect(candidate?.passwordHash).toBe(`${HASH}-upgraded`);
  });

  it("ignores a malformed id instead of throwing", async () => {
    await expect(recordSuccessfulLogin("not-an-id")).resolves.toBeUndefined();
    await expect(updatePasswordHash("not-an-id", HASH)).resolves.toBeUndefined();
  });
});

/**
 * Redeeming an invitation, against a real mongod.
 *
 * This is the one flow in the product that writes a password without a
 * session, so it gets an end-to-end test rather than a schema one: issue,
 * look up by digest, complete, sign in with what was just set.
 *
 * The expiry case is the regression. `completeInvitation` compares
 * `inviteExpiresAt` with `$gt`, and `sanitizeFilter` is on process-wide — so
 * an unmarked operator is rewritten into an `$eq` on the literal object and
 * the update throws a CastError against a Date path before it reaches
 * MongoDB. Every invited user was left INVITED with no password, which is
 * invisible in a mocked test and total in a real one.
 */
describe("redeeming an invitation", () => {
  async function invite(status: "INVITED" | "SUSPENDED" = "INVITED") {
    const { scope } = await seedTenant("alpha");
    const user = await usersRepository
      .forScope(scope)
      .create({ name: "Sami", email: "sami@ppm.local", passwordHash: HASH, role: "TECHNICIAN", status });

    const invitation = issueInvitation();
    await usersRepository.forScope(scope).update(user._id, {
      inviteTokenHash: invitation.tokenHash,
      inviteExpiresAt: invitation.expiresAt,
    });

    return { scope, user, invitation };
  }

  it("sets the password, activates the account, and burns the token", async () => {
    const { invitation } = await invite();

    expect(await findInvitedAccount(invitation.tokenHash)).toMatchObject({
      name: "Sami",
      email: "sami@ppm.local",
    });

    expect(await completeInvitation(invitation.tokenHash, `${HASH}-chosen`)).toBe(true);

    const candidate = await findSignInCandidate("sami@ppm.local");
    expect(candidate?.status).toBe("ACTIVE");
    expect(candidate?.passwordHash).toBe(`${HASH}-chosen`);

    // The token is gone, so the link cannot set a password a second time.
    expect(await findInvitedAccount(invitation.tokenHash)).toBeNull();
    expect(await completeInvitation(invitation.tokenHash, `${HASH}-again`)).toBe(false);
  });

  it("refuses an expired invitation without throwing", async () => {
    const { scope, user, invitation } = await invite();
    await usersRepository
      .forScope(scope)
      .update(user._id, { inviteExpiresAt: new Date(Date.now() - 1_000) });

    expect(await completeInvitation(invitation.tokenHash, `${HASH}-chosen`)).toBe(false);
    expect(await findInvitedAccount(invitation.tokenHash)).toBeNull();

    // Still unusable, rather than half-redeemed.
    const candidate = await findSignInCandidate("sami@ppm.local");
    expect(candidate?.status).toBe("INVITED");
    expect(candidate?.passwordHash).toBe(HASH);
  });

  it("hides a suspended account behind the same null as an unknown token", async () => {
    const { invitation } = await invite("SUSPENDED");
    expect(await findInvitedAccount(invitation.tokenHash)).toBeNull();
  });

  it("returns nothing for a token of the wrong shape or an unknown one", async () => {
    await invite();

    expect(await findInvitedAccount("not-a-digest")).toBeNull();
    expect(await findInvitedAccount(hashInviteToken("never issued"))).toBeNull();
    expect(await completeInvitation("not-a-digest", HASH)).toBe(false);
  });
});
