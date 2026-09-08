import { z } from "zod";

import { amcContractTypeSchema, contractStatusSchema } from "../../domain/amc";
import { minorUnitsSchema } from "../../domain/currency";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One annual maintenance contract: this client, these terms, running from this
 * day to that one, worth this much, running at this compliance.
 *
 * There IS a `clientId` path, and it is REQUIRED — the inversion of
 * `WorkOrder.clientId`, which is nullable. That difference is the design.
 *
 *  - A work order's client is nullable because a fault can happen at an org-wide
 *    site: the depot's own compressor is genuinely nobody's customer's problem.
 *    A contract has no such case. A contract is an agreement WITH somebody, and
 *    the counterparty is what makes it a contract rather than a maintenance
 *    plan; `clientId: null` would describe an AMC with nobody, which has no
 *    invoice to raise and no portal user to show it to.
 *  - It is also load-bearing for visibility. The filter the DAL builds for a
 *    CLIENT session is `clientId: <theirs>`, which matches no `null`. A nullable
 *    path would therefore create a silent class of contracts that no customer
 *    can ever see, on the one module whose entire purpose is being seen by the
 *    customer.
 *
 * The presence of the path is separately what makes `createRepository()` narrow
 * a CLIENT session to its own rows rather than refusing it outright, which is
 * what `src/lib/nav/modules.ts` requires: `amc` is open to CLIENT. The two must
 * not drift — a route open to a role whose queries the DAL would refuse is a
 * 500, not a security boundary.
 *
 * The type and status vocabularies live in `src/lib/domain/amc.ts`, not here,
 * because the contract list, its filters, its KPI header, its badge and its
 * per-row action buttons are Client Components and need them as VALUES —
 * importing them from this file would pull Mongoose into the browser bundle.
 */
export const contractInputSchema = entity({
  /**
   * The counterparty. REQUIRED — see the header.
   *
   * Re-checked against the caller's organization in the action before it is
   * used: an id that arrived in a request is never trusted to be in scope.
   *
   * Deliberately NOT `{ index: true }`. A field-level hint builds a bare
   * `{ clientId: 1 }` index, which is not tenant-first: the planner may choose
   * it and then scan across every organization's contracts for that client
   * before the organizationId term filters them out. The compound below covers
   * the same query with the tenant in front.
   */
  clientId: objectId("Client"),

  /**
   * The commercial reference. Unique inside the organization, and fixed once
   * saved — it goes on invoices, and a reference that changes is a reference
   * that reconciles against nothing. Same shape and same reasoning as
   * `Client.code`.
   */
  contractNumber: mongo(
    z
      .string()
      .min(2)
      .max(32)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens"),
    { trim: true, lowercase: true },
  ),

  /** What the contract covers, in the words the client would recognise. */
  title: mongo(z.string().min(2).max(160), { trim: true }),

  /** What the price includes — comprehensive, non-comprehensive, or labour only. */
  type: amcContractTypeSchema,

  /**
   * The full term value, in HALALAS — minor units, a whole number.
   *
   * The first money field in the codebase, and the convention it sets is:
   * everything below the API boundary counts minor units, because a decimal
   * riyal amount is a float and floats do not add. See `domain/currency.ts` for
   * the conversion, which is integer arithmetic on a decimal string rather than
   * `Math.round(sar * 100)`.
   *
   * `zodToSchemaDefinition` mirrors the INCLUSIVE bounds (`min`/`max`) onto the
   * Mongoose path, so `runValidators: true` enforces them on `findOneAndUpdate`
   * too. It does NOT mirror `.int()` — integerness is enforced by zod alone,
   * which holds because the only thing ever written here is the output of
   * `sarInputSchema`.
   *
   * Currency is not stored per contract: `src/lib/i18n/request.ts` hard-codes
   * SAR in its number format, while `Organization.settings.defaultCurrency` is a
   * six-currency enum. An AED tenant already sees SAR symbols across the app;
   * this is simply the first place it shows on a money figure. When that is
   * fixed, this field needs a sibling `currency` and the halala constant in
   * `domain/currency.ts` becomes a per-currency lookup.
   */
  value: minorUnitsSchema,

  /**
   * The term. Both are DAYS, not moments — normalised to UTC midnight on the
   * way in by the action, so that `endDate < today` means the same thing for a
   * manager in Riyadh and a server in another region. See `startOfUtcDay`.
   *
   * `endDate` must be after `startDate`, and that rule is NOT here; see the note
   * on `refine` below.
   */
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),

  /**
   * How much of the contracted work has been delivered, 0–100.
   *
   * Stored and hand-entered for now, the same shape as `Asset.health`. It is a
   * candidate to be DERIVED from PPM completion once a contract is linked to the
   * schedules that discharge it — and when that happens nothing above this layer
   * changes, because the DTO already exposes it as a plain number.
   *
   * Defaults to 100 rather than 0: a contract signed this morning has had no
   * work fall due, and a fresh row that reads "0% compliant" accuses a provider
   * of failing at something that has not been asked of them yet.
   */
  compliance: z.coerce.number().int().min(0).max(100).default(100),

  /**
   * The STORED lifecycle state — three values, moved only by a person through
   * `transitionContract`. `UPCOMING`, `EXPIRING` and `EXPIRED` are not stored;
   * they are derived from the term by `effectiveContractStatus()`, because a
   * stored value for them would be wrong the moment the clock passed midnight
   * and nothing runs to correct it.
   */
  status: contractStatusSchema.default("ACTIVE"),

  /**
   * When someone suspended it, and when someone cancelled it.
   *
   * Nullable rather than absent so the paths always exist and can be projected
   * and indexed later. They are stamped by the transition action, never by a
   * form: a timestamp a client could set is not evidence that anything happened.
   */
  suspendedAt: z.coerce.date().nullable().optional(),
  cancelledAt: z.coerce.date().nullable().optional(),
});

export type ContractInput = z.input<typeof contractInputSchema>;
export type ContractDocument = DocumentOf<typeof contractInputSchema>;

/**
 * No `refine` hook, deliberately.
 *
 * The tempting invariant here — `endDate` after `startDate` — cannot be enforced
 * at this layer. `refine` registers a `pre("validate")` DOCUMENT hook, which
 * runs on `save()` and therefore on `create()`, but NOT on the
 * `findOneAndUpdate` the DAL's `update()` issues: `runValidators` runs per-path
 * validators, not document middleware. A hook here would guard the one path that
 * rarely gets a term backwards — creation, from a form with both inputs on
 * screen — and miss the one that could, which is worse than no hook because it
 * reads as protection.
 *
 * The term rule is enforced in `src/lib/amc/schemas.ts`, on the action payload,
 * where both dates are in hand and the error can be routed to the field the
 * person just typed. The same reasoning as `ppm-schedule.ts` and `work-order.ts`.
 */
export const Contract = defineModel("Contract", contractInputSchema, {
  collection: "contracts",
  indexes: [
    /**
     * The list, and three of the four derived-status filters.
     *
     * Tenant-first, as every index on a tenant-scoped collection must be. The
     * status/endDate pair is what makes "expiring" cheap: the filter is
     * `{ status: "ACTIVE", endDate: { $gte: today, $lt: horizon } }`, an
     * equality on the second key and a range on the third, which is exactly the
     * shape a compound index serves without touching a document that does not
     * match. `EXPIRED` and `ACTIVE` are the same shape with different bounds.
     */
    { fields: { organizationId: 1, status: 1, endDate: 1 } },

    /**
     * `UPCOMING`, which the index above cannot serve: its only range is on
     * `startDate` and its `endDate` is unbounded, so without this it degenerates
     * to a scan of every live contract in the tenant with `startDate` checked
     * per document. Also the read a renewals pipeline will want.
     */
    { fields: { organizationId: 1, status: 1, startDate: 1 } },

    // The default list order with no status filter: soonest renewal first. The
    // sort key has to be in an index or the tenant's whole book is sorted in
    // memory, which mongod aborts past 32MB.
    { fields: { organizationId: 1, endDate: 1 } },

    /**
     * The CLIENT-narrowed list, in list order.
     *
     * `{ organizationId, clientId }` would be a strict PREFIX of this, so this
     * one index serves every query that one would and additionally serves a
     * client's own status filter without a partition scan. Declaring both would
     * mean a second index entry written on every insert for no read that needs
     * it — the same reasoning `work-order.ts` gives for
     * `{ organizationId, clientId, status }`.
     */
    { fields: { organizationId: 1, clientId: 1, status: 1, endDate: 1 } },

    // Per-organization uniqueness of the commercial reference. Partial, so a
    // soft-deleted row does not reserve a contract number forever.
    {
      fields: { organizationId: 1, contractNumber: 1 },
      options: { unique: true, partialFilterExpression: { deletedAt: null } },
    },
  ],
});
