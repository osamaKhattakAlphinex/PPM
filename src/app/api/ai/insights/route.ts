import Anthropic from "@anthropic-ai/sdk";

import { requireRole } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/roles";
import { aiInsightRequestSchema } from "@/lib/ai/analyses";
import { buildInsightContext, upcomingPlanFor } from "@/lib/ai/context";
import { approximateTokens, buildInsightPrompt } from "@/lib/ai/prompts";
import { getServerEnv } from "@/lib/env";
import { assertNoUnsafeKeys } from "@/lib/db";
import { handleApiError, ValidationError } from "@/lib/security";
import { clientIpFrom, createRateLimiter, enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * AI insights — the one route in the product that talks to a third party.
 *
 * The security requirement CLAUDE.md states for this module is that the API key
 * lives server-side ONLY, and the shape of this file is what makes that true
 * rather than merely intended:
 *
 *  - The key is read from `getServerEnv()`, in this module, which is a Route
 *    Handler and therefore never bundled for a browser. It is not on a
 *    `NEXT_PUBLIC_` variable, so Next has no mechanism by which it could inline
 *    it into client JavaScript.
 *  - The browser never calls Anthropic. It calls THIS route, which calls
 *    Anthropic from the server and streams the text back. A network inspector
 *    on the client sees one request to `/api/ai/insights` and a text stream —
 *    no key, no upstream URL, and no other tenant's data.
 *  - The prompt is not sent by the client either. The request body carries an
 *    analysis name and a locale, both enums; everything the model reads is
 *    assembled on the server from the caller's own SCOPED data.
 *
 * A Route Handler rather than a Server Action, which is what CLAUDE.md reserves
 * them for: this streams, and a server action can only return a serialisable
 * value once.
 */

/**
 * Node, not Edge. The Anthropic SDK is fine on either, but this route also
 * reaches Mongoose to gather the snapshot, and that is Node-only.
 */
export const runtime = "nodejs";

/** Never cached: every response is one tenant's data. */
export const dynamic = "force-dynamic";

/**
 * Who may ask.
 *
 * Management only, matching `aiInsights` in `src/lib/nav/modules.ts`. The
 * narrowness is deliberate on three counts: the call costs money per request,
 * the output is an opinion about how well the provider is running the contract,
 * and a client-scoped session would produce an analysis of a single customer's
 * equipment that reads like a report card on their own provider.
 */
const AI_READERS: readonly [Role, ...Role[]] = ["ADMIN", "FM_MANAGER"];

/**
 * Per-user, per-minute. Much tighter than the shared mutation limiter, because
 * unlike every other endpoint in the product this one costs real money on every
 * call — a runaway retry loop in a browser is a bill.
 */
const aiRateLimiter = createRateLimiter({
  name: "ai-insights",
  limit: 6,
  windowMs: 60_000,
  // A five-minute block after the limit, rather than a rolling window: the
  // failure mode here is an automated loop, and a rolling window lets one
  // through every ten seconds forever.
  blockMs: 5 * 60_000,
});

/**
 * How long the answer may run.
 *
 * 1,500 tokens is roughly twice the 200–350 words the system prompt asks for —
 * enough headroom that a thorough answer is never truncated mid-sentence, and
 * low enough that a pathological response cannot run for minutes. The request
 * STREAMS regardless, which is what keeps a slow answer from hitting an HTTP
 * timeout.
 */
const MAX_TOKENS = 1_500;

export async function POST(request: Request): Promise<Response> {
  try {
    const { user, scope } = await requireRole(...AI_READERS);

    enforceRateLimit(aiRateLimiter, `${user.id}:${clientIpFrom(request.headers)}`);

    const env = getServerEnv();
    if (!env.ANTHROPIC_API_KEY) {
      /**
       * A deployment without a key is a supported configuration, not a bug —
       * the AI module is one feature of eleven. The message says what is wrong
       * without naming an environment variable to a browser.
       */
      return Response.json(
        {
          ok: false,
          error: { code: "NOT_CONFIGURED", message: "AI insights are not configured." },
        },
        { status: 503 },
      );
    }

    const raw: unknown = await request.json().catch(() => {
      throw new ValidationError("request body is not JSON");
    });

    // The DAL's own definition of an unsafe key, applied before zod, for the
    // same reason `defineAction` applies it: one definition, everywhere.
    assertNoUnsafeKeys(raw);
    const { analysis, locale } = aiInsightRequestSchema.parse(raw);

    /**
     * The snapshot. Every read inside is scoped by the DAL to this session's
     * organization; there is no parameter here by which a caller could widen it.
     */
    const context = await buildInsightContext(scope, analysis);

    // The one analysis that needs the forward plan as well as the history.
    const extra =
      analysis === "PM_OPTIMIZATION"
        ? { upcomingPlan: await upcomingPlanFor(scope) }
        : undefined;

    const { system, user: userMessage } = buildInsightPrompt(analysis, locale, context, extra);

    /**
     * Logged BEFORE the call, and deliberately: it records that this user asked
     * for this analysis and roughly how much data went with it. It logs the
     * SIZE and never the content — a log drain is not a place to put a tenant's
     * fault descriptions.
     */
    console.info(
      `[ai] ${analysis} for user=${user.id} org=${scope.organizationId.toHexString()} ` +
        `payload≈${approximateTokens(userMessage)} tokens`,
    );

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    /**
     * Streamed, for two reasons. A 300-word analysis behind adaptive thinking
     * can take twenty seconds to complete, which is long enough to hit a
     * platform's HTTP timeout on a non-streaming request; and a card that fills
     * in as the answer arrives is the difference between "working" and "broken"
     * to whoever pressed the button.
     *
     * `effort: "medium"` rather than the default `high`: the question is a
     * reading of forty rows of maintenance data, not a hard reasoning problem,
     * and the cheaper setting answers it as well while costing less per press.
     */
    const upstream = client.messages.stream({
      model: env.ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      messages: [{ role: "user", content: userMessage }],
    });

    /**
     * Re-emitted as plain text rather than proxied as SSE.
     *
     * The client needs the words and nothing else — not the event framing, not
     * the usage block, not the model id. Narrowing the response to text is one
     * more thing that cannot leak: whatever the upstream envelope grows next,
     * this route still emits only the analysis.
     */
    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of upstream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }

          const final = await upstream.finalMessage();

          /**
           * A safety decline arrives as a successful response with
           * `stop_reason: "refusal"` rather than as an error, so it has to be
           * checked explicitly. The user gets a plain sentence rather than an
           * empty card.
           */
          if (final.stop_reason === "refusal") {
            controller.enqueue(
              encoder.encode("\n\nThis analysis could not be completed for this data."),
            );
          }
        } catch (error) {
          // Logged in full server-side; the client gets one generic sentence
          // appended to whatever had already streamed. A stack trace or an
          // upstream error body must never reach a browser.
          console.error("[ai] stream failed", error);
          controller.enqueue(
            encoder.encode("\n\nThe analysis was interrupted. Please try again."),
          );
        } finally {
          controller.close();
        }
      },

      cancel() {
        // The reader went away — a closed tab, a navigation. Stop paying for
        // tokens nobody will read.
        upstream.abort();
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        // A tenant's analysis must never be held by a shared cache.
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        // Proxies that buffer would defeat the streaming entirely.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    // Logs server-side with a request id and returns a generic, non-leaky body.
    return handleApiError(error, { operation: "POST /api/ai/insights" });
  }
}
