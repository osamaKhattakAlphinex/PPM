import { requireRole } from "@/lib/auth/guard";
import { REPORTS_ROUTE_ROLES } from "@/lib/reports/route-roles";
import { buildReportForScope } from "@/lib/reports/queries";
import { reportsForRole } from "@/lib/reports/roles";
import { reportKindSchema, type ReportKind } from "@/lib/reports/kinds";
import { ReportPicker } from "./report-picker";
import { ReportView } from "./report-view";

/**
 * Reports — pick one, read it, print it, or take the PDF.
 *
 * The chosen report lives in the URL (`?report=PM`) rather than in component
 * state, and that is worth defending: it makes a generated report a LINK. A
 * manager can send "the asset report" to a colleague, a browser back button
 * behaves, and refreshing does not throw the reader back to the picker. It also
 * means the report is rendered on the SERVER, so no report data crosses to the
 * browser except the report the caller is entitled to.
 *
 * Which is the second reason for the shape: the role check happens twice, and
 * neither is decorative. `requireRole` on the ROUTE decides who may open the
 * module at all; `buildReportForScope` re-checks the caller's role against the
 * PER-REPORT list before it reads anything, so a supervisor who edits the query
 * string to `FINANCIAL` gets an authorization error rather than a document.
 *
 * No `setRequestLocale`, no `metadata`: the locale is resolved from the request
 * header in `src/lib/i18n/request.ts`, and `noindex` is inherited from the two
 * layouts above this one.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { scope, user } = await requireRole(...REPORTS_ROUTE_ROLES);

  const available = reportsForRole(user.role);
  const params = await searchParams;

  /**
   * Parsed, never trusted. An unknown or malformed value is "no report chosen"
   * rather than an error page: somebody following a stale link should land on
   * the picker, not on a stack trace.
   */
  const requested = reportKindSchema.safeParse(params.report);
  const selected: ReportKind | null =
    requested.success && available.includes(requested.data) ? requested.data : null;

  const report = selected ? await buildReportForScope(scope, user.role, selected) : null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ReportPicker available={available} selected={selected} />
      {report && <ReportView report={report} />}
    </div>
  );
}
