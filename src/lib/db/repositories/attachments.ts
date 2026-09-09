import type { Types } from "mongoose";

import type { AttachmentRefType } from "../../domain/files";
import { Attachment, type AttachmentDocument } from "../models/attachment";
import { createRepository } from "../repository";
import type { TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach attachments.
 *
 * Client-partitioned, which follows from the model: `Attachment` has a nullable
 * `clientId`, so a CLIENT session sees files about its own equipment and the
 * provider's internal photographs — which carry `null` — stay internal.
 *
 * This repository is the file's access control. There is no other: the object
 * store hands out bytes to whoever knows a key, and the app never hands out a
 * key, so "may this person read this file?" is exactly "does `findById` return
 * a row?".
 */

export interface AttachmentCreateInput {
  refType: AttachmentRefType;
  refId: Types.ObjectId | string;
  clientId?: Types.ObjectId | string | null;
  storageKey: string;
  filename: string;
  contentType: string;
  size: number;
  checksum: string;
  uploadedBy: Types.ObjectId | string;
}

/**
 * Nothing is patchable.
 *
 * An uploaded file is evidence — a nameplate, a leak, a signed job sheet — and
 * renaming or repointing one after the fact would change what the record says
 * happened. Replacing a file is a new upload and a soft delete of the old row,
 * which leaves both facts in the collection.
 */
export type AttachmentUpdateInput = Record<never, never>;

export const attachmentsRepository = createRepository<
  AttachmentDocument,
  AttachmentCreateInput,
  AttachmentUpdateInput
>(Attachment);

/**
 * Everything attached to one thing, newest first.
 *
 * Capped: a gallery is a gallery, and a work order with four hundred
 * photographs needs paging rather than a page that loads forty megabytes of
 * thumbnails. The cap also stops an unbounded read from a route any signed-in
 * user can call.
 */
export async function listAttachmentsFor(
  scope: TenantScope,
  refType: AttachmentRefType,
  refId: Types.ObjectId | string,
  limit = 24,
): Promise<AttachmentDocument[]> {
  return attachmentsRepository.forScope(scope).find(
    {
      refType,
      refId: refId as AttachmentDocument["refId"],
    },
    { sort: { createdAt: -1 }, limit },
  );
}
