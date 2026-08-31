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

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * Renders as a centered dialog on desktop and a draggable bottom sheet on
 * mobile — one component, two presentations. See docs/DESIGN.md §3.
 */
export function Modal({ open, onOpenChange, title, description, children, footer }: ModalProps) {
  const isDesktop = useIsDesktop();

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
                className="fixed inset-0 z-50 bg-ink/50"
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
                initial={isDesktop ? { opacity: 0, scale: 0.98 } : { y: "100%" }}
                animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }}
                exit={isDesktop ? { opacity: 0, scale: 0.98 } : { y: "100%" }}
                transition={
                  isDesktop
                    ? { duration: 0.18, ease: "easeOut" }
                    : { type: "spring", stiffness: 380, damping: 32 }
                }
                className={cn(
                  "fixed z-50 flex flex-col bg-surface-raised shadow-lg focus:outline-none",
                  isDesktop
                    ? "left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg p-6"
                    : "inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
                )}
              >
                {!isDesktop && (
                  <div
                    className="mx-auto mb-4 h-1.5 w-10 shrink-0 rounded-full bg-border-strong"
                    aria-hidden
                  />
                )}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Dialog.Title className="font-display text-lg font-semibold text-foreground">
                      {title}
                    </Dialog.Title>
                    {description && (
                      <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                        {description}
                      </Dialog.Description>
                    )}
                  </div>
                  <Dialog.Close className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="size-4" aria-hidden />
                    <span className="sr-only">Close</span>
                  </Dialog.Close>
                </div>
                <div className="mt-4 overflow-y-auto">{children}</div>
                {footer && (
                  <div className="mt-6 flex shrink-0 items-center justify-end gap-3 border-t border-border pt-4">
                    {footer}
                  </div>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
