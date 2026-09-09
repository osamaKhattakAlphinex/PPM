"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { stripLocale } from "@/lib/i18n/config";
import { activeModuleKey } from "@/lib/nav/modules";
import type { Role } from "@/lib/auth/roles";
import { BottomTabs } from "./bottom-tabs";
import { MobileDrawer } from "./mobile-drawer";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { NotificationFeed } from "@/lib/notifications/queries";
import type { ShellModule, ShellUser } from "./types";

/**
 * The authenticated shell.
 *
 * A client component holding exactly one piece of state — whether the drawer
 * is open — and composing four presentational pieces around the page. It is
 * mounted by the layout, not by a page, so it survives navigation: the sidebar
 * does not re-mount, its stagger does not replay on every click, and only the
 * content area animates (see `app/[locale]/app/template.tsx`).
 *
 * The active item is derived from `usePathname()` rather than passed down from
 * the server, so it updates the instant a link is clicked instead of waiting
 * for the server response.
 */
export function AppShell({
  modules,
  user,
  homeHref,
  notifications,
  children,
}: {
  /** Already filtered to this user's role, server-side. */
  modules: readonly ShellModule[];
  user: ShellUser;
  homeHref: string;
  /** The bell's first page, rendered on the server. See `Topbar`. */
  notifications?: NotificationFeed;
  children: ReactNode;
}) {
  const t = useTranslations("shell");
  const nav = useTranslations("nav");
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Two triggers open the same drawer; whichever one was used is the one focus
  // returns to when it closes.
  const headerTriggerRef = useRef<HTMLButtonElement>(null);
  const tabTriggerRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement>(null);

  const openFrom = useCallback((ref: React.RefObject<HTMLButtonElement | null>) => {
    lastTriggerRef.current = ref.current;
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  // A route change while the drawer is open — the back button, a redirect —
  // should not leave it hanging over the new page.
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [pathname]);

  const barePath = stripLocale(pathname);
  const activeKey = activeModuleKey(barePath, user.role as Role);
  const activeTitle = activeKey ? nav(activeKey) : undefined;

  return (
    <div className="flex min-h-dvh bg-background">
      {/*
        First tabbable element on the page. Eleven nav links stand between the
        top of the document and the content, and a keyboard user should not
        have to walk past them on every navigation.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-sm focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-primary"
      >
        {t("skipToContent")}
      </a>

      <Sidebar modules={modules} activeKey={activeKey} homeHref={homeHref} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          homeHref={homeHref}
          notifications={notifications}
          onOpenMenu={() => openFrom(headerTriggerRef)}
          menuButtonRef={headerTriggerRef}
          isMenuOpen={isDrawerOpen}
          title={activeTitle}
        />

        <main
          id="main-content"
          tabIndex={-1}
          // The bottom padding clears the fixed tab bar below `lg`. Without it
          // the last row of a work-order table sits permanently underneath it.
          className="flex-1 px-4 pb-28 pt-5 outline-none sm:px-6 sm:pt-6 lg:pb-10"
        >
          {children}
        </main>
      </div>

      <MobileDrawer
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        modules={modules}
        activeKey={activeKey}
        homeHref={homeHref}
        triggerRef={lastTriggerRef}
      />

      <BottomTabs
        modules={modules}
        activeKey={activeKey}
        onOpenMenu={() => openFrom(tabTriggerRef)}
        menuButtonRef={tabTriggerRef}
        isMenuOpen={isDrawerOpen}
      />
    </div>
  );
}
