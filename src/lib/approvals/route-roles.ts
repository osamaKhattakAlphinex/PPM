import type { Role } from "@/lib/auth/roles";

/**
 * Who may open `/app/approvals`.
 *
 * A tiny module of its own because the page needs it and the page must not
 * import `queries.ts` for it — that module is `server-only` AND pulls the whole
 * data-access layer in, while this is one array the route rule and the page
 * guard both need. It restates the row in `src/lib/nav/modules.ts`; the two are
 * kept honest by `route-roles.test.ts`, which asserts they are the same set.
 *
 * Pure: a type import and a literal. Safe from anywhere.
 */
export const APPROVALS_ROUTE_ROLES: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
];
