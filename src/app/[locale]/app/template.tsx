"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

/**
 * The page transition, scoped to the content area.
 *
 * A `template.tsx` re-mounts on every navigation, where a `layout.tsx`
 * persists — which is exactly the split we want: the shell (sidebar, top bar,
 * tab bar) stays put and does not replay its stagger, and only the page fades
 * and rises.
 *
 * Enter only, no exit: animating the outgoing page means holding both in the
 * DOM, and the layout shift that produces on a mid-range Android is far more
 * noticeable than the transition it buys. DESIGN.md §3.
 *
 * Reduced motion is handled globally by `<MotionConfig reducedMotion="user">`
 * in the theme provider — the `y` is dropped and the fade remains.
 */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
