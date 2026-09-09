"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Report } from "@/lib/reports/queries";
import { HealthBar } from "../_components/health-bar";

/**
 * A generated report, rendered for the screen and for the printer.
 *
 * The same component serves both: `print:` utilities strip the card chrome and
 * force black-on-white, so Ctrl-P produces the document rather than a screenshot
 * of an app. That is deliberately NOT a second code path — a print stylesheet
 * that drifts from the screen is how a report ends up missing the one column
 * somebody needed.
 *
 * There is no chart here. A report is read on paper as often as on screen, and a
 * donut that prints as five identical grey wedges is worse than the table it
 * replaced. Every figure is a number or a bar with its value written beside it.
 *
 * Everything arrives as one prop, computed on the server. This component fetches
 * nothing and decides nothing about scope.
 */
export function ReportView({ report }: { report: Report }) {
  const t = useTranslations("reports");
  const format = useFormatter();

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium" });

  return (
    <article className="grid gap-4 print:gap-6">
      {/* The masthead. On paper this is the letterhead; on screen it is a
          summary of what the reader is looking at and when it was taken. */}
      <header className="rounded-md border border-border bg-surface p-4 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-foreground">
              {t(`kind.${report.kind}.title`)}
            </h3>
            <p className="text-sm text-muted-foreground">
              {report.organizationName}
              {report.clientName ? ` · ${report.clientName}` : ""}
            </p>
          </div>
          <div className="text-end text-sm text-muted-foreground">
            <p className="tabular-nums numeric-isolate">{day(report.generatedAt)}</p>
            {report.organizationVatNumber && (
              <p className="tabular-nums numeric-isolate">
                {t("vatNumber", { number: report.organizationVatNumber })}
              </p>
            )}
          </div>
        </div>
      </header>

      {report.kind === "PM" && <PmBody report={report} />}
      {report.kind === "ASSET" && <AssetBody report={report} />}
      {report.kind === "FINANCIAL" && <FinancialBody report={report} />}
    </article>
  );
}

/** A figure and its label. The report's unit of content. */
function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4 print:border-0 print:p-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-display text-3xl font-semibold tabular-nums numeric-isolate text-foreground">
        {value}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="print:border-0 print:shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * A plain table.
 *
 * Not the app's responsive `Table`, deliberately: that one collapses to cards
 * below `md`, which is right for an interactive list and wrong for a document —
 * a printed report has no breakpoint, and a reader comparing six frequencies
 * needs the columns to line up. It scrolls sideways on a phone instead.
 */
function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={`py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
                  index === 0 ? "text-start" : "text-end"
                }`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`py-2 text-foreground ${
                    cellIndex === 0 ? "text-start" : "text-end tabular-nums numeric-isolate"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PmBody({ report }: { report: Extract<Report, { kind: "PM" }> }) {
  const t = useTranslations("reports");
  const tf = useTranslations("preventive.frequency");
  const format = useFormatter();

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label={t("compliance")}
          // An em dash, not "0%": nothing having fallen due is not a failure.
          value={report.compliance === null ? "—" : `${report.compliance}%`}
          note={t("complianceNote", { done: report.completed, due: report.due })}
        />
        <Figure label={t("completed")} value={String(report.completed)} />
        <Figure label={t("missed")} value={String(report.missed)} />
        <Figure label={t("upcoming")} value={String(report.upcoming)} />
      </div>

      <Section title={t("byFrequency")}>
        {report.byFrequency.length === 0 ? (
          <EmptyState title={t("noData")} className="border-0 py-6" />
        ) : (
          <DataTable
            headers={[t("frequency"), t("scheduled"), t("completed"), t("overdue"), t("compliance")]}
            rows={report.byFrequency.map((row) => [
              tf(row.frequency),
              row.total,
              row.completed,
              row.overdue,
              row.compliance === null ? "—" : `${row.compliance}%`,
            ])}
          />
        )}
      </Section>

      <Section title={t("overdueVisits")}>
        {report.overdue.length === 0 ? (
          <EmptyState title={t("nothingOverdue")} className="border-0 py-6" />
        ) : (
          <DataTable
            headers={[t("asset"), t("frequency"), t("dueDate")]}
            rows={report.overdue.map((row) => [
              row.assetName ?? t("unknownAsset"),
              tf(row.type),
              format.dateTime(new Date(row.dueDate), { dateStyle: "medium" }),
            ])}
          />
        )}
      </Section>
    </>
  );
}

function AssetBody({ report }: { report: Extract<Report, { kind: "ASSET" }> }) {
  const t = useTranslations("reports");
  const tc = useTranslations("masterData.assets.category");
  const ts = useTranslations("masterData.status");

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={t("totalAssets")} value={String(report.total)} />
        <Figure label={t("inService")} value={String(report.active)} />
        <Figure label={t("underMaintenance")} value={String(report.inMaintenance)} />
        <Figure
          label={t("averageHealth")}
          value={report.averageHealth === null ? "—" : `${report.averageHealth}%`}
          note={t("openWorkOrdersNote", { count: report.openWorkOrders })}
        />
      </div>

      <Section title={t("byCategory")}>
        {report.byCategory.length === 0 ? (
          <EmptyState title={t("noData")} className="border-0 py-6" />
        ) : (
          <DataTable
            headers={[t("category"), t("totalAssets"), t("inService"), t("underMaintenance"), t("averageHealth")]}
            rows={report.byCategory.map((row) => [
              tc(row.category),
              row.total,
              row.active,
              row.maintenance,
              row.averageHealth === null ? "—" : `${row.averageHealth}%`,
            ])}
          />
        )}
      </Section>

      <Section title={t("worstCondition")}>
        {report.worst.length === 0 ? (
          <EmptyState title={t("noData")} className="border-0 py-6" />
        ) : (
          <DataTable
            headers={[t("asset"), t("category"), t("status"), t("health")]}
            rows={report.worst.map((row) => [
              row.name,
              tc(row.category),
              <Badge key={`${row.id}-status`} variant="neutral">
                {ts(row.status)}
              </Badge>,
              <HealthBar key={`${row.id}-health`} value={row.health} label={row.name} />,
            ])}
          />
        )}
      </Section>
    </>
  );
}

function FinancialBody({ report }: { report: Extract<Report, { kind: "FINANCIAL" }> }) {
  const t = useTranslations("reports");
  const format = useFormatter();
  const money = (value: number) => format.number(value, "currency");

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label={t("invoiced")}
          value={money(report.invoiced)}
          note={t("invoiceCountNote", { count: report.invoiceCount })}
        />
        <Figure label={t("collected")} value={money(report.paid)} />
        <Figure label={t("outstanding")} value={money(report.pending)} />
        <Figure
          label={t("overdueMoney")}
          value={money(report.overdue)}
          note={t("overdueCountNote", { count: report.overdueCount })}
        />
      </div>

      <Section title={t("contracts")}>
        <DataTable
          headers={[t("measure"), t("value")]}
          rows={[
            [t("contractValue"), money(report.contractValue)],
            [t("activeContracts"), report.activeContracts],
            [t("expiringContracts"), report.expiringContracts],
            [
              t("averageContractCompliance"),
              report.averageCompliance === null ? "—" : `${report.averageCompliance}%`,
            ],
          ]}
        />
      </Section>

      <Section title={t("workloadTrend")}>
        <DataTable
          headers={[t("month"), t("preventive"), t("corrective")]}
          rows={report.trend.map((point) => [
            format.dateTime(new Date(`${point.month}-01T00:00:00.000Z`), {
              month: "short",
              year: "numeric",
            }),
            point.preventive,
            point.corrective,
          ])}
        />
      </Section>
    </>
  );
}
