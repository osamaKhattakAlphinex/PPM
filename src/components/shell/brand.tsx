"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { localeHref, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/cn";

/**
 * The wordmark: a brass valve-tag square with the product initials, then the
 * name. Not a logo file — there isn't one yet, and a placeholder image would
 * be worse than a deliberate typographic mark.
 *
 * The initials stay Latin in both locales. "PPM" is the product's name, not a
 * word to translate, and a two-glyph mark that changes shape between languages
 * stops being a mark.
 */
export function Brand({
  href,
  className,
  /**
   * Drop the wordmark text below `sm`, leaving the tile. At 390px the top bar
   * is already carrying a menu button and three controls; the name truncates
   * to "PP…" and stops being a name. The drawer shows it in full.
   */
  compact = false,
}: {
  href: string;
  className?: string;
  compact?: boolean;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("brand");

  return (
    <Link
      href={localeHref(href, locale)}
      className={cn(
        "group flex min-h-9 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-md bg-petrol-800 font-display text-xs font-bold tracking-tight text-brass-300 shadow-sm ring-1 ring-inset ring-brass-500/40 transition-transform group-hover:-translate-y-px"
      >
        PPM
      </span>
      <span className={cn("min-w-0 flex-col", compact ? "hidden sm:flex" : "flex")}>
        <span className="truncate font-display text-sm font-semibold text-foreground">
          {t("name")}
        </span>
        <span className="truncate text-xs text-muted-foreground">{t("tagline")}</span>
      </span>
    </Link>
  );
}
