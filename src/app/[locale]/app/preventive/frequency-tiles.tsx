"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import type { PpmFrequency } from "@/lib/domain/preventive";
import type { PpmTypeCount } from "@/lib/db";

/**
 * How much open work there is at each frequency, and how much of it is late.
 *
 * The screen's answer to the first question an FM manager asks in the morning,
 * before any individual visit matters: where is the load, and where is it
 * slipping. Each tile is also the filter for its own frequency, because having
 * read "9 quarterly, 3 of them overdue" the next thing anyone wants is those
 * three rows.
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

export function FrequencyTiles({
  counts,
  selected,
  onSelect,
}: {
  counts: PpmTypeCount[];
  /** The frequency currently filtering the list, if any. */
  selected: PpmFrequency | "";
  /** Called with "" when the active tile is pressed again, to clear the filter. */
  onSelect: (type: PpmFrequency | "") => void;
}) {
  const t = useTranslations("preventive");
  const tf = useTranslations("preventive.frequency");

  return (
    <motion.div
      className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
      initial="hidden"
      animate="visible"
      variants={gridVariants}
    >
      {counts.map((count, index) => {
        const isSelected = selected === count.type;

        return (
          <motion.button
            key={count.type}
            type="button"
            variants={index < STAGGER_LIMIT ? tileVariants : undefined}
            onClick={() => onSelect(isSelected ? "" : count.type)}
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
            <span className="text-sm font-medium text-muted-foreground">{tf(count.type)}</span>

            {/*
              The KPI figure from DESIGN.md §2: display face, 4xl, tabular so the
              digits do not jitter as the number changes under a filter.
              `numeric-isolate` keeps it LTR inside the Arabic layout.
            */}
            <span className="font-display text-4xl font-semibold tabular-nums numeric-isolate text-foreground">
              {count.open}
            </span>

            {/*
              The overdue figure is rendered only when there is one. A row of
              "0 overdue" labels trains the eye to skip the line that matters on
              the one morning it is not zero.
            */}
            {count.overdue > 0 ? (
              <span className="text-xs font-medium text-danger">
                {t("tiles.overdue", { count: count.overdue })}
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
