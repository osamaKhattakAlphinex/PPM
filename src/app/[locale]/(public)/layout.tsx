import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/config";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo/site";
import { MarketingFooter } from "./_components/marketing-footer";
import { MarketingHeader } from "./_components/marketing-header";

/**
 * The public marketing surface.
 *
 * A route GROUP — `(public)` — so it adds no path segment: the landing page is
 * `/en`, not `/en/public`. What it does add is the one thing that separates
 * these pages from every other page in the product: they are INDEXABLE.
 *
 * `robots` is overridden here, and that override is deliberate and narrow. The
 * locale layout above sets `index: false` for the whole tree, which is the
 * correct default for a product that is almost entirely an authenticated app;
 * `/app` then re-asserts it, so if this group's override were ever widened by
 * accident the authenticated shell would still be noindex. Two statements, in
 * opposite directions, each on the segment it is about.
 *
 * `metadataBase` is set here rather than at the root because it is only
 * meaningful for pages that emit absolute URLs — canonicals, hreflang, Open
 * Graph images. Without it Next resolves those against localhost and silently
 * ships a canonical nobody can follow.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: { siteName: SITE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
};

export default async function PublicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    /**
     * `min-h-dvh` with the footer pushed down by `flex-1` on the main, so a
     * short page does not leave the footer floating in the middle of a tall
     * screen. `dvh` rather than `vh` because a phone's address bar makes `vh`
     * taller than the visible viewport.
     */
    <div className="flex min-h-dvh flex-col bg-background">
      <MarketingHeader locale={locale} />
      <main className="flex-1">{children}</main>
      <MarketingFooter locale={locale} />
    </div>
  );
}
