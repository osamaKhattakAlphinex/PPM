"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { ChecklistRunStatus } from "@/lib/domain/checklists";

/**
 * The two states a checklist run is shown in.
 *
 * Separate from `StatusBadge`, `PpmStatusBadge` and `WorkOrderStatusBadge`
 * rather than folded into any of them, for the reason `ppm-status-badge.tsx`
 * gives: those maps are the MASTER-DATA, PREVENTIVE and CORRECTIVE
 * vocabularies, and merging a fourth would put keys nothing else uses into maps
 * other screens read — where the first collision would be silent.
 *
 * The tones follow the convention the other three already set, which is what
 * makes them readable without a legend:
 *
 *  - IN_PROGRESS is petrol, the brand hue, because it is petrol on the
 *    preventive and corrective badges too. Same idea — live, in hand, not a
 *    problem — and a concept that changes colour between screens is a concept a
 *    person has to learn twice.
 *  - COMPLETED is moss, and terminal, exactly as CLOSED is on a work order.
 *
 * There is no warning tone here and there should not be: a run is either being
 * done or is signed off. "Overdue" is a property of the JOB the run is attached
 * to, and the job's own badge already says it.
 *
 * Written as a literal map on purpose: Tailwind v4 only keeps the theme colours
 * it can see in a complete class name, so a tone built by interpolation gets
 * tree-shaken out of the stylesheet and renders unstyled in production.
 */
const TONE = {
  IN_PROGRESS: "primary",
  COMPLETED: "success",
} as const;

/**
 * Swapped through `AnimatePresence` for the same reason the work-order badge is:
 * completing a run is a deliberate press whose effect must be visible before
 * the round trip lands, and the sheet supplies the new status optimistically.
 *
 * `scale` rather than `width`, so the app's global `<MotionConfig
 * reducedMotion="user">` can drop it to an instant opacity change; it cannot do
 * that for a width, which would keep animating regardless. `mode="popLayout"`
 * so the outgoing badge leaves the flow immediately instead of sitting beside
 * the incoming one and shoving the row sideways.
 */
export function ChecklistRunBadge({ status }: { status: ChecklistRunStatus }) {
  const t = useTranslations("checklists.runStatus");

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
