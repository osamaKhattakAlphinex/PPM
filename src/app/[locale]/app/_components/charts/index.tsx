"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * The charts, loaded only when a screen that uses them is opened.
 *
 * Recharts is the single largest dependency in the client bundle — it pulls in
 * d3-scale, d3-shape and d3-array — and only three screens in the product draw a
 * chart. Importing it directly from a page would put it in the shared chunk that
 * every signed-in user downloads, including a technician on a phone whose entire
 * job is a list of today's work.
 *
 * `ssr: false` as well as the dynamic import, and that is a correctness
 * requirement rather than an optimisation: recharts' `ResponsiveContainer`
 * measures its parent element to decide the SVG's size, and there is no element
 * to measure on the server. Rendered server-side it emits an empty box, which
 * React then reports as a hydration mismatch when the browser draws the real
 * one.
 *
 * A `"use client"` module is needed for `ssr: false` at all — Next forbids it in
 * a Server Component — so this barrel is the seam. It exists so that the pages
 * import a chart the same way they import any other component.
 */

/**
 * A placeholder the exact height of the chart it replaces.
 *
 * Matching the height is the point: a skeleton that is shorter than its content
 * makes the whole page jump when the chart arrives, which is worse than showing
 * nothing at all.
 */
function ChartSkeleton({ height }: { height: number }) {
  return <Skeleton className="w-full rounded-md" style={{ height }} />;
}

export const WorkStatusDonut = dynamic(
  () => import("./work-status-donut").then((module) => module.WorkStatusDonut),
  { ssr: false, loading: () => <ChartSkeleton height={220} /> },
);

export const MaintenanceTrendChart = dynamic(
  () => import("./maintenance-trend-chart").then((module) => module.MaintenanceTrendChart),
  { ssr: false, loading: () => <ChartSkeleton height={268} /> },
);
