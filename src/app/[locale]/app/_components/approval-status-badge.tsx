"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { ApprovalStatus } from "@/lib/domain/approvals";

/**
 * The four states a chain is shown in.
 *
 * A map of its own rather than a branch of an existing badge, for the reason
 * every other badge file here gives: those maps are other modules'
 * vocabularies, and merging a fifth would put keys nothing else uses into maps
 * other screens read — where the first collision would be silent. The collision
 * would be real, too: `amc.status` already holds `ACTIVE` and `CANCELLED`, and
 * neither means what any of these four mean.
 *
 * The tones, and why:
 *
 *  - PENDING is neutral. Something waiting for a decision is not a problem; it
 *    is the ordinary state of this screen, and colouring the whole queue as an
 *    alert would make the colour meaningless by lunchtime.
 *  - APPROVED is brass. It is GOOD news that is also an OUTSTANDING TASK —
 *    somebody has to raise the invoice — so it must not read as finished.
 *  - COMPLETED is moss: signed off and billed. This is the one that is done.
 *  - REJECTED is rust. Work was refused, and someone has to redo it or argue
 *    about it. That is the row this screen exists to surface.
 *
 * Written as a literal map on purpose: Tailwind v4 only keeps the theme colours
 * it can see in a complete class name, so a tone built by interpolation gets
 * tree-shaken out of the stylesheet and renders unstyled in production.
 */
const TONE = {
  PENDING: "neutral",
  APPROVED: "warning",
  REJECTED: "danger",
  COMPLETED: "success",
} as const;

/**
 * Animated, because a status here changes under a person's hands: the approve
 * and reject buttons are on the same row as the badge, and the press has to
 * look like it did something before the round trip lands.
 *
 * `scale` rather than `width`, so the app's global `<MotionConfig
 * reducedMotion="user">` can drop it to an instant opacity change; it cannot do
 * that for a width. `mode="popLayout"` so the outgoing badge leaves the flow
 * immediately rather than sitting beside the incoming one and shoving the row
 * sideways for the length of the crossfade.
 */
export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const t = useTranslations("approvals.status");

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
