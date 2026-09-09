import { z } from "zod";

/**
 * What may be uploaded, how big, and what it is called once it is stored.
 *
 * Pure — zod and byte arithmetic — so the upload button, the model and the
 * route can all import it. The same rule every `src/lib/domain/*` file follows.
 */

// ---------------------------------------------------------------------------
// What a file is attached to
// ---------------------------------------------------------------------------

/**
 * The three things worth photographing in this product.
 *
 * An allow-list rather than a free-form owner id, so an attachment can only
 * ever hang off something the app knows how to scope. Each one is re-read
 * through its OWN scoped repository before an upload is accepted, which is what
 * proves the caller may attach to it.
 */
export const ATTACHMENT_REF_TYPES = ["ASSET", "WORK_ORDER", "PPM_SCHEDULE"] as const;

export type AttachmentRefType = (typeof ATTACHMENT_REF_TYPES)[number];

export const attachmentRefTypeSchema = z.enum(ATTACHMENT_REF_TYPES);

// ---------------------------------------------------------------------------
// What may be uploaded
// ---------------------------------------------------------------------------

/**
 * The allowed types, and the extension each is stored with.
 *
 * An ALLOW-LIST, not a block-list, and that direction is the whole decision: a
 * block-list is a list of the attacks somebody thought of, and the first one
 * they did not think of is the one that gets through. Four image types and PDF
 * cover what an FM technician actually uploads — a photo of a nameplate, a
 * photo of a leak, a signed job sheet.
 *
 * SVG is deliberately absent even though it is an image. An SVG is a document
 * that can carry script, and serving one from the app's own origin would be a
 * stored cross-site-scripting hole dressed as a photograph.
 */
export const ALLOWED_UPLOAD_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
});

export function isAllowedType(contentType: string): boolean {
  return Object.hasOwn(ALLOWED_UPLOAD_TYPES, contentType);
}

export function extensionFor(contentType: string): string {
  return ALLOWED_UPLOAD_TYPES[contentType] ?? "bin";
}

/**
 * Ten megabytes.
 *
 * Enough for a modern phone photo at full resolution and a scanned multi-page
 * job sheet; small enough that a request body cannot be used to exhaust a
 * server's memory, since the whole file is read into a buffer to be sniffed and
 * to have its metadata stripped.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * The magic bytes each allowed type actually starts with.
 *
 * The declared `Content-Type` on a multipart part is written by the CLIENT and
 * is therefore a claim rather than a fact. Sniffing the first bytes is what
 * turns it into one — it is what stops a `.php` or an `.svg` arriving labelled
 * `image/png`.
 *
 * `null` means "no reliable signature at this offset": HEIC's identifier sits
 * at byte 4 inside an ISO-BMFF box, which `sniffType` handles as a special
 * case rather than as a prefix.
 */
const MAGIC: ReadonlyArray<{ type: string; offset: number; bytes: readonly number[] }> = [
  { type: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // "RIFF" .... "WEBP"
  { type: "image/webp", offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  { type: "application/pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  // "ftyp" at byte 4 — the ISO base media box HEIC shares with MP4.
  { type: "image/heic", offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
];

function matchesAt(data: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  if (data.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => data[offset + index] === byte);
}

/**
 * What this file actually IS, from its own bytes.
 *
 * Returns null when nothing matches, which the route treats as a refusal —
 * fail closed. A WEBP is additionally checked for its second signature at byte
 * 8, because `RIFF` alone is also a WAV and an AVI.
 */
export function sniffType(data: Uint8Array): string | null {
  for (const candidate of MAGIC) {
    if (!matchesAt(data, candidate.offset, candidate.bytes)) continue;

    if (candidate.type === "image/webp") {
      // "WEBP" at byte 8. Without this, any RIFF container passes as an image.
      if (!matchesAt(data, 8, [0x57, 0x45, 0x42, 0x50])) continue;
    }

    return candidate.type;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Names and keys
// ---------------------------------------------------------------------------

/**
 * How long a stored display name may be.
 *
 * The ORIGINAL name is kept for the person who uploaded it — "chiller-2
 * nameplate.jpg" is meaningful and a UUID is not — but it is never used as a
 * path. See `safeDisplayName` and `storageKeyFor`, which are two different
 * jobs.
 */
export const MAX_FILENAME_LENGTH = 120;

/**
 * The original filename, made safe to STORE AND DISPLAY.
 *
 * Not safe to use as a path — nothing is, which is why the storage key is
 * generated rather than derived. What this strips is everything that would make
 * the name dangerous to render or to put in a `Content-Disposition`:
 *
 *  - path separators and `..`, so a name cannot suggest a directory;
 *  - control characters and quotes, which would break out of the header;
 *  - a leading dot, so a file cannot be named to hide itself on a POSIX host.
 *
 * A name that reduces to nothing becomes "file", because an empty display name
 * renders as a gap somebody cannot click.
 */
export function safeDisplayName(filename: string): string {
  const withoutPath = filename.split(/[/\\]/).pop() ?? "";

  const cleaned = withoutPath
    /**
     * Control characters (CR and LF among them, which would let a name inject a
     * second HTTP header), quotes, backticks, semicolons and slashes —
     * everything that could escape a `Content-Disposition` value or a string
     * the name is rendered into.
     *
     * Written with `\u` escapes rather than literal control bytes: a source
     * file containing raw 0x00-0x1f is a file every tool downstream treats as
     * binary.
     */
    .replace(/[\u0000-\u001f\u007f"'`;\\/]/g, "")
    // `..` collapsed, so a name cannot suggest a parent directory even in a log
    // line somebody later pastes into a shell.
    .replace(/\.{2,}/g, ".")
    // A leading dot would name a file that hides itself on a POSIX host.
    .replace(/^\.+/, "")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);

  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * Where the file lives in object storage.
 *
 * `org/<organizationId>/<refType>/<random>.<ext>` — namespaced by tenant, as
 * CLAUDE.md requires, and with a name the uploader had no part in choosing.
 *
 * Both halves matter. The tenant prefix means a misconfigured bucket policy
 * fails per-tenant rather than globally, and it makes a mistaken cross-tenant
 * read visible in a path rather than invisible in a query. The generated name
 * means there is no path traversal to defend against, no collision between two
 * people uploading `photo.jpg`, and nothing guessable to enumerate — though
 * guessing is not the defence, since every read goes through an authenticated,
 * scoped route rather than a public URL.
 */
export function storageKeyFor(
  organizationId: string,
  refType: AttachmentRefType,
  randomName: string,
  contentType: string,
): string {
  return `org/${organizationId}/${refType.toLowerCase()}/${randomName}.${extensionFor(contentType)}`;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Remove every APPn metadata segment from a JPEG — EXIF, and with it the GPS
 * coordinates a phone writes into every photograph.
 *
 * This matters more in this product than in most. A technician photographs a
 * nameplate in a customer's plant room; the phone records exactly where that
 * plant room is, and the file is then attached to a record a customer contact
 * may be able to open. The location of a customer's site is theirs to share,
 * not something a maintenance provider should redistribute by accident — and
 * the app has an explicit, consented channel for location already (attendance),
 * which is the shape a deliberate capture should take.
 *
 * Only JPEG is handled, and that is honest rather than complete: JPEG is where
 * EXIF actually appears in practice. PNG and WEBP can carry metadata chunks,
 * and HEIC certainly does; stripping those correctly means a real image
 * pipeline. So the function returns the input unchanged for anything else and
 * the caller does not pretend otherwise.
 *
 * The parse is deliberately conservative: on anything it does not understand it
 * returns the ORIGINAL buffer rather than a truncated one. A stripper that
 * corrupts a photograph is worse than one that occasionally leaves metadata in.
 */
export function stripJpegMetadata(data: Uint8Array): Uint8Array {
  // SOI. Not a JPEG otherwise.
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return data;

  const out: number[] = [0xff, 0xd8];
  let index = 2;

  while (index + 3 < data.length) {
    if (data[index] !== 0xff) return data; // Not a marker where one must be.

    const marker = data[index + 1]!;

    // Start of scan: the entropy-coded image data runs to the end. Copy the
    // rest verbatim and stop parsing — there are no more segment headers.
    if (marker === 0xda) {
      return Uint8Array.from([...out, ...data.subarray(index)]);
    }

    const length = (data[index + 2]! << 8) | data[index + 3]!;
    // A segment shorter than its own length field is malformed.
    if (length < 2 || index + 2 + length > data.length) return data;

    const isAppSegment = marker >= 0xe0 && marker <= 0xef;
    // COM — a free-text comment, which is also metadata.
    const isComment = marker === 0xfe;

    if (!isAppSegment && !isComment) {
      out.push(...data.subarray(index, index + 2 + length));
    }

    index += 2 + length;
  }

  return Uint8Array.from(out);
}
