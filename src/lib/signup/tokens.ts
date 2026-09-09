import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens.
 *
 * Pure functions over crypto primitives, in their own module so the invitation
 * rules can be tested without a database — and so there is exactly one place
 * that decides how long a token is and how long it lives.
 *
 * The shape of the scheme:
 *
 *   issue    -> 32 random bytes, hex. The RAW token goes to the administrator
 *               once and is never stored.
 *   store    -> SHA-256 of the raw token. A dump of the users collection
 *               therefore contains nothing anybody can redeem.
 *   redeem   -> hash what arrives, look up the digest, burn it.
 *
 * SHA-256 rather than argon2, which would be wrong here: argon2 is slow on
 * purpose to make a LOW-entropy secret expensive to guess. This secret is 32
 * bytes of CSPRNG output — there is no dictionary, no reuse across sites, and
 * 2^256 to search — so the slowness would buy nothing and cost a page load.
 */

/** 32 bytes. Long enough that guessing is not a threat model. */
const TOKEN_BYTES = 32;

/**
 * Seven days.
 *
 * Long enough for somebody on leave to come back to it, short enough that a
 * link forwarded into a group chat two months ago is dead. An invitation that
 * never expired would be a permanent password-reset link sitting in an inbox.
 */
export const INVITE_TTL_DAYS = 7;

export interface IssuedInvitation {
  /** Shown to the administrator once, then gone. Goes in the link. */
  readonly token: string;
  /** What the database stores. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export function issueInvitation(now: Date = new Date()): IssuedInvitation {
  const token = randomBytes(TOKEN_BYTES).toString("hex");

  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1_000),
  };
}

/** The digest a raw token is stored and looked up as. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Compare two digests without leaking where they diverge.
 *
 * Not strictly required — the lookup is an indexed equality match inside
 * MongoDB, which this cannot influence — but it is here for the places that
 * compare in application code, and because a `===` on a secret is the kind of
 * thing that gets copied into somewhere it does matter.
 */
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The path an invitation link points at, given a locale and a raw token. */
export function invitePath(locale: string, token: string): string {
  return `/${locale}/invite/${token}`;
}
