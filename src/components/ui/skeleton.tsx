import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

/**
 * `style` is accepted alongside `className` for one reason: a chart placeholder
 * has to be exactly as tall as the chart it stands in for, and that height is a
 * number the chart module owns rather than a Tailwind step. Everything else
 * about the skeleton is still a class.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("skeleton rounded-sm", className)} style={style} aria-hidden="true" />
  );
}
