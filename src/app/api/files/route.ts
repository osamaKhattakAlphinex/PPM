import { requireRole } from "@/lib/auth/guard";
import { attachmentRefTypeSchema, MAX_UPLOAD_BYTES } from "@/lib/domain/files";
import { storeUpload, UPLOADERS } from "@/lib/files/service";
import { apiSuccess, handleApiError, ValidationError } from "@/lib/security";
import { clientIpFrom, createRateLimiter, enforceRateLimit } from "@/lib/security/rate-limit";
import { objectIdString } from "@/lib/validation/primitives";

/**
 * Upload one file.
 *
 * A Route Handler rather than a Server Action, which is what CLAUDE.md reserves
 * them for: this takes a FILE. Server actions can carry `FormData`, but the
 * size cap, the streaming refusal and the `Content-Type` handling all belong on
 * a request rather than in an action wrapper built for JSON payloads.
 *
 * Everything that makes an upload safe is in `storeUpload` — the reference is
 * re-read through its own scoped repository, the type is sniffed from the bytes
 * rather than believed, metadata is stripped, and the storage key is generated.
 * This file is the boundary: authenticate, rate limit, cap the size, parse the
 * two identifiers, hand over.
 */

/** Node, not Edge: the service reaches Mongoose and hashes with `node:crypto`. */
export const runtime = "nodejs";

/** Never cached. It has side effects. */
export const dynamic = "force-dynamic";

/**
 * Tighter than the shared mutation limiter.
 *
 * An upload is bytes over the wire, a hash, a metadata parse and an object-store
 * round trip — the most expensive write in the product. Twenty a minute is more
 * than a technician photographing a plant room will ever need and far less than
 * a script would want.
 */
const uploadRateLimiter = createRateLimiter({
  name: "file-upload",
  limit: 20,
  windowMs: 60_000,
});

export async function POST(request: Request): Promise<Response> {
  try {
    const { user, scope } = await requireRole(...UPLOADERS);

    enforceRateLimit(uploadRateLimiter, `${user.id}:${clientIpFrom(request.headers)}`);

    /**
     * The declared length, refused BEFORE the body is read.
     *
     * A header a client wrote, so it is not the real check — `storeUpload`
     * measures the buffer — but refusing here means an oversized upload costs
     * one header parse instead of ten megabytes of transfer and a buffer.
     */
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES * 1.1) {
      return Response.json(
        {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: "That file is too large." },
        },
        { status: 413 },
      );
    }

    const form = await request.formData().catch(() => {
      throw new ValidationError("body is not multipart form data");
    });

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("no file part in the upload", {
        file: "Choose a file to upload.",
      });
    }

    // Both identifiers are PARSED before they are used. An unparseable one is a
    // validation error rather than a cast failure deeper in.
    const refType = attachmentRefTypeSchema.parse(form.get("refType"));
    const refId = objectIdString.parse(form.get("refId"));

    const data = new Uint8Array(await file.arrayBuffer());

    const attachment = await storeUpload(scope, user, {
      refType,
      refId,
      filename: file.name,
      // What the CLIENT claimed. `storeUpload` sniffs the bytes and refuses a
      // mismatch; this only ever fails fast with a clearer message.
      declaredType: file.type,
      data,
    });

    return apiSuccess(attachment, { status: 201 });
  } catch (error) {
    return handleApiError(error, { operation: "POST /api/files" });
  }
}
