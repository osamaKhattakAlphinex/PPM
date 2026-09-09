import { z } from "zod";

/**
 * Server-only environment. Parsed lazily and memoised so that importing a
 * module that *might* touch the database never crashes a build where the
 * variables are legitimately absent (e.g. `next build` in CI).
 *
 * Nothing here may be imported from a Client Component: these values include
 * credentials and must never be serialised into the RSC payload.
 */
const serverEnvSchema = z.object({
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((value) => /^mongodb(\+srv)?:\/\//.test(value), {
      message: "must start with mongodb:// or mongodb+srv://",
    }),
  MONGODB_DB_NAME: z.string().min(1).max(63),

  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(100).default(0),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .default(8_000),
  MONGODB_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(45_000),
  MONGODB_AUTO_INDEX: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  // --- Auth.js -------------------------------------------------------------
  // Signs and encrypts the session cookie. A rotation invalidates every live
  // session, which is the intended behaviour for a leaked secret.
  AUTH_SECRET: z
    .string()
    .min(
      32,
      "must be at least 32 characters (generate with `openssl rand -base64 32`)",
    ),

  // AUTH_SESSION_MAX_AGE and AUTH_SESSION_REVALIDATE_AFTER are deliberately
  // absent: they are read in `src/lib/auth/config.ts`, which the Edge-runtime
  // middleware imports and which therefore cannot import this module (parsing
  // it would demand MONGODB_URI on the Edge, where nothing connects).

  // --- AI insights ---------------------------------------------------------
  /**
   * The Anthropic API key. SERVER-ONLY, and this module is the only thing that
   * reads it — `src/lib/env.ts` is never imported from a Client Component, and
   * the key is never placed on a `NEXT_PUBLIC_` variable, so there is no path
   * by which it can reach a browser bundle.
   *
   * OPTIONAL, deliberately. The AI module is one feature of eleven, and a
   * deployment that has not bought an Anthropic key must still boot, sign
   * people in and run maintenance. The route answers a clear "not configured"
   * instead, and `hasAiKey()` below is what the UI asks before offering the
   * screen at all.
   */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /**
   * Which model the insight route calls. Overridable per environment so a
   * staging deploy can point at a cheaper model without a code change, and
   * bounded to a plausible id shape so a typo fails at boot rather than as a
   * 404 from the API on somebody's first click.
   */
  ANTHROPIC_MODEL: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9.-]*$/, "must be a model id, e.g. claude-opus-5")
    .default("claude-opus-5"),

  // --- Scheduled jobs ------------------------------------------------------
  /**
   * The shared secret a scheduler sends to `/api/jobs/*`.
   *
   * OPTIONAL in the schema and REQUIRED by the route: a deployment that has not
   * configured it gets a 503 from the job rather than an open endpoint. Treating
   * "no secret configured" as "no authentication required" is how an internal
   * job URL ends up on the public internet.
   *
   * Long enough that a brute force is not worth attempting; the route compares
   * it in constant time regardless.
   */
  CRON_SECRET: z.string().min(24).optional(),

  // --- File storage --------------------------------------------------------
  /**
   * Where uploads live when no bucket is configured: a directory on the host.
   *
   * The DEVELOPMENT default, and the reason it has one is that the alternative
   * is nobody being able to exercise the upload path without an S3 account.
   * It is not a production store — a serverless host has no durable disk and a
   * multi-instance host has a different one per instance — which is why the
   * pre-launch checklist in `docs/DEPLOYMENT.md` names it.
   */
  UPLOAD_DIR: z.string().min(1).default(".uploads"),

  /**
   * S3-compatible object storage. Present together or not at all.
   *
   * `getStorage()` chooses the driver by whether these are set, so there is no
   * flag to forget: either the bucket and its credentials are configured and
   * uploads go to it, or they are not and uploads go to disk.
   */
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).default("me-south-1"),
  /** For R2, MinIO and anything else that is not AWS itself. */
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  /**
   * Whether anybody may register a new company from the public site.
   *
   * CLAUDE.md forbids public write endpoints; sign-up is the deliberate
   * exception, so it comes with an off switch that needs no deploy to think
   * about. Default ON, because a product whose sign-up page 503s out of the box
   * looks broken rather than careful — and because the endpoint can only ever
   * create a NEW empty tenant, never touch an existing one.
   *
   * Set it to `false` for a deployment that provisions its customers by hand.
   * The pre-launch checklist in `docs/DEPLOYMENT.md` asks the question.
   */
  SIGNUP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

/**
 * Validate and return the server environment.
 *
 * On failure the thrown message names the offending variables but never their
 * values — an env error must not leak a connection string into a log drain.
 */
export function getServerEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new Error(
      `Invalid server environment. Check .env.example and your .env.local:\n${problems}`,
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/**
 * Is the AI feature configured at all?
 *
 * Asked by the page before it renders the analysis cards, so a deployment with
 * no key shows an honest "not configured" panel rather than four buttons that
 * all fail. Returns a BOOLEAN and never the key — a helper that returned the
 * key would be one import away from a Client Component.
 */
export function hasAnthropicKey(): boolean {
  return getServerEnv().ANTHROPIC_API_KEY !== undefined;
}

/**
 * May a visitor register a new company?
 *
 * A boolean, asked by both the page (which renders a closed notice instead of a
 * form) and the action (which refuses regardless of what the page did). Two
 * checks rather than one, because a hidden form is not a disabled endpoint.
 */
export function isSignupEnabled(): boolean {
  return getServerEnv().SIGNUP_ENABLED;
}

/** Test-only escape hatch so a suite can re-read a mutated `process.env`. */
export function resetServerEnvCache(): void {
  cachedEnv = undefined;
}
