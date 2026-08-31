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
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(500).default(8_000),
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
    .min(32, "must be at least 32 characters (generate with `openssl rand -base64 32`)"),

  // AUTH_SESSION_MAX_AGE and AUTH_SESSION_REVALIDATE_AFTER are deliberately
  // absent: they are read in `src/lib/auth/config.ts`, which the Edge-runtime
  // middleware imports and which therefore cannot import this module (parsing
  // it would demand MONGODB_URI on the Edge, where nothing connects).

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid server environment. Check .env.example and your .env.local:\n${problems}`,
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/** Test-only escape hatch so a suite can re-read a mutated `process.env`. */
export function resetServerEnvCache(): void {
  cachedEnv = undefined;
}
