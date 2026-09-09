import type { Types } from "mongoose";
import { z } from "zod";

import type { Role } from "../auth/roles";
import { connectToDatabase } from "./connect";
import { Client } from "./models/client";
import { Organization, type OrganizationInput } from "./models/organization";
import { User, type UserStatus } from "./models/user";
import { toObjectId } from "./object-id";

/**
 * The identity store: the ONE module allowed to read these collections without
 * a tenant scope.
 *
 * Everything else in the app goes through `createRepository()`, which injects
 * organizationId into every query. Authentication cannot: at sign-in there is
 * no session yet, so there is no organizationId to inject — resolving the
 * tenant IS the job. The same applies to provisioning an organization, which
 * happens before anyone belongs to it.
 *
 * That exemption is kept honest by three rules, and by living inside
 * `src/lib/db/**` where the DAL-boundary lint rule can see it:
 *
 *  1. Every function here is a fixed, code-authored query shape. A caller
 *     supplies a value, never a filter.
 *  2. Every value is re-validated here (email through zod, ids through
 *     `toObjectId`) even though callers validate too. A malformed value
 *     returns null instead of reaching MongoDB.
 *  3. Only the fields authentication needs are projected, and `passwordHash`
 *     leaves this module only inside `SignInCandidate`, which the auth layer
 *     consumes and drops.
 *
 * Anything that is not authentication or provisioning belongs in a repository.
 */

/**
 * Normalised exactly as the model stores it, so the lookup is an exact match.
 * Trimmed and lowercased BEFORE the format check — a `.trim()` appended after
 * `z.email()` would validate the raw string and normalise the survivor.
 *
 * Declared here rather than imported from `src/lib/auth/schemas.ts` to keep the
 * dependency arrow pointing one way: auth may depend on db, never the reverse.
 */
const emailLookupSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export type OrganizationStatus = "ACTIVE" | "SUSPENDED";

export interface SignInCandidate {
  id: string;
  email: string;
  name: string;
  /** argon2id digest. Consumed by `verifyPassword` and never stored elsewhere. */
  passwordHash: string;
  role: Role;
  organizationId: string;
  clientId: string | null;
  status: UserStatus;
  /** A suspended tenant locks out every one of its users at once. */
  organizationStatus: OrganizationStatus;
}

/** The session-relevant view of a user. Never carries the password hash. */
export interface IdentitySnapshot {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
  clientId: string | null;
  status: UserStatus;
  organizationStatus: OrganizationStatus;
}

interface UserRow {
  _id: Types.ObjectId;
  email: string;
  name: string;
  passwordHash?: string;
  role: Role;
  organizationId: Types.ObjectId;
  clientId?: Types.ObjectId | null;
  status: UserStatus;
}

interface OrganizationRow {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  status: OrganizationStatus;
}

async function organizationStatusOf(
  organizationId: Types.ObjectId,
): Promise<OrganizationStatus | null> {
  const organization = await Organization.findOne({ _id: organizationId }, { status: 1 })
    .lean<{ status: OrganizationStatus } | null>()
    .exec();
  return organization?.status ?? null;
}

/**
 * Look up a sign-in candidate by email.
 *
 * Returns the row whatever its status: the caller must still verify the
 * password before it acts on `status`, otherwise a failed login would take a
 * different amount of time for a suspended account than for one that does not
 * exist — a free user-enumeration oracle.
 */
export async function findSignInCandidate(email: unknown): Promise<SignInCandidate | null> {
  const parsed = emailLookupSchema.safeParse(email);
  if (!parsed.success) return null;

  await connectToDatabase();

  const user = await User.findOne(
    { email: parsed.data },
    { email: 1, name: 1, role: 1, organizationId: 1, clientId: 1, status: 1 },
  )
    // Explicitly re-included: the schema marks it `select: false`, so it stays
    // out of every other query in the app.
    .select("+passwordHash")
    .lean<UserRow | null>()
    .exec();

  if (!user?.passwordHash) return null;

  const organizationStatus = await organizationStatusOf(user.organizationId);
  if (!organizationStatus) return null;

  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    passwordHash: user.passwordHash,
    role: user.role,
    organizationId: user.organizationId.toHexString(),
    clientId: user.clientId?.toHexString() ?? null,
    status: user.status,
    organizationStatus,
  };
}

/**
 * Re-read the identity behind a live session.
 *
 * This is what stops a role change, a suspension or a deletion from taking
 * effect only at the next sign-in: the JWT callback calls it periodically and
 * drops the session when the answer no longer matches the token.
 */
export async function findIdentityById(userId: unknown): Promise<IdentitySnapshot | null> {
  const _id = toObjectId(userId);
  if (!_id) return null;

  await connectToDatabase();

  const user = await User.findOne(
    { _id },
    { email: 1, name: 1, role: 1, organizationId: 1, clientId: 1, status: 1 },
  )
    .lean<UserRow | null>()
    .exec();

  if (!user) return null;

  const organizationStatus = await organizationStatusOf(user.organizationId);
  if (!organizationStatus) return null;

  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId.toHexString(),
    clientId: user.clientId?.toHexString() ?? null,
    status: user.status,
    organizationStatus,
  };
}

/** Stamp a successful sign-in. Best-effort: it never fails the login. */
export async function recordSuccessfulLogin(userId: unknown): Promise<void> {
  const _id = toObjectId(userId);
  if (!_id) return;

  try {
    await connectToDatabase();
    await User.updateOne({ _id }, { $set: { lastLoginAt: new Date() } }).exec();
  } catch (error) {
    // A failed bookkeeping write must not cost the user their session.
    console.error("[identity] failed to record login", error);
  }
}

/**
 * Replace a stored digest with a stronger one.
 *
 * Called right after a successful sign-in, when the plaintext is briefly
 * available and the argon2 parameters have since been raised. Unscoped like the
 * rest of this module because it happens inside the sign-in flow, before a
 * session (and therefore a scope) exists; the id comes from the row that was
 * just authenticated, never from a caller.
 */
export async function updatePasswordHash(userId: unknown, passwordHash: string): Promise<void> {
  const _id = toObjectId(userId);
  if (!_id || !passwordHash) return;

  try {
    await connectToDatabase();
    await User.updateOne({ _id }, { $set: { passwordHash } }).exec();
  } catch (error) {
    console.error("[identity] failed to upgrade password hash", error);
  }
}

// ---------------------------------------------------------------------------
// Provisioning — runs before there is an organization to be scoped to
// ---------------------------------------------------------------------------

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
}

function toOrganizationRecord(row: OrganizationRow): OrganizationRecord {
  return { id: row._id.toHexString(), name: row.name, slug: row.slug, status: row.status };
}

export async function findOrganizationBySlug(slug: unknown): Promise<OrganizationRecord | null> {
  const parsed = z.string().min(2).max(64).safeParse(slug);
  if (!parsed.success) return null;

  await connectToDatabase();

  const organization = await Organization.findOne(
    { slug: parsed.data.toLowerCase() },
    { name: 1, slug: 1, status: 1 },
  )
    .lean<OrganizationRow | null>()
    .exec();

  return organization ? toOrganizationRecord(organization) : null;
}

/**
 * Create the organization if its slug is free, otherwise return the existing
 * one. Idempotent, so the seed can be re-run; provisioning a real tenant should
 * check `findOrganizationBySlug` first and report the conflict instead.
 */
export async function ensureOrganization(input: OrganizationInput): Promise<OrganizationRecord> {
  await connectToDatabase();

  const existing = await findOrganizationBySlug(input.slug);
  if (existing) return existing;

  const document = new Organization(input);
  await document.save();

  return toOrganizationRecord(document.toObject() as OrganizationRow);
}

/**
 * Prove that a client belongs to an organization.
 *
 * Used when provisioning a CLIENT user: a clientId that arrived in a request is
 * never trusted to live inside the caller's tenant, so it is checked against
 * the organization from the session before it is written to the user.
 */
export async function clientBelongsToOrganization(
  clientId: unknown,
  organizationId: unknown,
): Promise<boolean> {
  const client = toObjectId(clientId);
  const organization = toObjectId(organizationId);
  if (!client || !organization) return false;

  await connectToDatabase();

  const found = await Client.findOne(
    { _id: client, organizationId: organization, status: "ACTIVE" },
    { _id: 1 },
  )
    .lean<{ _id: Types.ObjectId } | null>()
    .exec();

  return found !== null;
}

/**
 * Every ACTIVE organisation's id.
 *
 * The one read in this file that is not about signing somebody in, and it is
 * here rather than in a repository for the reason this module exists at all:
 * there is no tenant scope to run it under. A scheduled job has no session, so
 * it cannot obtain a `TenantScope`, and the DAL correctly refuses to build one
 * from nothing.
 *
 * What keeps that safe is the shape of what it returns — a list of IDS, and
 * nothing else. The job then builds a scope PER ORGANISATION and does every
 * subsequent read through the ordinary scoped repositories, so the unscoped
 * surface is exactly one query returning exactly one field, and the isolation
 * guarantee holds for everything that follows it.
 *
 * SUSPENDED tenants are excluded: a suspended organisation's users cannot sign
 * in, so notifying them would be writing rows nobody can ever read.
 *
 * The cap is a real limit rather than a rounding. Past it the job would need to
 * page and checkpoint, which is a different piece of work; failing visibly at a
 * thousand tenants is better than a job that silently processes the first
 * thousand of two thousand.
 */
export const MAX_ORGANIZATIONS_PER_JOB = 1_000;

export async function listActiveOrganizationIds(): Promise<Types.ObjectId[]> {
  const rows = await Organization.find({ status: "ACTIVE" }, { _id: 1 })
    .limit(MAX_ORGANIZATIONS_PER_JOB)
    .lean<{ _id: Types.ObjectId }[]>()
    .exec();

  return rows.map((row) => row._id);
}
