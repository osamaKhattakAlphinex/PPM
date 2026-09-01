"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { Locale } from "@/lib/i18n/config";
import { Brand } from "./brand";
import { NavList } from "./nav-list";
import type { ShellModule } from "./types";

/**
 * The sidebar, as a drawer, below `lg`.
 *
 * It slides from the inline-start edge — the left in English, the right in
 * Arabic — which is where the thing that opened it lives in both languages.
 * Framer Motion animates physical `x`, so the sign is flipped for RTL rather
 * than left to a CSS logical property that does not apply to transforms.
 *
 * The behaviours that make a drawer usable rather than merely present:
 * Escape closes it, the backdrop closes it, focus moves into the panel on open
 * and back to the trigger on close, Tab is trapped inside while it is open,
 * and the page behind it does not scroll.
 */
export function MobileDrawer({
  isOpen,
  onClose,
  modules,
  activeKey,
  homeHref,
  triggerRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  modules: readonly ShellModule[];
  activeKey: string | null;
  homeHref: string;
  /** Focus goes back here on close. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("shell");
  const locale = useLocale() as Locale;
  const isRtl = locale === "ar";
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    /**
     * Captured now, not read in the cleanup. Reading `triggerRef.current` at
     * cleanup time is what `react-hooks/exhaustive-deps` warns about — by then
     * the node it points at may have been replaced or unmounted. Capturing here
     * is not just a way to quiet the rule, it is correct: the caller sets the
     * ref BEFORE opening the drawer, so it already holds the button that opened
     * it, and that is the button focus should return to.
     */
    const openedBy = triggerRef.current;

    // The panel itself takes focus first (it is tabindex={-1}) so a screen
    // reader announces the dialog before its first link.
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      // Focus trap. A drawer with a backdrop that Tab can escape leaves a
      // keyboard user tabbing through a page they cannot see.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      (openedBy ?? previouslyFocused)?.focus();
    };
  }, [isOpen, onClose, triggerRef]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/*
            A plain opacity fade, never a backdrop blur: blur is expensive to
            composite on the low-end Android a technician carries. DESIGN.md §3.
          */}
          <motion.button
            type="button"
            aria-label={t("closeMenu")}
            onClick={onClose}
            className="absolute inset-0 bg-ink/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("primaryNavigation")}
            tabIndex={-1}
            className="absolute inset-y-0 start-0 flex w-[min(19rem,85vw)] flex-col bg-surface-sunken shadow-lg outline-none"
            initial={{ x: isRtl ? "100%" : "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: isRtl ? "100%" : "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <Brand href={homeHref} className="min-w-0" />
              <button
                type="button"
                onClick={onClose}
                aria-label={t("closeMenu")}
                className="grid size-11 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <NavList
                modules={modules}
                activeKey={activeKey}
                layoutIdPrefix="drawer"
                onNavigate={onClose}
              />
            </nav>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
