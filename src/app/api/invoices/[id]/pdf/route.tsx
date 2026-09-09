import { renderToBuffer } from "@react-pdf/renderer";

import { requireRole } from "@/lib/auth/guard";
import { connectToDatabase, getOrganizationForScope } from "@/lib/db";
import { findInvoiceForScope, INVOICE_READERS } from "@/lib/invoicing/queries";
import {
  formatVatRate,
  InvoicePdf,
  PDF_STATUS_LABELS,
  type InvoicePdfModel,
} from "@/lib/pdf/invoice-document";
import { registerPdfFonts } from "@/lib/pdf/fonts";
import { handleApiError, NotFoundError } from "@/lib/security";
import { clientIpFrom, enforceRateLimit, createRateLimiter } from "@/lib/security/rate-limit";
import { objectIdString } from "@/lib/validation/primitives";

/**
 * Download one invoice as a PDF.
 *
 * A Route Handler rather than a Server Action, which is what CLAUDE.md reserves
 * them for: this returns a FILE, and a server action can only return
 * serialisable data.
 *
 * The authorisation is the whole point of the route, and it is four things in
 * this order:
 *
 *  1. `requireRole(...INVOICE_READERS)` — no session, no document. The role list
 *     is the module's own, so a supervisor cannot pull a customer's bill even by
 *     guessing the URL.
 *  2. The id is PARSED before it is used. A malformed one is a 404, not a cast
 *     error inside the driver.
 *  3. `findInvoiceForScope` reads through the SCOPED repository, so the id in
 *     the URL is a filter TERM with organizationId (and clientId for a client
 *     session) layered on top by the DAL. Another tenant's invoice number
 *     matches nothing — the route never holds a document it should not have,
 *     rather than holding one and then deciding not to send it.
 *  4. Only then is anything rendered.
 *
 * That third step is what the product asks to be verified: the PDF route
 * refuses an invoice outside your scope. It refuses it by never finding it.
 */

/**
 * Node, not Edge. `@react-pdf/renderer` embeds font files read from disk and
 * uses Node stream primitives; the Edge runtime has neither.
 */
export const runtime = "nodejs";

/** Never cached or prerendered: every response is one tenant's document. */
export const dynamic = "force-dynamic";

/**
 * A tighter limiter than the shared mutation one.
 *
 * Rendering a PDF is the most expensive thing a signed-in user can ask this
 * server to do — font parsing, layout, compression — so it gets a bucket of its
 * own rather than sharing the generous mutation allowance. Keyed on the user
 * first and the IP second, the same shape `defineAction` uses.
 */
const pdfRateLimiter = createRateLimiter({
  name: "invoice-pdf",
  limit: 20,
  windowMs: 60_000,
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { user, scope } = await requireRole(...INVOICE_READERS);

    enforceRateLimit(pdfRateLimiter, `${user.id}:${clientIpFrom(request.headers)}`);

    const { id } = await context.params;

    /**
     * Parsed, not trusted. `safeParse` rather than `parse` because a malformed
     * id in a URL is an ordinary 404 — somebody edited a link — and not
     * something to log as a validation failure on a form.
     */
    const parsed = objectIdString.safeParse(id);
    if (!parsed.success) throw new NotFoundError(`invalid invoice id in url`);

    await connectToDatabase();

    const invoice = await findInvoiceForScope(scope, parsed.data);
    if (!invoice) throw new NotFoundError(`invoice ${parsed.data} not in scope`);

    const organization = await getOrganizationForScope(scope);

    registerPdfFonts();

    /**
     * The numbers are formatted HERE, once, with a fixed locale and an explicit
     * two decimal places.
     *
     * `en-US` deliberately, and not the reader's locale: the document is a
     * record, and a total rendered with Eastern Arabic numerals for one reader
     * and Western digits for another is two different-looking documents for one
     * transaction. The DTO already converted halalas to riyals, so this is the
     * last step.
     */
    const money = (value: number): string =>
      value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const day = (iso: string): string => iso.slice(0, 10);

    const status = PDF_STATUS_LABELS[invoice.displayStatus] ?? {
      en: invoice.displayStatus,
      ar: invoice.displayStatus,
    };

    const model: InvoicePdfModel = {
      organizationName: organization?.name ?? "—",
      organizationVatNumber: organization?.vatNumber ?? null,
      clientName: invoice.clientName ?? "—",
      invoiceNumber: invoice.invoiceNumber,
      workRef: invoice.workRef,
      issueDate: day(invoice.issueDate),
      dueDate: day(invoice.dueDate),
      status: status.en,
      statusArabic: status.ar,
      amount: money(invoice.amount),
      vat: money(invoice.vat),
      vatRateLabel: formatVatRate(invoice.vatRate),
      total: money(invoice.total),
      notes: invoice.notes,
      generatedAt: new Date().toISOString().slice(0, 10),
    };

    const buffer = await renderToBuffer(<InvoicePdf model={model} />);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        /**
         * `inline`, so a browser opens it in its viewer rather than dropping it
         * in Downloads — a person checking an invoice usually wants to look at
         * it. The filename is built from the invoice NUMBER, which the model
         * schema constrains to lowercase letters, digits and hyphens, so there
         * is nothing in it that could break out of the header.
         */
        "Content-Disposition": `inline; filename="invoice-${invoice.invoiceNumber}.pdf"`,
        /**
         * A tenant's document must never be held by a shared cache, and
         * `private` alone is not enough for a proxy that ignores it.
         */
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    // Logs server-side with a request id and returns a generic, non-leaky body.
    // A 404 here is indistinguishable from "belongs to another tenant", which is
    // the answer both cases should give.
    return handleApiError(error, { operation: "GET /api/invoices/[id]/pdf" });
  }
}
