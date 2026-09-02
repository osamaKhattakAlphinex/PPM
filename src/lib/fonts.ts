import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";

/**
 * Self-hosted at build time by next/font — no runtime request to Google,
 * no layout shift from a late font swap. See docs/DESIGN.md §2.
 */

/**
 * Latin display AND body.
 *
 * No `weight` array on purpose: Inter ships as a variable font, so omitting it
 * loads the single 100–900 axis file instead of one static cut per weight.
 * That is both fewer requests and more weights than the four we were pinning
 * before — `font-medium`, `font-semibold` and `font-bold` all interpolate off
 * the same file.
 */
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Arabic has no Inter cut, so the Arabic side runs IBM Plex Sans Arabic.
 * Swapped in wholesale on `dir="rtl"`; see globals.css.
 */
export const plexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans-arabic",
  display: "swap",
});

export const fontVariables = `${inter.variable} ${plexSansArabic.variable}`;
