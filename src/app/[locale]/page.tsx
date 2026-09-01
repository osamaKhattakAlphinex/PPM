import Link from "next/link";

import { DEFAULT_LOCALE, isLocale, localeHref } from "@/lib/i18n/config";
import { Button } from "@/components/ui/button";
import { LocaleToggle } from "@/components/ui/locale-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="absolute end-5 top-5 flex items-center gap-2">
        <LocaleToggle />
        <ThemeToggle />
      </div>

      <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-accent-text">
        PPM Platform
      </p>
      <h1 className="max-w-xl font-display text-4xl font-semibold text-foreground">
        Facility maintenance, built for the Gulf.
      </h1>
      <p className="max-w-md text-base text-muted-foreground">
        The public marketing site is a later prompt. Sign in to the application, or review the
        design system and component kit in the style guide.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href={localeHref("/app", locale)}>
          <Button size="lg">Open the app</Button>
        </Link>
        <Link href={localeHref("/style-guide", locale)}>
          <Button size="lg" variant="outline">
            Style guide
          </Button>
        </Link>
      </div>
    </main>
  );
}
