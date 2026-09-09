"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, LayoutDashboard, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { localeHref, type Locale } from "@/lib/i18n/config";

/**
 * "Sign in", or the signed-in person's menu.
 *
 * A client island, and it has to be one for a reason worth writing down: the
 * marketing pages are `force-static` (see `docs/SEO.md`), so their HTML is
 * written once at build time — long before anybody has a session. A server
 * component cannot know who is looking at a prerendered page.
 *
 * So the page ships the signed-out state, which is correct for every crawler
 * and for most visitors, and this component asks who is here after hydration.
 * The alternative — making three marketing pages dynamic so the header can read
 * a cookie — would trade the prerender, the static CSP and the Lighthouse
 * scores for a button label.
 *
 * The endpoint is Auth.js's own `/api/auth/session`. It reads the same httpOnly
 * cookie the server does and returns only the claims the session already
 * carries, so this adds no new disclosure: anyone who can call it is already
 * holding the session it describes.
 */

interface PublicSession {
  name: string | null;
}

export function PublicSessionMenu({ locale }: { locale: Locale }) {
  const t = useTranslations("marketing.nav");

  /**
   * Three states, not two. `undefined` is "not asked yet", and it renders the
   * same thing the static HTML already contains — so a signed-out visitor sees
   * no flicker at all, and a signed-in one sees one swap rather than a button
   * that appears out of nowhere.
   */
  const [session, setSession] = useState<PublicSession | null | undefined>(
    undefined,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Aborted on unmount so a fast navigation away does not set state on a
    // component that is gone.
    const controller = new AbortController();

    async function resolve() {
      try {
        const response = await fetch("/api/auth/session", {
          signal: controller.signal,
          // The session cookie is httpOnly; this is what sends it.
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });

        if (!response.ok) {
          setSession(null);
          return;
        }

        const body: unknown = await response.json();
        const user =
          body && typeof body === "object" && "user" in body
            ? (body as { user?: { name?: unknown } }).user
            : null;

        setSession(
          user
            ? { name: typeof user.name === "string" ? user.name : null }
            : null,
        );
      } catch {
        // A failed lookup means "show the signed-out header", which is the
        // safe direction: the worst outcome is a signed-in person being
        // offered a sign-in link that lands them straight back in the app.
        if (!controller.signal.aborted) setSession(null);
      }
    }

    void resolve();
    return () => controller.abort();
  }, []);

  // Close on a click outside, and on Escape — the two ways anyone expects to
  // dismiss a menu.
  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  /**
   * Sign out the way Auth.js expects: fetch the CSRF token, then POST it.
   *
   * Not a link, because a GET that ends a session can be fired by any
   * third-party page with an `<img src>` — a nuisance rather than a breach,
   * but a trivial one to avoid. Not a Server Action either, because this
   * component renders inside a statically generated page.
   */
  async function signOut() {
    setIsSigningOut(true);
    try {
      const csrfResponse = await fetch("/api/auth/csrf", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const { csrfToken } = (await csrfResponse.json()) as {
        csrfToken?: string;
      };
      if (!csrfToken) throw new Error("no csrf token");

      const body = new URLSearchParams({
        csrfToken,
        callbackUrl: localeHref("/", locale),
        json: "true",
      });

      await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });

      // A full reload rather than a router refresh: the page is static, so
      // there is no server render to invalidate — what has to change is the
      // cookie the next request carries.
      window.location.assign(localeHref("/", locale));
    } catch {
      setIsSigningOut(false);
      setIsOpen(false);
    }
  }

  if (!session) {
    return (
      <Link href={localeHref("/login", locale)}>
        <Button size="sm">{t("signIn")}</Button>
      </Link>
    );
  }

  const label = session.name ?? t("account");

  return (
    <div className="relative" ref={menuRef}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span className="max-w-32 truncate">{label}</span>
        <ChevronDown
          className={cn("size-4 transition-transform", isOpen && "rotate-180")}
          aria-hidden
        />
      </Button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute end-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          {/*
            `/app/start` rather than a computed path: it is the post-login
            dispatcher that already knows where each role belongs, so this
            component does not need to learn the routing table.
          */}
          <Link
            href={localeHref("/app/start", locale)}
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none"
            onClick={() => setIsOpen(false)}
          >
            <LayoutDashboard
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            {t("goToApp")}
          </Link>

          <button
            type="button"
            role="menuitem"
            disabled={isSigningOut}
            onClick={signOut}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-start text-sm text-danger transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden />
            {isSigningOut ? t("signingOut") : t("signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
