import { RateLimitError } from "./errors";

/**
 * Rate limiting for the endpoints that are worth attacking.
 *
 * A sliding window kept in process memory. That is deliberate for now and has
 * one honest limitation: the counters are per instance, so N serverless
 * instances allow roughly N times the configured limit, and a cold start
 * forgets everything. It raises the cost of a brute-force run by orders of
 * magnitude without adding a dependency, and the interface is the one a shared
 * store would implement — swapping in Redis means reimplementing `consume`,
 * not touching a single caller.
 *
 * No `node:*` imports: this has to run in the Edge runtime too.
 */

export interface RateLimitRule {
  /** Label used in log lines and in the key namespace. */
  readonly name: string;
  /** Attempts allowed inside the window. */
  readonly limit: number;
  readonly windowMs: number;
  /**
   * How long the key stays locked once the limit is hit. Longer than the
   * window, so a burst costs the attacker a real pause rather than letting
   * them trickle at exactly the limit forever.
   */
  readonly blockMs?: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Attempts left in the current window. Zero once blocked. */
  readonly remaining: number;
  /** Seconds until the next attempt is allowed. Zero when it already is. */
  readonly retryAfterSeconds: number;
}

interface Bucket {
  /** Timestamps of the attempts still inside the window. */
  hits: number[];
  /** Epoch ms until which every attempt is refused, or 0. */
  blockedUntil: number;
}

/**
 * A hard ceiling on tracked keys, so a flood of unique IPs cannot turn the
 * limiter itself into the memory-exhaustion vector. When it is reached the
 * oldest entries go first; a legitimate user losing their counter costs them
 * nothing, an attacker gains at most a few extra attempts.
 */
const MAX_TRACKED_KEYS = 10_000;

/** Survives the module re-evaluation that `next dev` does on every save. */
declare global {
  var __ppmRateLimitBuckets: Map<string, Bucket> | undefined;
}

const buckets: Map<string, Bucket> = globalThis.__ppmRateLimitBuckets ?? new Map();
globalThis.__ppmRateLimitBuckets = buckets;

function sweep(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    const stale =
      bucket.blockedUntil < now &&
      (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > windowMs);
    if (stale) buckets.delete(key);
    if (buckets.size <= MAX_TRACKED_KEYS) break;
  }

  // Still over the ceiling after dropping the stale ones: evict in insertion
  // order, which is the closest thing a Map gives us to "least recently added".
  while (buckets.size > MAX_TRACKED_KEYS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

export interface RateLimiter {
  /** The rule this limiter enforces — read by `enforceRateLimit` for its log. */
  readonly rule: RateLimitRule;
  /** Records an attempt and says whether it is allowed. */
  consume(key: string): RateLimitDecision;
  /** Reads the current state without recording an attempt. */
  peek(key: string): RateLimitDecision;
  /** Clears a key — call it after a SUCCESSFUL login so honest users reset. */
  reset(key: string): void;
}

export function createRateLimiter(rule: RateLimitRule): RateLimiter {
  const blockMs = rule.blockMs ?? rule.windowMs;

  const namespaced = (key: string): string => `${rule.name}:${key}`;

  const decide = (key: string, record: boolean): RateLimitDecision => {
    const now = Date.now();
    const mapKey = namespaced(key);
    const bucket = buckets.get(mapKey) ?? { hits: [], blockedUntil: 0 };

    if (bucket.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1_000),
      };
    }

    // Drop the attempts that have aged out of the window.
    bucket.hits = bucket.hits.filter((at) => now - at < rule.windowMs);

    if (bucket.hits.length >= rule.limit) {
      bucket.blockedUntil = now + blockMs;
      bucket.hits = [];
      buckets.set(mapKey, bucket);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(blockMs / 1_000) };
    }

    if (record) {
      bucket.hits.push(now);
      buckets.set(mapKey, bucket);
      if (buckets.size > MAX_TRACKED_KEYS) sweep(now, rule.windowMs);
    }

    return {
      allowed: true,
      remaining: Math.max(0, rule.limit - bucket.hits.length),
      retryAfterSeconds: 0,
    };
  };

  return {
    rule,
    consume: (key) => decide(key, true),
    peek: (key) => decide(key, false),
    reset: (key) => {
      buckets.delete(namespaced(key));
    },
  };
}

/** Test-only: drop every counter in the process. */
export function resetAllRateLimits(): void {
  buckets.clear();
}

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is only as trustworthy as the proxy in front of the app: a
 * client can send the header itself, so on a deployment with no proxy this
 * degrades to an attacker-chosen key. That is why it is never the ONLY axis a
 * sensitive endpoint is limited on — see `loginByEmailRateLimiter`, and see
 * `mutationRateLimiter`, which is keyed by session user id first.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // Leftmost entry is the original client; the rest are proxy hops.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim().slice(0, 64);

  return "unknown";
}

// --- Presets ----------------------------------------------------------------

/**
 * The default ceiling on writes from one authenticated session.
 *
 * Not an anti-brute-force measure — the caller is already signed in. It caps
 * what a stolen session or a runaway client loop can do in one burst, and it
 * is the limiter `defineAction()` applies unless an action names a tighter
 * one. 120/min is far above a human clicking Save and far below a script.
 */
export const mutationRateLimiter = createRateLimiter({
  name: "mutation",
  limit: 120,
  windowMs: 60 * 1_000,
  blockMs: 60 * 1_000,
});

/**
 * For the small number of writes that are expensive or externally visible —
 * generating a PDF invoice, emailing a client, calling the AI endpoint.
 * Actions opt into this explicitly.
 */
export const sensitiveMutationRateLimiter = createRateLimiter({
  name: "mutation:sensitive",
  limit: 10,
  windowMs: 60 * 1_000,
  blockMs: 5 * 60 * 1_000,
});

/**
 * Consume one token or throw.
 *
 * Throwing rather than returning is what makes this composable with the single
 * error handler: a `RateLimitError` carries its own 429 and `Retry-After`, so
 * no caller has to remember either. The key is never logged in full — it can
 * contain an IP — only the limiter name and the wait.
 */
export function enforceRateLimit(limiter: RateLimiter, key: string): void {
  const decision = limiter.consume(key);
  if (decision.allowed) return;

  throw new RateLimitError(
    decision.retryAfterSeconds,
    `${limiter.rule.name} limit of ${limiter.rule.limit}/${Math.round(limiter.rule.windowMs / 1_000)}s exceeded`,
  );
}

/**
 * Advisory headers for a Route Handler that wants to tell an honest client how
 * much room it has left. Never required — the 429 is the enforcement.
 */
export function rateLimitHeaders(limiter: RateLimiter, decision: RateLimitDecision): HeadersInit {
  return {
    "RateLimit-Limit": String(limiter.rule.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(decision.retryAfterSeconds),
  };
}
