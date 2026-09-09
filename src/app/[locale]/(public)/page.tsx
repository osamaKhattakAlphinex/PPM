import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  Boxes,
  CalendarCheck,
  FileText,
  Languages,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_LOCALE,
  isLocale,
  localeHref,
  type Locale,
} from "@/lib/i18n/config";
import {
  absoluteUrl,
  alternatesFor,
  organizationJsonLd,
  SITE_NAME,
  softwareJsonLd,
} from "@/lib/seo/site";
import { STARTING_PRICE_SAR } from "./pricing/plans";
import {
  BlueprintGrid,
  ContourField,
  PlantRoomScene,
} from "@/components/artwork/schematic";
import {
  HeroReveal,
  Reveal,
  RevealGroup,
  RevealItem,
} from "./_components/reveal";

/**
 * The landing page.
 *
 * Statically rendered in both languages — `setRequestLocale` is what tells
 * next-intl this segment is static, and without it every request would be
 * server-rendered for no reason. There is no session, no database and no
 * dynamic API here, so the page can be served from a CDN edge, which is what
 * makes it fast enough for the Lighthouse target in CLAUDE.md.
 *
 * The JSON-LD is emitted here and NOWHERE else on the site: a crawler needs the
 * organisation and the product described once, and three copies is three
 * chances for them to disagree. It is injected with
 * `dangerouslySetInnerHTML` because that is the only way to emit a
 * `application/ld+json` script tag — the content is `JSON.stringify` of an
 * object this module built, so there is no user input anywhere near it.
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
  const t = await getTranslations({ locale, namespace: "marketing" });

  return {
    title: {
      // The template is set HERE rather than on the layout so the landing page
      // itself is "PPM Platform — …" and not "… | PPM Platform | PPM Platform".
      absolute: `${SITE_NAME} — ${t("hero.tagline")}`,
    },
    description: t("meta.description"),
    alternates: alternatesFor("", locale),
    openGraph: {
      title: `${SITE_NAME} — ${t("hero.tagline")}`,
      description: t("meta.description"),
      url: absoluteUrl("", locale),
      locale: locale === "ar" ? "ar_SA" : "en_US",
      alternateLocale: locale === "ar" ? "en_US" : "ar_SA",
    },
    twitter: {
      title: `${SITE_NAME} — ${t("hero.tagline")}`,
      description: t("meta.description"),
    },
  };
}

const FEATURE_ICONS = [
  Boxes,
  CalendarCheck,
  ShieldCheck,
  FileText,
  Sparkles,
  Languages,
];

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // Marks the segment static for next-intl. Must come before `getTranslations`.
  setRequestLocale(locale);
  const t = await getTranslations("marketing");

  const features = [
    "assets",
    "planned",
    "approvals",
    "invoicing",
    "insights",
    "bilingual",
  ] as const;

  return (
    <>
      <script
        type="application/ld+json"
        // Both objects in one array, which is valid JSON-LD and one fewer
        // script tag. The content is built by `src/lib/seo/site.ts` from
        // constants; nothing user-supplied reaches it.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            organizationJsonLd(locale),
            softwareJsonLd(locale, STARTING_PRICE_SAR),
          ]),
        }}
      />

      {/* ---- Hero ---------------------------------------------------- */}
      <section className="relative overflow-hidden border-b border-border">
        {/*
          Three layers, cheapest first: a gradient wash, a drafting grid, and
          the plant-room drawing itself. All of it is CSS and inline SVG — no
          request, nothing to 404, and every colour comes from the same tokens
          as the text, so the whole thing restyles itself in dark mode.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_0%,var(--color-petrol-200)_0%,transparent_72%)] opacity-45 dark:opacity-20"
        />
        <BlueprintGrid
          id="hero-grid"
          opacity={0.35}
          className="pointer-events-none absolute inset-0 h-full w-full text-petrol-700 dark:text-petrol-300"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background"
        />

        <div className="relative mx-auto w-full max-w-4xl px-5 pt-20 text-center sm:pt-28">
          <HeroReveal>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">
              {t("hero.eyebrow")}
            </p>
          </HeroReveal>

          <HeroReveal delay={0.06}>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
              {t("hero.title")}
            </h1>
          </HeroReveal>

          <HeroReveal delay={0.12}>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              {t("hero.body")}
            </p>
          </HeroReveal>

          <HeroReveal delay={0.18}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href={localeHref("/signup", locale)}>
                <Button size="lg">{t("nav.signUp")}</Button>
              </Link>
              <Link href={localeHref("/login", locale)}>
                <Button size="lg" variant="outline">
                  {t("hero.primaryCta")}
                </Button>
              </Link>
            </div>

            <p className="mt-6 text-sm text-muted-foreground">
              {t("hero.note")}
            </p>
          </HeroReveal>
        </div>

        {/*
          The drawing sits under the copy rather than beside it, so the hero
          reads top-to-bottom on a phone without the illustration being shrunk
          into illegibility. It is clipped at the bottom on purpose — a plant
          room continues past the frame, and a fully contained drawing floating
          in white space looks like a sticker.
        */}
        <HeroReveal delay={0.24} className="relative mt-4 sm:mt-6">
          <PlantRoomScene className="mx-auto -mb-8 block h-auto w-full max-w-4xl px-5 text-foreground opacity-80 sm:-mb-12 dark:opacity-70" />
        </HeroReveal>
      </section>

      {/* ---- What it does -------------------------------------------- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-20">
        <Reveal>
          <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
            {t("features.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {t("features.body")}
          </p>
        </Reveal>

        <RevealGroup
          as="ul"
          className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((key, index) => {
            const Icon = FEATURE_ICONS[index] ?? Boxes;

            return (
              <RevealItem as="li" key={key}>
                {/*
                  The lift on hover is 2px and the border warms to the accent.
                  Deliberately small: these are not buttons, and a card that
                  jumps invites a click that leads nowhere.
                */}
                <div className="group h-full rounded-md border border-border bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md">
                  <span className="mb-3 flex size-9 items-center justify-center rounded-md bg-accent/10 text-accent-text transition-colors duration-200 group-hover:bg-accent/20">
                    <Icon
                      className="size-4 transition-transform duration-200 group-hover:scale-110"
                      aria-hidden
                    />
                  </span>
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    {t(`features.${key}.title`)}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`features.${key}.body`)}
                  </p>
                </div>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </section>

      {/* ---- The isolation promise ----------------------------------- */}
      <section className="relative overflow-hidden border-y border-border bg-surface-sunken">
        {/* Survey contours — the site, rather than the plant. */}
        <ContourField
          id="trust-contour"
          className="pointer-events-none absolute inset-0 h-full w-full text-petrol-700 opacity-[0.18] dark:text-petrol-300 dark:opacity-[0.12]"
        />

        <div className="relative mx-auto w-full max-w-4xl px-5 py-16 text-center sm:py-20">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
              {t("trust.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl leading-relaxed text-muted-foreground">
              {t("trust.body")}
            </p>
          </Reveal>

          <RevealGroup
            as="dl"
            className="mt-10 grid gap-6 text-start sm:grid-cols-3"
          >
            {(["isolation", "audit", "residency"] as const).map((key) => (
              <RevealItem key={key}>
                <dt className="font-display text-base font-semibold text-foreground">
                  {t(`trust.${key}.title`)}
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t(`trust.${key}.body`)}
                </dd>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ---- Closing CTA --------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_60%_at_50%_100%,var(--color-brass-200)_0%,transparent_70%)] opacity-40 dark:opacity-[0.12]"
        />
        <div className="relative mx-auto w-full max-w-4xl px-5 py-16 text-center sm:py-20">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
              {t("cta.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              {t("cta.body")}
            </p>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href={localeHref("/signup", locale)}>
                <Button size="lg">{t("nav.signUp")}</Button>
              </Link>
              <Link href={localeHref("/contact", locale)}>
                <Button size="lg" variant="outline">
                  {t("cta.primary")}
                </Button>
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
