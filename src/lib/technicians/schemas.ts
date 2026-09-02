import { z } from "zod";

import { technicianInputSchema } from "@/lib/db";
import {
  MAX_SKILLS,
  SKILL_MAX_LENGTH,
  technicianStatusSchema,
  tradeSchema,
} from "@/lib/domain/technicians";
import { objectIdString, pageParams, searchTerm } from "@/lib/validation/primitives";

/**
 * Every payload that reaches a technician action is parsed here first.
 *
 * Derived from `technicianInputSchema` rather than restated beside it, for the
 * reason CLAUDE.md gives: the model is the single source of truth, so a bound
 * that changes there changes here, and the database can never accept something
 * the form rejects — or, far worse, the reverse.
 *
 * What the derivation deliberately changes:
 *
 *  - `organizationId` is never a field. It comes from the session's scope, and
 *    a payload that could name a tenant would defeat the data-isolation rule.
 *  - ids arrive as 24-character hex strings, because that is what a form and a
 *    JSON body carry. The DAL converts them and still treats them as filter
 *    terms with the scope layered on top.
 *  - `skills` is re-declared rather than picked, because the wire form needs a
 *    normalisation the stored form does not (see below).
 *
 * `entity()` builds a `z.strictObject`, and `pick`/`partial`/`extend` preserve
 * that, so an unknown key is rejected by every schema below.
 */

/**
 * The skills array as it arrives from the chip editor.
 *
 * Trimmed, deduplicated case-insensitively, and capped — all three at the edge
 * rather than in the UI, because the UI is not the only caller and a duplicate
 * "HVAC"/"hvac" pair would make the skill filter return the same technician
 * from two different chips. The FIRST spelling of a skill wins, so the casing a
 * tenant actually types is what gets stored and displayed.
 *
 * The bounds come from the model, so widening one widens both.
 */
const skillList = z
  .array(z.string().trim().min(1).max(SKILL_MAX_LENGTH))
  .max(MAX_SKILLS)
  .transform((skills) => {
    const unique = new Map<string, string>();
    for (const skill of skills) {
      const key = skill.toLocaleLowerCase();
      if (!unique.has(key)) unique.set(key, skill);
    }
    return [...unique.values()];
  });

/** One skill, as a filter value. Matched exactly — chips are clicked, not typed. */
const skillTerm = z.string().trim().min(1).max(SKILL_MAX_LENGTH);

/**
 * `userId` is optional and nullable, and both mean something different:
 * absent leaves the link alone on an update, `null` unlinks. The id is proved
 * to be a TECHNICIAN-role account inside the caller's organization by the
 * action — a schema cannot check that without reading another collection.
 */
export const createTechnicianSchema = technicianInputSchema
  .pick({ name: true, trade: true, status: true })
  .extend({
    skills: skillList.optional(),
    userId: objectIdString.nullish(),
  });

export const updateTechnicianSchema = technicianInputSchema
  .pick({ name: true, trade: true, status: true })
  .partial()
  .extend({
    id: objectIdString,
    skills: skillList.optional(),
    userId: objectIdString.nullish(),
  });

export const deleteTechnicianSchema = z.strictObject({ id: objectIdString });

export const listTechniciansSchema = z.strictObject({
  ...pageParams,
  status: technicianStatusSchema.optional(),
  trade: tradeSchema.optional(),
  /** Everyone who has this exact skill. Backed by the multikey index. */
  skill: skillTerm.optional(),
  /** Anchored prefix match on the name. See `prefixFilter` in the DAL. */
  q: searchTerm.optional(),
});

export type CreateTechnicianInput = z.input<typeof createTechnicianSchema>;
export type UpdateTechnicianInput = z.input<typeof updateTechnicianSchema>;
export type ListTechniciansInput = z.input<typeof listTechniciansSchema>;
