"use client";

import { animate, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormatter } from "next-intl";

import { cn } from "@/lib/cn";

/**
 * One headline figure, counted up on arrival.
 *
 * The count-up is the one piece of decorative motion in the app, and it earns
 * its place for a specific reason: a dashboard's four numbers all land at once
 * and a reader's eye has nothing to follow. Counting them draws attention to
 * the figure rather than to the tile, and it finishes in under half a second.
 *
 * `useReducedMotion()` is checked and honoured HERE rather than relying on the
 * app's global `<MotionConfig reducedMotion="user">`. That config can only
 * neutralise transform and layout animation on `motion` components; it cannot
 * know that a number ticking from 0 to 148 is animation at all. Somebody who has
 * asked their OS for less motion gets the final figure immediately, with no
 * transition.
 *
 * `null` is rendered as an em dash rather than as zero, throughout. "No assets
 * have fallen due yet" and "nothing was done" are opposite statements about a
 * maintenance provider, and a KPI that cannot tell them apart is worse than no
 * KPI.
 */

const COUNT_UP_MS = 420;

function useCountUp(target: number | null): number | null {
  const prefersReducedMotion = useReducedMotion();
  const [value, setValue] = useState(target);
  /** Where the last animation finished, so a re-render counts from there. */
  const from = useRef(target ?? 0);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      return;
    }

    if (prefersReducedMotion) {
      from.current = target;
      setValue(target);
      return;
    }

    const controls = animate(from.current, target, {
      duration: COUNT_UP_MS / 1000,
      ease: "easeOut",
      onUpdate: (latest) => setValue(Math.round(latest)),
      onComplete: () => {
        from.current = target;
      },
    });

    return () => controls.stop();
  }, [target, prefersReducedMotion]);

  return value;
}

export interface KpiTileProps {
  label: string;
  /** `null` renders an em dash. See the header — it is not zero. */
  value: number | null;
  /** Appended to the counted figure, e.g. "%". */
  suffix?: string;
  /** A short line under the figure: what the number is over. */
  note?: ReactNode;
  /** A lucide icon element, rendered small and muted beside the label. */
  icon?: ReactNode;
  /** Raises the figure to the attention colour. For a number that means act. */
  tone?: "default" | "alert";
  className?: string;
}

export function KpiTile({
  label,
  value,
  suffix,
  note,
  icon,
  tone = "default",
  className,
}: KpiTileProps) {
  const format = useFormatter();
  const counted = useCountUp(value);

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 6 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
      }}
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border border-border bg-surface p-4",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {icon}
        {label}
      </span>

      <span
        className={cn(
          "font-display text-4xl font-semibold tabular-nums numeric-isolate",
          tone === "alert" ? "text-danger" : "text-foreground",
        )}
      >
        {counted === null ? "—" : format.number(counted)}
        {counted !== null && suffix}
      </span>

      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </motion.div>
  );
}

/** The grid the tiles sit in, with the stagger they arrive on. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
    >
      {children}
    </motion.div>
  );
}
