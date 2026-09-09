import type { Role } from "@/lib/auth/roles";

import { REPORT_KINDS, type ReportKind } from "./kinds";

/**
 * Who may run which report.
 *
 * A PURE module, separate from `queries.ts`, and the separation is load-bearing
 * rather than tidy: `queries.ts` is `server-only` and pulls the data-access
 * layer (and, through `requireRole`, next-auth), so a Client Component that
 * needed this policy — the report picker — could not import it, and neither
 * could a unit test. The policy is the thing worth testing, so it lives where
 * it can be.
 *
 * A different list per report, not one list for the module, because the three
 * ask different questions of the same tenant:
 *
 *  - PM: management and supervisors. It is an operational document, and the
 *    preventive plan is provider-internal — `ppmSchedulesRepository` refuses a
 *    client scope outright — so a customer cannot run it at all.
 *  - ASSET: everyone who may see the asset register, customers included,
 *    narrowed by the DAL to their own equipment.
 *  - FINANCIAL: management and the customer whose money it is. The same split
 *    AMC and invoicing make: a supervisor dispatches work, they do not price it.
 *
 * TECHNICIAN is absent from all three. A technician's screen is the job in front
 * of them; a report is a management document about how the work is going, which
 * is a different question with a different audience.
 */
export const REPORT_ROLES: Readonly<Record<ReportKind, readonly [Role, ...Role[]]>> =
  Object.freeze({
    PM: ["ADMIN", "FM_MANAGER", "SUPERVISOR"],
    ASSET: ["ADMIN", "FM_MANAGER", "SUPERVISOR", "CLIENT"],
    FINANCIAL: ["ADMIN", "FM_MANAGER", "CLIENT"],
  });

/** Every report this role may run, in menu order. */
export function reportsForRole(role: Role): ReportKind[] {
  return REPORT_KINDS.filter((kind) => (REPORT_ROLES[kind] as readonly Role[]).includes(role));
}

export function canRunReport(role: Role, kind: ReportKind): boolean {
  return (REPORT_ROLES[kind] as readonly Role[]).includes(role);
}
