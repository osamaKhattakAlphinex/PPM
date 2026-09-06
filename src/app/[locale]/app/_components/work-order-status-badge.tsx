"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { WorkOrderStatus } from "@/lib/domain/corrective";

/**
 * The five states a work order is shown in.
 *
 * Separate from `StatusBadge` and from `PpmStatusBadge` rather than folded into
 * either, for the reason `ppm-status-badge.tsx` gives: those maps are the
 * MASTER-DATA and PREVENTIVE vocabularies, and merging a third would put keys
 * nothing else uses into maps other screens read — where the first collision
 * would be silent.
 *
 * The tones, and why:
 *
 *  - IN_PROGRESS is petrol, the brand hue, and it is petrol HERE because it is
 *    petrol on the preventive badge too. It is the same idea — live, in hand,
 *    not a problem — and a concept that changes colour between two screens is a
 *    concept a person has to learn twice.
 *  - PENDING is rust, the one attention colour, and it is the only status that
 *    gets it. A ticket blocked on a part, an approval or access is the anomaly
 *    in this list: nobody is working it and nobody will until someone clears
 *    the block. That is the row a supervisor exists to find.
 *  - OPEN is brass. Raised and untriaged is the NORMAL state of new work, not a
 *    failure — it needs picking up today, which is what brass says.
 *  - ASSIGNED is neutral: it has an owner and is waiting its turn. Nothing to
 *    do about it.
 *  - CLOSED is moss, and the only terminal one.
 *
 * Written as a literal map on purpose: Tailwind v4 only keeps the theme colours
 * it can see in a complete class name, so a tone built by interpolation gets
 * tree-shaken out of the stylesheet and renders unstyled in production.
 */
const TONE = {
  OPEN: "warning",
  ASSIGNED: "neutral",
  IN_PROGRESS: "primary",
  PENDING: "danger",
  CLOSED: "success",
} as const;

/**
 * The transition is the point of this component.
 *
 * A work order moves more often than a PPM visit does — assign, start, hold,
 * resume, close — and each press has to LOOK like it did something, on a phone,
 * in a plant room, before the round trip lands. So the badge is keyed on the
 * status and swapped through `AnimatePresence`: the old tone fades out as the
 * new one scales in, 160ms, inside DESIGN.md §3's micro-interaction band. The
 * row's optimistic update supplies the new status immediately, so this plays on
 * the press rather than on the response.
 *
 * `scale` rather than `width`: the app's global `<MotionConfig reducedMotion=
 * "user">` drops TRANSFORM-based animation to an instant opacity change when
 * the OS asks for reduced motion, and it cannot do that for a width, which
 * would keep animating regardless. No per-component opt-in is needed or wanted.
 *
 * `mode="popLayout"` so the outgoing badge leaves the flow immediately — without
 * it the two are laid out side by side for the length of the crossfade and the
 * whole row jumps sideways.
 */
export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const t = useTranslations("corrective.status");

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
