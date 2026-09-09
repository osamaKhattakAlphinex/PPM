import { requireRole } from "@/lib/auth/guard";
import { FILE_READERS, readAttachment } from "@/lib/files/service";
import { handleApiError, NotFoundError } from "@/lib/security";
import { objectIdString } from "@/lib/validation/primitives";

/**
 * Serve one file.
 *
 * This route IS the access control for every uploaded file in the product.
 * There is no public bucket URL, no signed link and no `list` on the storage
 * driver — so a file is readable exactly when its row is, and the row is
 * resolved through the SCOPED repository. An id belonging to another tenant is
 * a filter term that matches nothing, and the handler answers 404 without ever
 * having asked the object store a question about it.
 *
 * That is the property CLAUDE.md asks to be verified: a file from Org A is not
 * retrievable by an Org B user. It is not retrievable because it is not found.
 */

/** Node, not Edge: the service reaches Mongoose and the storage driver. */
export const runtime = "nodejs";

/** Never cached or prerendered: every response is one tenant's file. */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { scope } = await requireRole(...FILE_READERS);

    const { id } = await context.params;

    // Parsed, not trusted. A malformed id in a URL is an ordinary 404 —
    // somebody edited a link — not a validation failure to log against a form.
    const parsed = objectIdString.safeParse(id);
    if (!parsed.success) throw new NotFoundError("invalid attachment id in url");

    const { document, data } = await readAttachment(scope, parsed.data);

    return new Response(new Uint8Array(data), {
      headers: {
        /**
         * The type the SERVER sniffed at upload, never one a client supplied.
         * Echoing an uploader's claim would let somebody have the app serve a
         * file browsers execute as something other than an image.
         */
        "Content-Type": document.contentType,

        /**
         * `inline` for images so a gallery can render them, `attachment` for
         * everything else — a PDF opened inline from the app's own origin is a
         * document with the app's cookies in scope, and there is no reason to
         * take that risk for a job sheet somebody is going to file anyway.
         *
         * The filename was sanitised at upload (`safeDisplayName`), so there is
         * nothing in it that could break out of the header.
         */
        "Content-Disposition": `${
          document.contentType.startsWith("image/") ? "inline" : "attachment"
        }; filename="${document.filename}"`,

        /**
         * `nosniff` matters more here than anywhere else in the app: it is what
         * stops a browser second-guessing the type above for a file a stranger
         * uploaded.
         */
        "X-Content-Type-Options": "nosniff",

        /**
         * A tenant's file must never be held by a shared cache. `private`
         * alone is not enough for a proxy that ignores it.
         */
        "Cache-Control": "private, no-store, max-age=0",

        /**
         * Nothing in an uploaded file may execute or reach the network, even if
         * a browser is somehow persuaded to treat it as a document.
         */
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    // A 404 here is indistinguishable from "belongs to another tenant", which
    // is the answer both cases should give.
    return handleApiError(error, { operation: "GET /api/files/[id]" });
  }
}
