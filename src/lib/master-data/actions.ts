"use server";

import { revalidatePath } from "next/cache";

import {
  clientExistsInScope,
  clientsRepository,
  connectToDatabase,
  locationsRepository,
  updateOrganizationForScope,
  type Page,
} from "@/lib/db";
import { defineAction, type ActionResult } from "@/lib/security/action";
import { NotFoundError, ValidationError } from "@/lib/security/errors";
import {
  toClientSummary,
  toLocationSummary,
  toOrganizationSummary,
  type ClientSummary,
  type LocationSummary,
  type OrganizationSummary,
} from "./dto";
import {
  listClientsForScope,
  listLocationsForScope,
  LOCATION_READERS,
  MASTER_DATA_MANAGERS,
  MASTER_DATA_READERS,
} from "./queries";
import {
  createClientSchema,
  createLocationSchema,
  deleteClientSchema,
  deleteLocationSchema,
  listClientsSchema,
  listLocationsSchema,
  updateClientSchema,
  updateLocationSchema,
  updateOrganizationSchema,
} from "./schemas";

/**
 * The write side of master data.
 *
 * Server Actions rather than Route Handlers, per CLAUDE.md. Everything above
 * the business rule comes from `defineAction`: authenticate, check the role,
 * resolve the tenant scope, rate limit, parse with zod — in that order, once,
 * for all of them. What is left in each handler is the part that is actually
 * about the entity.
 *
 * Two things worth reading twice:
 *
 *  - `organizationId` is not a field in any schema. It comes from the scope the
 *    wrapper resolved, so no payload can choose a tenant.
 *  - the list actions take the SAME roles and the SAME implementation as the
 *    Server Component reads in `queries.ts`, so paginating in the browser
 *    cannot reach anything the first render could not.
 */

// --- Clients ----------------------------------------------------------------

const runCreateClient = defineAction({
  name: "createClient",
  roles: MASTER_DATA_MANAGERS,
  input: createClientSchema,
  async handler({ input, scope }): Promise<ClientSummary> {
    await connectToDatabase();

    // A duplicate `code` trips the partial unique index and surfaces as a
    // neutral 409 through `normaliseError`. The colliding value is never echoed.
    const created = await clientsRepository.forScope(scope).create({
      name: input.name,
      code: input.code,
      status: input.status,
      contactInfo: input.contactInfo,
    });

    revalidatePath("/[locale]/app/clients", "page");
    return toClientSummary(created);
  },
});

const runUpdateClient = defineAction({
  name: "updateClient",
  roles: MASTER_DATA_MANAGERS,
  input: updateClientSchema,
  async handler({ input, scope }): Promise<ClientSummary> {
    await connectToDatabase();

    const { id, ...patch } = input;
    // The id is never trusted to belong to the caller's tenant: `update()`
    // treats it as a filter term with organizationId layered on top, so one
    // from another organization matches nothing and returns null here.
    const updated = await clientsRepository.forScope(scope).update(id, patch);
    if (!updated) throw new NotFoundError(`client ${id} not in scope`);

    revalidatePath("/[locale]/app/clients", "page");
    return toClientSummary(updated);
  },
});

const runDeleteClient = defineAction({
  name: "deleteClient",
  roles: MASTER_DATA_MANAGERS,
  input: deleteClientSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    // Soft delete. The row stays for audit and for the contracts and invoices
    // that point at it; the partial unique index releases the `code`.
    const deleted = await clientsRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`client ${input.id} not in scope`);

    revalidatePath("/[locale]/app/clients", "page");
    return { id: input.id };
  },
});

const runListClients = defineAction({
  name: "listClients",
  roles: MASTER_DATA_READERS,
  input: listClientsSchema,
  // A read behind a session. A limiter here would only get in the way of
  // someone paging through their own data.
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<ClientSummary>> {
    await connectToDatabase();
    return listClientsForScope(scope, input);
  },
});

// --- Locations --------------------------------------------------------------

const runCreateLocation = defineAction({
  name: "createLocation",
  roles: MASTER_DATA_MANAGERS,
  input: createLocationSchema,
  async handler({ input, scope }): Promise<LocationSummary> {
    await connectToDatabase();

    /**
     * A `clientId` that arrived in a request is never trusted to live inside
     * the caller's tenant. `clientExistsInScope` re-reads it through the scoped
     * repository, so an id from another organization fails here with a field
     * message rather than being written against a client the tenant cannot see.
     */
    if (input.clientId) {
      const belongs = await clientExistsInScope(scope, input.clientId);
      if (!belongs) {
        throw new ValidationError(
          `clientId ${input.clientId} is outside the actor's organization`,
          { clientId: "Unknown client." },
        );
      }
    }

    const created = await locationsRepository.forScope(scope).create({
      name: input.name,
      building: input.building,
      // Absent means an org-wide site. The DAL stamps a CLIENT session's own id
      // regardless of what is passed, but only staff reach this action anyway.
      clientId: input.clientId ?? null,
      address: input.address,
      status: input.status,
    });

    revalidatePath("/[locale]/app/locations", "page");
    // `clientName` is left null rather than resolved: naming it would cost a
    // second scoped read for a value nothing renders — the list reloads from
    // the server on success, and that read resolves names a page at a time.
    return toLocationSummary(created, null);
  },
});

const runUpdateLocation = defineAction({
  name: "updateLocation",
  roles: MASTER_DATA_MANAGERS,
  input: updateLocationSchema,
  async handler({ input, scope }): Promise<LocationSummary> {
    await connectToDatabase();

    const { id, ...patch } = input;
    // `clientId` cannot appear in `patch` — the schema has no such field, and
    // the DAL would strip it anyway. A location's customer is fixed.
    const updated = await locationsRepository.forScope(scope).update(id, patch);
    if (!updated) throw new NotFoundError(`location ${id} not in scope`);

    revalidatePath("/[locale]/app/locations", "page");
    // Null `clientName`, for the same reason as create above.
    return toLocationSummary(updated, null);
  },
});

const runDeleteLocation = defineAction({
  name: "deleteLocation",
  roles: MASTER_DATA_MANAGERS,
  input: deleteLocationSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await connectToDatabase();

    const deleted = await locationsRepository.forScope(scope).delete(input.id);
    if (!deleted) throw new NotFoundError(`location ${input.id} not in scope`);

    revalidatePath("/[locale]/app/locations", "page");
    return { id: input.id };
  },
});

const runListLocations = defineAction({
  name: "listLocations",
  // CLIENT is included, and needs no special case: the DAL narrows a
  // client-scoped session to its own locations before the query runs.
  roles: LOCATION_READERS,
  input: listLocationsSchema,
  rateLimit: null,
  async handler({ input, scope }): Promise<Page<LocationSummary>> {
    await connectToDatabase();
    return listLocationsForScope(scope, input);
  },
});

// --- Organization -----------------------------------------------------------

const runUpdateOrganization = defineAction({
  name: "updateOrganization",
  roles: MASTER_DATA_MANAGERS,
  input: updateOrganizationSchema,
  async handler({ input, scope }): Promise<OrganizationSummary> {
    await connectToDatabase();

    // The organization updated is the one in the scope. There is no id
    // parameter, here or in the store beneath it, so an ADMIN can only ever
    // rename their own tenant.
    const updated = await updateOrganizationForScope(scope, input);
    if (!updated) throw new NotFoundError(`organization ${scope.organizationId} not found`);

    revalidatePath("/[locale]/app/settings/organization", "page");
    return toOrganizationSummary(updated);
  },
});

// --- Exports ----------------------------------------------------------------
//
// Every export of a `"use server"` module must be an async function, so the
// wrappers above are assigned to module constants and re-exported here. The
// `(previous, payload)` signature is what `useActionState` calls with; the
// previous state is ignored on purpose, because it arrives from the client on
// every submit and treating it as input would be a way past the schema.

export async function createClientAction(
  _previous: ActionResult<ClientSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<ClientSummary>> {
  return runCreateClient(payload);
}

export async function updateClientAction(
  _previous: ActionResult<ClientSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<ClientSummary>> {
  return runUpdateClient(payload);
}

export async function deleteClientAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  return runDeleteClient(payload);
}

export async function listClientsAction(
  payload: unknown,
): Promise<ActionResult<Page<ClientSummary>>> {
  return runListClients(payload);
}

export async function createLocationAction(
  _previous: ActionResult<LocationSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<LocationSummary>> {
  return runCreateLocation(payload);
}

export async function updateLocationAction(
  _previous: ActionResult<LocationSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<LocationSummary>> {
  return runUpdateLocation(payload);
}

export async function deleteLocationAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runDeleteLocation(payload);
}

export async function listLocationsAction(
  payload: unknown,
): Promise<ActionResult<Page<LocationSummary>>> {
  return runListLocations(payload);
}

export async function updateOrganizationAction(
  _previous: ActionResult<OrganizationSummary> | undefined,
  payload: unknown,
): Promise<ActionResult<OrganizationSummary>> {
  return runUpdateOrganization(payload);
}
