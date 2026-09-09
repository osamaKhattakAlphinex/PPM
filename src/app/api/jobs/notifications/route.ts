import { timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env";
import { runNotificationJob } from "@/lib/notifications/job";
import { handleApiError } from "@/lib/security";

/**
 * The nightly notification job, triggerable by a scheduler.
 *
 * A Route Handler because it has no session and no page — Vercel Cron, a
 * Kubernetes CronJob or a `curl` from a bastion all call the same URL.
 *
 * ## How it is authorised
 *
 * A shared secret in the `Authorization` header, compared in CONSTANT TIME.
 * That last part matters more than it looks: a `!==` on a secret leaks its
 * length and, over enough requests, its prefix. `timingSafeEqual` needs equal
 * lengths to run at all, so the length is compared first — which is itself a
 * leak of one bit, and an unavoidable one; what it must not leak is the
 * content.
 *
 * There is no session and no role check, deliberately, because there is no user:
 * the secret IS the identity. What bounds the damage if it leaks is that this
 * endpoint can only ever create notifications from data that already exists —
 * it reads and writes nothing else, takes no parameters, and returns counts
 * rather than content.
 *
 * ## Why it is not open when unconfigured
 *
 * A missing `CRON_SECRET` means the route answers 503 rather than running. The
 * alternative — treating "no secret configured" as "no authentication required"
 * — is how an internal job endpoint ends up on the public internet.
 */

/** Node, not Edge: the job reaches Mongoose. */
export const runtime = "nodejs";

/** Never cached. It has side effects. */
export const dynamic = "force-dynamic";

/**
 * Constant-time comparison of two secrets.
 *
 * Both are hashed to a fixed length first, so `timingSafeEqual` never throws on
 * a length mismatch and the comparison itself is over equal-length buffers
 * whatever was sent.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<Response> {
  try {
    const env = getServerEnv();

    if (!env.CRON_SECRET) {
      return Response.json(
        {
          ok: false,
          error: { code: "NOT_CONFIGURED", message: "This job is not configured." },
        },
        { status: 503 },
      );
    }

    /**
     * `Authorization: Bearer <secret>` — the shape Vercel Cron sends, and the
     * one every other scheduler can produce. The prefix is required rather than
     * optional, so a secret sent as a bare header is refused rather than
     * half-working.
     */
    const header = request.headers.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

    if (!provided || !secretsMatch(provided, env.CRON_SECRET)) {
      // Deliberately indistinguishable from a wrong secret: an unauthenticated
      // caller learns nothing about whether the endpoint exists or is armed.
      return Response.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Not authorised." } },
        { status: 401 },
      );
    }

    const result = await runNotificationJob();

    /**
     * Counts, never content. A scheduler's log is not a place for a tenant's
     * contract numbers — and `failed` carries organisation IDS so a run can be
     * re-tried, which is the one identifier worth returning.
     */
    console.info(
      `[notifications] run complete: ${result.organizations} orgs, ` +
        `${result.created} created, ${result.skipped} duplicates, ${result.failed.length} failed`,
    );

    return Response.json(
      { ok: true, data: result },
      {
        // A partial failure is still a 200 with a `failed` list: the job DID
        // run and most tenants were processed. A scheduler that retried the
        // whole thing on one tenant's bad row would notify everyone twice —
        // except that the dedupe key makes that harmless, which is exactly why
        // it is safe to report honestly rather than defensively.
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return handleApiError(error, { operation: "POST /api/jobs/notifications" });
  }
}

/**
 * POST is the correct verb for a job with side effects, and GET exists because
 * some schedulers (Vercel Cron among them) only issue GET. Both are behind the
 * same secret; neither is reachable without it.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
