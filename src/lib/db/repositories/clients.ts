import { Client, type ClientContactInfo, type ClientDocument } from "../models/client";
import type { ObjectIdLike } from "../object-id";
import { createRepository } from "../repository";
import { isClientScope, type TenantScope } from "../scope";

/**
 * The tenant-scoped way to reach clients.
 *
 * Deliberately NOT marked `sharedWithClients`: the collection has no `clientId`
 * of its own — a client row IS the client — so there is nothing to narrow a
 * CLIENT session by, and serving one would hand a customer the list of every
 * other customer the organization works for. The repository therefore refuses a
 * CLIENT scope outright (`ScopeResolutionError`), which is the fail-closed half
 * of the rule in CLAUDE.md.
 *
 * When the client portal needs to show a client its own record, that is
 * `findOwnClientForScope()` below — a purpose-built read filtered by
 * `_id: scope.clientId`, not a widening of this repository.
 */

export interface ClientCreateInput {
  name: string;
  code: string;
  status?: "ACTIVE" | "SUSPENDED";
  contactInfo?: ClientContactInfo;
}

export interface ClientUpdateInput {
  name?: string;
  status?: "ACTIVE" | "SUSPENDED";
  contactInfo?: ClientContactInfo;
}

export const clientsRepository = createRepository<
  ClientDocument,
  ClientCreateInput,
  ClientUpdateInput
>(Client);

/**
 * The one client record a CLIENT session is allowed to see: its own.
 *
 * This is the exception the file header promises, and it is kept honest the
 * same way `identity-store.ts` is: the query shape is fixed and code-authored,
 * every term comes from the SCOPE rather than from an argument, and there is no
 * parameter a caller could use to widen it. `organizationId` is still applied
 * even though `_id` is unique, because a stale or forged session carrying
 * another tenant's clientId must match nothing rather than resolve.
 *
 * Returns null for a staff scope — staff have no "own client", and defaulting
 * one would be the widening this module exists to prevent.
 */
export async function findOwnClientForScope(
  scope: TenantScope,
): Promise<ClientDocument | null> {
  if (!isClientScope(scope)) return null;

  return Client.findOne({
    _id: scope.clientId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
    .lean<ClientDocument | null>()
    .exec();
}

/**
 * Prove a client id from a request belongs to the caller's organization.
 *
 * Used before a location is filed against a client. It goes through the scoped
 * repository rather than a raw query, so the organizationId term cannot be
 * forgotten: `findById` treats the id as a filter TERM and still layers the
 * scope on top, meaning an id from another tenant simply matches nothing.
 *
 * Accepts SUSPENDED clients — a suspended customer's sites still exist and
 * still need maintaining — which is why this is not the identity store's
 * `clientBelongsToOrganization()`.
 */
export async function clientExistsInScope(
  scope: TenantScope,
  clientId: ObjectIdLike,
): Promise<boolean> {
  const found = await clientsRepository.forScope(scope).findById(clientId, { select: ["_id"] });
  return found !== null;
}
