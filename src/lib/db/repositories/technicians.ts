import type { Types } from "mongoose";

import type { TechnicianStatus, Trade } from "../../domain/technicians";
import { Technician, type TechnicianDocument } from "../models/technician";
import { createRepository } from "../repository";

/**
 * The tenant-scoped way to reach technicians.
 *
 * Deliberately NOT marked `sharedWithClients`. The collection has no `clientId`
 * — a technician works across every site the organization maintains, so there
 * is no honest way to say which customer "owns" one — which means a CLIENT
 * session cannot be narrowed here. `createRepository` therefore refuses one with
 * a `ScopeResolutionError` rather than serving it the organization's whole
 * workforce, which is the fail-closed half of the rule in CLAUDE.md.
 *
 * That refusal is the same shape as `clientsRepository`'s, and for the same
 * reason: "this collection cannot be scoped to you" must never quietly become
 * "so you get all of it".
 *
 * Staff scoping needs no code here. `organizationId` is appended to every
 * filter last, after anything a caller passed, so one tenant's dispatcher can
 * never see another's people.
 */

/** What a caller may supply. `organizationId` comes from the scope, never here. */
export interface TechnicianCreateInput {
  name: string;
  trade: Trade;
  skills?: string[];
  status?: TechnicianStatus;
  /**
   * The `User` this person signs in with. Optional — most technicians have no
   * account. The action proves the id belongs to a TECHNICIAN-role user inside
   * the caller's organization before it gets here.
   */
  userId?: Types.ObjectId | string | null;
}

/**
 * Patchable fields.
 *
 * `userId` IS patchable, unlike `Location.clientId`. Linking is a correction,
 * not a transfer of ownership: accounts are usually created after the person,
 * and unlinking a leaver must not require deleting their work history. The
 * partial unique index still stops one account being claimed twice.
 */
export interface TechnicianUpdateInput {
  name?: string;
  trade?: Trade;
  skills?: string[];
  status?: TechnicianStatus;
  userId?: Types.ObjectId | string | null;
}

export const techniciansRepository = createRepository<
  TechnicianDocument,
  TechnicianCreateInput,
  TechnicianUpdateInput
>(Technician);
