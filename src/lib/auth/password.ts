import { randomBytes } from "node:crypto";

import { hash, verify, type Options } from "@node-rs/argon2";

/**
 * Password hashing.
 *
 * argon2id via `@node-rs/argon2` — a prebuilt native binding, so there is no
 * compiler in the install path and no pure-JS fallback silently doing 100x
 * fewer rounds. This module is Node-only (native addon): it must never be
 * imported by middleware or any Edge-runtime code, which is why the Auth.js
 * config is split in two and only `auth.ts` reaches it.
 */

/**
 * `Algorithm.Argon2id` spelled as its numeric value: `Algorithm` is an ambient
 * `const enum`, which this project's `isolatedModules` setting forbids
 * importing as a value.
 */
const ARGON2ID = 2 as NonNullable<Options["algorithm"]>;

/**
 * OWASP's recommended argon2id baseline: 19 MiB of memory, 2 passes, 1 lane.
 * Memory is the parameter that costs an attacker's GPU the most, so it is
 * raised before iterations.
 *
 * The parameters are encoded into every digest, so raising them later does not
 * invalidate existing hashes — old passwords keep verifying with the settings
 * they were created under, and get re-hashed on the owner's next sign-in.
 */
const HASH_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

/** Cheap sanity check that a stored value is an argon2 digest, not a password. */
const ARGON2_PREFIX = /^\$argon2(id|i|d)\$/;

export function isPasswordHash(value: string): boolean {
  return ARGON2_PREFIX.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

/**
 * A digest of random bytes, computed once per process.
 *
 * Verifying against it costs the same as verifying a real one, which is what
 * makes "no such user" and "wrong password" take the same amount of time. A
 * cheaper early return would turn the login form into a user-enumeration
 * oracle: an attacker could time responses to learn which addresses have
 * accounts.
 */
let decoyHash: Promise<string> | undefined;

function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString("hex"));
  return decoyHash;
}

/**
 * Verify a password against a stored digest.
 *
 * Pass `null` when the account does not exist: the work is still done against
 * the decoy and the answer is still `false`, so both paths cost the same.
 * Always returns a boolean — a malformed digest is a failed login, never a
 * thrown error that would separate the two cases again.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  const digest = storedHash ?? (await getDecoyHash());

  try {
    const matches = await verify(digest, password);
    // The decoy can only ever match by astronomical coincidence, but the answer
    // for a non-existent account is a flat no either way.
    return storedHash ? matches : false;
  } catch (error) {
    console.error("[auth] password verification failed", error);
    return false;
  }
}

/**
 * True when a digest was made with weaker parameters than the current baseline
 * and should be replaced. Call after a successful sign-in; re-hashing needs the
 * plaintext, which only exists at that moment.
 */
export function needsRehash(storedHash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
  if (!match) return true;

  const [, memory, time, lanes] = match;
  return (
    Number(memory) < Number(HASH_OPTIONS.memoryCost) ||
    Number(time) < Number(HASH_OPTIONS.timeCost) ||
    Number(lanes) !== Number(HASH_OPTIONS.parallelism)
  );
}
