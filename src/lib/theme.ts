import { z } from "zod";

/**
 * Theme preference, kept in a cookie rather than localStorage.
 *
 * localStorage is only readable after JavaScript runs, which is why almost
 * every dark-mode implementation ships an inline `<script>` in `<head>` to
 * avoid a white flash. That script is exactly the thing the CSP in
 * `src/lib/security/headers.ts` refuses to allow without a nonce, and nonces
 * force dynamic rendering. A cookie is readable on the server, so the very
 * first byte of HTML already carries `data-theme` — no inline script, no
 * flash, and one fewer exception in the policy.
 *
 * Not httpOnly: the toggle writes it from the client so the switch is instant.
 * It carries no authority — the worst a tampered value can do is render the
 * wrong colours for its own author.
 */

export const THEMES = ["light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const themeSchema = z.enum(THEMES);

/** Absent means "follow the OS", which the CSS handles via prefers-color-scheme. */
export type ThemePreference = Theme | undefined;

export const THEME_COOKIE = "ppm-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTheme(value: unknown): ThemePreference {
  const parsed = themeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
