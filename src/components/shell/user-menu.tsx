"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LogOut, Settings, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { logoutAction } from "@/lib/auth/actions";
import { localeHref, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/cn";
import type { ShellUser } from "./types";

/**
 * Account menu.
 *
 * Hand-rolled rather than pulled from Radix: this is a menu of three links and
 * a form, and the kit already carries one Radix dependency (`Dialog`, for the
 * modal) that earns its weight through focus trapping. A dropdown does not.
 * What it does need is here — Escape closes it, an outside click closes it,
 * focus returns to the trigger, and the trigger reports `aria-expanded`.
 *
 * Sign-out is a `<form action>` bound to a Server Action, not an `onClick`
 * fetch: it works before hydration, and it is a POST, so a prefetch or a
 * crawler following the link cannot sign anyone out.
 */
export function UserMenu({ user }: { user: ShellUser }) {
  const t = useTranslations("userMenu");
  const roleLabel = useTranslations("roles");
  const locale = useLocale() as Locale;
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      // Focus goes back where it came from, or a keyboard user is stranded at
      // the top of the document.
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const initials = initialsOf(user.name);

  const itemClass =
    "flex min-h-11 w-full items-center gap-2.5 px-3 text-sm text-foreground transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        aria-label={t("openLabel")}
        className="flex min-h-11 items-center gap-2 rounded-sm border border-border-strong bg-surface ps-1.5 pe-2 transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-petrol-800 font-display text-xs font-semibold text-brass-300"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 flex-col items-start sm:flex">
          <span className="max-w-32 truncate text-xs font-semibold text-foreground">
            {user.name}
          </span>
          <span className="max-w-32 truncate text-[11px] text-muted-foreground">
            {roleLabel(user.role)}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-mist-500 transition-transform duration-150",
            isOpen && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label={t("label")}
            // `end-0` not `right-0`: the menu hangs off the inline-end edge, so
            // it opens leftwards in English and rightwards in Arabic.
            className="absolute end-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-md border border-border bg-surface-raised py-1 shadow-lg"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <div className="border-b border-border px-3 pb-3 pt-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("signedInAs")}
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground">{user.name}</p>
              {/*
                An address is a Latin token inside possibly-Arabic prose; without
                isolation the bidi algorithm drags its punctuation to the wrong
                end. DESIGN.md §5.
              */}
              <p className="bidi-isolate mt-0.5 truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>

            <Link
              href={localeHref("/app/account", locale)}
              role="menuitem"
              className={itemClass}
              onClick={() => setIsOpen(false)}
            >
              <Settings className="size-4 text-mist-500" aria-hidden />
              {t("account")}
            </Link>

            {user.role === "ADMIN" && (
              <Link
                href={localeHref("/app/admin", locale)}
                role="menuitem"
                className={itemClass}
                onClick={() => setIsOpen(false)}
              >
                <ShieldCheck className="size-4 text-mist-500" aria-hidden />
                {t("administration")}
              </Link>
            )}

            <form action={logoutAction} className="border-t border-border">
              <button type="submit" role="menuitem" className={cn(itemClass, "text-danger")}>
                <LogOut className="size-4" aria-hidden />
                {t("signOut")}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Up to two initials, taken by code point so a name in Arabic script produces
 * Arabic initials rather than mojibake — `String.prototype[0]` would split a
 * surrogate pair.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? "");
  return letters.join("").toUpperCase() || "?";
}
