"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MotionConfig } from "framer-motion";

import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type Theme, type ThemePreference } from "@/lib/theme";

/**
 * Theme state, and the app-wide motion policy.
 *
 * Locale used to live here too. It does not any more: the locale is a path
 * segment now, resolved on the server, so a component that needs it reads
 * `useLocale()` from next-intl and a component that changes it navigates. See
 * `src/lib/i18n/config.ts` for why the URL is the right home for it.
 *
 * The initial theme arrives as a prop from the server, which already read the
 * cookie and stamped `data-theme` on `<html>`. That is what removes the
 * pre-hydration flash script — and with it the last inline `<script>` the CSP
 * would have had to make an exception for.
 */

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeContextValue {
  /** The explicit choice, or undefined when following the OS. */
  readonly theme: ThemePreference;
  /** What is actually on screen right now. Never undefined. */
  readonly resolvedTheme: Theme;
  readonly setTheme: (theme: Theme) => void;
  readonly toggleTheme: () => void;
}

export function ThemeProvider({
  children,
  initialTheme,
}: {
  children: ReactNode;
  /** From the `ppm-theme` cookie, read in the server layout. */
  initialTheme: ThemePreference;
}) {
  const [theme, setThemeState] = useState<ThemePreference>(initialTheme);

  /**
   * The OS preference, tracked so `resolvedTheme` is correct for the users who
   * have made no explicit choice — the toggle has to show a moon on a machine
   * that is already dark. Starts at the light default and corrects on mount;
   * the CSS has already painted the right colours either way, because
   * `prefers-color-scheme` needs no JavaScript.
   */
  const [systemTheme, setSystemTheme] = useState<Theme>("light");

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemTheme(query.matches ? "dark" : "light");
    const onChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = theme ?? systemTheme;

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    // Written directly rather than through a server action: the switch has to
    // be instant, and the cookie carries no authority — it only decides which
    // colours this browser renders.
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = [
      `${THEME_COOKIE}=${next}`,
      "path=/",
      `max-age=${THEME_COOKIE_MAX_AGE}`,
      "samesite=lax",
      window.location.protocol === "https:" ? "secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {/*
        One place, once: every `motion.*` component in the kit drops its
        transform animation to an instant opacity crossfade when the OS asks
        for reduced motion. No component opts in. DESIGN.md §3.
      */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
