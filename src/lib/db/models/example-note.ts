import { z } from "zod";

import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * EXAMPLE ONLY — delete this file when the first real entity lands.
 *
 * It exists to show the zod-first pattern end to end and to give the schema
 * tests something to introspect. It is not part of the product domain.
 */

// 1. The zod schema is the source of truth. Strict: unknown keys are rejected.
export const noteInputSchema = entity({
  title: mongo(z.string().min(1).max(120), { trim: true }),
  body: z.string().max(5_000).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  pinned: z.boolean().default(false),
  tags: z.array(z.string().min(1).max(24)).max(10).default([]),
  authorId: objectId("User"),
  reminderAt: z.date().nullable().optional(),
});

/** What a caller may send. Ids arrive as strings. */
export type NoteInput = z.input<typeof noteInputSchema>;

/** What is stored: the zod output plus organizationId and the base fields. */
export type NoteDocument = DocumentOf<typeof noteInputSchema>;

/** Patch payload: every field optional, still strict about unknown keys. */
export const noteUpdateSchema = noteInputSchema.partial();

// 2. The Mongoose model is derived. organizationId, createdAt, updatedAt and
//    deletedAt are added by the global base plugin — never declared here.
export const ExampleNote = defineModel("ExampleNote", noteInputSchema, {
  collection: "example_notes",
  indexes: [
    // Tenant-first, as every index on a tenant-scoped collection must be.
    { fields: { organizationId: 1, status: 1, createdAt: -1 } },
    { fields: { organizationId: 1, authorId: 1, deletedAt: 1 } },
  ],
});
