import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic, Space_Grotesk } from "next/font/google";

/**
 * Self-hosted at build time by next/font — no runtime request to Google,
 * no layout shift from a late font swap. See docs/DESIGN.md §2.
 */

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

export const plexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans-arabic",
  display: "swap",
});

export const fontVariables = `${spaceGrotesk.variable} ${plexSans.variable} ${plexSansArabic.variable}`;
