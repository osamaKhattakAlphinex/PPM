"use server";

import { revalidatePath } from "next/cache";

import {
  assetsRepository,
  connectToDatabase,
  ppmSchedulesRepository,
  techniciansRepository,
  type Page,
  type PpmScheduleDocument,
  type PpmTypeCount,
  type TenantScope,
} from "@/lib/db";
import { startOfUtcDay } from "@/lib/domain/preventive";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { toPpmScheduleSummary, type PpmScheduleSummary } from "./dto";
import {
  listPpmSchedulesForScope,
  summarisePpmSchedulesForScope,
  PPM_EXECUTORS,
  PPM_MANAGERS,
  PPM_READERS,
} from "./queries";
import {
  completePpmScheduleSchema,
  createPpmScheduleSchema,
  deletePpmScheduleSchema,
  listPpmSchedulesSchema,
  startPpmScheduleSchema,
  summarisePpmSchedulesSchema,
  updatePpmScheduleSchema,
} from "./schemas";

/**
 * The write side of preventive maintenance.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md. Everything above the
 * business rule comes from `defineAction`: authenticate, check the role, resolve
 * the tenant scope, rate limit, parse with zod — in that order, once, for all of
 * them. What is left in each handler is the part that is actually about the
 * entity, which here is two things: proving the ids belong to the caller's
 * tenant, and keeping the state machine honest.
 */

const REVALIDATE_PATH = "/[locale]/app/preventive";

/**
 * Read an asset back through the SCOPED repository.
 *
 * An `assetId` that arrived in a request is never trusted to live inside the
 * caller's tenant. `findById` treats the id as a filter term with organizationId
 * layered on top, so one from another organization matches nothing and fails
 * here with a field message rather than being written against plant the tenant
 * cannot see.
 */
async function requireAssetInScope(scope: TenantScope, assetId: string): Promise<void> {
  const asset = await assetsRepository.forScope(scope).findById(assetId, { select: ["_id"] });
  if (!asset) {
    throw new ValidationError(`assetId ${assetId} is outside the actor's scope`, {
      assetId: "Unknown asset.",
    });
  }
}

/** The same, for the person the visit is assigned to. */
async function requireTechnicianInScope(
  scope: TenantScope,
  technicianId: string,
): Promise<void> {
  const person = await techniciansRepository
    .forScope(scope)
    .findById(technicianId, { select: ["_id"] });
  if (!person) {
    throw new ValidationError(`technicianId ${technicianId} is outside the actor's scope`, {
      technicianId: "Unknown technician.",
    });
  }
}

/**
 * The row this action is about, or a 404.
 *
 * The id is never trusted to belong to the caller's tenant: `findById` layers
 * organizationId on top, so one from another organization matches nothing. The
 * 404 is deliberately indistinguishable from a scoping refusal — see
 * `NotFoundError`.
 */
async function requireScheduleInScope(
  scope: TenantScope,
  id: string,
): Promise<PpmScheduleDocument> {
  const schedule = await ppmSchedulesRepository.forScope(scope).findById(id);
  if (!schedule) throw new NotFoundError(`ppm schedule ${id} not in scope`);
  return schedule;
}

/** One page of names for a single row we just wrote. */
async function summariseOne(
  scope: TenantScope,
  document: PpmScheduleDocument,
): Promise<PpmScheduleSummary> {
  const [asset, person] = await Promise.all([
    assetsRepository.forScope(scope).findById(document.assetId, { select: ["_id", "name"] }),
    techniciansRepository
      .forScope(scope)
      .findById(document.technicianId, { select: ["_id", "name"] }),
  ]);

  return toPpmScheduleSummary(document, asset?.name ?? null, person?.name ?? null);
}

// --- Planning ---------------------------------------------------------------

const runCreatePpmSchedule = defineAction({
  name: "createPpmSchedule",
  roles: PPM_MANAGERS,
  input: createPpmScheduleSchema,
  async handler({ input, scope }): Promise<PpmScheduleSummary> {
    await connectToDatabase();

    // Both ids re-scoped before either is written. In parallel because neither
    // check depends on the other, and a bad payload should fail on the first
    // round trip rather than the second.
    await Promise.all([
      requireAssetInScope(scope, input.assetId),
      requireTechnicianInScope(scope, input.technicianId),
    ]);

    const created = await ppmSchedulesRepository.forScope(scope).create({
      assetId: input.assetId,
      type: input.type,
      // Normalised to UTC midnight, because a due date is a DAY. A form submits
      // "2026-03-14", but a JSON caller could send an instant; storing it as
      // given would make two schedules due on the same day sort and compare
      // differently. `effectiveStatus` normalises the other side of every
      // comparison the same way.
      dueDate: startOfUtcDay(input.dueDate),
      technicianId: input.technicianId,
    });

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, created);
  },
});

const runUpdatePpmSchedule = defineAction({
  name: "updatePpmSchedule",
  roles: PPM_MANAGERS,
  input: updatePpmScheduleSchema,
  async handler({ input, scope }): Promise<PpmScheduleSummary> {
    await connectToDatabase();

    const { id, ...patch } = input;
    const current = await requireScheduleInScope(scope, id);

    /**
     * A finished visit is a record, not a plan.
     *
     * Rebooking or reassigning a COMPLETED schedule would rewrite what was
     * actually done — and, once recurrence is driven, would change the date the
     * NEXT occurrence is measured from. The correction for a mis-filed
     * completion is a new schedule, not an edit to the history.
     */
    if (current.status === "COMPLETED") {
      throw new ValidationError(`ppm schedule ${id} is completed and cannot be edited`, {
        id: "A completed visit cannot be changed.",
      });
    }

    await Promise.all([
      patch.assetId ? requireAssetInScope(scope, patch.assetId) : Promise.resolve(),
      patch.technicianId
        ? requireTechnicianInScope(scope, patch.technicianId)
        : Promise.resolve(),
    ]);

    const updated = await ppmSchedulesRepository.forScope(scope).update(id, {
      ...(patch.assetId ? { assetId: patch.assetId } : {}),
      ...(patch.type ? { type: patch.type } : {}),
      ...(patch.dueDate ? { dueDate: startOfUtcDay(patch.dueDate) } : {}),
      ...(patch.technicianId ? { technicianId: patch.technicianId } : {}),
    });
    if (!updated) throw new NotFoundError(`ppm schedule ${id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

const runDeletePpmSchedule = defineAction({
  name: "deletePpmSchedule",
  roles: PPM_MANAGERS,
  input: deletePpmScheduleSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    // Soft delete. A cancelled visit still answers "why was nothing done in
    // March", which a hard delete would erase.
    const deleted = await ppmSchedulesRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`ppm schedule ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return { id: input.id };
  },
});

// --- Transitions ------------------------------------------------------------
//
// Both read the current status before writing, rather than patching blindly.
// `status` is not on any payload schema, so the ONLY way a row moves is through
// one of these two handlers, and each will only accept the one state that
// precedes it:
//
//     SCHEDULED --Start--> IN_PROGRESS --Complete--> COMPLETED
//
// A second Start on a row someone else already started is refused with a field
// message rather than silently re-stamping `startedAt` — two technicians on one
// job is worth telling them about.

const runStartPpmSchedule = defineAction({
  name: "startPpmSchedule",
  roles: PPM_EXECUTORS,
  input: startPpmScheduleSchema,
  async handler({ input, scope }): Promise<PpmScheduleSummary> {
    await connectToDatabase();

    const current = await requireScheduleInScope(scope, input.id);
    if (current.status !== "SCHEDULED") {
      throw new ValidationError(
        `ppm schedule ${input.id} is ${current.status} and cannot be started`,
        { id: "This visit has already been started." },
      );
    }

    const updated = await ppmSchedulesRepository
      .forScope(scope)
      .update(input.id, { status: "IN_PROGRESS", startedAt: new Date() });
    if (!updated) throw new NotFoundError(`ppm schedule ${input.id} not in scope`);

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

const runCompletePpmSchedule = defineAction({
  name: "completePpmSchedule",
  roles: PPM_EXECUTORS,
  input: completePpmScheduleSchema,
  async handler({ input, scope }): Promise<PpmScheduleSummary> {
    await connectToDatabase();

    const current = await requireScheduleInScope(scope, input.id);
    if (current.status !== "IN_PROGRESS") {
      throw new ValidationError(
        `ppm schedule ${input.id} is ${current.status} and cannot be completed`,
        { id: "Start this visit before completing it." },
      );
    }

    const updated = await ppmSchedulesRepository
      .forScope(scope)
      .update(input.id, { status: "COMPLETED", completedAt: new Date() });
    if (!updated) throw new NotFoundError(`ppm schedule ${input.id} not in scope`);

    /**
     * This is where recurrence WOULD regenerate the next occurrence:
     *
     *     const next = planNextOccurrence({ ...updated as strings });
     *     await ppmSchedulesRepository.forScope(scope).create(next);
     *
     * It is left out on purpose — the brief asks for the recurrence to be
     * designed, not driven, and the piece that is genuinely missing is not the
     * date arithmetic (that is written and tested in `domain/preventive.ts`) but
     * IDEMPOTENCY. A retried completion would write a second identical row here,
     * and nothing in this handler could tell the two apart. That guarantee
     * belongs to whatever ends up driving it, along with catching up a schedule
     * whose next date is already in the past.
     */

    revalidatePath(REVALIDATE_PATH, "page");
    return summariseOne(scope, updated);
  },
});

// --- Reads ------------------------------------------------------------------

const runListPpmSchedules = defineAction({
  name: "listPpmSchedules",
  roles: PPM_READERS,
  input: listPpmSchedulesSchema,
  // A read behind a session. A limiter here would only get in the way of someone
  // paging through their own data.
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<PpmScheduleSummary>> {
    await connectToDatabase();
    return listPpmSchedulesForScope(scope, input);
  },
});

const runSummarisePpmSchedules = defineAction({
  name: "summarisePpmSchedules",
  roles: PPM_READERS,
  input: summarisePpmSchedulesSchema,
  rateLimit: null,
  async handler({ scope }): Promise<PpmTypeCount[]> {
    return summarisePpmSchedulesForScope(scope);
  },
});

// --- Exports ----------------------------------------------------------------
//
// Every export of a `"use server"` module must be an async function, so the
// wrappers above are assigned to module constants and re-exported here. The
// `(previous, payload)` signature is what `useActionState` calls with; the
// previous state is ignored on purpose, because it arrives from the client on
// every submit and treating it as input would be a way past the schema.

export async function createPpmScheduleAction(
  _previous: ActionResult<PpmScheduleSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<PpmScheduleSummary>> {
  return runCreatePpmSchedule(payload);
}

export async function updatePpmScheduleAction(
  _previous: ActionResult<PpmScheduleSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<PpmScheduleSummary>> {
  return runUpdatePpmSchedule(payload);
}

export async function deletePpmScheduleAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runDeletePpmSchedule(payload);
}

export async function startPpmScheduleAction(
  payload: unknown,
): Promise<ActionResult<PpmScheduleSummary>> {
  return runStartPpmSchedule(payload);
}

export async function completePpmScheduleAction(
  payload: unknown,
): Promise<ActionResult<PpmScheduleSummary>> {
  return runCompletePpmSchedule(payload);
}

export async function listPpmSchedulesAction(
  payload: unknown,
): Promise<ActionResult<Page<PpmScheduleSummary>>> {
  return runListPpmSchedules(payload);
}

export async function summarisePpmSchedulesAction(
  payload: unknown,
): Promise<ActionResult<PpmTypeCount[]>> {
  return runSummarisePpmSchedules(payload);
}
