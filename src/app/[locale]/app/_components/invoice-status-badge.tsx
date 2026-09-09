"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { InvoiceDisplayStatus } from "@/lib/domain/invoicing";

/**
 * The three states an invoice is shown in.
 *
 * A map of its own rather than a branch of an existing badge, for the reason
 * every other badge file here gives: those maps are other modules'
 * vocabularies, and merging a fourth would put keys nothing else uses into maps
 * other screens read — where the first collision would be silent. And the
 * collision would be real: `approvals.status` already holds `PENDING`, where it
 * means "waiting for a signature" rather than "waiting for money".
 *
 * The tones, and why:
 *
 *  - OVERDUE is rust, the one attention colour. Money that was due and has not
 *    arrived is the row this screen exists to surface.
 *  - PENDING is neutral. An unpaid invoice inside its terms is not a problem;
 *    it is what most of the ledger looks like on any given morning.
 *  - PAID is moss. Settled, and nothing to do.
 *
 * Written as a literal map on purpose: Tailwind v4 only keeps the theme colours
 * it can see in a complete class name, so a tone built by interpolation gets
 * tree-shaken out of the stylesheet and renders unstyled in production.
 */
const TONE = {
  PENDING: "neutral",
  OVERDUE: "danger",
  PAID: "success",
} as const;

/**
 * Animated, because the status changes under a person's hands: "mark paid" is
 * on the same row, and the press has to look like it did something before the
 * round trip lands.
 *
 * `scale` rather than `width`, so the app's global `<MotionConfig
 * reducedMotion="user">` can drop it to an instant opacity change.
 * `mode="popLayout"` so the outgoing badge leaves the flow immediately rather
 * than shoving the row sideways for the length of the crossfade.
 */
export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  const t = useTranslations("invoicing.status");

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
