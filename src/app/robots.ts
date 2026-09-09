import type { MetadataRoute } from "next";

import { PROTECTED_PREFIX } from "@/lib/auth/access";
import { SITE_ORIGIN } from "@/lib/seo/site";

/**
 * robots.txt.
 *
 * Two rules, and the second one matters more than the first:
 *
 *  - `allow: /` opens the public marketing pages, which is what the file is
 *    mostly for.
 *  - Everything private is DISALLOWED explicitly, and the list is derived from
 *    `PROTECTED_PREFIX` — the same constant the middleware uses to decide what
 *    needs a session. Restating "/app" here as a literal is how a robots file
 *    ends up out of date with the app it describes.
 *
 * The disallow is belt-and-braces rather than the control. `/app` is `noindex`
 * in its own metadata AND unreachable without a session, so a crawler that
 * ignores this file learns nothing. What the entry actually buys is crawl
 * budget: a well-behaved crawler stops requesting a thousand pages that will
 * all redirect it to a login form.
 *
 * `/api` is listed for the same reason. Every route under it requires a session
 * or a shared secret, so there is nothing to protect — but there is no reason
 * to have a crawler discover them either.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Derived, not restated. `/app` and everything under it.
          `${PROTECTED_PREFIX}/`,
          PROTECTED_PREFIX,
          "/api/",
          // The component gallery is a development tool, not a product page.
          "/style-guide",
        ],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
