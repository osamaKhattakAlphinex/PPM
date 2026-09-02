"use client";

import { useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

function useIsDesktop(breakpoint = 768) {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    setIsDesktop(mql.matches);
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);
  return isDesktop;
}

/**
 * Desktop widths. A six-field form in a 448px dialog is a column of controls
 * roughly 700px tall — taller than the content area of a 768px laptop — so the
 * fix is not only to scroll it but to give it room to lay out sideways. `lg`
 * is wide enough for two comfortable columns of inputs.
 */
const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-2xl",
  lg: "sm:max-w-4xl",
} as const;

const TONES = {
  default: {
    rule: "bg-accent",
    chip: "bg-accent/12 text-accent-text ring-accent/25",
  },
  danger: {
    rule: "bg-danger",
    chip: "bg-danger/12 text-danger ring-danger/25",
  },
} as const;

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Desktop width. Defaults to `sm` — confirmations stay tight. */
  size?: keyof typeof SIZES;
  /** Colours the top rule and the icon chip. */
  tone?: keyof typeof TONES;
  /** A lucide icon element, rendered in a tinted chip beside the title. */
  icon?: ReactNode;
}

/**
 * Centered dialog on desktop, draggable bottom sheet on mobile — one
 * component, two presentations. See docs/DESIGN.md §3.
 *
 * Three structural rules are what make it survive a long form:
 *
 * 1. The shell is a flex column with a bounded height on BOTH presentations.
 *    Desktop previously had no cap at all, so a tall form ran off the top and
 *    bottom of the viewport with nothing to scroll and the footer out of reach.
 * 2. Only the body scrolls. Header and footer are `shrink-0`, so the title and
 *    the Save button stay put however long the form gets.
 * 3. The body is a `@container`, so the form inside lays out against the
 *    DIALOG's width rather than the viewport's. A `sm:grid-cols-2` goes two-up
 *    because the WINDOW is 640px wide, which is exactly wrong when the dialog
 *    itself is 448px — the columns get cramped rather than wider.
 *
 * Padding sits on the sections rather than the shell, so the header and footer
 * rules run edge to edge.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "sm",
  tone = "default",
  icon,
}: ModalProps) {
  const isDesktop = useIsDesktop();
  const toneStyle = TONES[tone];

  function handleDragEnd(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    if (!isDesktop && (info.offset.y > 120 || info.velocity.y > 500)) {
      onOpenChange(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                drag={isDesktop ? false : "y"}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.5 }}
                onDragEnd={handleDragEnd}
                // The vertical centring is carried by `y` rather than a
                // `-translate-y-1/2` class: framer writes `transform`, so a
                // Tailwind translate on the same element would be overwritten
                // mid-animation and the dialog would jump.
                initial={isDesktop ? { opacity: 0, scale: 0.98, y: "-48%" } : { y: "100%" }}
                animate={isDesktop ? { opacity: 1, scale: 1, y: "-50%" } : { y: 0 }}
                exit={isDesktop ? { opacity: 0, scale: 0.98, y: "-48%" } : { y: "100%" }}
                transition={
                  isDesktop
                    ? { duration: 0.18, ease: "easeOut" }
                    : { type: "spring", stiffness: 380, damping: 32 }
                }
                className={cn(
                  "fixed z-50 flex flex-col overflow-hidden bg-surface-raised shadow-lg ring-1 ring-border focus:outline-none",
                  isDesktop
                    ? [
                        "left-1/2 top-1/2 w-[calc(100%-3rem)] -translate-x-1/2 rounded-lg",
                        "max-h-[min(88dvh,46rem)]",
                        SIZES[size],
                      ]
                    : "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-lg",
                )}
              >
                {/*
                  The brass rule from DESIGN.md §1, reused as the dialog's top
                  edge. It turns rust on a destructive dialog, so the tone is
                  legible before the button text is read.
                */}
                <span aria-hidden className={cn("h-0.5 shrink-0", toneStyle.rule)} />

                {!isDesktop && (
                  <div
                    className="mx-auto mb-1 mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border-strong"
                    aria-hidden
                  />
                )}

                <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                  {icon && (
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 grid size-9 shrink-0 place-items-center rounded-md ring-1 ring-inset [&>svg]:size-[18px]",
                        toneStyle.chip,
                      )}
                    >
                      {icon}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="font-display text-base font-semibold leading-snug text-foreground">
                      {title}
                    </Dialog.Title>
                    {description && (
                      <Dialog.Description className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {description}
                      </Dialog.Description>
                    )}
                  </div>

                  <Dialog.Close className="-me-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="size-4" aria-hidden />
                    <span className="sr-only">Close</span>
                  </Dialog.Close>
                </header>

                {children && (
                  <div className="@container flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                    {children}
                  </div>
                )}

                {footer && (
                  <footer
                    className={cn(
                      "flex shrink-0 items-center justify-end gap-2.5 border-t border-border bg-surface-sunken/40 px-5 py-3.5 sm:px-6",
                      // A sheet's footer sits against the home indicator.
                      !isDesktop && "pb-[max(0.875rem,env(safe-area-inset-bottom))]",
                    )}
                  >
                    {footer}
                  </footer>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
