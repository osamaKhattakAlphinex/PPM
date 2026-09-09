import { z } from "zod";

/**
 * The three reports, as a vocabulary.
 *
 * A module of its own so the report picker — a Client Component — can import
 * these as VALUES without dragging `queries.ts` (and therefore the whole
 * data-access layer, and therefore Mongoose) into the browser bundle. The same
 * rule every `src/lib/domain/*` file follows.
 *
 * Pure: zod and three strings. Safe from anywhere.
 */
export const REPORT_KINDS = ["PM", "ASSET", "FINANCIAL"] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export const reportKindSchema = z.enum(REPORT_KINDS);
