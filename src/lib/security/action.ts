import "server-only";

import { headers } from "next/headers";
import { z } from "zod";

import { assertNoUnsafeKeys, describeScope, type TenantScope } from "../db";
import { requireRole } from "../auth/guard";
import type { Role } from "../auth/roles";
import type { SessionUser } from "../auth/session";
import {
  logAppError,
  newRequestId,
  normaliseError,
  toApiErrorBody,
  ValidationError,
  type ApiErrorBody,
} from "./errors";
import {
  clientIpFrom,
  enforceRateLimit,
  mutationRateLimiter,
  type RateLimiter,
} from "./rate-limit";

/**
 * The wrapper every server action goes through.
 *
 * CLAUDE.md asks for the same four things at the top of every mutation:
 * check the session, check the role, resolve the tenant scope, parse the input
 * with zod. Four things repeated by hand in fifty files is four things that
 * will eventually be three in one of them — and the one that goes missing is
 * never noticed, because the action still works. So the sequence lives here,
 * once, and an action supplies only the parts that differ:
 *
 *     export const closeWorkOrder = defineAction({
 *       name: "closeWorkOrder",
 *       roles: ["ADMIN", "FM_MANAGER", "SUPERVISOR"],
 *       input: z.strictObject({ id: objectIdString, note: z.string().max(500) }),
 *       async handler({ input, scope }) {
 *         return workOrders.forScope(scope).update(input.id, { status: "CLOSED" });
 *       },
 *     });
 *
 * The handler receives a `scope` it did not construct and cannot widen, and an
 * `input` that is already the parsed type — there is no way to reach the body
 * before validation, because the raw value is never passed through.
 *
 * Order, and why: authenticate before anything (an anonymous caller learns
 * nothing, not even whether the payload was well-formed), rate-limit before
 * parsing (parsing is the expensive part and must not be free to a flooder),
 * validate before the handler runs.
 */

// --- Result shape -----------------------------------------------------------

export interface ActionSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

export type ActionResult<T> = ActionSuccess<T> | ApiErrorBody;

export function isActionSuccess<T>(result: ActionResult<T>): result is ActionSuccess<T> {
  return result.ok;
}

/**
 * Actions return a result rather than throwing.
 *
 * A thrown error inside a server action is serialised by React into a generic
 * "An error occurred in the Server Components render" — which is safe, but
 * useless: the form cannot show a field message and the user cannot be told
 * whether to retry. Returning the same `{ ok, error }` envelope the API uses
 * means one shape for `useActionState` and one shape for fetch.
 */

// --- Definition -------------------------------------------------------------

export interface ActionContext<Input> {
  /** Parsed and typed. Never the raw payload. */
  readonly input: Input;
  readonly user: SessionUser;
  /** Carries organizationId, and clientId for a CLIENT session. */
  readonly scope: TenantScope;
}

export interface ActionDefinition<Schema extends z.ZodType, Output> {
  /** Appears in the server log line. Keep it the function's own name. */
  readonly name: string;
  /**
   * Who may call this. Listed at the definition, not derived from a route: an
   * action has no route of its own, and one reachable from two pages must not
   * inherit whichever policy the caller happened to come through.
   *
   * A non-empty tuple, so "allow everyone" cannot be written by accident —
   * `requireRole()` with no roles throws, and the type stops it earlier.
   */
  readonly roles: readonly [Role, ...Role[]];
  /**
   * The zod schema for the payload. Prefer `z.strictObject` — CLAUDE.md
   * requires unknown fields to be rejected, and `z.object` strips them
   * silently instead.
   */
  readonly input: Schema;
  /**
   * Defaults to the shared mutation limiter. Pass a tighter one for anything
   * expensive or externally visible, or `null` for a read-only action where a
   * limit would only get in the way.
   */
  readonly rateLimit?: RateLimiter | null;
  readonly handler: (context: ActionContext<z.output<Schema>>) => Promise<Output>;
}

/**
 * Reject `$`-prefixed and dotted keys before zod ever sees them.
 *
 * zod's strict object mode already refuses an unknown `$where`, so this is the
 * second layer rather than the first — it exists for the schemas that legitimately
 * accept an open-ended record (a checklist's answers, a report's filters), where
 * "unknown key" is not an error and a `$gt` would otherwise sail through into a
 * query object. Reused from the DAL so there is exactly one definition of
 * "unsafe key" in the codebase.
 */
function rejectOperatorKeys(raw: unknown): void {
  if (raw === null || typeof raw !== "object") return;

  try {
    assertNoUnsafeKeys(raw);
  } catch (error) {
    // `UnsafeQueryError` carries the offending key names in its message, which
    // is fine for a log and wrong for a response. Re-thrown as a
    // ValidationError so the caller gets "check the details" and the key names
    // stay in `detail`.
    throw new ValidationError(
      error instanceof Error ? error.message : "unsafe keys in action input",
      undefined,
      error,
    );
  }
}

/**
 * The rate-limit key.
 *
 * Session user id first, IP second. The id is the meaningful axis — it comes
 * from a signed cookie and cannot be spoofed — and the IP is appended only so
 * that one compromised account driven from a botnet does not get a shared,
 * generous bucket. `x-forwarded-for` is attacker-controllable, which would
 * matter if it were the ONLY axis; here it can only ever narrow the bucket.
 */
async function rateLimitKey(userId: string): Promise<string> {
  const requestHeaders = await headers();
  return `${userId}:${clientIpFrom(requestHeaders)}`;
}

/**
 * Wrap a handler in authenticate -> scope -> rate limit -> validate -> run.
 *
 * Returns a function taking the raw, untrusted payload — `unknown`, so a
 * caller cannot hand it something it has already "checked".
 */
export function defineAction<Schema extends z.ZodType, Output>(
  definition: ActionDefinition<Schema, Output>,
): (raw: unknown) => Promise<ActionResult<Output>> {
  const { name, roles, input: schema, handler } = definition;
  const limiter = definition.rateLimit === undefined ? mutationRateLimiter : definition.rateLimit;

  return async function runAction(raw: unknown): Promise<ActionResult<Output>> {
    // Declared out here so the catch can log who was acting, when we got far
    // enough to know.
    let scope: TenantScope | undefined;
    let userId: string | undefined;

    try {
      // 1. Authenticate, and 2. resolve scope — one step, on purpose. The only
      //    way to obtain a TenantScope is to have passed the role check, so
      //    "checked the caller" and "scoped the query" cannot come apart.
      const context = await requireRole(...roles);
      scope = context.scope;
      userId = context.user.id;

      // 3. Rate limit. After auth so an anonymous flood is refused earlier and
      //    more cheaply, before parsing so parsing is not free.
      if (limiter) enforceRateLimit(limiter, await rateLimitKey(context.user.id));

      // 4. Validate. `parse`, not `safeParse` — a ZodError is normalised into a
      //    400 with per-field messages by the same handler that catches
      //    everything else.
      rejectOperatorKeys(raw);
      const parsed = schema.parse(raw) as z.output<Schema>;

      // 5. Run.
      const data = await handler({ input: parsed, user: context.user, scope: context.scope });
      return { ok: true, data };
    } catch (error) {
      const appError = normaliseError(error);
      const requestId = newRequestId();
      logAppError(appError, requestId, {
        operation: `action:${name}`,
        scope: scope ? describeScope(scope) : undefined,
        userId,
      });
      return toApiErrorBody(appError, requestId);
    }
  };
}

// --- Form actions -----------------------------------------------------------

/**
 * FormData as a plain object, so one zod schema can serve both a progressively
 * enhanced `<form action>` and a JSON caller.
 *
 * Repeated names become an array (multi-select, checkbox groups). Everything
 * else stays a string — coercion is the schema's job (`z.coerce.number()`),
 * not this function's, because guessing here would make `"0123"` a number in
 * one action and a string in another.
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    // React's own bookkeeping field for a progressively-enhanced action. It is
    // not part of anyone's schema and would fail a strictObject parse.
    if (key.startsWith("$ACTION_")) continue;

    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }

  return result;
}

/**
 * The same wrapper, in the signature `useActionState` wants.
 *
 *     const [state, formAction, isPending] = useActionState(createAsset, initialActionState);
 *
 * The previous state is ignored deliberately: it arrives from the client on
 * every submit, so treating it as input would be a way to smuggle values past
 * the schema.
 */
export function defineFormAction<Schema extends z.ZodType, Output>(
  definition: ActionDefinition<Schema, Output>,
): (previous: ActionResult<Output> | undefined, formData: FormData) => Promise<ActionResult<Output>> {
  const run = defineAction(definition);
  return async (_previous, formData) => run(formDataToObject(formData));
}

/** A neutral starting value for `useActionState`. */
export const initialActionState = undefined;
