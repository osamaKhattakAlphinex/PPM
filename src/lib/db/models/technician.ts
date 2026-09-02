import { z } from "zod";

import {
  MAX_SKILLS,
  SKILL_MAX_LENGTH,
  technicianStatusSchema,
  tradeSchema,
} from "../../domain/technicians";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * A person who does the work.
 *
 * Deliberately NOT a `User`. Most technicians on a Gulf FM contract never sign
 * in — they are dispatched on paper or through a supervisor's phone — so making
 * an account a precondition for existing in the system would mean either
 * fabricating credentials for people who will never use them, or leaving the
 * workforce unrepresented. So this is its own record, and `userId` is an
 * OPTIONAL link to the account that person signs in with when they have one.
 *
 * There is no `clientId` path, and that absence is doing real work: it makes
 * the collection un-narrowable to a single customer, so `createRepository()`
 * refuses a CLIENT session outright rather than widening it to the whole
 * organization. A customer must not be able to enumerate its provider's
 * workforce. See the note in `repositories/technicians.ts`.
 *
 * The trade and status vocabularies live in `src/lib/domain/technicians.ts`,
 * not here, because the directory grid is a Client Component and must be able
 * to import them without pulling Mongoose into the browser bundle.
 */
export const technicianInputSchema = entity({
  name: mongo(z.string().min(2).max(120), { trim: true }),

  trade: tradeSchema,

  /**
   * Free-text competencies — "chiller overhaul", "brazing", "VRF commissioning".
   * A flat array of strings rather than a reference to a skills collection: a
   * tenant's vocabulary is its own, it changes with every contract, and forcing
   * it through an admin-managed taxonomy is how skills lists end up empty.
   * Bounded in both directions so the array cannot become an unindexed blob.
   */
  skills: z
    .array(mongo(z.string().min(1).max(SKILL_MAX_LENGTH), { trim: true }))
    .max(MAX_SKILLS)
    .default([]),

  status: technicianStatusSchema.default("ACTIVE"),

  /**
   * The account this person signs in with, when they have one.
   *
   * Nullable and patchable — unlike `Location.clientId`, linking is genuinely
   * reversible: an account is created after the technician record more often
   * than before it, and a technician who leaves has their account unlinked
   * rather than their history rewritten. The uniqueness of the link is enforced
   * by the partial index below, so one account cannot be two technicians.
   *
   * The ROLE of the linked account is checked in the action, not here: the
   * value lives in another collection, and a schema validator that reached into
   * one would be a cross-collection read outside the DAL.
   */
  userId: objectId("User").nullable().optional(),
});

export type TechnicianInput = z.input<typeof technicianInputSchema>;
export type TechnicianDocument = DocumentOf<typeof technicianInputSchema>;

export const Technician = defineModel("Technician", technicianInputSchema, {
  collection: "technicians",
  indexes: [
    /**
     * Tenant-first, as every index on a tenant-scoped collection must be.
     * "who can do HVAC" is the question this module exists to answer — a
     * dispatcher asks it for every work order — so it gets its own index.
     */
    { fields: { organizationId: 1, trade: 1 } },
    // The default list order, and what the anchored `^name` prefix search rides.
    { fields: { organizationId: 1, name: 1 } },
    // The filtered list: available people in one trade.
    { fields: { organizationId: 1, status: 1, trade: 1 } },
    // Multikey, for the "everyone with this skill" filter behind a skill chip.
    { fields: { organizationId: 1, skills: 1 } },
    /**
     * One account, one technician.
     *
     * `$type: "objectId"` rather than `$exists: true`: an unlinked technician
     * stores `userId: null`, and `$exists` matches a present-but-null field, so
     * the second unlinked technician in a tenant would collide with the first.
     * `deletedAt: null` releases the link when a technician is soft-deleted.
     */
    {
      fields: { organizationId: 1, userId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { userId: { $type: "objectId" }, deletedAt: null },
      },
    },
  ],
});
