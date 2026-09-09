import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { localeHref, type Locale } from "@/lib/i18n/config";
import { SITE_NAME } from "@/lib/seo/site";

/**
 * The public footer.
 *
 * A server component with no JavaScript at all. The year is computed at RENDER
 * time on the server rather than in the browser: a `new Date()` in a client
 * component would be a hydration mismatch waiting for midnight, and these pages
 * are statically rendered anyway.
 */
export async function MarketingFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations("marketing");

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          © {new Date().getUTCFullYear()} {SITE_NAME}. {t("footerNote")}
        </p>

        <nav aria-label={t("footerNav")} className="flex flex-wrap items-center gap-5">
          <Link
            href={localeHref("/pricing", locale)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("nav.pricing")}
          </Link>
          <Link
            href={localeHref("/contact", locale)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("nav.contact")}
          </Link>
          <Link
            href={localeHref("/login", locale)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("nav.signIn")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
