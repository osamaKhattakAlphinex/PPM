import Link from "next/link";

import { Button } from "@/components/ui/button";
import { LocaleToggle } from "@/components/ui/locale-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { localeHref, type Locale } from "@/lib/i18n/config";
import { getTranslations } from "next-intl/server";
import { PublicSessionMenu } from "./public-session-menu";

/**
 * The public header.
 *
 * A SERVER component, and everything in it that can be static is static: the
 * links are `<a>` elements rendered on the server, and only the toggles and the
 * session menu are client islands. That is what keeps the landing page's
 * JavaScript to the controls that genuinely need it rather than to a whole
 * navigation.
 *
 * The session menu has to be an island because these pages are `force-static`:
 * their HTML is written at build time, so no server render here can know who is
 * looking. It ships the signed-out state and corrects itself after hydration —
 * see `public-session-menu.tsx`.
 *
 * `<nav>` with an accessible name, because there are two navigations on the
 * page — this and the footer's — and a screen reader listing "navigation,
 * navigation" is a screen reader that cannot tell them apart.
 */
export async function MarketingHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations("marketing");

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-5">
        <Link
          href={localeHref("/", locale)}
          className="font-display text-lg font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          PPM<span className="text-accent-text">.</span>
        </Link>

        <nav
          aria-label={t("primaryNav")}
          className="ms-6 hidden items-center gap-6 sm:flex"
        >
          <Link
            href={localeHref("/pricing", locale)}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("nav.pricing")}
          </Link>
          <Link
            href={localeHref("/scenarios", locale)}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("nav.scenarios")}
          </Link>
          <Link
            href={localeHref("/contact", locale)}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("nav.contact")}
          </Link>
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <LocaleToggle />
          <ThemeToggle />
          {/*
            Static, and deliberately outside the session island: "Start free" is
            the page's primary call to action and must be in the prerendered
            HTML, where a crawler and a visitor on a slow connection both find
            it. A signed-in visitor seeing it is harmless — the sign-up page
            redirects them to their own workspace.
          */}
          <Link
            href={localeHref("/signup", locale)}
            className="hidden sm:block"
          >
            <Button size="sm" variant="outline">
              {t("nav.signUp")}
            </Button>
          </Link>
          <PublicSessionMenu locale={locale} />
        </div>
      </div>
    </header>
  );
}
