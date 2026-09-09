import { LOCALES, type Locale } from "@/lib/i18n/config";

/**
 * The facts the public pages, the sitemap, the robots file and the JSON-LD all
 * have to agree about.
 *
 * One module rather than a constant in each place, because the failure mode of
 * disagreement is silent: a canonical URL on one origin and a sitemap on
 * another is a site that tells a crawler two different things and gets indexed
 * as neither.
 *
 * Pure: strings and the locale list. Imported by server components, the sitemap
 * route and the metadata builders alike.
 */

/**
 * The public origin, with no trailing slash.
 *
 * Read from the environment because it genuinely differs per deployment —
 * preview, staging, production — and a hardcoded one would put the production
 * canonical on a preview build, which is how a preview deployment ends up
 * outranking the real site.
 *
 * The fallback is localhost rather than a guessed production domain: a wrong
 * absolute URL in a canonical tag is worse than an obviously-local one, because
 * the local one is noticed immediately.
 *
 * `NEXT_PUBLIC_` deliberately — this is the one value on the public side that a
 * Client Component may legitimately need, and it is not a secret: it is the
 * address people type.
 */
export const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export const SITE_NAME = "PPM Platform";

/** The public pages, in sitemap order. Unprefixed — the locale is added. */
export const PUBLIC_ROUTES = ["", "/pricing", "/contact"] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

/** An absolute URL for one route in one locale. */
export function absoluteUrl(route: PublicRoute, locale: Locale): string {
  return `${SITE_ORIGIN}/${locale}${route}`;
}

/**
 * The `alternates` block every public page sets.
 *
 * Three things a crawler needs and which are easy to get subtly wrong:
 *
 *  - a CANONICAL pointing at this page in this language, so the two locales are
 *    not treated as duplicates of each other;
 *  - a `languages` map, which Next renders as `hreflang` links, so a crawler
 *    knows the Arabic page is the same page rather than a different one;
 *  - `x-default`, pointing at English. Without it a crawler picks one itself,
 *    and the one it picks for a Gulf audience is not predictable.
 */
export function alternatesFor(route: PublicRoute, locale: Locale) {
  const languages: Record<string, string> = {};
  for (const alternate of LOCALES) {
    languages[alternate] = absoluteUrl(route, alternate);
  }
  languages["x-default"] = absoluteUrl(route, "en");

  return { canonical: absoluteUrl(route, locale), languages };
}

/**
 * The organisation, as JSON-LD.
 *
 * Emitted once, on the landing page only. Repeating it on every page is a
 * common and pointless habit: a crawler needs the entity described once per
 * site, and three copies of it is three chances for them to disagree.
 */
export function organizationJsonLd(locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("", locale),
    logo: `${SITE_ORIGIN}/icon.svg`,
    areaServed: ["SA", "AE", "KW", "BH", "OM", "QA"],
    knowsLanguage: ["en", "ar"],
  };
}

/**
 * The product, as JSON-LD.
 *
 * `SoftwareApplication` with `offers`, because the pricing page states prices
 * and a rich result that shows them is the point of marking this up at all.
 * The currency is SAR, which is the currency the product actually bills in.
 */
export function softwareJsonLd(locale: Locale, priceFrom: number) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteUrl("", locale),
    inLanguage: ["en", "ar"],
    offers: {
      "@type": "Offer",
      price: String(priceFrom),
      priceCurrency: "SAR",
      url: absoluteUrl("/pricing", locale),
    },
  };
}
