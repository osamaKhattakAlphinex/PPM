import { Client, type ClientDocument } from "../models/client";
import { createRepository } from "../repository";

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
 * When the client portal needs to show a client its own record, that is a
 * purpose-built read filtered by `_id: scope.clientId` — not a widening of this
 * repository.
 */

export interface ClientCreateInput {
  name: string;
  code: string;
  status?: "ACTIVE" | "SUSPENDED";
  contactEmail?: string | null;
}

export interface ClientUpdateInput {
  name?: string;
  status?: "ACTIVE" | "SUSPENDED";
  contactEmail?: string | null;
}

export const clientsRepository = createRepository<
  ClientDocument,
  ClientCreateInput,
  ClientUpdateInput
>(Client);
