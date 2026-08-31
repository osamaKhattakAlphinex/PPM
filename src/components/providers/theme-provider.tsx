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

export type Theme = "light" | "dark";
export type Locale = "en" | "ar";

const THEME_KEY = "ppm-theme";
const LOCALE_KEY = "ppm-locale";

/**
 * Runs before hydration (see layout.tsx <head> script) so the very first
 * paint already has the right data-theme/dir/lang — no light-flash on load.
 */
export const noFlashScript = `
(function () {
  try {
    var theme = localStorage.getItem("${THEME_KEY}");
    var locale = localStorage.getItem("${LOCALE_KEY}") || "en";
    var dir = locale === "ar" ? "rtl" : "ltr";
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    document.documentElement.setAttribute("lang", locale);
    document.documentElement.setAttribute("dir", dir);
  } catch (e) {}
})();
`;

type ThemeLocaleContextValue = {
  theme: Theme | undefined;
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
};

const ThemeLocaleContext = createContext<ThemeLocaleContextValue | null>(null);

export function ThemeLocaleProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme | undefined>(undefined);
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_KEY) as Theme | null;
    const storedLocale = window.localStorage.getItem(LOCALE_KEY) as Locale | null;
    if (storedTheme === "light" || storedTheme === "dark") setThemeState(storedTheme);
    if (storedLocale === "en" || storedLocale === "ar") setLocaleState(storedLocale);
  }, []);

  const [systemTheme, setSystemTheme] = useState<Theme>("light");
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemTheme(mql.matches ? "dark" : "light");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const resolvedTheme = theme ?? systemTheme;

  useEffect(() => {
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
    document.documentElement.setAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  }, [locale]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(THEME_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(LOCALE_KEY, next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "en" ? "ar" : "en");
  }, [locale, setLocale]);

  const value = useMemo<ThemeLocaleContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
      locale,
      dir: locale === "ar" ? "rtl" : "ltr",
      setLocale,
      toggleLocale,
    }),
    [theme, resolvedTheme, setTheme, toggleTheme, locale, setLocale, toggleLocale]
  );

  return (
    <ThemeLocaleContext.Provider value={value}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ThemeLocaleContext.Provider>
  );
}

export function useThemeLocale() {
  const ctx = useContext(ThemeLocaleContext);
  if (!ctx) throw new Error("useThemeLocale must be used within ThemeLocaleProvider");
  return ctx;
}
