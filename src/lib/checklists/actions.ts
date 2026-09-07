"use server";

import { revalidatePath } from "next/cache";

import {
  checklistRunsRepository,
  checklistsRepository,
  connectToDatabase,
  ppmSchedulesRepository,
  toObjectId,
  workOrdersRepository,
  type ChecklistDocument,
  type ChecklistRunDocument,
  type ChecklistRunItem,
  type Page,
  type TenantScope,
} from "@/lib/db";
import { canCompleteRun, type ChecklistJobType } from "@/lib/domain/checklists";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { toChecklistSummary, type ChecklistRunSummary, type ChecklistSummary } from "./dto";
import {
  CHECKLIST_MANAGERS,
  CHECKLIST_READERS,
  CHECKLIST_RUNNERS,
  listChecklistRunsForScope,
  listChecklistsForScope,
  toRunSummaryForScope,
} from "./queries";
import {
  completeChecklistRunSchema,
  createChecklistSchema,
  deleteChecklistRunSchema,
  deleteChecklistSchema,
  listChecklistRunsSchema,
  listChecklistsSchema,
  setChecklistRunItemSchema,
  startChecklistRunSchema,
  updateChecklistSchema,
} from "./schemas";

/**
 * Write access to checklists.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md. Everything above
 * the business rule comes from `defineAction`: authenticate, check the role,
 * resolve the tenant scope, rate limit, parse with zod — in that order, once,
 * for all of them. What is left in each handler is the part that is actually
 * about the entity, which here is three things:
 *
 *  1. a job id that arrived in a request is never trusted to be in scope, and
 *     which COLLECTION to check it against is a function of `jobType`;
 *  2. a run's content is snapshot from a template the server read, never
 *     supplied by the caller;
 *  3. a run cannot be signed off until every required line is ticked, checked
 *     against the row as it actually is rather than as the payload claims.
 */

const REVALIDATE_PATH = "/[locale]/app/checklists";

// ---------------------------------------------------------------------------
// Scope re-checks
// ---------------------------------------------------------------------------

async function requireChecklistInScope(
  scope: TenantScope,
  id: string,
): Promise<ChecklistDocument> {
  const checklist = await checklistsRepository.forScope(scope).findById(id);
  if (!checklist) throw new NotFoundError(`checklist ${id} not in scope`);
  return checklist;
}

async function requireRunInScope(scope: TenantScope, id: string): Promise<ChecklistRunDocument> {
  const run = await checklistRunsRepository.forScope(scope).findById(id);
  if (!run) throw new NotFoundError(`checklist run ${id} not in scope`);
  return run;
}

/**
 * Prove the job exists inside the caller's tenant, and is still worth attaching
 * a checklist to.
 *
 * The polymorphism is handled here and nowhere else. `jobType` selects the
 * repository, and the read is `findById` through a SCOPED one — so an id from
 * another organization is a filter term that matches nothing and fails here
 * with a field message, rather than becoming a run pointing at a job the caller
 * cannot see.
 *
 * The terminal-state check is the second half, and it is a real rule rather
 * than tidiness: a checklist is a record of work being done, so attaching one
 * to a CLOSED work order or a COMPLETED visit would produce evidence dated
 * after the job it claims to describe. If the job needs more work, it gets
 * reopened or re-raised — and on a work order that means re-raised, because
 * CLOSED is terminal there too.
 */
async function requireOpenJobInScope(
  scope: TenantScope,
  jobType: ChecklistJobType,
  jobId: string,
): Promise<void> {
  if (jobType === "PPM") {
    const schedule = await ppmSchedulesRepository
      .forScope(scope)
      .findById(jobId, { select: ["_id", "status"] });

    if (!schedule) {
      throw new ValidationError(`ppm schedule ${jobId} is outside the actor's scope`, {
        jobId: "Unknown visit.",
      });
    }

    if (schedule.status === "COMPLETED") {
      throw new ValidationError(`ppm schedule ${jobId} is already completed`, {
        jobId: "That visit is already completed.",
      });
    }

    return;
  }

  const workOrder = await workOrdersRepository
    .forScope(scope)
    .findById(jobId, { select: ["_id", "status"] });

  if (!workOrder) {
    throw new ValidationError(`work order ${jobId} is outside the actor's scope`, {
      jobId: "Unknown work order.",
    });
  }

  if (workOrder.status === "CLOSED") {
    throw new ValidationError(`work order ${jobId} is closed`, {
      jobId: "That work order is closed.",
    });
  }
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const runCreateChecklist = defineAction({
  name: "createChecklist",
  roles: CHECKLIST_MANAGERS,
  input: createChecklistSchema,
  async handler({ input, scope }): Promise<ChecklistSummary> {
    await connectToDatabase();

    /**
     * `items` is written exactly as parsed — sanitised, bounded and in the
     * order the builder produced. No de-duplication and no re-ordering here:
     * the array's order IS the procedure's order, and a server that quietly
     * sorted it would be rewriting the method statement.
     *
     * A duplicate name inside the tenant is caught by the partial unique index
     * on the model, and `normaliseError` turns Mongo's 11000 into a CONFLICT
     * envelope. Deliberately not pre-checked with a read: a check-then-write
     * loses the race it exists to prevent, and the index does not.
     */
    const created = await checklistsRepository.forScope(scope).create({
      name: input.name,
      category: input.category,
      items: input.items,
      lastUsedAt: null,
    });

    revalidatePath(REVALIDATE_PATH, "page");
    return toChecklistSummary(created);
  },
});

const runUpdateChecklist = defineAction({
  name: "updateChecklist",
  roles: CHECKLIST_MANAGERS,
  input: updateChecklistSchema,
  async handler({ input, scope }): Promise<ChecklistSummary> {
    await connectToDatabase();

    const { id, ...patch } = input;
    await requireChecklistInScope(scope, id);

    /**
     * Editing a template does NOT touch any run it has already produced, and
     * that is the point of the snapshot in `checklist-run.ts`. Rewording a line
     * here changes what gets asked NEXT time; what a technician confirmed last
     * quarter stays exactly as they confirmed it.
     */
    const updated = await checklistsRepository.forScope(scope).update(id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.category ? { category: patch.category } : {}),
      ...(patch.items ? { items: patch.items } : {}),
    });

    if (!updated) throw new NotFoundError(`checklist ${id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return toChecklistSummary(updated);
  },
});

const runDeleteChecklist = defineAction({
  name: "deleteChecklist",
  roles: CHECKLIST_MANAGERS,
  input: deleteChecklistSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    /**
     * Soft delete, so the runs it produced keep working. They carry their own
     * copy of everything they need to be read — name, category, items — so a
     * retired procedure does not take its own history with it, and the partial
     * unique index releases the name for a rewrite.
     */
    const deleted = await checklistsRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`checklist ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return { id: input.id };
  },
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const runStartChecklistRun = defineAction({
  name: "startChecklistRun",
  roles: CHECKLIST_RUNNERS,
  input: startChecklistRunSchema,
  async handler({ input, scope }): Promise<ChecklistRunSummary> {
    await connectToDatabase();

    const [checklist] = await Promise.all([
      requireChecklistInScope(scope, input.checklistId),
      requireOpenJobInScope(scope, input.jobType, input.jobId),
    ]);

    const jobId = toObjectId(input.jobId);
    const checklistId = toObjectId(input.checklistId);
    // Both were validated as 24 hex characters by the schema and then proved in
    // scope above, so this is unreachable; it is here because the types say the
    // coercion can fail and a non-null assertion would say something we have not
    // proved.
    if (!jobId || !checklistId) throw new NotFoundError("unparseable id after validation");

    /**
     * Attaching twice is not an error, it is the same attachment.
     *
     * Pressing Run again — a double tap, a reload, a second technician opening
     * the same job — must not produce two half-ticked copies of one procedure,
     * because an auditor reading them cannot tell which one happened. So an
     * existing run for this (job, template) is RETURNED rather than refused:
     * the caller gets the sheet they meant to open, already showing whatever
     * has been ticked so far.
     *
     * This is the cooperative half. The partial unique index on the model is
     * the backstop for the concurrent case this read cannot see, where it
     * becomes a CONFLICT envelope instead of a duplicate row.
     */
    const existing = await checklistRunsRepository.forScope(scope).findOne({
      jobType: input.jobType,
      jobId,
      checklistId,
    });

    if (existing) return toRunSummaryForScope(scope, existing);

    /**
     * The snapshot. Everything the run needs to be read as a record is COPIED
     * from the template the server just read — never taken from the payload,
     * which is what stops a caller filing a record claiming a technician
     * confirmed lines that were never in the procedure.
     */
    const items: ChecklistRunItem[] = checklist.items.map((item) => ({
      label: item.label,
      required: item.required,
      done: false,
      note: null,
      completedAt: null,
    }));

    const created = await checklistRunsRepository.forScope(scope).create({
      checklistId: checklist._id,
      checklistName: checklist.name,
      category: checklist.category,
      jobType: input.jobType,
      jobId,
      items,
      status: "IN_PROGRESS",
    });

    /**
     * "Last used" is stamped on ATTACHMENT rather than on completion, and the
     * difference is deliberate: the library's purpose for this field is "what
     * do we reach for", and a procedure someone started and abandoned was still
     * reached for. A separate write rather than part of the create above,
     * because they are two collections — and a failure here must not lose the
     * run, so it is not awaited as a precondition of anything.
     */
    await checklistsRepository.forScope(scope).update(checklist._id, { lastUsedAt: new Date() });

    revalidatePath(REVALIDATE_PATH, "page");
    return toRunSummaryForScope(scope, created);
  },
});

const runSetChecklistRunItem = defineAction({
  name: "setChecklistRunItem",
  roles: CHECKLIST_RUNNERS,
  input: setChecklistRunItemSchema,
  async handler({ input, scope }): Promise<ChecklistRunSummary> {
    await connectToDatabase();

    const run = await requireRunInScope(scope, input.runId);

    // A completed run is a signed statement about work that was done. Ticking a
    // line on one afterwards would change what the record SAYS happened, which
    // is the one thing an audit trail must not permit.
    if (run.status === "COMPLETED") {
      throw new ValidationError(`run ${input.runId} is completed and cannot be changed`, {
        runId: "This checklist is already signed off.",
      });
    }

    /**
     * The index is bounded by the schema against the array CAP, and here
     * against this run's ACTUAL length. The second check is the one that
     * matters: a template of six lines produces a run of six, and index 12 is a
     * well-formed number that names nothing.
     */
    if (input.index >= run.items.length) {
      throw new ValidationError(
        `index ${input.index} is past the end of run ${input.runId}`,
        { index: "That line is not on this checklist." },
      );
    }

    const now = new Date();

    /**
     * The whole array is rewritten, not one element.
     *
     * MongoDB addresses an array element through a dotted path (`items.3.done`)
     * and the DAL's sanitizer refuses dotted keys by design — they are the
     * mechanism a filter uses to reach into a nested document, and allowing
     * them from feature code would reopen exactly the hole the sanitizer
     * closes. So the run is read, the array is rebuilt in memory, and it goes
     * back as one `$set`.
     *
     * The honest cost: two technicians ticking different lines of the same run
     * within the same round trip will have the later write win the whole array,
     * losing the earlier tick. That is a real race and it is accepted here
     * rather than hidden — the alternative is a positional update the DAL
     * cannot express safely, or optimistic concurrency on a version field,
     * which is worth adding the day two people genuinely share one sheet. Today
     * a run belongs to whoever is standing in front of the plant.
     *
     * `label` and `required` are re-emitted untouched. They are the snapshot,
     * and this write is the one place a bug could quietly rewrite them.
     */
    const items: ChecklistRunItem[] = run.items.map((item, index) => {
      if (index !== input.index) return item;

      return {
        label: item.label,
        required: item.required,
        done: input.done,
        // `undefined` leaves the note alone, `null` clears it, a string sets
        // it. An empty string collapses to null so a cleared field and an
        // untouched one are stored the same way.
        note: input.note === undefined ? (item.note ?? null) : (input.note || null),
        // Cleared when the line is un-ticked: a completion time on a line
        // nobody has ticked is a timestamp for something that did not happen.
        completedAt: input.done ? (item.completedAt ?? now) : null,
      };
    });

    const updated = await checklistRunsRepository.forScope(scope).update(input.runId, { items });
    if (!updated) throw new NotFoundError(`checklist run ${input.runId} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return toRunSummaryForScope(scope, updated);
  },
});

const runCompleteChecklistRun = defineAction({
  name: "completeChecklistRun",
  roles: CHECKLIST_RUNNERS,
  input: completeChecklistRunSchema,
  async handler({ input, scope, user }): Promise<ChecklistRunSummary> {
    await connectToDatabase();

    const run = await requireRunInScope(scope, input.runId);

    if (run.status === "COMPLETED") {
      throw new ValidationError(`run ${input.runId} is already completed`, {
        runId: "This checklist is already signed off.",
      });
    }

    /**
     * The rule, checked against the row as it ACTUALLY is.
     *
     * `canCompleteRun` is the same predicate the sheet disables its button
     * from, which is what stops a greyed-out button and a server rejection ever
     * disagreeing — but the sheet is reading a copy that may be a round trip
     * out of date, and this is reading the row. A field message on `runId`
     * tells the client the sheet moved under it, exactly as the corrective
     * transitions do.
     */
    if (!canCompleteRun(run.items)) {
      throw new ValidationError(`run ${input.runId} has required items outstanding`, {
        runId: "Every required line has to be ticked first.",
      });
    }

    const updated = await checklistRunsRepository.forScope(scope).update(input.runId, {
      status: "COMPLETED",
      completedAt: new Date(),
      /**
       * Who signed it — the authenticated USER from the session, never a value
       * from the payload. Most technicians never sign in (see
       * `db/models/technician.ts`), so the person named on the job is not
       * reliably the person holding the phone; what we can prove is who was
       * authenticated when the button was pressed, and that is what the record
       * should say.
       */
      completedByUserId: user.id,
    });

    if (!updated) throw new NotFoundError(`checklist run ${input.runId} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return toRunSummaryForScope(scope, updated);
  },
});

const runDeleteChecklistRun = defineAction({
  name: "deleteChecklistRun",
  roles: CHECKLIST_MANAGERS,
  input: deleteChecklistRunSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    /**
     * The module's only correction path, and it is a MANAGER's, not a runner's.
     *
     * COMPLETED is terminal, so a run signed off in error cannot be reopened —
     * that would make `completedAt` a lie. It is discarded instead and the
     * checklist re-attached, which leaves both the discarded row (soft-deleted,
     * restorable by an administrator) and a fresh run in the record. A runner
     * who could do this could quietly erase a sheet they did not like.
     */
    const deleted = await checklistRunsRepository.forScope(scope).delete(input.runId);
    if (!deleted) throw new NotFoundError(`checklist run ${input.runId} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return { id: input.runId };
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const runListChecklists = defineAction({
  name: "listChecklists",
  roles: CHECKLIST_READERS,
  input: listChecklistsSchema,
  // A read behind a session. The mutation limiter exists to bound writes.
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<ChecklistSummary>> {
    await connectToDatabase();
    return listChecklistsForScope(scope, input);
  },
});

const runListChecklistRuns = defineAction({
  name: "listChecklistRuns",
  roles: CHECKLIST_READERS,
  input: listChecklistRunsSchema,
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<ChecklistRunSummary>> {
    await connectToDatabase();
    return listChecklistRunsForScope(scope, input);
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
//
// `defineAction` returns a value, and a "use server" module may only export
// async functions — so the wrappers are assigned to module consts above and
// re-exported as real async functions here. The one that pairs with
// `useActionState` takes `(previous, payload)`; the rest take a payload.

export async function createChecklistAction(
  _previous: ActionResult<ChecklistSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<ChecklistSummary>> {
  return runCreateChecklist(payload);
}

export async function updateChecklistAction(
  _previous: ActionResult<ChecklistSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<ChecklistSummary>> {
  return runUpdateChecklist(payload);
}

export async function deleteChecklistAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runDeleteChecklist(payload);
}

export async function startChecklistRunAction(
  payload: unknown,
): Promise<ActionResult<ChecklistRunSummary>> {
  return runStartChecklistRun(payload);
}

export async function setChecklistRunItemAction(
  payload: unknown,
): Promise<ActionResult<ChecklistRunSummary>> {
  return runSetChecklistRunItem(payload);
}

export async function completeChecklistRunAction(
  payload: unknown,
): Promise<ActionResult<ChecklistRunSummary>> {
  return runCompleteChecklistRun(payload);
}

export async function deleteChecklistRunAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runDeleteChecklistRun(payload);
}

export async function listChecklistsAction(
  payload: unknown,
): Promise<ActionResult<Page<ChecklistSummary>>> {
  return runListChecklists(payload);
}

export async function listChecklistRunsAction(
  payload: unknown,
): Promise<ActionResult<Page<ChecklistRunSummary>>> {
  return runListChecklistRuns(payload);
}
