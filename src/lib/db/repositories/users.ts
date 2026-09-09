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

/**
 * Patchable fields. Email changes get their own flow.
 *
 * The two invitation fields are patchable together and are never read back
 * through this repository — redeeming an invitation happens before there is a
 * session, so the lookup lives in `identity-store.ts`. What a scoped caller
 * does with them is issue one (an administrator inviting a colleague) or clear
 * one (a password change, which must not leave a live link behind that could
 * set the password again without knowing it).
 */
export interface UserUpdateInput {
  name?: string;
  role?: Role;
  status?: UserStatus;
  passwordHash?: string;
  lastLoginAt?: Date | null;
  /** A SHA-256 digest, or null to withdraw the invitation. */
  inviteTokenHash?: string | null;
  inviteExpiresAt?: Date | null;
}

export const usersRepository = createRepository<
  UserDocument,
  UserCreateInput,
  UserUpdateInput
>(User);
