import { z } from "zod";

import { attachmentRefTypeSchema, MAX_FILENAME_LENGTH } from "../../domain/files";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One uploaded file: what it is, what it belongs to, and where the bytes live.
 *
 * The bytes themselves are NOT here. A photograph in a MongoDB document is a
 * document that has to be paged into memory to answer a query about its
 * filename, and a 10MB one is four times the 4MB the driver will move
 * comfortably. So the collection holds the metadata and object storage holds
 * the file, joined by `storageKey`.
 *
 * ## This row is the access-control record
 *
 * The object store has no idea who anybody is. A bucket key is not a
 * permission, and the app never hands one out — every read goes through
 * `/api/files/[id]`, which resolves THIS row through the scoped repository
 * first. So a file is reachable exactly when its row is, which makes the
 * ordinary tenant isolation the file's isolation too, with nothing extra to
 * maintain.
 *
 * The consequence worth stating: an orphaned object — one whose row was deleted
 * — is unreadable by anybody, including the tenant that uploaded it. That is
 * the safe direction, and the purge job that eventually removes such objects is
 * a caretaking task rather than a security one.
 *
 * ## clientId is present and nullable
 *
 * Copied from whatever the file is attached to, by the action that stores it,
 * and never accepted from a request. Present so the DAL can narrow a CLIENT
 * session to files about their own equipment; nullable because a photograph of
 * the provider's own depot compressor has no counterparty, and `null` matches
 * no client filter.
 */
export const attachmentInputSchema = entity({
  /** What it is attached to. An allow-list — see `domain/files.ts`. */
  refType: attachmentRefTypeSchema,
  refId: objectId(),

  /** The counterparty, copied from the referenced document. See the header. */
  clientId: objectId("Client").nullable().optional(),

  /**
   * The object-storage key: `org/<organizationId>/<refType>/<random>.<ext>`.
   *
   * GENERATED, never derived from the uploaded filename — so there is no path
   * traversal to defend against and no collision between two people uploading
   * `photo.jpg`. Unique per organisation, enforced below, because two rows
   * pointing at one object would mean deleting one row orphans the other.
   */
  storageKey: mongo(z.string().min(8).max(300), { trim: true }),

  /**
   * The name the person recognises, sanitised.
   *
   * Kept because "chiller-2 nameplate.jpg" is meaningful and a random key is
   * not. It is a DISPLAY string and never a path: `safeDisplayName()` strips
   * control characters, quotes and separators so it is safe in a
   * `Content-Disposition` and in anything that renders it.
   */
  filename: mongo(z.string().min(1).max(MAX_FILENAME_LENGTH), { trim: true }),

  /**
   * What the SERVER decided this file is, by sniffing its first bytes — not
   * what the upload claimed.
   *
   * This is the value the download route sends back as `Content-Type`, which is
   * why it must be the sniffed one: echoing a client's claim would let somebody
   * have the app serve an `image/png` that browsers execute as something else.
   */
  contentType: mongo(z.string().min(3).max(100), { trim: true }),

  /** Bytes, as stored. Bounded by `MAX_UPLOAD_BYTES` at the route. */
  size: z.coerce.number().int().min(0),

  /**
   * SHA-256 of the stored bytes, hex.
   *
   * Not a security control — the file is not signed — but it makes two useful
   * things possible without another round trip: telling a re-upload of the same
   * photograph from a genuinely new one, and noticing that an object came back
   * from storage changed.
   */
  checksum: mongo(z.string().length(64), { trim: true }),

  /** Who uploaded it. An id, so the record survives a rename. */
  uploadedBy: objectId("User"),
});

export type AttachmentDocument = DocumentOf<typeof attachmentInputSchema>;

export const Attachment = defineModel("Attachment", attachmentInputSchema, {
  collection: "attachments",
  indexes: [
    /**
     * "What is attached to this?" — the only read the gallery makes. Tenant
     * first, then the two equality terms, then the sort key.
     */
    { fields: { organizationId: 1, refType: 1, refId: 1, createdAt: -1 } },

    /** The CLIENT-narrowed gallery. */
    { fields: { organizationId: 1, clientId: 1, createdAt: -1 } },

    /**
     * One row per object. Partial on `deletedAt: null`, so a soft-deleted row
     * does not reserve a key that has since been removed from storage.
     */
    {
      fields: { organizationId: 1, storageKey: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },
  ],
});
