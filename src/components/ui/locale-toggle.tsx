"use client";

import { motion } from "framer-motion";
import { useThemeLocale, type Locale } from "@/components/providers/theme-provider";
import { cn } from "@/lib/cn";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "ar", label: "AR" },
];

export function LocaleToggle() {
  const { locale, setLocale } = useThemeLocale();

  return (
    <div className="relative inline-flex h-11 items-center gap-1 rounded-sm border border-border-strong bg-surface p-1 text-sm font-medium">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLocale(option.value)}
          aria-pressed={locale === option.value}
          className={cn(
            "relative min-w-11 rounded-[4px] px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            locale === option.value ? "text-on-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {locale === option.value && (
            <motion.span
              layoutId="locale-toggle-pill"
              className="absolute inset-0 -z-10 rounded-[4px] bg-primary"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
