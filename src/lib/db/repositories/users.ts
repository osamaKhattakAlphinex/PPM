import type { Types } from "mongoose";

import type { Role } from "../../auth/roles";
import { User, type UserDocument, type UserStatus } from "../models/user";
import { createRepository } from "../repository";

/**
 * The tenant-scoped way to reach users.
 *
 * Feature code uses this; only `identity-store.ts` is allowed to query the
 * collection unscoped, and only for sign-in and provisioning. Because `User`
 * carries a `clientId`, a CLIENT session is narrowed to its own client's users
 * automatically — a client contact can never enumerate the staff of the
 * organization that serves them.
 */

/** What a caller may supply. `organizationId` comes from the scope, never here. */
export interface UserCreateInput {
  name: string;
  email: string;
  /** Already hashed by `hashPassword()`. A plaintext password never gets here. */
  passwordHash: string;
  role: Role;
  /** Required when role is CLIENT, rejected otherwise — enforced by the model. */
  clientId?: Types.ObjectId | string | null;
  status?: UserStatus;
}

/** Patchable fields. Email and password changes get their own flows. */
export interface UserUpdateInput {
  name?: string;
  role?: Role;
  status?: UserStatus;
  passwordHash?: string;
  lastLoginAt?: Date | null;
}

export const usersRepository = createRepository<UserDocument, UserCreateInput, UserUpdateInput>(
  User,
);
