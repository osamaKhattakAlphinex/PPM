"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/cn";

/**
 * An asset's condition, 0–100.
 *
 * Three details that are easy to get wrong and matter here:
 *
 *  1. The fill animates `scaleX`, not `width`. The app's global
 *     `<MotionConfig reducedMotion="user">` drops TRANSFORM-based animation to
 *     an instant opacity change when the OS asks for reduced motion — it cannot
 *     do that for a width, which would keep sliding regardless. A transform is
 *     also the cheap one to animate on a field device.
 *  2. `origin-left rtl:origin-right`, so the bar grows from the start edge in
 *     both directions. The same mirroring the toast progress bar uses
 *     (DESIGN.md §3); a scaleX with a default centre origin grows from the
 *     middle outward, which reads as a gauge rather than a fill.
 *  3. `role="progressbar"` rather than the semantically-tempting `meter`, which
 *     assistive technology support for is still patchy. The percentage is also
 *     rendered as text, so the value never depends on colour alone.
 */

/** Three bands, mapped onto the palette's semantic tones rather than new hues. */
function toneFor(health: number): { bar: string; text: string } {
  if (health >= 70) return { bar: "bg-success", text: "text-success" };
  if (health >= 40) return { bar: "bg-warning", text: "text-accent-text" };
  return { bar: "bg-danger", text: "text-danger" };
}

export function HealthBar({ value, label }: { value: number; label: string }) {
  // Defensive: the model bounds this 0–100, but a bar that renders at -0.3
  // scale because of a bad read is a visual bug nobody traces back to data.
  const health = Math.max(0, Math.min(100, Math.round(value)));
  const tone = toneFor(health);

  return (
    <div className="inline-flex w-28 items-center gap-2 sm:w-32">
      <div
        role="progressbar"
        aria-valuenow={health}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full border border-border bg-surface-sunken"
      >
        <motion.div
          className={cn("h-full w-full origin-left rounded-full rtl:origin-right", tone.bar)}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: health / 100 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
        />
      </div>
      <span className={cn("w-8 shrink-0 text-xs font-medium tabular-nums", tone.text)}>
        {health}
      </span>
    </div>
  );
}
