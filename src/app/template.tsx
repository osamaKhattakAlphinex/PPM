"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

/**
 * Runs on every route change (not on initial load persistence like layout.tsx)
 * so navigating between pages gets a consistent fade + rise. See DESIGN.md §3.
 */
export default function Template({ children }: { children: ReactNode }) {
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
