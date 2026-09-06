import { z } from "zod";

import { workOrderPrioritySchema, workOrderStatusSchema } from "../../domain/corrective";
import { defineModel } from "../define-model";
import { entity, mongo, objectId, type DocumentOf } from "../zod-mongoose";

/**
 * One reactive job: something on this asset is broken, this is how badly, and
 * this is where it has got to.
 *
 * The counterpart to `PpmSchedule`. A PPM row is work the calendar predicted; a
 * work order is work the building demanded, and the difference shows up in
 * three places in the shape below — the assignee is optional, the lifecycle has
 * five states instead of three, and there is a `clientId`.
 *
 * That last one is the important one. `PpmSchedule` deliberately has NO
 * `clientId` path, which is what makes `createRepository()` refuse a CLIENT
 * session outright rather than serve it the organization's whole maintenance
 * plan. This collection is the opposite case and for a real reason:
 * `src/lib/nav/modules.ts` gives `corrective` to EVERYONE, with the note
 * "Reactive work orders — the one thing a client raises directly". A customer
 * who cannot report a fault has no way into the system at all.
 *
 * So the `clientId` path is present, and its mere PRESENCE is what makes the
 * DAL treat this collection as client-partitioned and append
 * `clientId: scope.clientId` to every filter it builds. The two must not drift:
 * a route open to a role whose queries the DAL would refuse is a 500, not a
 * security boundary — and here, a `clientId` the DAL did NOT know about would
 * be worse, because the CLIENT session would be served every tenant customer's
 * faults instead of being refused.
 *
 * The priority and status vocabularies live in `src/lib/domain/corrective.ts`,
 * not here, because the ticket list, its filters, its tiles and its per-row
 * action buttons are Client Components and need them as VALUES — importing them
 * from this file would pull Mongoose into the browser bundle.
 */
export const workOrderInputSchema = entity({
  /**
   * The thing that is broken. REQUIRED: a work order with no asset is a
   * complaint, not maintenance, and nothing downstream — cost, history, the
   * asset's health score — can attach to it.
   *
   * Re-checked against the caller's organization in the action before it is
   * used; an id that arrived in a request is never trusted to be in scope.
   *
   * Deliberately NOT `{ index: true }`, for the reason `ppm-schedule.ts` gives:
   * a field-level hint builds a bare `{ assetId: 1 }` index, which is not
   * tenant-first, and the compound below already covers the query with the
   * organization in front.
   */
  assetId: objectId("Asset"),

  /**
   * Whose building this happened in — DERIVED, never entered on a form.
   *
   * Copied by the action from the asset's own `clientId`, which was itself
   * copied from the site the asset stands at (see `asset.ts`). So "a fault at
   * Acme's tower, filed against a rival" is not a state this can reach, and
   * `null` means an org-wide site such as the depot, which is invisible to
   * every CLIENT.
   *
   * It is also NOT patchable: `clientId` is in the DAL's `RESERVED_FIELDS`, so
   * `update()` strips it. Moving a ticket to an asset in another client's
   * partition is refused in the action instead — that is what keeps the
   * derivation true without needing to recompute it.
   *
   * Deliberately carries NO `{ index: true }`, for the same reason `assetId`
   * does not. A field-level hint builds a bare `{ clientId: 1 }` index, and a
   * bare index on a tenant-scoped collection is the one thing every index here
   * must not be: the planner may choose it and then walk every organization's
   * tickets for that customer before the organizationId term filters them out.
   * The `{ organizationId, clientId, status }` compound below covers the
   * client-narrowed read with the tenant in front — and it is a genuine prefix
   * match, because the filter the DAL builds for a client session is exactly
   * `{ organizationId, clientId }` with an optional status on top.
   */
  clientId: objectId("Client").nullable().optional(),

  /**
   * What is wrong, in the words of whoever noticed.
   *
   * A minimum of 5 characters because "ac" is not a fault report and the
   * technician who picks it up cannot act on it; a maximum of 2000 because this
   * is a description, not an attachment, and an unbounded string on a
   * client-writable field is a storage bill waiting to happen.
   */
  issue: mongo(z.string().min(5).max(2000), { trim: true }),

  /**
   * How badly it needs doing. REQUIRED and with no default: the person raising
   * the ticket is the person standing in front of the problem, and a default of
   * MEDIUM would quietly make every unconsidered ticket the same shape as a
   * considered one.
   */
  priority: workOrderPrioritySchema,

  /**
   * The STORED lifecycle state, moved only by a person and only along the map
   * in `src/lib/domain/corrective.ts`. Every row starts OPEN — raised, and
   * nobody's yet.
   */
  status: workOrderStatusSchema.default("OPEN"),

  /**
   * Who is doing it, once someone is.
   *
   * NULLABLE, unlike `PpmSchedule.technicianId`, and that is the whole
   * difference between planned and reactive work: a planned visit is created BY
   * a supervisor who already knows who is going, while a work order exists from
   * the moment a fault is noticed and is triaged afterwards. `OPEN` means
   * exactly "this field is still null".
   *
   * Set by `assignWorkOrder` and cleared by an unassign, never by the create or
   * update payload.
   */
  technicianId: objectId("Technician").nullable().optional(),

  /**
   * When it was given to someone, when work began, and when it was closed.
   *
   * Nullable rather than absent so the paths always exist and can be projected
   * and indexed later. They are stamped by the transition actions, never by a
   * form: a timestamp a client could set is not evidence that anything
   * happened. There is no `raisedAt` because `createdAt` from `basePlugin` is
   * already exactly that.
   */
  assignedAt: z.coerce.date().nullable().optional(),
  startedAt: z.coerce.date().nullable().optional(),
  closedAt: z.coerce.date().nullable().optional(),
});

export type WorkOrderInput = z.input<typeof workOrderInputSchema>;
export type WorkOrderDocument = DocumentOf<typeof workOrderInputSchema>;

/**
 * No `refine` hook, deliberately — the same reasoning as `ppm-schedule.ts`, and
 * it matters more here because there is more to be tempted by.
 *
 * The invariants this schema cannot enforce are real ones: ASSIGNED implies a
 * technicianId, CLOSED implies closedAt, and above all that a status change
 * followed a legal edge. But `refine` registers a `pre("validate")` DOCUMENT
 * hook, which runs on `save()` and therefore on `create()`, and NOT on the
 * `findOneAndUpdate` the DAL's `update()` issues — `runValidators` runs
 * per-path validators, not document middleware. A hook here would guard the one
 * path that never violates the rule (creation, which is always OPEN with a null
 * assignee) and miss every path that could, which is worse than no hook because
 * it reads as protection.
 *
 * And the deepest reason: a transition is not a property of the document being
 * written, it is a property of the PAIR (old status, new status). This layer
 * only ever sees the new one. The state machine is enforced in
 * `src/lib/corrective/actions.ts`, which reads the current row back through the
 * scoped repository before it decides anything.
 */
export const WorkOrder = defineModel("WorkOrder", workOrderInputSchema, {
  collection: "work_orders",
  indexes: [
    /**
     * The one the brief names, and the one the board is built on. Tenant-first,
     * as every index on a tenant-scoped collection must be: equality on status,
     * equality on priority, which is the exact shape of "show me the open
     * critical jobs" and of the `$group` behind the priority tiles.
     */
    { fields: { organizationId: 1, status: 1, priority: 1 } },

    // The status filter in list order. The sort key is in the index, so the
    // list is a walk of it rather than an in-memory sort of the tenant's
    // tickets — which the pair above cannot do, having no date in it.
    { fields: { organizationId: 1, status: 1, createdAt: -1 } },

    // A priority tile's drill-down, in the same list order.
    { fields: { organizationId: 1, priority: 1, createdAt: -1 } },

    // One person's queue: the technician filter, and the "my jobs" view a
    // mobile app will want. Status second because the useful question is
    // "what is still on Yousef", not "everything he ever touched".
    { fields: { organizationId: 1, technicianId: 1, status: 1 } },

    // Every fault ever raised on one asset — the drill-down from the register,
    // and what an asset-history view and a health score will both read.
    { fields: { organizationId: 1, assetId: 1, createdAt: -1 } },

    // The CLIENT-narrowed list. The DAL appends `clientId` to every filter for
    // a client-scoped session, so for those users this is the index that serves
    // the list and the status filter alike.
    { fields: { organizationId: 1, clientId: 1, status: 1 } },
  ],
});
