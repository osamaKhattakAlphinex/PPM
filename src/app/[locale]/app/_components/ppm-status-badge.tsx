"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { PpmDisplayStatus } from "@/lib/domain/preventive";

/**
 * The five states a planned visit is shown in.
 *
 * Separate from `StatusBadge` rather than folded into its `TONE` map, because
 * that map is the MASTER-DATA vocabulary (a client is ACTIVE or SUSPENDED, an
 * asset is under MAINTENANCE). Merging them would put five keys nothing else
 * uses into a map three screens read, and the first collision — a `SCHEDULED`
 * that meant something else somewhere — would be silent.
 *
 * The tones are chosen so the row can be read without reading:
 *
 *  - OVERDUE is rust, the palette's one "attention" colour, and the only status
 *    here that means someone has to do something today.
 *  - UPCOMING is brass — the hazard-plate amber DESIGN.md §1 gives to warning —
 *    for work inside the week that still has slack in it.
 *  - IN_PROGRESS is petrol, the brand hue: live, in hand, not a problem.
 *  - SCHEDULED is neutral. Most of the plan is further out than a week, and a
 *    list where every row shouts is a list nobody scans.
 *  - COMPLETED is moss, and the only terminal one.
 *
 * Written as a literal map on purpose: Tailwind v4 only keeps the theme colours
 * it can see in a complete class name, so a tone built by interpolation gets
 * tree-shaken out of the stylesheet and renders unstyled in production.
 */
const TONE = {
  SCHEDULED: "neutral",
  UPCOMING: "warning",
  OVERDUE: "danger",
  IN_PROGRESS: "primary",
  COMPLETED: "success",
} as const;

/**
 * The transition is the point of this component.
 *
 * Pressing Start has to LOOK like it did something, on a phone, in a plant room,
 * before the round trip lands — so the badge is keyed on the status and swapped
 * through `AnimatePresence`: the old tone fades out as the new one scales in,
 * 160ms, inside DESIGN.md §3's micro-interaction band.
 *
 * `scale` rather than `width`: the app's global `<MotionConfig reducedMotion=
 * "user">` drops TRANSFORM-based animation to an instant opacity change when the
 * OS asks for reduced motion, and it cannot do that for a width, which would
 * keep animating regardless. No per-component opt-in is needed or wanted.
 *
 * `mode="popLayout"` so the outgoing badge leaves the flow immediately — without
 * it the two are laid out side by side for the length of the crossfade and the
 * whole row jumps sideways.
 */
export function PpmStatusBadge({ status }: { status: PpmDisplayStatus }) {
  const t = useTranslations("preventive.status");

  return (
    <span className="inline-grid">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="inline-flex"
        >
          <Badge variant={TONE[status]} dot>
            {t(status)}
          </Badge>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
