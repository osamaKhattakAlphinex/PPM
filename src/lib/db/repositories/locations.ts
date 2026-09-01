import type { Types } from "mongoose";

import { Location, type Address, type LocationDocument } from "../models/location";
import { createRepository } from "../repository";

/**
 * The tenant-scoped way to reach locations.
 *
 * There is no client-handling code in this file, and that is the point. The
 * `Location` schema has a `clientId` path, so `createRepository()` sets
 * `isClientPartitioned` and appends `clientId: scope.clientId` to every filter
 * it builds for a client-scoped session — last, after anything the caller
 * passed, so no argument can displace it. A CLIENT user therefore sees exactly
 * the sites belonging to their own client and nothing else, including none of
 * the organization's own unassigned sites.
 */

/**
 * What a caller may supply. `organizationId` comes from the scope, never here.
 *
 * `clientId` is optional: staff may create an org-wide site by omitting it. A
 * CLIENT session's value is ignored and replaced with their own by the DAL, so
 * a client cannot file a site against someone else's account.
 */
export interface LocationCreateInput {
  name: string;
  building?: string | null;
  clientId?: Types.ObjectId | string | null;
  address: Address;
  status?: "ACTIVE" | "INACTIVE";
}

/**
 * Patchable fields.
 *
 * `clientId` is deliberately absent, and the DAL enforces that independently by
 * listing it in `RESERVED_FIELDS` — a location's customer is fixed at creation.
 * See the note on the model.
 */
export interface LocationUpdateInput {
  name?: string;
  building?: string | null;
  address?: Address;
  status?: "ACTIVE" | "INACTIVE";
}

export const locationsRepository = createRepository<
  LocationDocument,
  LocationCreateInput,
  LocationUpdateInput
>(Location);
