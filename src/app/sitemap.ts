import type { MetadataRoute } from "next";

import { LOCALES } from "@/lib/i18n/config";
import {
  absoluteUrl,
  DYNAMIC_PUBLIC_ROUTES,
  PUBLIC_ROUTES,
} from "@/lib/seo/site";

/**
 * The sitemap.
 *
 * Only the PUBLIC pages, and that is the whole design. The authenticated app is
 * `noindex`, so listing `/app/assets` here would be telling a crawler to fetch
 * something it is explicitly forbidden to index — and, worse, publishing the
 * shape of a private application to anybody who reads the file. What is in this
 * file is exactly `PUBLIC_ROUTES` plus `DYNAMIC_PUBLIC_ROUTES` — the marketing
 * pages, and the one public page that renders per request. Both lists live in
 * `src/lib/seo/site.ts`, which is also what the marketing navigation reads, so
 * they cannot drift.
 *
 * Each entry carries its `alternates.languages` map, which Next renders as the
 * `xhtml:link rel="alternate" hreflang` elements a crawler needs to understand
 * that `/en/pricing` and `/ar/pricing` are one page in two languages rather
 * than two pages.
 *
 * `lastModified` is the BUILD time, not `new Date()` evaluated per request.
 * These pages are statically generated, so the build is genuinely when they
 * last changed; a per-request timestamp would tell a crawler the whole site
 * changes every time it is asked, which is how a sitemap stops being believed.
 */

/** Frozen at module evaluation — the build, for a statically rendered route. */
const BUILT_AT = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [...PUBLIC_ROUTES, ...DYNAMIC_PUBLIC_ROUTES];

  return LOCALES.flatMap((locale) =>
    routes.map((route) => ({
      url: absoluteUrl(route, locale),
      lastModified: BUILT_AT,
      // The landing page is the entry point; the other two are secondary. A
      // uniform priority tells a crawler nothing, which is the same as omitting
      // it, so it is set deliberately or not at all.
      priority: route === "" ? 1 : 0.7,
      changeFrequency: "monthly" as const,
      alternates: {
        languages: Object.fromEntries(
          LOCALES.map((alternate) => [
            alternate,
            absoluteUrl(route, alternate),
          ]),
        ),
      },
    })),
  );
}
