"use client";

import { useTranslations } from "next-intl";
import { Boxes, HeartPulse, TriangleAlert, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PortalKpis } from "@/lib/dashboard/queries";
import type { WorkOrderStatus } from "@/lib/domain/corrective";
import { MaintenanceTrendChart, WorkStatusDonut } from "../_components/charts";
import { KpiGrid, KpiTile } from "../_components/kpi-tile";

/**
 * The customer's own figures, on their own home screen.
 *
 * Deliberately NARROWER than the staff dashboard, and the omissions are the
 * design rather than an unfinished screen:
 *
 *  - There is no PM compliance figure. That number is the provider's
 *    performance against its own internal plan, and the plan itself is not a
 *    customer-facing document — `ppmSchedulesRepository` refuses a client scope
 *    outright, so there is no way to compute it here even by accident.
 *  - The trend chart's preventive series is therefore all zeroes for a client
 *    session and is not drawn; what a customer sees is their own reactive work
 *    over six months, which is the question they actually ask ("is my building
 *    breaking more than it used to?").
 *
 * Every number arrives as a prop, computed on the server by `loadPortalKpis()`
 * against a scope the DAL narrowed to this client.
 */
export function PortalFigures({ figures }: { figures: PortalKpis }) {
  const t = useTranslations("dashboard");

  return (
    <>
      <KpiGrid>
        <KpiTile
          label={t("yourAssets")}
          value={figures.assets}
          icon={<Boxes className="size-4" aria-hidden />}
        />
        <KpiTile
          label={t("openWorkOrders")}
          value={figures.openWorkOrders}
          icon={<Wrench className="size-4" aria-hidden />}
          tone={figures.criticalWorkOrders > 0 ? "alert" : "default"}
          note={t("criticalNote", { count: figures.criticalWorkOrders })}
        />
        <KpiTile
          label={t("averageHealth")}
          value={figures.averageHealth}
          suffix="%"
          icon={<HeartPulse className="size-4" aria-hidden />}
        />
        <KpiTile
          label={t("alertCriticalShort")}
          value={figures.criticalWorkOrders}
          icon={<TriangleAlert className="size-4" aria-hidden />}
          tone={figures.criticalWorkOrders > 0 ? "alert" : "default"}
        />
      </KpiGrid>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("workStatus")}</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkStatusDonut
              data={figures.workOrdersByStatus.map((entry) => ({
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
            <MaintenanceTrendChart data={figures.trend} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
