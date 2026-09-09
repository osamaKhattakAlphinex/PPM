import type { Metadata } from "next";

import { requireRole } from "@/lib/auth/guard";
import {
  assignableRolesFor,
  listClientOptions,
  listUsers,
  USER_ADMINS,
} from "@/lib/admin/queries";
import { UsersManager } from "./users-manager";

export const metadata: Metadata = { title: "Users" };

/**
 * User administration.
 *
 * A Server Component per CLAUDE.md: the first page of accounts is read and
 * rendered on the server, so the organization's directory is never fetched from
 * the browser to draw the initial screen.
 *
 * The `requireRole` here is not a duplicate of the middleware's check. The
 * middleware guards NAVIGATION; this guards DATA, and it is also where the role
 * comes from — `assignableRolesFor` decides which roles the create form even
 * offers. The actions behind it check again regardless, so an FM_MANAGER who
 * forges an ADMIN option gets a FORBIDDEN envelope, not an administrator.
 *
 * `/app/admin` is ADMIN-only in `ROUTE_ACCESS`, while `USER_ADMINS` is ADMIN
 * and FM_MANAGER. That is deliberate and not an inconsistency: the route rule
 * is the narrower of the two, so today only an ADMIN arrives here — and on the
 * day this module is opened to FM_MANAGER, the data layer already agrees with
 * `registerUser`, which has accepted both roles from the beginning.
 */
export default async function AdminPage() {
  const { user } = await requireRole(...USER_ADMINS);

  const [page, clientOptions] = await Promise.all([
    listUsers(),
    listClientOptions(),
  ]);

  return (
    <UsersManager
      initialPage={page}
      assignableRoles={assignableRolesFor(user.role)}
      clientOptions={clientOptions}
      currentUserId={user.id}
    />
  );
}
