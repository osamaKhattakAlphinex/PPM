import { requireRole } from "@/lib/auth/guard";
import { DASHBOARD_READERS, loadDashboard } from "@/lib/dashboard/queries";
import type { Locale } from "@/lib/i18n/config";
import { DashboardView } from "./dashboard-view";

/**
 * The staff dashboard.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts`.
 *
 * CLIENT is absent from it, and that absence is load-bearing rather than a
 * preference. The nav table sends a client session to `/app/portal` through
 * `clientHref`, and it has to: this page aggregates preventive maintenance, and
 * `ppmSchedulesRepository` REFUSES a client scope outright (the collection has
 * no `clientId` and is not `sharedWithClients`, so serving one would mean
 * serving the whole organization). A customer's own figures are on the portal,
 * drawn only from collections a client scope can legally reach.
 *
 * Every number below comes from a scoped aggregation issued on the server; see
 * `src/lib/db/repositories/analytics.ts` for why each pipeline's `$match` is
 * provably tenant-scoped.
 */
export default async function AppHomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  await requireRole(...DASHBOARD_READERS);

  const { locale } = await params;
  const data = await loadDashboard();

  return <DashboardView data={data} locale={locale} />;
}
