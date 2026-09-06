"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import type { WorkOrderPriority } from "@/lib/domain/corrective";
import type { WorkOrderPriorityCount } from "@/lib/db";

/**
 * How much unfinished reactive work sits at each priority, and how much of it
 * nobody owns yet.
 *
 * The screen's answer to the first question a supervisor asks in the morning,
 * before any individual ticket matters: how bad is it, and what has nobody
 * picked up. Each tile is also the filter for its own priority, because having
 * read "7 critical, 3 of them unassigned" the next thing anyone wants is those
 * three rows.
 *
 * Four tiles rather than preventive's six, so the grid goes straight from two
 * columns to four instead of stepping through three — the row reads as one
 * severity ramp on any screen wide enough to hold it.
 *
 * Not built on `Card`: `Card` is a `motion.div`, and these need to be real
 * `<button>`s — a filter you can only reach with a mouse is one a technician on
 * a phone with a keyboard cannot reach at all. The resting style is the same
 * 1px-border-no-shadow card DESIGN.md §4 specifies, so they still read as one
 * family with everything else on the page.
 */

const STAGGER_LIMIT = 10;

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
};

const tileVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" as const } },
};

export function PriorityTiles({
  counts,
  selected,
  onSelect,
}: {
  counts: WorkOrderPriorityCount[];
  /** The priority currently filtering the list, if any. */
  selected: WorkOrderPriority | "";
  /** Called with "" when the active tile is pressed again, to clear the filter. */
  onSelect: (priority: WorkOrderPriority | "") => void;
}) {
  const t = useTranslations("corrective");
  const tp = useTranslations("corrective.priority");

  return (
    <motion.div
      className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
      initial="hidden"
      animate="visible"
      variants={gridVariants}
    >
      {counts.map((count, index) => {
        const isSelected = selected === count.priority;

        return (
          <motion.button
            key={count.priority}
            type="button"
            variants={index < STAGGER_LIMIT ? tileVariants : undefined}
            onClick={() => onSelect(isSelected ? "" : count.priority)}
            aria-pressed={isSelected}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.99, y: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className={cn(
              "group flex flex-col items-start gap-1 rounded-md border bg-surface p-4 text-start transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-border-strong",
            )}
          >
            <span className="text-sm font-medium text-muted-foreground">{tp(count.priority)}</span>

            {/*
              The KPI figure from DESIGN.md §2: display face, 4xl, tabular so the
              digits do not jitter as the number changes under a filter.
              `numeric-isolate` keeps it LTR inside the Arabic layout.
            */}
            <span className="font-display text-4xl font-semibold tabular-nums numeric-isolate text-foreground">
              {count.open}
            </span>

            {/*
              The unassigned figure is rendered only when there is one. A row of
              "0 unassigned" labels trains the eye to skip the line that matters
              on the one morning it is not zero.
            */}
            {count.unassigned > 0 ? (
              <span className="text-xs font-medium text-danger">
                {t("tiles.unassigned", { count: count.unassigned })}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t("tiles.open")}</span>
            )}
          </motion.button>
        );
      })}
    </motion.div>
  );
}
