"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useThemeLocale } from "@/components/providers/theme-provider";

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useThemeLocale();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      className="relative inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-sm border border-border-strong bg-surface text-foreground transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? "moon" : "sun"}
          initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex"
        >
          {isDark ? <Moon className="size-5" aria-hidden /> : <Sun className="size-5" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
