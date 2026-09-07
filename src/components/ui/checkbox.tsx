"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * A tick box.
 *
 * A real `<button role="checkbox">` rather than an `<input type="checkbox">`,
 * and the reason is the one thing this control has to get right: it is pressed
 * with a thumb, in a plant room, through a glove. A native checkbox is drawn at
 * roughly 13px by the platform and cannot be resized reliably across browsers,
 * so every design system ends up hiding it behind a styled `<span>` anyway —
 * at which point the "native" argument has already been spent, and what is left
 * is a hidden input whose focus ring has to be forwarded by hand.
 *
 * A button carries the whole affordance instead: it is focusable, it is
 * activated by both Space and Enter, and `role="checkbox"` + `aria-checked`
 * gives a screen reader exactly the same announcement the input would have. The
 * label is passed as `aria-label` by the caller, because in both places this is
 * used the visible text sits beside the box rather than inside it.
 *
 * The check itself is drawn with a spring, not a fade: ticking a line is the
 * single most repeated gesture in the run sheet, and it should feel like the
 * box caught the press. `MotionConfig reducedMotion="user"` (theme provider)
 * drops the scale to an opacity change when the OS asks it to.
 */
export function Checkbox({
  checked,
  onChange,
  disabled,
  label,
  size = "md",
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** The accessible name. The visible text lives beside the box, not in it. */
  label: string;
  /** `lg` is the thumb-sized one used in the run sheet. */
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "grid shrink-0 place-items-center rounded-md border transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "lg" ? "size-7" : "size-5",
        checked
          ? "border-success bg-success text-on-primary"
          : "border-border-strong bg-surface text-transparent hover:border-primary",
        className,
      )}
    >
      <motion.span
        // Keyed on the state so the spring replays on every tick rather than
        // only on mount.
        key={checked ? "on" : "off"}
        initial={{ scale: checked ? 0.4 : 1, opacity: checked ? 0 : 1 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 520, damping: 24 }}
        className="grid place-items-center"
      >
        <Check className={cn(size === "lg" ? "size-4.5" : "size-3.5")} aria-hidden strokeWidth={3} />
      </motion.span>
    </button>
  );
}
