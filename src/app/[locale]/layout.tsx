import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";

import { LOCALES, directionOf, isLocale } from "@/lib/i18n/config";
import { fontVariables } from "@/lib/fonts";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import "../globals.css";

export const metadata: Metadata = {
  title: "PPM Platform",
  description: "Facility maintenance management for the Gulf market.",
  // The authenticated app is noindex. Set here as the baseline for the whole
  // tree and re-asserted on `/app` itself — see `app/[locale]/app/layout.tsx`.
  // Public marketing pages will override it explicitly when they exist.
  robots: { index: false, follow: false },
};

/** Both locales are known at build time; Next can pre-render the segment. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // The locale comes out of the URL, so it is attacker-controlled: `/xx/app`
  // must 404 rather than render with a half-empty message catalogue.
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  /**
   * Read on the server so `data-theme` is in the first byte of HTML. This is
   * what a pre-hydration inline `<script>` normally does — and that script is
   * precisely what the CSP in `src/lib/security/headers.ts` will not allow
   * without a nonce. A cookie costs one dynamic render and removes the
   * exception entirely. See `src/lib/theme.ts`.
   */
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      // `data-theme` absent means "follow the OS", which the CSS already does.
      {...(theme ? { "data-theme": theme } : {})}
      suppressHydrationWarning
    >
      <body className={`${fontVariables} font-body antialiased`}>
        <ThemeProvider initialTheme={theme}>
          <NextIntlClientProvider messages={messages}>
            <ToastProvider>{children}</ToastProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
