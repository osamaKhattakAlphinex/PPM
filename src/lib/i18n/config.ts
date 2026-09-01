import { z } from "zod";

/**
 * Locale routing.
 *
 * The locale is a path segment — `/en/app/assets`, `/ar/app/assets` — not a
 * cookie or a client-side toggle. Three reasons that matters here:
 *
 *  - Arabic and English are different documents, not the same document with a
 *    switch. `dir` changes, the font family changes, and line-height changes.
 *    A URL that renders differently per user is a URL that cannot be shared,
 *    bookmarked, or linked in a work-order email — and this product's users
 *    hand links to each other constantly.
 *  - It is what makes `hreflang` and the eventual public marketing pages
 *    indexable in both languages (CLAUDE.md > SEO).
 *  - It is resolvable on the server, so the first paint is already correct.
 *    Nothing flips direction after hydration.
 *
 * This module is pure and imports nothing but zod: `src/middleware.ts` uses it
 * on the Edge runtime.
 */

export const LOCALES = ["en", "ar"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const localeSchema = z.enum(LOCALES);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export type Direction = "ltr" | "rtl";

export function directionOf(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Shown in the language switcher, each in its own language. */
export const LOCALE_LABELS: Readonly<Record<Locale, { short: string; full: string }>> = {
  en: { short: "EN", full: "English" },
  ar: { short: "ع", full: "العربية" },
};

/**
 * Split `/en/app/assets` into `["en", "/app/assets"]`.
 *
 * Returns a null locale when the first segment is not one — which is how the
 * middleware tells "needs a redirect" from "already localised". The path half
 * is always the unprefixed path, so every downstream rule (route access, the
 * nav's active check) is written once, against `/app/assets`, and never has to
 * think about locales.
 */
export function splitLocale(pathname: string): { locale: Locale | null; pathname: string } {
  const segments = pathname.split("/");
  // "/en/app" -> ["", "en", "app"]
  const first = segments[1];

  if (!isLocale(first)) return { locale: null, pathname };

  const rest = `/${segments.slice(2).join("/")}`;
  return { locale: first, pathname: rest === "/" ? "/" : rest.replace(/\/$/, "") };
}

/** The path with the locale segment removed. `/ar/app` -> `/app`. */
export function stripLocale(pathname: string): string {
  return splitLocale(pathname).pathname;
}

/**
 * Prefix an app-relative path with a locale. `("/app", "ar")` -> `"/ar/app"`.
 *
 * Idempotent: passing an already-prefixed path re-prefixes the unprefixed
 * form, so a caller cannot produce `/ar/en/app` by being careless.
 */
export function localeHref(path: string, locale: Locale): string {
  const bare = stripLocale(path.startsWith("/") ? path : `/${path}`);
  return bare === "/" ? `/${locale}` : `/${locale}${bare}`;
}

/**
 * Pick a locale for a visitor with no locale in their URL.
 *
 * A previous explicit choice (the cookie) beats the browser's list, because a
 * user who switched to Arabic on a laptop with an English OS meant it. Beyond
 * that this is a deliberately small negotiation: quality values are honoured,
 * but no region matching beyond the primary subtag — `ar-SA`, `ar-AE` and
 * `ar-EG` all mean Arabic here, and there is no third language to disambiguate
 * against.
 */
export function negotiateLocale(options: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(options.cookie)) return options.cookie;

  const header = options.acceptLanguage;
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return {
        // Primary subtag only: "ar-SA" -> "ar".
        tag: tag.trim().toLowerCase().split("-")[0],
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    if (isLocale(entry.tag)) return entry.tag;
  }

  return DEFAULT_LOCALE;
}

/**
 * The request header `src/middleware.ts` stamps with the resolved locale, and
 * `src/lib/i18n/request.ts` reads back.
 *
 * It exists because the message catalogue has to be chosen before ANY
 * component renders — see the note in `request.ts`. It is an internal header
 * on the request only; it never goes out on a response.
 */
export const LOCALE_HEADER = "x-ppm-locale";

/** Where the visitor's last explicit choice is remembered. */
export const LOCALE_COOKIE = "ppm-locale";
/** A year. Re-set on every switch, so an active user never loses the choice. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
