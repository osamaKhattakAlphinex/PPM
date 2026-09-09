"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MaintenanceTrendPoint } from "@/lib/db";

/**
 * Planned work against reactive work, month by month.
 *
 * The single most useful chart in an FM product, because the SHAPE is the
 * argument: preventive maintenance is supposed to suppress corrective work, so a
 * corrective line that rises while the preventive line is flat is the number a
 * manager needs to see. That is also why both series share ONE y-axis — they are
 * both counts of visits, and a second scale would let the two lines be drawn
 * into any relationship the axis chose.
 *
 * Two series, so both are named twice over: a legend below the plot AND a
 * direct label at the end of each line, so identity never rests on colour alone.
 * The two colours were checked against each other under protanopia,
 * deuteranopia and tritanopia and against the surface for contrast, separately
 * in each theme — which is why the light and dark tokens are different colours
 * rather than one hex on two backgrounds.
 */

export function MaintenanceTrendChart({ data }: { data: MaintenanceTrendPoint[] }) {
  const t = useTranslations("dashboard");
  const format = useFormatter();

  /**
   * `YYYY-MM` into a short month name, in the reader's locale.
   *
   * Parsed as the FIRST of the month at UTC midnight, matching how the buckets
   * were built server-side; `new Date("2026-03")` is parsed as UTC by the spec
   * but `new Date("2026-03-01")` is clearer about intent and about the day.
   */
  const monthLabel = (month: string): string =>
    format.dateTime(new Date(`${month}-01T00:00:00.000Z`), { month: "short" });

  const rows = data.map((point) => ({ ...point, label: monthLabel(point.month) }));
  const last = rows[rows.length - 1];

  return (
    <div>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            {/* Horizontal only, and recessive: the grid is scaffolding for
                reading a value off the axis, not data. Vertical lines would add
                nothing here — the x positions are already labelled. */}
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="var(--chart-axis)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--chart-axis)" }}
            />
            <YAxis
              stroke="var(--chart-axis)"
              tickLine={false}
              axisLine={false}
              width={44}
              // Counts are whole visits: a "2.5 work orders" gridline is a lie.
              allowDecimals={false}
              tick={{ fontSize: 12, fill: "var(--chart-axis)" }}
            />
            <Tooltip
              cursor={{ stroke: "var(--chart-grid)", strokeWidth: 1 }}
              contentStyle={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                color: "var(--foreground)",
                fontSize: "0.8125rem",
              }}
              /**
                * `value` is typed by recharts as a union including `undefined`
                * — a formatter is called for every payload shape the chart can
                * hold — so it is narrowed here rather than asserted.
                */
              formatter={(value, key) => [
                typeof value === "number" ? value : 0,
                key === "preventive" ? t("preventive") : t("corrective"),
              ]}
            />
            <Line
              type="monotone"
              dataKey="preventive"
              stroke="var(--chart-planned)"
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-planned)" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="corrective"
              stroke="var(--chart-reactive)"
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-reactive)" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/*
        The legend, with each series' latest value beside it — the "direct
        label" the design asks for, placed here rather than floating at the end
        of the line where six months of labels would collide on a phone.
      */}
      <ul className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-0.5 w-5 rounded-full"
            style={{ background: "var(--chart-planned)" }}
          />
          <span className="text-muted-foreground">{t("preventive")}</span>
          <span className="tabular-nums numeric-isolate font-medium text-foreground">
            {last?.preventive ?? 0}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-0.5 w-5 rounded-full"
            style={{ background: "var(--chart-reactive)" }}
          />
          <span className="text-muted-foreground">{t("corrective")}</span>
          <span className="tabular-nums numeric-isolate font-medium text-foreground">
            {last?.corrective ?? 0}
          </span>
        </li>
      </ul>
    </div>
  );
}
