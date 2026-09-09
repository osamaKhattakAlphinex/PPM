import { z } from "zod";

import { userStatusSchema } from "@/lib/db";
import { roleSchema } from "@/lib/auth/roles";
import { assignableUserStatusSchema } from "@/lib/domain/users";
import {
  objectIdString,
  pageParams,
  searchTerm,
} from "@/lib/validation/primitives";

/**
 * Every payload that reaches a user-administration action is parsed here first.
 *
 * Pure — no `server-only`, no session — so the same schema validates on the
 * server and can be imported by a Client Component or a test.
 *
 * What is deliberately NOT a field in any schema below:
 *
 *  - `organizationId`. It comes from the session's scope. A payload that could
 *    name a tenant would let an administrator of one company create a user in
 *    another, which is the isolation rule in its most direct form.
 *  - `passwordHash`. A password arrives as a password and is hashed on the
 *    server; a payload carrying a hash would let a caller install one they
 *    already know the plaintext for.
 *  - `status`, on creation. A new account is INVITED, decided by the model's
 *    default. Letting the form choose would let it create a pre-activated
 *    account and skip the deliberate second step.
 */

/** The list screen's filters. Every one of them is optional. */
export const listUsersSchema = z.strictObject({
  ...pageParams,
  search: searchTerm.optional(),
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
});

export type ListUsersInput = z.input<typeof listUsersSchema>;

/**
 * Activate or suspend one account.
 *
 * Only the two statuses an administrator may move an account TO — `INVITED` is
 * absent because nothing may return to it (see `src/lib/domain/users.ts`). The
 * move is checked against the account's CURRENT status by the action, which has
 * to read the row first: a schema cannot know where the account is now.
 */
export const setUserStatusSchema = z.strictObject({
  id: objectIdString,
  status: assignableUserStatusSchema,
});

export type SetUserStatusInput = z.input<typeof setUserStatusSchema>;
