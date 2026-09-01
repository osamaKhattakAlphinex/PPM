import type { ReactNode } from "react";

/**
 * A pass-through.
 *
 * `<html>` carries `lang` and `dir`, and both are decided by the locale in the
 * URL — so the element itself has to live inside the `[locale]` segment, where
 * that param is available. Next still requires a root layout, and this is it:
 * it renders nothing and exists only to satisfy that requirement.
 *
 * Every path is given a locale prefix by `src/middleware.ts`, so nothing is
 * ever rendered by this layout alone.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
