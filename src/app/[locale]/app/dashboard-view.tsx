"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Boxes, CalendarClock, ClipboardCheck, Sparkles, TriangleAlert, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { DashboardData } from "@/lib/dashboard/queries";
import type { WorkOrderStatus } from "@/lib/domain/corrective";
import { localeHref, type Locale } from "@/lib/i18n/config";
import { MaintenanceTrendChart, WorkStatusDonut } from "./_components/charts";
import { KpiGrid, KpiTile } from "./_components/kpi-tile";
import { PageHeading } from "./_components/page-heading";
import { PpmStatusBadge } from "./_components/ppm-status-badge";

/**
 * The staff dashboard.
 *
 * A Client Component, and the reason is narrow: the count-up on the KPI figures
 * and the two charts need the browser. Everything it renders was computed on the
 * SERVER by `loadDashboard()` and handed in as one prop — no fetching happens
 * here at all, so the screen is complete on first paint and there is no loading
 * state to design.
 *
 * The charts themselves arrive through `./_components/charts`, which dynamically
 * imports recharts. A technician who never opens this screen never downloads it.
 */
export function DashboardView({ data, locale }: { data: DashboardData; locale: Locale }) {
  const t = useTranslations("dashboard");
  const tp = useTranslations("preventive");
  const tf = useTranslations("preventive.frequency");
  const format = useFormatter();

  const { kpis, alerts } = data;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading title={t("title")} subtitle={t("subtitle")} />

      <KpiGrid>
        <KpiTile
          label={t("totalAssets")}
          value={kpis.totalAssets}
          icon={<Boxes className="size-4" aria-hidden />}
          note={t("activeAssets", { count: kpis.activeAssets })}
        />
        <KpiTile
          label={t("ppmCompliance")}
          value={kpis.ppmCompliance}
          suffix="%"
          icon={<ClipboardCheck className="size-4" aria-hidden />}
          /**
           * The denominator is spelled out under the figure. A bare percentage
           * hides whether it is 3 visits out of 3 or 300 out of 300, and those
           * are not the same claim about a maintenance provider.
           */
          note={
            kpis.ppmCompliance === null
              ? t("nothingDue")
              : t("complianceNote", { done: kpis.ppmCompleted, due: kpis.ppmDue })
          }
        />
        <KpiTile
          label={t("openWorkOrders")}
          value={kpis.openWorkOrders}
          icon={<Wrench className="size-4" aria-hidden />}
          tone={kpis.criticalWorkOrders > 0 ? "alert" : "default"}
          note={t("criticalNote", { count: kpis.criticalWorkOrders })}
        />
        <KpiTile
          label={t("upcomingPpm")}
          value={kpis.upcomingPpm}
          icon={<CalendarClock className="size-4" aria-hidden />}
          note={t("nextSevenDays")}
        />
      </KpiGrid>

      {/*
        The AI insight strip.

        Rendered only when there is something to say — a permanent banner that
        says "0 overdue" trains people to stop reading it. It links to the AI
        Insights module rather than analysing anything itself; the numbers in it
        come from the same scoped aggregations as the tiles above.
      */}
      {(alerts.overduePpm > 0 || alerts.criticalOpen > 0) && (
        <Link
          href={localeHref("/app/ai-insights", locale)}
          className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-foreground transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="size-4 shrink-0 text-accent-text" aria-hidden />
          <span className="min-w-0 flex-1">
            {alerts.overduePpm > 0 && t("alertOverdue", { count: alerts.overduePpm })}
            {alerts.overduePpm > 0 && alerts.criticalOpen > 0 && " · "}
            {alerts.criticalOpen > 0 && t("alertCritical", { count: alerts.criticalOpen })}
          </span>
          <span className="shrink-0 font-medium text-accent-text">{t("seeInsights")}</span>
        </Link>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("workStatus")}</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkStatusDonut
              data={data.workOrdersByStatus.map((entry) => ({
                status: entry.status as WorkOrderStatus,
                count: entry.count,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("trendTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MaintenanceTrendChart data={data.trend} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="mb-4 flex-row items-center justify-between gap-4">
          <CardTitle>{t("upcomingTitle")}</CardTitle>
          <Link
            href={localeHref("/app/preventive", locale)}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tp("title")}
          </Link>
        </CardHeader>
        <CardContent>
          {data.upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t("nothingUpcoming")}
              description={t("nothingUpcomingBody")}
              className="border-0 py-8"
            />
          ) : (
            <ul className="grid gap-3">
              {data.upcoming.map((visit) => (
                <li
                  key={visit.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {visit.assetName ?? t("unknownAsset")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tf(visit.type)} ·{" "}
                      <span className="tabular-nums numeric-isolate">
                        {format.dateTime(new Date(visit.dueDate), { dateStyle: "medium" })}
                      </span>
                    </p>
                  </div>
                  <PpmStatusBadge status={visit.displayStatus} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {alerts.overduePpm > 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {t("alertOverdue", { count: alerts.overduePpm })}
        </p>
      )}
    </div>
  );
}
