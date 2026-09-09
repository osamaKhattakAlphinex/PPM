import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { landingPathForRole } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/guard";
import { isSignupEnabled } from "@/lib/env";
import { DEFAULT_LOCALE, isLocale, localeHref } from "@/lib/i18n/config";
import { alternatesFor } from "@/lib/seo/site";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SignupForm } from "./signup-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "signup" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor("/signup", locale),
    /**
     * Indexable, unlike every other page under `(auth)`. This one is the front
     * door of the marketing funnel — the `[locale]` layout's blanket
     * `index: false` is right for the app and wrong here, so it is overridden
     * deliberately and only here.
     */
    robots: { index: true, follow: true },
  };
}

/**
 * Register a company.
 *
 * The product's one open write endpoint, and the one deliberate exception to
 * CLAUDE.md's "no public write endpoints". What makes it defensible is what it
 * cannot reach: it creates a NEW organization and its first administrator, and
 * there is no path through it that reads, changes or even names a row
 * belonging to an existing tenant.
 *
 * `isSignupEnabled()` is checked here AND in the action. Not a duplicate: this
 * one decides what to render, and the action's decides what happens — a hidden
 * form is not a disabled endpoint, because the action is reachable by POST
 * whatever this page drew.
 *
 * A signed-in visitor is redirected away rather than shown the form. Somebody
 * with a session who lands here has almost certainly followed an old link, and
 * offering to make them a second company is not the helpful reading.
 */
export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  const user = await getCurrentUser();
  if (user) redirect(localeHref(landingPathForRole(user.role), locale));

  const t = await getTranslations("signup");
  const open = isSignupEnabled();

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* The same identity plate the sign-in page uses — DESIGN.md §1. */}
      <section
        aria-hidden
        className="relative hidden overflow-hidden bg-petrol-800 lg:block"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.05) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      >
        <div className="flex h-full flex-col justify-between p-10">
          <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-brass-300">
            PPM Platform
          </p>

          <div className="max-w-md">
            <div className="mb-6 h-0.5 w-16 bg-brass-400" />
            <p className="font-display text-3xl font-semibold leading-tight text-stone-100">
              {t("plate.title")}
            </p>
            <ul className="mt-6 grid gap-2 text-sm text-petrol-200">
              <li>{t("plate.pointOne")}</li>
              <li>{t("plate.pointTwo")}</li>
              <li>{t("plate.pointThree")}</li>
            </ul>
          </div>

          <p className="text-xs text-petrol-200">
            Riyadh · Jeddah · Dammam &nbsp;—&nbsp; SAR
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-accent-text lg:hidden">
                PPM Platform
              </p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-foreground lg:mt-0">
                {t("title")}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("subtitle")}
              </p>
            </div>
            <ThemeToggle />
          </div>

          {open ? (
            <SignupForm />
          ) : (
            <p
              role="status"
              className="rounded-md border border-border bg-surface-sunken px-4 py-3 text-sm text-muted-foreground"
            >
              {t("closed")}
            </p>
          )}

          <p className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
            {t("haveAccount")}{" "}
            <Link
              href={localeHref("/login", locale)}
              className="font-medium text-accent-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("signInLink")}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
