import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALE_HEADER, isLocale, type Locale } from "./config";

/**
 * next-intl's server-side entry point: hand back the message catalogue and
 * formatting defaults for the request's language.
 *
 * The messages are imported dynamically so only the requested catalogue ends
 * up in the response — an Arabic session never ships the English strings, and
 * vice versa.
 *
 * The locale is read from a header the middleware sets, and `requestLocale` is
 * only the fallback. That is not a stylistic preference — it is a bug fix.
 * This config resolves ONCE per request and is then cached, so whatever asks
 * for a translation first decides the locale for the whole tree. With
 * `requestLocale`, that answer depends on `setRequestLocale()` in the layout
 * having run before the page's first `getTranslations()` — and layouts and
 * pages render concurrently, so it sometimes had not. The symptom was a page
 * served with `dir="rtl"` and English strings. A header is available before
 * any component runs, so the race cannot happen.
 *
 * Either way the value is *validated* rather than trusted: it originates in a
 * URL segment, so `/xx/app` must fall back to the default, not attempt to
 * import `../../messages/xx.json`.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const fromHeader = (await headers()).get(LOCALE_HEADER);
  const requested = isLocale(fromHeader) ? fromHeader : await requestLocale;
  const locale: Locale = isLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Riyadh. Fixed rather than per-user for now: an SLA breach time must mean
    // the same thing to the technician on site and the manager reading the
    // report, and both are in the same operating region.
    timeZone: "Asia/Riyadh",
    formats: {
      number: {
        // CLAUDE.md: currency is SAR. Declared once here so no component
        // hard-codes a symbol or a decimal count.
        currency: { style: "currency", currency: "SAR" },
      },
      dateTime: {
        short: { day: "numeric", month: "short", year: "numeric" },
        withTime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
      },
    },
  };
});
