/**
 * NoSQL-injection defences for anything that comes from outside the server.
 *
 * The attack this exists to stop: a JSON body of `{"email": {"$gt": ""}}` fed
 * into `User.findOne({ email: body.email })` turns an equality check into a
 * "first document whose email is greater than empty string" query, which
 * matches the first user in the collection.
 *
 * Two complementary tools, for two different kinds of object:
 *
 *  - {@link sanitize} — for UNTRUSTED data (request bodies, query strings,
 *    webhook payloads). Removes every key that could be read as an operator.
 *    Untrusted input is never allowed to contribute an operator at all.
 *
 *  - {@link assertNoDangerousOperators} — for TRUSTED, code-authored query
 *    fragments where operators are legitimate (`$in`, `$gte`, ...). Rejects
 *    only the operators that execute server-side JavaScript or write to other
 *    collections, which must never appear even in our own code.
 *
 * Neither replaces zod validation — they are the layer beneath it, so that a
 * schema gap can never become a query-shape bug.
 */

/** Keys that let an attacker reach `Object.prototype` through a merge. */
const PROTOTYPE_POLLUTION_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Operators that execute JavaScript on the server or write outside the current
 * query. These must never appear in a filter, projection, or pipeline, whoever
 * authored it.
 *
 * Note: `$lookup` is deliberately absent — it is legitimate in code we write,
 * but it crosses collections, so the tenant-scoped data-access layer is
 * responsible for proving any lookup stays inside the caller's organization.
 */
export const DANGEROUS_OPERATORS: ReadonlySet<string> = new Set([
  "$where", // runs arbitrary JS in the server's query engine
  "$function", // aggregation equivalent of $where
  "$accumulator", // custom JS accumulator
  "$eval", // legacy server-side eval
  "$expr", // can reference sibling fields and sidestep an equality check
  "mapReduce", // a command rather than an operator, same JS-execution risk
  "$out", // aggregation stage that overwrites a collection
  "$merge", // aggregation stage that writes into a collection
]);

/** Payload nesting beyond this is treated as hostile rather than walked. */
const DEFAULT_MAX_DEPTH = 32;

/** Raised when input is structurally unsafe. Never carries a user value. */
export class UnsafeQueryError extends Error {
  readonly code = "UNSAFE_QUERY";

  constructor(message: string) {
    super(message);
    this.name = "UnsafeQueryError";
  }
}

export interface SanitizeOptions {
  /** Maximum object nesting to walk before rejecting the payload. */
  maxDepth?: number;
}

/**
 * True when a key must never survive into a query built from untrusted input:
 * operator-prefixed (`$`), dotted (reaches into a nested path), or a
 * prototype-pollution vector.
 */
export function isUnsafeKey(key: string): boolean {
  return key.startsWith("$") || key.includes(".") || PROTOTYPE_POLLUTION_KEYS.has(key);
}

/**
 * Only walk into things a JSON body can actually produce. Dates, ObjectIds,
 * Buffers, RegExps, and class instances are values, not operator carriers, and
 * are passed through untouched — copying them would corrupt them.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertDepth(depth: number, maxDepth: number): void {
  if (depth > maxDepth) {
    throw new UnsafeQueryError(`Input nested deeper than ${maxDepth} levels; rejected.`);
  }
}

function sanitizeValue(
  value: unknown,
  maxDepth: number,
  depth: number,
  seen: WeakMap<object, unknown>,
): unknown {
  if (Array.isArray(value)) {
    assertDepth(depth, maxDepth);
    const existing = seen.get(value);
    if (existing !== undefined) return existing;

    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) {
      result.push(sanitizeValue(item, maxDepth, depth + 1, seen));
    }
    return result;
  }

  if (isPlainObject(value)) {
    assertDepth(depth, maxDepth);
    const existing = seen.get(value);
    if (existing !== undefined) return existing;

    const result: Record<string, unknown> = {};
    seen.set(value, result);
    // Own property names only, so an inherited accessor is never invoked.
    for (const key of Object.getOwnPropertyNames(value)) {
      if (isUnsafeKey(key)) continue;
      result[key] = sanitizeValue(value[key], maxDepth, depth + 1, seen);
    }
    return result;
  }

  return value;
}

/**
 * Deep-copy `value`, dropping every unsafe key at every level.
 *
 * `{ email: { $gt: "" } }` becomes `{ email: {} }` — an equality match against
 * an empty object, which matches no document. The query fails closed.
 *
 * The input is never mutated; the caller gets a fresh structure.
 */
export function sanitize<T>(value: T, options: SanitizeOptions = {}): T {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  // Sanitizing only ever removes keys, so the result stays assignable to T.
  return sanitizeValue(value, maxDepth, 0, new WeakMap()) as T;
}

/**
 * Dotted paths of every key {@link sanitize} would strip. Use it to log a
 * probable attack server-side while the caller still gets a generic error.
 */
export function findUnsafeKeys(value: unknown, options: SanitizeOptions = {}): string[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const found: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string, depth: number): void => {
    if (Array.isArray(node)) {
      assertDepth(depth, maxDepth);
      if (seen.has(node)) return;
      seen.add(node);
      node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }

    if (isPlainObject(node)) {
      assertDepth(depth, maxDepth);
      if (seen.has(node)) return;
      seen.add(node);
      for (const key of Object.getOwnPropertyNames(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isUnsafeKey(key)) {
          found.push(childPath);
          continue;
        }
        walk(node[key], childPath, depth + 1);
      }
    }
  };

  walk(value, "", 0);
  return found;
}

/** Reject rather than strip. For endpoints that should never see an operator. */
export function assertNoUnsafeKeys(value: unknown, options: SanitizeOptions = {}): void {
  const unsafe = findUnsafeKeys(value, options);
  if (unsafe.length > 0) {
    throw new UnsafeQueryError(`Disallowed keys in input: ${unsafe.join(", ")}`);
  }
}

/**
 * Guard for query fragments we build ourselves, where operators are allowed but
 * server-side JavaScript and cross-collection writes are not.
 *
 * Checks keys *and* string values, because an aggregation stage can name an
 * operator in a value position.
 */
export function assertNoDangerousOperators(value: unknown, options: SanitizeOptions = {}): void {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const seen = new WeakSet<object>();

  const walk = (node: unknown, depth: number): void => {
    if (typeof node === "string") {
      if (DANGEROUS_OPERATORS.has(node)) {
        throw new UnsafeQueryError(`Disallowed operator in query: ${node}`);
      }
      return;
    }

    if (Array.isArray(node)) {
      assertDepth(depth, maxDepth);
      if (seen.has(node)) return;
      seen.add(node);
      for (const item of node) walk(item, depth + 1);
      return;
    }

    if (isPlainObject(node)) {
      assertDepth(depth, maxDepth);
      if (seen.has(node)) return;
      seen.add(node);
      for (const key of Object.getOwnPropertyNames(node)) {
        if (DANGEROUS_OPERATORS.has(key)) {
          throw new UnsafeQueryError(`Disallowed operator in query: ${key}`);
        }
        walk(node[key], depth + 1);
      }
    }
  };

  walk(value, 0);
}
