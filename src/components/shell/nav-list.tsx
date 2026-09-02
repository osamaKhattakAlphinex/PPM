"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";

import { localeHref, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/cn";
import { MODULE_ICONS } from "./nav-icons";
import type { ShellModule } from "./types";

/**
 * The module list, shared by the desktop sidebar and the mobile drawer.
 *
 * One component for both so a module can never appear in one and not the
 * other, and so the active-state rule is written once.
 *
 * Motion, per DESIGN.md §3: children stagger in by 30ms on first mount only.
 * `MotionConfig reducedMotion="user"` (set in the theme provider) turns the
 * slide into an opacity-only fade when the OS asks for that — no per-component
 * opt-in, no `useReducedMotion()` branch here.
 */

export function NavList({
  modules,
  activeKey,
  layoutIdPrefix,
  onNavigate,
  className,
}: {
  modules: readonly ShellModule[];
  activeKey: string | null;
  /**
   * The shared-element indicator uses `layoutId`, which is global. The sidebar
   * and the drawer can both be mounted at once (a tablet rotating), so each
   * instance namespaces its own or the pill flies across the screen between
   * them.
   */
  layoutIdPrefix: string;
  /** Closes the drawer after a tap. Not passed on desktop, where nothing closes. */
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useTranslations("nav");
  const locale = useLocale() as Locale;
  const isRtl = locale === "ar";

  return (
    <motion.ul
      className={cn("flex flex-col gap-0.5", className)}
      initial="hidden"
      animate="shown"
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
      }}
    >
      {modules.map((module) => {
        const Icon = MODULE_ICONS[module.key];
        const isActive = module.key === activeKey;

        return (
          <motion.li
            key={module.key}
            variants={{
              // Enters from the inline-start edge — which is the right edge in
              // Arabic, hence the sign flip rather than a hard-coded -8.
              hidden: { opacity: 0, x: isRtl ? 8 : -8 },
              shown: { opacity: 1, x: 0, transition: { duration: 0.18, ease: "easeOut" } },
            }}
          >
            <Link
              href={localeHref(module.href, locale)}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // 36px rows on a mouse; `.touch-target` (globals.css) puts the
                // 44px box from DESIGN.md §4 back on a coarse pointer, which is
                // where that rule was actually aimed — this same list is the
                // mobile drawer.
                "group relative flex min-h-9 touch-target items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              {/*
                `z-0` and not `-z-10`: a negative index would put the pill
                behind the SIDEBAR's background rather than behind the label,
                because the link creates no stacking context of its own. The
                icon and label are positioned so they paint above it.
              */}
              {isActive && (
                <>
                  <motion.span
                    layoutId={`${layoutIdPrefix}-active-bg`}
                    className="absolute inset-0 z-0 rounded-md bg-surface shadow-sm"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                  {/*
                    A brass rule on the inline-start edge — the valve-tag
                    reference from DESIGN.md §1, and a second, non-colour signal
                    for the active item alongside `aria-current`.
                  */}
                  <motion.span
                    layoutId={`${layoutIdPrefix}-active-rule`}
                    className="absolute inset-y-1 start-0 z-0 w-0.5 rounded-full bg-accent"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                </>
              )}

              <Icon
                className={cn(
                  "relative z-10 size-[18px] shrink-0 transition-colors",
                  isActive ? "text-accent-text" : "text-mist-500 group-hover:text-foreground",
                )}
                aria-hidden
              />
              <span className="relative z-10 truncate">{t(module.key)}</span>
            </Link>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
