import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { Role } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/session";
import {
  assetsRepository,
  attachmentsRepository,
  connectToDatabase,
  listAttachmentsFor,
  ppmSchedulesRepository,
  workOrdersRepository,
  type AttachmentDocument,
  type TenantScope,
} from "@/lib/db";
import {
  extensionFor,
  isAllowedType,
  MAX_UPLOAD_BYTES,
  safeDisplayName,
  sniffType,
  storageKeyFor,
  stripJpegMetadata,
  type AttachmentRefType,
} from "@/lib/domain/files";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { getStorage } from "@/lib/storage";

/**
 * Storing and reading files, with the checks that make either safe.
 *
 * The upload path is six steps and the ORDER is the design — each one is
 * cheaper than the next, so a hostile or malformed request is refused before it
 * costs anything:
 *
 *  1. The reference is re-read through its OWN scoped repository. A file may
 *     only be attached to something the caller can already see, and this is
 *     also where `clientId` comes from — never from the request.
 *  2. The size is checked against the buffer's actual length.
 *  3. The type is SNIFFED from the first bytes. The declared `Content-Type` is
 *     a claim written by the client and is used only to fail fast; the sniffed
 *     value is what is stored and what the download route later sends back.
 *  4. Metadata is stripped, so a phone's GPS coordinates do not travel with a
 *     photograph of a customer's plant room.
 *  5. A key is GENERATED — never derived from the uploaded name.
 *  6. The object is written, and only then the row.
 *
 * That last order matters: an object with no row is unreadable by anybody
 * (there is no public URL and no `list`), whereas a row with no object is a
 * broken thumbnail. Failing toward the harmless one is worth the orphan.
 */

/** Who may attach a file. Everyone who does the work, and nobody outside it. */
export const UPLOADERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
];

/**
 * Who may READ one — everybody, narrowed by the DAL.
 *
 * Wider than the uploaders, and deliberately: a customer looking at their own
 * asset should see the photograph of its nameplate. What stops them seeing
 * anybody else's is not this list but the `clientId` the DAL appends to every
 * filter.
 */
export const FILE_READERS: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
  "CLIENT",
];

export interface AttachmentView {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** ISO 8601. A Date does not survive the boundary. */
  createdAt: string;
  /** The authenticated route to fetch it from. Never a storage URL. */
  href: string;
  isImage: boolean;
}

export function toAttachmentView(document: AttachmentDocument): AttachmentView {
  return {
    id: document._id.toHexString(),
    filename: document.filename,
    contentType: document.contentType,
    size: document.size,
    createdAt: document.createdAt.toISOString(),
    href: `/api/files/${document._id.toHexString()}`,
    isImage: document.contentType.startsWith("image/"),
  };
}

/**
 * Read the thing a file is being attached to, through ITS OWN scoped
 * repository, and return the counterparty to copy onto the attachment.
 *
 * The id in the request is used as a FILTER TERM with organizationId (and
 * clientId) layered on top by the DAL, so a reference to another tenant's asset
 * matches nothing and fails here — rather than storing a file against something
 * the uploader cannot see.
 *
 * A PPM schedule has no `clientId` of its own (preventive is
 * provider-internal), so evidence attached to one is internal too.
 */
async function resolveReference(
  scope: TenantScope,
  refType: AttachmentRefType,
  refId: string,
): Promise<{ clientId: AttachmentDocument["clientId"] }> {
  if (refType === "ASSET") {
    const asset = await assetsRepository
      .forScope(scope)
      .findById(refId, { select: ["_id", "clientId"] });
    if (!asset) {
      throw new ValidationError(`asset ${refId} is outside the actor's scope`, {
        refId: "Unknown asset.",
      });
    }
    return { clientId: asset.clientId ?? null };
  }

  if (refType === "WORK_ORDER") {
    const workOrder = await workOrdersRepository
      .forScope(scope)
      .findById(refId, { select: ["_id", "clientId"] });
    if (!workOrder) {
      throw new ValidationError(`work order ${refId} is outside the actor's scope`, {
        refId: "Unknown work order.",
      });
    }
    return { clientId: workOrder.clientId ?? null };
  }

  const schedule = await ppmSchedulesRepository
    .forScope(scope)
    .findById(refId, { select: ["_id"] });
  if (!schedule) {
    throw new ValidationError(`ppm schedule ${refId} is outside the actor's scope`, {
      refId: "Unknown maintenance schedule.",
    });
  }
  return { clientId: null };
}

export interface UploadInput {
  refType: AttachmentRefType;
  refId: string;
  filename: string;
  /** What the CLIENT claimed. Used to fail fast; never stored. */
  declaredType: string;
  data: Uint8Array;
}

export async function storeUpload(
  scope: TenantScope,
  user: SessionUser,
  input: UploadInput,
): Promise<AttachmentView> {
  await connectToDatabase();

  // 1. May this caller attach to this thing, and whose is it?
  const { clientId } = await resolveReference(scope, input.refType, input.refId);

  // 2. Size, against the buffer rather than a header a client wrote.
  if (input.data.byteLength === 0) {
    throw new ValidationError("empty upload", { file: "That file is empty." });
  }
  if (input.data.byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`upload of ${input.data.byteLength} bytes exceeds the cap`, {
      file: `Files must be under ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    });
  }

  /**
   * 3. What it IS, not what it says it is.
   *
   * The declared type is checked first only because it is free and gives a
   * clearer message for the ordinary mistake (somebody picking a .docx). The
   * decision is the sniffed value, and a mismatch between the two is refused
   * outright — a PNG header on a file the client called a PDF is not a
   * confusion worth resolving in the uploader's favour.
   */
  if (!isAllowedType(input.declaredType)) {
    throw new ValidationError(`declared type ${input.declaredType} is not allowed`, {
      file: "Only JPEG, PNG, WEBP, HEIC and PDF files can be uploaded.",
    });
  }

  const sniffed = sniffType(input.data);
  if (!sniffed || !isAllowedType(sniffed)) {
    throw new ValidationError(`sniffed type ${sniffed ?? "unknown"} is not allowed`, {
      file: "That file is not a JPEG, PNG, WEBP, HEIC or PDF.",
    });
  }
  if (sniffed !== input.declaredType) {
    throw new ValidationError(`declared ${input.declaredType} but sniffed ${sniffed}`, {
      file: "That file's contents do not match its type.",
    });
  }

  // 4. Strip what the phone wrote into the photograph.
  const bytes = sniffed === "image/jpeg" ? stripJpegMetadata(input.data) : input.data;

  // 5. A key the uploader had no part in choosing.
  const key = storageKeyFor(
    scope.organizationId.toHexString(),
    input.refType,
    randomUUID(),
    sniffed,
  );

  // 6. Object first, row second. See the header for why that order.
  await getStorage().put(key, bytes, sniffed);

  const created = await attachmentsRepository.forScope(scope).create({
    refType: input.refType,
    refId: input.refId,
    // From the referenced document, never from the request.
    clientId,
    storageKey: key,
    filename: ensureExtension(safeDisplayName(input.filename), sniffed),
    // The SNIFFED type, which is what the download route will send back.
    contentType: sniffed,
    size: bytes.byteLength,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    uploadedBy: user.id,
  });

  return toAttachmentView(created);
}

/**
 * Give the display name an extension matching what the file actually is.
 *
 * A photograph uploaded as `IMG_0031` with no extension downloads as a file the
 * operating system cannot open; one named `report.pdf` that is really a JPEG
 * would be worse, and the sniffing above has already refused that case. So this
 * only ever APPENDS, and only when the name does not already end in the right
 * thing.
 */
function ensureExtension(name: string, contentType: string): string {
  const extension = extensionFor(contentType);
  return name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
}

/**
 * One file's bytes, for the download route.
 *
 * The row is resolved through the SCOPED repository FIRST — so an id belonging
 * to another tenant matches nothing and this throws before any storage call is
 * made. The object store is never asked a question about a file the caller is
 * not entitled to.
 */
export async function readAttachment(
  scope: TenantScope,
  id: string,
): Promise<{ document: AttachmentDocument; data: Uint8Array }> {
  await connectToDatabase();

  const document = await attachmentsRepository.forScope(scope).findById(id);
  if (!document) throw new NotFoundError(`attachment ${id} not in scope`);

  const object = await getStorage().get(document.storageKey);
  if (!object) {
    // The row exists and the object does not — a failed upload, or a bucket
    // somebody has been tidying. A 404 rather than a 500: there is nothing the
    // caller did wrong and nothing they can retry.
    throw new NotFoundError(`attachment ${id} has no stored object`);
  }

  return { document, data: object.data };
}

/**
 * Remove a file: the row, then the object.
 *
 * The reverse of the upload order, and for the same reason. Deleting the row
 * first makes the file immediately unreachable — which is what "delete" means
 * to the person who pressed it — and a storage failure afterwards leaves an
 * orphan nobody can read rather than a live file everybody thinks is gone.
 */
export async function deleteAttachment(scope: TenantScope, id: string): Promise<void> {
  await connectToDatabase();

  const document = await attachmentsRepository.forScope(scope).findById(id);
  if (!document) throw new NotFoundError(`attachment ${id} not in scope`);

  const deleted = await attachmentsRepository.forScope(scope).delete(id);
  if (!deleted) throw new NotFoundError(`attachment ${id} not in scope`);

  await getStorage().remove(document.storageKey);
}

/** The gallery for one thing. */
export async function listAttachmentViews(
  scope: TenantScope,
  refType: AttachmentRefType,
  refId: string,
): Promise<AttachmentView[]> {
  await connectToDatabase();

  const documents = await listAttachmentsFor(scope, refType, refId);
  return documents.map(toAttachmentView);
}
