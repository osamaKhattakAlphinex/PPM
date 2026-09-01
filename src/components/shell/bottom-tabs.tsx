"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { localeHref, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/cn";
import { MODULE_ICONS } from "./nav-icons";
import type { ShellModule } from "./types";

/**
 * The mobile bottom bar: four destinations plus the drawer trigger.
 *
 * Four, not eleven, and not "whatever fits". A 360px phone gives each of five
 * slots 72px, and the 44px minimum target from DESIGN.md §4 has to fit inside
 * that with a label under it. Everything past the fourth module lives in the
 * drawer behind "More", which is why "More" is a real, labelled control rather
 * than a hamburger tucked into the header where a thumb cannot reach it.
 *
 * `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the iPhone home
 * indicator, which otherwise sits directly on top of the middle tab.
 */
export function BottomTabs({
  modules,
  activeKey,
  onOpenMenu,
  menuButtonRef,
  isMenuOpen,
}: {
  modules: readonly ShellModule[];
  activeKey: string | null;
  onOpenMenu: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  isMenuOpen: boolean;
}) {
  const t = useTranslations("shell");
  const nav = useTranslations("nav");
  const locale = useLocale() as Locale;

  const tabs = modules.filter((module) => module.primary).slice(0, 4);

  const cellClass =
    "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 pt-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <nav
      aria-label={t("primaryNavigation")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex items-stretch">
        {tabs.map((module) => {
          const Icon = MODULE_ICONS[module.key];
          const isActive = module.key === activeKey;

          return (
            <li key={module.key} className="flex flex-1">
              <Link
                href={localeHref(module.href, locale)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  cellClass,
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {isActive && (
                  // A brass rule along the top edge of the active cell, sharing
                  // one layoutId so it slides between tabs rather than blinking.
                  <motion.span
                    layoutId="bottom-tab-rule"
                    className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon
                  className={cn("size-5", isActive ? "text-accent-text" : "text-mist-500")}
                  aria-hidden
                />
                <span className="max-w-full truncate">{nav(module.key)}</span>
              </Link>
            </li>
          );
        })}

        <li className="flex flex-1">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={onOpenMenu}
            aria-expanded={isMenuOpen}
            aria-haspopup="dialog"
            className={cn(cellClass, "text-muted-foreground")}
          >
            <MoreHorizontal className="size-5 text-mist-500" aria-hidden />
            <span className="max-w-full truncate">{t("more")}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
