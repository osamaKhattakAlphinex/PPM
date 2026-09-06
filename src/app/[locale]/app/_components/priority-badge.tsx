"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { WorkOrderPriority } from "@/lib/domain/corrective";

/**
 * How badly a work order needs doing.
 *
 * Four steps, and the point of the colours is that a supervisor can find the
 * critical rows without reading a word:
 *
 *  - CRITICAL is rust, the palette's one "attention" colour. Plant down, or a
 *    safety system out — the thing that gets looked at before this sentence is
 *    finished.
 *  - HIGH is brass, DESIGN.md §1's hazard-plate amber: it matters today, but it
 *    is not an emergency.
 *  - MEDIUM is petrol, the brand hue. Present, ordinary, unalarming.
 *  - LOW is neutral. Most of a healthy backlog is here, and a list where every
 *    row shouts is a list nobody scans.
 *
 * Note what is NOT used: `accent`. `globals.css` defines `--warning` as
 * `var(--accent)`, so the Badge's `warning` and `accent` variants are the same
 * brass and are indistinguishable side by side. The style guide's early
 * work-order prototype pairs `High: warning` with `Medium: accent`, which
 * renders two identical badges; that is the trap this map avoids.
 *
 * Written as a literal map on purpose: Tailwind v4 only keeps the theme colours
 * it can see in a complete class name, so a tone built by interpolation gets
 * tree-shaken out of the stylesheet and renders unstyled in production.
 *
 * Not animated, unlike `WorkOrderStatusBadge`. Priority changes on an edit, in a
 * modal that closes over the top of the row; there is nothing for a person to
 * watch, and a transition here would only compete with the status one beside it.
 */
const TONE = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "primary",
  LOW: "neutral",
} as const;

export function PriorityBadge({ priority }: { priority: WorkOrderPriority }) {
  const t = useTranslations("corrective.priority");

  return (
    <Badge variant={TONE[priority]} dot>
      {t(priority)}
    </Badge>
  );
}
