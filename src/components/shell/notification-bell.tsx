"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";

import { cn } from "@/lib/cn";
import { localeHref, type Locale } from "@/lib/i18n/config";
import { MAX_UNREAD_COUNT, REF_HREF } from "@/lib/domain/notifications";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import type { NotificationFeed } from "@/lib/notifications/queries";

/**
 * The bell.
 *
 * The feed is rendered on the SERVER by the shell and handed in, so the badge is
 * correct on first paint rather than after a fetch — a count that appears a
 * second late is a count people learn to distrust.
 *
 * Two things it deliberately does not do:
 *
 *  - It does not poll. A maintenance manager's notifications are a nightly job's
 *    output, not a chat feed, and a request every thirty seconds from every open
 *    tab in a tenant is a cost with no corresponding benefit. The count refreshes
 *    on navigation, which in an app people move around in is often enough.
 *  - It does not render the message text from the server. Each notification
 *    carries a KEY and its parameters, and the sentence is composed here in the
 *    reader's own locale — so a notification written at 02:00 by a job is
 *    English for an English reader and Arabic for an Arabic one.
 */
export function NotificationBell({ initial }: { initial: NotificationFeed }) {
  const t = useTranslations("notifications");
  const format = useFormatter();
  const locale = useLocale() as Locale;

  const [feed, setFeed] = useState(initial);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Close on an outside click or Escape.
   *
   * A popover rather than the app's `Modal`: a bell menu that took over the
   * screen on a phone would be a dialog, and dismissing it would cost a
   * deliberate action for something people open to glance at.
   */
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function markRead(id: string) {
    startTransition(async () => {
      const response = await markNotificationReadAction({ id });
      if (response.ok) setFeed(response.data);
    });
  }

  function markAllRead() {
    startTransition(async () => {
      const response = await markAllNotificationsReadAction({});
      if (response.ok) setFeed(response.data);
    });
  }

  const badge =
    feed.unread >= MAX_UNREAD_COUNT ? `${MAX_UNREAD_COUNT - 1}+` : String(feed.unread);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        // The count is in the accessible name, not only in the badge: a screen
        // reader user gets "Notifications, 3 unread" rather than "Notifications".
        aria-label={t("ariaLabel", { count: feed.unread })}
        className="relative grid size-9 touch-target-square place-items-center rounded-md border border-border-strong bg-surface text-foreground transition-colors hover:border-primary hover:bg-surface-sunken hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="size-4" aria-hidden />

        {feed.unread > 0 && (
          <span
            aria-hidden
            className="absolute -end-1 -top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-on-primary"
          >
            {badge}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={t("title")}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            /**
             * Anchored to the inline-END edge with `end-0`, so it opens leftward
             * in English and rightward in Arabic without a JS measurement. A
             * fixed `right-0` would hang off the screen in RTL.
             */
            className="absolute end-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="font-medium text-foreground">{t("title")}</p>
              {feed.unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <CheckCheck className="size-3.5" aria-hidden />
                  {t("markAllRead")}
                </button>
              )}
            </div>

            {feed.items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {feed.items.map((item) => (
                  <li key={item.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={localeHref(REF_HREF[item.refType], locale)}
                      onClick={() => {
                        if (!item.isRead) markRead(item.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        !item.isRead && "bg-accent/5",
                      )}
                    >
                      {/* Unread is marked with a dot AND a weight change, never
                          with colour alone. */}
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          item.isRead
                            ? "bg-transparent"
                            : item.severity === "URGENT"
                              ? "bg-danger"
                              : "bg-accent",
                        )}
                      />
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block text-sm text-foreground",
                            !item.isRead && "font-medium",
                          )}
                        >
                          {/*
                            The sentence is composed HERE from a key and its
                            parameters, in the reader's locale. `params` is a
                            record of strings and numbers written by the job
                            from the tenant's own data.
                          */}
                          {t(`message.${item.titleKey}`, item.params)}
                        </span>
                        <span className="mt-0.5 block text-xs tabular-nums numeric-isolate text-muted-foreground">
                          {format.relativeTime(new Date(item.createdAt))}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
