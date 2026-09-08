import { z } from "zod";

import { contractInputSchema } from "@/lib/db";
import { amcContractTypeSchema, contractDisplayStatusSchema } from "@/lib/domain/amc";
import { sarInputSchema } from "@/lib/domain/currency";
import { objectIdString, pageParams } from "@/lib/validation/primitives";

/**
 * Every payload that reaches an AMC action is parsed here first.
 *
 * DERIVED from `contractInputSchema` rather than restated beside it, which is
 * the point of the zod-first pattern in CLAUDE.md: the model is the single
 * source of truth, so a bound or a coercion that changes there changes here too,
 * and the two cannot drift into a state where the database accepts something the
 * form rejects — or, far worse, the reverse.
 *
 * What the derivation deliberately changes:
 *
 *  - `organizationId` is never a field. It comes from the session's scope, and a
 *    payload that could name a tenant would defeat data isolation entirely.
 *  - `clientId` is on CREATE only, as a hex string, and is re-checked against
 *    the caller's organization in the action. It is not patchable: it sits in
 *    the DAL's `RESERVED_FIELDS`, and moving a contract between customers is a
 *    new contract, not an edit.
 *  - `contractNumber` is on create only. It goes on invoices, and a reference
 *    that changes is a reference that reconciles against nothing — the same rule
 *    as `Client.code`.
 *  - `status` is never a field. It is moved only by `transitionContract`, which
 *    reads the current value first and checks it against `CONTRACT_TRANSITIONS`;
 *    a patchable status would let a caller cancel a contract without the
 *    timestamp that records it.
 *  - `suspendedAt` and `cancelledAt` are never fields. A timestamp a client
 *    could choose is not evidence that anything happened.
 *  - `value` is the one field NOT derived from the model, and that break is
 *    deliberate — see `moneyField` below.
 *
 * `entity()` builds a `z.strictObject`, and `pick`/`partial`/`extend` preserve
 * that, so an unknown key is still rejected everywhere below. `.superRefine()`
 * preserves it too, and additionally is skipped when an inner field fails to
 * parse — so the term check below never sees a value that is not a `Date`.
 */

/**
 * The one field the derivation deliberately breaks.
 *
 * The model stores HALALAS — a whole number of minor units, because a decimal
 * riyal amount is a float and floats do not add. A person types RIYALS. This is
 * the only layer where both representations are in scope, so this is where the
 * conversion belongs; `sarInputSchema` does it by integer arithmetic on the
 * decimal string rather than `Math.round(sar * 100)`, for the reason spelled out
 * in `src/lib/domain/currency.ts`.
 *
 * `schemas.test.ts` asserts this field is NOT `contractInputSchema.shape.value`,
 * so that the break cannot be quietly "fixed" by someone tidying the file back
 * into a pure `.pick()`.
 */
const moneyField = sarInputSchema;

/** The fields a person actually fills in, taken straight from the model. */
const contractFields = {
  title: true,
  type: true,
  startDate: true,
  endDate: true,
  compliance: true,
} as const;

/**
 * `endDate` must be strictly after `startDate`.
 *
 * `path: ["endDate"]` is what turns this into `fieldErrors.endDate`:
 * `fieldErrorsFrom()` in `src/lib/security/errors.ts` keys its map on
 * `issue.path.join(".") || "_"`, and an issue with an empty path lands under
 * `_`, where the form has nowhere to render it — the field would go
 * un-highlighted and the message would vanish. It is reported on the END date
 * rather than the start because that is the one the person just typed and the
 * one they can fix without rethinking the contract.
 *
 * Strictly after, not on-or-after: a term of zero days is not a contract, and
 * `EXPIRING` and `EXPIRED` would both be true of it on its only day.
 */
function assertEndAfterStart(
  input: { startDate?: Date; endDate?: Date },
  ctx: z.RefinementCtx,
): void {
  const { startDate, endDate } = input;
  if (!startDate || !endDate) return;

  if (endDate.getTime() <= startDate.getTime()) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The end date must be after the start date.",
    });
  }
}

export const createContractSchema = contractInputSchema
  .pick(contractFields)
  .extend({
    clientId: objectIdString,
    contractNumber: contractInputSchema.shape.contractNumber,
    value: moneyField,
  })
  .superRefine(assertEndAfterStart);

/**
 * What can be corrected after the fact: the title, the terms, the value, the
 * term itself and the compliance figure. Not the client, not the contract
 * number, not the status.
 */
export const updateContractSchema = contractInputSchema
  .pick(contractFields)
  .partial()
  .extend({
    id: objectIdString,
    value: moneyField.optional(),
  })
  .superRefine((input, ctx) => {
    /**
     * A term is a PAIR, and this layer only ever sees the payload — so a patch
     * that moves one end and not the other cannot be checked here at all.
     *
     * Reading the row back and comparing against the stored other half would
     * work, and it is the wrong answer: it puts the term rule in two places
     * (here for create, the action for update) and the two drift the first time
     * someone changes `<=` to `<`. Refusing the half-payload keeps ONE rule —
     * every write that touches the term carries the WHOLE term, and the whole
     * term is checked right here, without a database round trip, which is also
     * what makes it assertable in `schemas.test.ts`.
     *
     * That the rule is complete is an induction, and it is worth stating: a row
     * is created with a checked pair; the only other write path that touches
     * either date is this one, which either carries both (checked) or neither
     * (leaving a pair that was already valid); `transitionContract` writes only
     * `status` and a timestamp. So no reachable sequence of writes can leave a
     * term inverted.
     *
     * Nothing legitimate is refused: the edit sheet renders both date inputs and
     * always submits both, the way every other edit sheet in this app submits
     * its whole form. What is refused is a hand-rolled request that would
     * otherwise have left the row with `endDate` before `startDate` and no error
     * anywhere.
     */
    const hasStart = input.startDate !== undefined;
    const hasEnd = input.endDate !== undefined;

    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: "custom",
        // Point at the one that is MISSING, so the form highlights the empty
        // input rather than the one the person just filled in.
        path: [hasStart ? "endDate" : "startDate"],
        message: "Change both dates together, or neither.",
      });
      return;
    }

    assertEndAfterStart(input, ctx);
  });

export const deleteContractSchema = z.strictObject({ id: objectIdString });

/**
 * Suspend, resume, cancel.
 *
 * One schema and one action rather than three, because the rule they share —
 * `canTransitionContract(current, to)` — is the thing being enforced, and three
 * handlers would be three places for it to be forgotten. `to` is validated
 * against the STORED status enum here, which only proves it names a status
 * somebody could move a row to; whether it is reachable from where the row
 * actually is can only be decided by the action, which reads the row first.
 */
export const transitionContractSchema = z.strictObject({
  id: objectIdString,
  to: contractInputSchema.shape.status,
});

export const listContractsSchema = z.strictObject({
  ...pageParams,
  /**
   * The DISPLAY vocabulary, not the stored one — the opposite of the corrective
   * list, and the same as the preventive list.
   *
   * A person filters for "expiring", which is not a value any row holds. The
   * name selects a branch of `contractStatusQueryFragment`, which returns a
   * code-authored fragment for the DAL's TRUSTED `where` channel; the name
   * itself never reaches a query.
   */
  status: contractDisplayStatusSchema.optional(),
  type: amcContractTypeSchema.optional(),
  clientId: objectIdString.optional(),
  /**
   * No free-text `q`, deliberately.
   *
   * `prefixFilter` is safe but it is only CHEAP when an index leads with the
   * field being matched, and there is no `{ organizationId, title }` index here
   * — the indexes on this collection all lead with `status` or `endDate`,
   * because that is what the screen actually filters and sorts by. Adding a
   * search box would mean either an unindexed prefix scan of the tenant's whole
   * book on every keystroke, or a sixth index written on every insert for a
   * filter nobody asked for. When contract search is wanted, it arrives with the
   * index that makes it answerable.
   */
});

export const summariseContractsSchema = z.strictObject({});

export type CreateContractInput = z.input<typeof createContractSchema>;
export type UpdateContractInput = z.input<typeof updateContractSchema>;
export type TransitionContractInput = z.input<typeof transitionContractSchema>;
export type ListContractsInput = z.input<typeof listContractsSchema>;
