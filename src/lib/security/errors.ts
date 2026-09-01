import { z } from "zod";

/**
 * One error taxonomy, one place that turns it into a response.
 *
 * The rule from CLAUDE.md is short: never expose a stack trace or a Mongo
 * error to the client; log server-side, return something generic. The way that
 * rule gets broken in practice is not carelessness — it is `catch (e) { return
 * { error: e.message } }` written once, in a hurry, in a file nobody reviews.
 * So the message a client can see is a *property of the error class*, not
 * something a call site decides:
 *
 *   - `message`      — safe. Deliberately written. Goes to the client.
 *   - `detail`       — unsafe. Goes to the server log only.
 *   - `cause`        — the original throwable. Never serialised.
 *
 * Everything unrecognised collapses to a 500 whose body says
 * "Something went wrong." and whose log line carries a request id, so a user
 * reporting a failure gives support a string that finds the real error.
 *
 * Edge-safe: no `node:*`, no `server-only`. The middleware uses this too.
 */

/** The wire shape of a failure. Mirrors `{ ok: true, data }` on success. */
export interface ApiErrorBody {
  readonly ok: false;
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    /** Per-field messages. Only ever present on a validation failure. */
    readonly fields?: Readonly<Record<string, string>>;
    /** Correlates the client's failure with the server log line. */
    readonly requestId: string;
  };
}

export interface ApiSuccessBody<T> {
  readonly ok: true;
  readonly data: T;
}

export type ApiBody<T> = ApiSuccessBody<T> | ApiErrorBody;

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * The base class. `message` is the client-visible sentence; `detail` is what
 * actually happened and stays on the server.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Server-log only. NEVER put this in a response body. */
  readonly detail: string;
  /** Per-field messages, safe to show. Validation only. */
  readonly fields?: Readonly<Record<string, string>>;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    detail: string,
    options?: { fields?: Readonly<Record<string, string>>; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.fields = options?.fields;
  }
}

export class ValidationError extends AppError {
  constructor(detail: string, fields?: Readonly<Record<string, string>>, cause?: unknown) {
    super("VALIDATION_FAILED", 400, "Check the details and try again.", detail, { fields, cause });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  /**
   * Deliberately indistinguishable from a scoping refusal. A record in another
   * tenant and a record that does not exist must look identical from outside,
   * or the 404/403 split becomes an existence oracle across organizations.
   */
  constructor(detail: string) {
    super("NOT_FOUND", 404, "Not found.", detail);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, detail: string, fields?: Readonly<Record<string, string>>) {
    super("CONFLICT", 409, message, detail, { fields });
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, detail: string) {
    super("RATE_LIMITED", 429, "Too many requests. Wait a moment and try again.", detail);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Anything with a numeric `status` and a string `code` — which is what
 * `AuthenticationError` and `AuthorizationError` in `src/lib/auth/guard.ts`
 * are. They are matched structurally rather than imported because that module
 * pulls in `server-only` and Mongoose, and this one has to stay loadable on
 * the Edge.
 */
interface StatusCarryingError {
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly detail?: string;
}

function isStatusCarrying(error: unknown): error is StatusCarryingError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.status === "number" &&
    typeof candidate.message === "string"
  );
}

function isKnownCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

/** MongoDB's duplicate-key error, without letting the driver's types leak. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 11000
  );
}

/**
 * Flatten a ZodError into `{ field: message }`, first message per field wins.
 *
 * Field NAMES are ours (we wrote the schema) so they are safe to return; the
 * messages are ours too. The submitted values never appear.
 */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    if (!(path in fields)) fields[path] = issue.message;
  }
  return fields;
}

/**
 * Normalise ANY throwable into an `AppError`.
 *
 * This is the choke point. Everything that is not explicitly recognised
 * becomes a 500 with a fixed sentence, so an unmapped Mongoose or driver error
 * cannot reach a client by default — the failure mode of forgetting to map
 * something is "too little information", never "too much".
 */
export function normaliseError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof z.ZodError) {
    return new ValidationError(
      `zod: ${error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.code}`).join("; ")}`,
      fieldErrorsFrom(error),
      error,
    );
  }

  if (isDuplicateKeyError(error)) {
    // The colliding VALUE is never echoed: email is unique system-wide, so
    // "admin@x.com is taken" would let one tenant probe another's user list.
    return new ConflictError("That value is already in use.", "mongo duplicate key (11000)");
  }

  // AuthenticationError / AuthorizationError / ScopeResolutionError.
  if (isStatusCarrying(error) && isKnownCode(error.code)) {
    return new AppError(error.code, error.status, error.message, error.detail ?? error.message, {
      cause: error,
    });
  }

  return new AppError("INTERNAL_ERROR", 500, "Something went wrong.", describeUnknown(error), {
    cause: error,
  });
}

/** A log-safe one-liner for something we could not classify. */
function describeUnknown(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return `thrown string: ${error.slice(0, 200)}`;
  return `thrown non-error: ${Object.prototype.toString.call(error)}`;
}

/** Correlates one client-visible failure with one server log line. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

export interface LogContext {
  /** e.g. `POST /api/work-orders` or `action:closeWorkOrder`. */
  readonly operation?: string;
  /** From `describeScope()` — org/role/client, no PII. */
  readonly scope?: string;
  readonly userId?: string;
}

/**
 * Write the failure to the server log, with the full detail and the stack.
 *
 * 5xx goes to `console.error` because it is a bug in our code; 4xx goes to
 * `console.warn` because it is a caller behaving badly, which is expected
 * traffic and should not page anyone. Neither is ever returned.
 */
export function logAppError(error: AppError, requestId: string, context: LogContext = {}): void {
  const parts = [
    `[${error.code}]`,
    `requestId=${requestId}`,
    context.operation ? `op=${context.operation}` : null,
    context.scope ? `scope=${context.scope}` : null,
    context.userId ? `user=${context.userId}` : null,
    `detail=${error.detail}`,
  ].filter(Boolean);

  const line = parts.join(" ");

  if (error.status >= 500) {
    console.error(line, error.cause ?? error);
  } else {
    console.warn(line);
  }
}

/** The client-safe body. The only function permitted to build one. */
export function toApiErrorBody(error: AppError, requestId: string): ApiErrorBody {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
      requestId,
    },
  };
}

/**
 * The single API error handler: log server-side, return something generic.
 *
 * Use it as the `catch` of every Route Handler:
 *
 *     export async function POST(request: Request) {
 *       try {
 *         const { scope } = await requireRole("ADMIN");
 *         ...
 *         return apiSuccess(result);
 *       } catch (error) {
 *         return handleApiError(error, { operation: "POST /api/exports" });
 *       }
 *     }
 *
 * or wrap the handler with `withApiErrorHandling()` below and never write the
 * try/catch at all.
 */
export function handleApiError(error: unknown, context: LogContext = {}): Response {
  const appError = normaliseError(error);
  const requestId = newRequestId();

  logAppError(appError, requestId, context);

  const headers = new Headers({ "Cache-Control": "no-store" });
  if (appError instanceof RateLimitError) {
    headers.set("Retry-After", String(appError.retryAfterSeconds));
  }
  if (appError.status === 401) {
    // Tells a fetch client to re-authenticate rather than retry the body.
    headers.set("WWW-Authenticate", 'Session realm="ppm"');
  }

  return Response.json(toApiErrorBody(appError, requestId), {
    status: appError.status,
    headers,
  });
}

/** The success half of the standard response shape. */
export function apiSuccess<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data } satisfies ApiSuccessBody<T>, {
    status: 200,
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

/**
 * Wrap a Route Handler so no throwable can escape it unmapped.
 *
 *     export const POST = withApiErrorHandling("POST /api/webhooks/x", async (request) => {
 *       ...
 *       return apiSuccess({ received: true });
 *     });
 */
export function withApiErrorHandling<Args extends unknown[]>(
  operation: string,
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleApiError(error, { operation });
    }
  };
}
