import { describe, expect, it } from "vitest";

import { PROTECTED_PREFIX } from "@/lib/auth/access";
import { LOCALES } from "@/lib/i18n/config";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  absoluteUrl,
  alternatesFor,
  organizationJsonLd,
  PUBLIC_ROUTES,
  SITE_ORIGIN,
  softwareJsonLd,
} from "../site";

/**
 * What a crawler is told.
 *
 * Three properties, each of which fails silently if it is wrong — which is why
 * they are asserted rather than eyeballed once:
 *
 *  1. The sitemap lists ONLY public pages. A private path in it is an
 *     invitation to crawl something that is `noindex` and behind a session, and
 *     it publishes the shape of the application to anyone who reads the file.
 *  2. Every public page declares a canonical and a full hreflang set. Without
 *     them the two locales are treated as duplicates of each other and one is
 *     dropped from the index.
 *  3. robots.txt disallows the protected prefix, derived from the same constant
 *     the middleware uses rather than restated as a literal.
 *
 * Pure: no database, no session, no network.
 */

describe("the sitemap", () => {
  const entries = sitemap();

  it("lists every public route in every locale, and nothing else", () => {
    expect(entries).toHaveLength(PUBLIC_ROUTES.length * LOCALES.length);

    for (const locale of LOCALES) {
      for (const route of PUBLIC_ROUTES) {
        expect(entries.some((entry) => entry.url === absoluteUrl(route, locale))).toBe(true);
      }
    }
  });

  /** The property that matters most: nothing private is advertised. */
  it("contains no path under the protected prefix", () => {
    for (const entry of entries) {
      expect(entry.url).not.toContain(PROTECTED_PREFIX);
      expect(entry.url).not.toContain("/api");
      expect(entry.url).not.toContain("/style-guide");
    }
  });

  it("gives every entry an hreflang map covering both locales", () => {
    for (const entry of entries) {
      const languages = entry.alternates?.languages ?? {};
      for (const locale of LOCALES) {
        expect(languages[locale], `${entry.url} is missing ${locale}`).toBeDefined();
      }
    }
  });

  it("uses absolute URLs on the configured origin", () => {
    for (const entry of entries) {
      expect(entry.url.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
    }
  });
});

describe("robots.txt", () => {
  const file = robots();
  const rule = Array.isArray(file.rules) ? file.rules[0] : file.rules;
  const disallow = [rule?.disallow ?? []].flat();

  it("allows the public site", () => {
    expect(rule?.allow).toBe("/");
  });

  it("disallows the protected prefix, derived from the access table", () => {
    expect(disallow).toContain(PROTECTED_PREFIX);
    expect(disallow).toContain(`${PROTECTED_PREFIX}/`);
  });

  it("disallows the API and the component gallery", () => {
    expect(disallow).toContain("/api/");
    expect(disallow).toContain("/style-guide");
  });

  it("points at the sitemap on the same origin", () => {
    expect(file.sitemap).toBe(`${SITE_ORIGIN}/sitemap.xml`);
  });
});

describe("alternatesFor", () => {
  it("declares a canonical for this locale and an alternate for each", () => {
    const alternates = alternatesFor("/pricing", "ar");

    expect(alternates.canonical).toBe(`${SITE_ORIGIN}/ar/pricing`);
    expect(alternates.languages.en).toBe(`${SITE_ORIGIN}/en/pricing`);
    expect(alternates.languages.ar).toBe(`${SITE_ORIGIN}/ar/pricing`);
  });

  /**
   * Without `x-default` a crawler picks a default itself, and which one it picks
   * for a Gulf audience is not predictable.
   */
  it("names English as x-default", () => {
    expect(alternatesFor("", "ar").languages["x-default"]).toBe(`${SITE_ORIGIN}/en`);
  });
});

describe("the structured data", () => {
  it("describes the organisation with a schema.org context", () => {
    const json = organizationJsonLd("en");
    expect(json["@context"]).toBe("https://schema.org");
    expect(json["@type"]).toBe("Organization");
    expect(json.url).toBe(`${SITE_ORIGIN}/en`);
  });

  /** The offer has to quote a real price, or the rich result is withdrawn. */
  it("quotes the starting price in SAR", () => {
    const json = softwareJsonLd("en", 750);
    expect(json.offers.price).toBe("750");
    expect(json.offers.priceCurrency).toBe("SAR");
    expect(json.offers.url).toBe(`${SITE_ORIGIN}/en/pricing`);
  });
});
