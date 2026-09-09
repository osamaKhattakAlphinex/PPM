"use client";

import { useTranslations } from "next-intl";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { WorkOrderStatus } from "@/lib/domain/corrective";

/**
 * Where the tenant's reactive work currently stands.
 *
 * ## Why a sequential ramp rather than five colours
 *
 * The five work-order statuses are an ORDERED progression — open, assigned, in
 * progress, pending, closed — not five unrelated things. So they take one hue
 * from light to dark (`--chart-seq-1..5`), which encodes the ordering in the
 * colour itself: a reader can see at a glance whether the tenant's work is
 * bunched at the start of the pipeline or the end.
 *
 * Five *categorical* hues would have been the obvious choice and would have been
 * wrong twice over. It would encode "unrelated" for things that are ordered, and
 * this palette's ramps cannot produce five hues that survive a colour-vision
 * check (the closest attempt came out at ΔE 5.2 under deuteranopia, well under
 * the ΔE 8 floor) — so it would also have been unreadable for roughly one man in
 * twelve.
 *
 * ## What carries identity besides colour
 *
 * Colour alone never identifies a slice here:
 *
 *  - a legend beside the chart names every status and its count;
 *  - a 2px gap in the surface colour separates adjacent segments, so two
 *    similar steps of the ramp never touch;
 *  - the total sits in the middle, so the chart answers "how much work is
 *    there" without any colour at all;
 *  - the legend IS the table view — every number on the chart is also written
 *    out as text.
 *
 * The tokens are CSS variables rather than hex literals, so the chart follows
 * the theme toggle without this component knowing which theme is active. The
 * dark ramp is stepped separately against the dark surface rather than being an
 * inversion of the light one.
 */

export interface WorkStatusSlice {
  status: WorkOrderStatus;
  count: number;
}

/** The ramp, light to dark, in the order the statuses progress. */
const RAMP = [
  "var(--chart-seq-1)",
  "var(--chart-seq-2)",
  "var(--chart-seq-3)",
  "var(--chart-seq-4)",
  "var(--chart-seq-5)",
] as const;

export function WorkStatusDonut({ data }: { data: WorkStatusSlice[] }) {
  const t = useTranslations("dashboard");
  const ts = useTranslations("corrective.status");

  const total = data.reduce((sum, slice) => sum + slice.count, 0);

  /**
   * Recharts renders nothing for an all-zero pie, which would leave an empty
   * box with a legend of noughts beside it. The empty state says so instead.
   */
  if (total === 0) {
    return (
      <p className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">
        {t("noWorkOrders")}
      </p>
    );
  }

  const slices = data.map((slice, index) => ({
    ...slice,
    label: ts(slice.status),
    fill: RAMP[index % RAMP.length]!,
  }));

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="relative h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="count"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              // The 2px surface-coloured stroke IS the gap the design asks for:
              // two adjacent steps of one ramp must never share an edge.
              stroke="var(--chart-gap)"
              strokeWidth={2}
              paddingAngle={1}
              // Off: the app's global reduced-motion config cannot reach inside
              // recharts, and a chart that redraws itself on every re-render is
              // noise rather than motion.
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.status} fill={slice.fill} />
              ))}
            </Pie>
            <Tooltip
              cursor={false}
              contentStyle={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                color: "var(--foreground)",
                fontSize: "0.8125rem",
              }}
              /**
               * `ValueType` rather than `number`: recharts types a tooltip
               * value as a union that includes arrays and `undefined`, because
               * a formatter is called for every payload shape the chart can
               * hold. Narrowing at the boundary is honest; asserting `number`
               * would be a lie the compiler happens to accept.
               */
              formatter={(value, name) => [typeof value === "number" ? value : 0, String(name)]}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* The headline, in the hole. Absolute rather than a recharts <Label>
            so it uses the app's own type tokens. `pointer-events-none` keeps it
            out of the way of the slices' hover targets. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-semibold tabular-nums numeric-isolate text-foreground">
            {total}
          </span>
          <span className="text-xs text-muted-foreground">{t("workOrders")}</span>
        </div>
      </div>

      {/* The legend, which is also the table view: every value on the chart is
          written out here as text, so nothing is encoded in colour alone. */}
      <ul className="grid gap-1.5 text-sm sm:min-w-[10rem]">
        {slices.map((slice) => (
          <li key={slice.status} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/10"
                style={{ background: slice.fill }}
              />
              {slice.label}
            </span>
            <span className="tabular-nums numeric-isolate font-medium text-foreground">
              {slice.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
