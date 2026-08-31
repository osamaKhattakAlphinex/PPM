import { Types } from "mongoose";

/**
 * Strict ObjectId coercion.
 *
 * `Types.ObjectId.isValid()` is deliberately NOT used: it accepts any
 * 12-character string and any number, so `isValid("secretpass!")` is true and
 * the resulting id is attacker-chosen bytes. We accept an ObjectId instance or
 * a 24-character hex string, and nothing else.
 *
 * Returns null rather than throwing, so a bad id from a URL segment becomes a
 * 404 (no document matched) instead of a 500 with a Mongo CastError in it.
 */
const HEX_24 = /^[0-9a-fA-F]{24}$/;

export type ObjectIdLike = Types.ObjectId | string;

export function toObjectId(value: unknown): Types.ObjectId | null {
  if (value instanceof Types.ObjectId) return value;
  if (typeof value === "string" && HEX_24.test(value)) return new Types.ObjectId(value);
  return null;
}

/** Same rule, for places where an invalid id is a programming error. */
export function requireObjectId(value: unknown, label = "id"): Types.ObjectId {
  const id = toObjectId(value);
  if (!id) throw new TypeError(`Invalid ${label}: expected a 24-character object id.`);
  return id;
}
