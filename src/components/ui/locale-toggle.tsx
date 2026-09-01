"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";

import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_LABELS,
  localeHref,
  type Locale,
} from "@/lib/i18n/config";
import { cn } from "@/lib/cn";

/**
 * EN / AR.
 *
 * Switching the language is a NAVIGATION, not a state change: the locale is a
 * path segment, so `/en/app/assets` becomes `/ar/app/assets` and the server
 * re-renders the page with `dir="rtl"`, the Arabic font stack and the taller
 * Arabic line-heights. Nothing flips client-side, which is why the whole
 * layout mirrors cleanly instead of half-mirroring after hydration.
 *
 * The cookie is written alongside so the choice survives a visit to a URL
 * with no locale in it — the middleware reads it before falling back to
 * `Accept-Language`.
 *
 * `replace`, not `push`: the same page in the other language is not a separate
 * step in the visitor's history, and a Back button that walks them through
 * every toggle is a Back button they stop trusting.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const active = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("locale");
  const [isPending, startTransition] = useTransition();

  const select = (next: Locale) => {
    if (next === active) return;

    document.cookie = [
      `${LOCALE_COOKIE}=${next}`,
      "path=/",
      `max-age=${LOCALE_COOKIE_MAX_AGE}`,
      "samesite=lax",
      window.location.protocol === "https:" ? "secure" : "",
    ]
      .filter(Boolean)
      .join("; ");

    startTransition(() => {
      router.replace(localeHref(pathname, next));
      // The layout above this component reads the locale from the URL; without
      // a refresh the server components in the tree keep their cached output.
      router.refresh();
    });
  };

  return (
    <div
      role="group"
      aria-label={t("label")}
      aria-busy={isPending || undefined}
      className={cn(
        "relative inline-flex h-11 items-center gap-0.5 rounded-sm border border-border-strong bg-surface p-1 text-sm font-medium",
        className,
      )}
    >
      {LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => select(locale)}
            aria-pressed={isActive}
            // The visible label is a two-letter abbreviation; the accessible
            // name is the language in its own language.
            aria-label={LOCALE_LABELS[locale].full}
            lang={locale}
            className={cn(
              "relative min-w-9 rounded-[4px] px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "text-on-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/*
              `z-0`, not `-z-10`: the button creates no stacking context, so a
              negative index would drop the pill behind the group's own
              background and it would never be seen. The label sits above it.
            */}
            {isActive && (
              <motion.span
                layoutId="locale-toggle-pill"
                className="absolute inset-0 z-0 rounded-[4px] bg-primary"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative z-10">{LOCALE_LABELS[locale].short}</span>
          </button>
        );
      })}
    </div>
  );
}
