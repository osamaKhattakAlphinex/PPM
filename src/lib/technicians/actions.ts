"use server";

import { revalidatePath } from "next/cache";

import {
  connectToDatabase,
  techniciansRepository,
  toObjectId,
  usersRepository,
  type Page,
  type TenantScope,
} from "@/lib/db";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import { toTechnicianSummary, type TechnicianSummary } from "./dto";
import {
  listTechniciansForScope,
  TECHNICIAN_MANAGERS,
  TECHNICIAN_READERS,
} from "./queries";
import {
  createTechnicianSchema,
  deleteTechnicianSchema,
  listTechniciansSchema,
  updateTechnicianSchema,
} from "./schemas";

/**
 * The write side of the technicians module.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md. Everything above
 * the business rule comes from `defineAction`: authenticate, check the role,
 * resolve the tenant scope, rate limit, parse with zod — in that order, once,
 * for all of them. What is left in each handler is the part that is actually
 * about a technician.
 *
 * `organizationId` is not a field in any schema here. It comes from the scope
 * the wrapper resolved, so no payload can name a tenant.
 */

const TECHNICIANS_PATH = "/[locale]/app/technicians";

/**
 * Prove an account may be linked to this technician.
 *
 * Two separate questions, and both have to be asked here rather than in a
 * schema, because both need another collection:
 *
 *  1. Is it OUR account? The id came from a request, so it is never trusted to
 *     belong to the caller's organization. `findById` on the scoped users
 *     repository treats it as a filter TERM with organizationId layered on top,
 *     so an id from another tenant simply matches nothing.
 *  2. Is it a TECHNICIAN account? Linking a supervisor's or an admin's login to
 *     a technician record would hand the mobile technician view — and later,
 *     attendance — to someone the org chart never put in the field.
 *
 * Uniqueness is checked too, so the caller gets a field message naming the
 * problem. The partial unique index behind it is the real guarantee: a race
 * between two admins trips it and surfaces as a neutral 409 through
 * `normaliseError`, not as a second technician holding the same account.
 */
async function assertAccountIsLinkable(
  scope: TenantScope,
  userId: string,
  /** The technician being edited, so re-saving an unchanged link is not a clash. */
  technicianId?: string,
): Promise<void> {
  /**
   * Coerced up front, and the failure is handled rather than assumed away. The
   * schema already guarantees 24 hex characters, so this branch is unreachable
   * today — but a `undefined` reaching the filter below would be STRIPPED by
   * Mongoose, turning "the technician holding this account" into "any
   * technician", which is exactly the kind of silent widening this module is
   * written to make impossible.
   */
  const accountId = toObjectId(userId);
  const account = accountId
    ? await usersRepository.forScope(scope).findById(accountId, { select: ["_id", "role", "status"] })
    : null;

  if (!account || account.role !== "TECHNICIAN") {
    // The detail says which; the caller gets the field message only. An id from
    // another tenant and an id with the wrong role fail identically on purpose
    // — distinguishing them would confirm the existence of the other tenant's
    // account.
    throw new ValidationError(
      `userId ${userId} is not a TECHNICIAN account inside the actor's organization`,
      { userId: "That account cannot be linked." },
    );
  }

  const holder = await techniciansRepository
    .forScope(scope)
    .findOne({ userId: accountId }, { select: ["_id"] });

  if (holder && holder._id.toHexString() !== technicianId) {
    throw new ValidationError(`userId ${userId} is already linked to technician ${holder._id}`, {
      userId: "That account is already linked to another technician.",
    });
  }
}

const runCreateTechnician = defineAction({
  name: "createTechnician",
  roles: TECHNICIAN_MANAGERS,
  input: createTechnicianSchema,
  async handler({ input, scope }): Promise<TechnicianSummary> {
    await connectToDatabase();

    if (input.userId) await assertAccountIsLinkable(scope, input.userId);

    const created = await techniciansRepository.forScope(scope).create({
      name: input.name,
      trade: input.trade,
      skills: input.skills,
      status: input.status,
      userId: input.userId ?? null,
    });

    revalidatePath(TECHNICIANS_PATH, "page");
    // The linked account is left unresolved rather than re-read: naming it
    // would cost a second scoped query for a value nothing renders — the list
    // reloads from the server on success, and that read resolves accounts a
    // page at a time.
    return toTechnicianSummary(created, null);
  },
});

const runUpdateTechnician = defineAction({
  name: "updateTechnician",
  roles: TECHNICIAN_MANAGERS,
  input: updateTechnicianSchema,
  async handler({ input, scope }): Promise<TechnicianSummary> {
    await connectToDatabase();

    const { id, userId, ...rest } = input;

    if (userId) await assertAccountIsLinkable(scope, userId, id);

    /**
     * The three states of `userId` are distinguished here rather than by a
     * spread, because they mean three different things and `undefined` in a
     * `$set` is not one of them:
     *
     *   absent  -> leave the link alone
     *   null    -> unlink
     *   an id   -> link (already proved above)
     */
    const patch = {
      ...rest,
      ...(userId === undefined ? {} : { userId: userId === null ? null : userId }),
    };

    // The id is never trusted to belong to the caller's tenant: `update()`
    // treats it as a filter term with organizationId layered on top, so one
    // from another organization matches nothing and returns null here.
    const updated = await techniciansRepository.forScope(scope).update(id, patch);
    if (!updated) throw new NotFoundError(`technician ${id} not in scope`);

    revalidatePath(TECHNICIANS_PATH, "page");
    return toTechnicianSummary(updated, null);
  },
});

const runDeleteTechnician = defineAction({
  name: "deleteTechnician",
  roles: TECHNICIAN_MANAGERS,
  input: deleteTechnicianSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    // Soft delete. The row stays for the work orders and timesheets that point
    // at it; the partial unique index releases the linked account, so a
    // returning employee's login can be attached to a fresh record.
    const deleted = await techniciansRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`technician ${input.id} not in scope`);

    revalidatePath(TECHNICIANS_PATH, "page");
    return { id: input.id };
  },
});

const runListTechnicians = defineAction({
  name: "listTechnicians",
  // The same roles as the Server Component read, and the same implementation
  // beneath — so paginating in the browser cannot reach anything the first
  // render could not.
  roles: TECHNICIAN_READERS,
  input: listTechniciansSchema,
  // A read behind a session. A limiter here would only get in the way of
  // someone paging through their own data.
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<TechnicianSummary>> {
    await connectToDatabase();
    return listTechniciansForScope(scope, input);
  },
});

// --- Exports ----------------------------------------------------------------
//
// Every export of a `"use server"` module must be an async function, so the
// wrappers above are assigned to module constants and re-exported here. The
// `(previous, payload)` signature is what `useActionState` calls with; the
// previous state is ignored on purpose, because it arrives from the client on
// every submit and treating it as input would be a way past the schema.

export async function createTechnicianAction(
  _previous: ActionResult<TechnicianSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<TechnicianSummary>> {
  return runCreateTechnician(payload);
}

export async function updateTechnicianAction(
  _previous: ActionResult<TechnicianSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<TechnicianSummary>> {
  return runUpdateTechnician(payload);
}

export async function deleteTechnicianAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runDeleteTechnician(payload);
}

export async function listTechniciansAction(
  payload: unknown,
): Promise<ActionResult<Page<TechnicianSummary>>> {
  return runListTechnicians(payload);
}
