"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { ContractDisplayStatus } from "@/lib/domain/amc";

/**
 * The six states a contract is shown in.
 *
 * Separate from `StatusBadge`, `PpmStatusBadge` and `WorkOrderStatusBadge`
 * rather than folded into any of them, for the reason each of those files
 * gives: those maps are the master-data, preventive and corrective
 * vocabularies, and merging a fourth would put keys nothing else uses into maps
 * other screens read — where the first collision would be silent.
 *
 * The collision here would not even be hypothetical. `masterData.status`
 * already holds `ACTIVE` and `SUSPENDED`, and they mean different things: there,
 * `ACTIVE` means "not suspended"; here it means "in force today, begun, and not
 * within sixty days of ending". Two of the six keys would have quietly changed
 * meaning depending on which screen rendered them.
 *
 * The tones, and why:
 *
 *  - EXPIRED is rust, the one attention colour. A contract whose term has run
 *    out while nobody renewed it is work being done for free, or not at all.
 *    That is the row this screen exists to surface.
 *  - EXPIRING is brass — the hazard plate. It matters today but it is not an
 *    emergency: sixty days is exactly enough runway to re-quote and sign, which
 *    is why the window is sixty days.
 *  - ACTIVE is moss. Unlike every other module's terminal-and-good green, this
 *    one means "healthy and running", which is the same thing a contract has to
 *    say: there is nothing to do about it this morning.
 *  - UPCOMING is neutral. Signed, not started, nobody's problem yet.
 *  - SUSPENDED is petrol. Deliberately NOT rust: a suspension is a decision
 *    somebody made on purpose, usually a commercial one, and colouring it as an
 *    alarm would send a manager chasing a row that is exactly where it was put.
 *  - CANCELLED is neutral, and terminal. It is history.
 *
 * Written as a literal map on purpose: Tailwind v4 only keeps the theme colours
 * it can see in a complete class name, so a tone built by interpolation gets
 * tree-shaken out of the stylesheet and renders unstyled in production.
 */
const TONE = {
  UPCOMING: "neutral",
  ACTIVE: "success",
  EXPIRING: "warning",
  EXPIRED: "danger",
  SUSPENDED: "primary",
  CANCELLED: "neutral",
} as const;

/**
 * Animated, like the work-order badge and unlike the priority one.
 *
 * A contract's displayed status changes under a person's hands — suspend,
 * resume, cancel — and each press has to look like it did something before the
 * round trip lands. The row's optimistic update supplies the new status
 * immediately, so this plays on the press rather than on the response.
 *
 * `scale` rather than `width`: the app's global `<MotionConfig
 * reducedMotion="user">` drops TRANSFORM-based animation to an instant opacity
 * change when the OS asks for reduced motion, and it cannot do that for a width.
 * `mode="popLayout"` so the outgoing badge leaves the flow immediately — without
 * it the two are laid out side by side for the length of the crossfade and the
 * whole row jumps sideways.
 */
export function ContractStatusBadge({ status }: { status: ContractDisplayStatus }) {
  const t = useTranslations("amc.status");

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
