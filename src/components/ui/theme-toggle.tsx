"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/cn";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const t = useTranslations("theme");
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? t("toLight") : t("toDark")}
      aria-pressed={isDark}
      className={cn(
        "relative inline-flex size-9 touch-target-square items-center justify-center overflow-hidden rounded-md border border-border-strong bg-surface text-foreground transition-colors hover:border-primary hover:bg-surface-sunken hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
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
          {isDark ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
