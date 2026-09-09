import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Mail, MapPin, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE, isLocale, localeHref, type Locale } from "@/lib/i18n/config";
import { absoluteUrl, alternatesFor, SITE_NAME } from "@/lib/seo/site";

/**
 * Contact.
 *
 * There is no FORM here, and that is a decision rather than an omission.
 * CLAUDE.md's security rules say "no public write endpoints", and a contact
 * form is exactly that: an unauthenticated POST that writes somewhere and sends
 * mail. Building one properly means a spam defence, a rate limit on an
 * anonymous axis, an outbound mail provider and a place to put the message —
 * four things, none of which this product has yet.
 *
 * So the page publishes the three ways to reach a human, using `mailto:` and
 * `tel:` links a phone can act on directly. When the form arrives it will be a
 * route handler with its own limiter, not a server action reachable from a
 * public page.
 *
 * Statically rendered in both languages, like the rest of the marketing site.
 */

/**
 * Statically rendered, and this is what forces it.
 *
 * The locale layout above reads the theme cookie so that `data-theme` is in the
 * first byte of HTML — which is right for the authenticated app, where a flash
 * of the wrong theme on every navigation would be constant, and which makes
 * every page under it dynamic.
 *
 * A public marketing page is the opposite trade. It is the same document for
 * everybody, it should come from a CDN edge, and it is what a Lighthouse score
 * is measured on. `force-static` makes `cookies()` return empty at build time
 * rather than throwing, so the page prerenders and the theme falls back to the
 * visitor's OS preference — which the CSS already honours through
 * `prefers-color-scheme`.
 *
 * The cost, stated so it is not rediscovered as a bug: a visitor who has
 * explicitly overridden the theme sees one frame of their OS preference before
 * the client-side provider applies their choice. On a page somebody reads once,
 * that is worth a static render; inside the app, it would not be.
 */
export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "marketing.contact" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor("/contact", locale),
    openGraph: {
      title: `${t("metaTitle")} — ${SITE_NAME}`,
      description: t("metaDescription"),
      url: absoluteUrl("/contact", locale),
    },
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  setRequestLocale(locale);
  const t = await getTranslations("marketing.contact");

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:py-20">
      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{t("body")}</p>
      </header>

      <dl className="mt-10 grid gap-5 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-5">
          <dt className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            <Mail className="size-4 text-accent-text" aria-hidden />
            {t("email.label")}
          </dt>
          <dd className="mt-1">
            {/*
              `bidi-isolate` because an email address is left-to-right text that
              may sit inside a right-to-left paragraph, and without isolation the
              punctuation migrates to the wrong end of it.
            */}
            <a
              href="mailto:sales@ppm-platform.example"
              className="bidi-isolate text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              sales@ppm-platform.example
            </a>
          </dd>
        </div>

        <div className="rounded-md border border-border bg-surface p-5">
          <dt className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            <Phone className="size-4 text-accent-text" aria-hidden />
            {t("phone.label")}
          </dt>
          <dd className="mt-1">
            <a
              href="tel:+966110000000"
              className="bidi-isolate text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              +966 11 000 0000
            </a>
          </dd>
        </div>

        <div className="rounded-md border border-border bg-surface p-5 sm:col-span-2">
          <dt className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            <MapPin className="size-4 text-accent-text" aria-hidden />
            {t("office.label")}
          </dt>
          <dd className="mt-1 text-sm text-muted-foreground">{t("office.value")}</dd>
        </div>
      </dl>

      <div className="mt-10 rounded-md border border-border bg-surface-sunken p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {t("existing.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("existing.body")}</p>
        <Link href={localeHref("/login", locale)} className="mt-4 inline-block">
          <Button>{t("existing.cta")}</Button>
        </Link>
      </div>
    </div>
  );
}
