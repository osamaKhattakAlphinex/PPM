import type { Role } from "@/lib/auth/roles";

/**
 * Who may open `/app/reports`.
 *
 * A tiny module of its own because the page needs it and must not import
 * `queries.ts` for it — that module is `server-only` and pulls the whole
 * data-access layer in. It restates the row in `src/lib/nav/modules.ts`; the two
 * are kept honest by `reports.test.ts`, which asserts they are the same set.
 *
 * This is the ROUTE list: who gets a sidebar entry and may open the module at
 * all. It is deliberately the UNION of the three per-report lists in
 * `queries.ts`, which is the safe direction — the picker only offers what the
 * caller's role may run, and `buildReportForScope` re-checks the per-report list
 * before it reads anything, so opening the module is not the same as being able
 * to run everything in it.
 */
export const REPORTS_ROUTE_ROLES: readonly [Role, ...Role[]] = [
  "ADMIN",
  "FM_MANAGER",
  "SUPERVISOR",
  "CLIENT",
];
