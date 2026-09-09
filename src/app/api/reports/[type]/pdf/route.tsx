import { renderToBuffer } from "@react-pdf/renderer";

import { requireRole } from "@/lib/auth/guard";
import { connectToDatabase } from "@/lib/db";
import { registerPdfFonts } from "@/lib/pdf/fonts";
import { ReportPdf } from "@/lib/pdf/report-document";
import { toReportPdfModel } from "@/lib/pdf/report-model";
import { reportKindSchema } from "@/lib/reports/kinds";
import { buildReportForScope } from "@/lib/reports/queries";
import { REPORTS_ROUTE_ROLES } from "@/lib/reports/route-roles";
import { handleApiError, NotFoundError } from "@/lib/security";
import { clientIpFrom, createRateLimiter, enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * Download a report as a PDF.
 *
 * The same pattern as the invoice route, deliberately — a route handler because
 * it returns a FILE, and the authorisation done in the same order:
 *
 *  1. `requireRole(...REPORTS_ROUTE_ROLES)` — no session, no document. That list
 *     is the union of the three per-report lists, so it only decides who may
 *     reach this route at all.
 *  2. The report kind is PARSED from the URL before it is used. An unknown one
 *     is a 404, not a cast error deeper in.
 *  3. `buildReportForScope` re-checks the caller's role against the PER-REPORT
 *     list and throws an authorization error otherwise. This is the check that
 *     matters: a supervisor who edits the URL to `FINANCIAL` is refused here,
 *     even though they are legitimately allowed on the route.
 *  4. Every figure in the report comes from a scoped aggregation, so the
 *     document can only ever contain the caller's own tenant — and, for a
 *     customer, only their own rows.
 */

/**
 * Node, not Edge. `@react-pdf/renderer` embeds font files read from disk and
 * uses Node stream primitives; the Edge runtime has neither.
 */
export const runtime = "nodejs";

/** Never cached or prerendered: every response is one tenant's document. */
export const dynamic = "force-dynamic";

/**
 * Tighter than the shared mutation limiter, and tighter than the invoice PDF's.
 *
 * A report runs four to six aggregations over the tenant's whole collection
 * before it renders anything, which makes it the most expensive read a signed-in
 * user can ask for. Keyed on the user first and the IP second, the same shape
 * `defineAction` uses.
 */
const reportRateLimiter = createRateLimiter({
  name: "report-pdf",
  limit: 10,
  windowMs: 60_000,
});

export async function GET(
  request: Request,
  context: { params: Promise<{ type: string }> },
): Promise<Response> {
  try {
    const { user, scope } = await requireRole(...REPORTS_ROUTE_ROLES);

    enforceRateLimit(reportRateLimiter, `${user.id}:${clientIpFrom(request.headers)}`);

    const { type } = await context.params;

    /**
     * `safeParse`, because an unknown report name in a URL is an ordinary 404 —
     * somebody followed a stale link — and not a validation failure to log
     * against a form.
     */
    const parsed = reportKindSchema.safeParse(type);
    if (!parsed.success) throw new NotFoundError(`unknown report kind in url: ${type}`);

    await connectToDatabase();

    /**
     * The per-report role check happens INSIDE this call and throws for a role
     * that may not run it. Restating the list here would be a second policy, and
     * the second one is the one that goes stale.
     */
    const report = await buildReportForScope(scope, user.role, parsed.data);

    registerPdfFonts();

    const buffer = await renderToBuffer(<ReportPdf model={toReportPdfModel(report)} />);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        // `inline`, so the browser's viewer opens it. The filename is built
        // from a PARSED enum member, so there is nothing in it that could break
        // out of the header.
        "Content-Disposition": `inline; filename="${parsed.data.toLowerCase()}-report.pdf"`,
        // A tenant's document must never be held by a shared cache, and
        // `private` alone is not enough for a proxy that ignores it.
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    // Logs server-side with a request id and returns a generic, non-leaky body.
    return handleApiError(error, { operation: "GET /api/reports/[type]/pdf" });
  }
}
