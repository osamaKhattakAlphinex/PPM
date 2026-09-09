import type { Metadata } from "next";
import Link from "next/link";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  DEFAULT_LOCALE,
  isLocale,
  localeHref,
  type Locale,
} from "@/lib/i18n/config";
import { absoluteUrl, alternatesFor, SITE_NAME } from "@/lib/seo/site";
import { PLANS } from "./plans";
import { BlueprintGrid } from "@/components/artwork/schematic";
import { Reveal, RevealGroup, RevealItem } from "../_components/reveal";

/**
 * Pricing.
 *
 * Statically rendered in both languages, like the landing page. The prices come
 * from `./plans.ts`, which the landing page's JSON-LD also reads — so the
 * structured data and the table cannot disagree.
 *
 * Deliberately no JSON-LD of its own. A second `SoftwareApplication` block here
 * would describe the same product a second time, and duplicate entity markup is
 * a reason for a crawler to trust neither copy.
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
  const t = await getTranslations({ locale, namespace: "marketing.pricing" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor("/pricing", locale),
    openGraph: {
      title: `${t("metaTitle")} — ${SITE_NAME}`,
      description: t("metaDescription"),
      url: absoluteUrl("/pricing", locale),
    },
  };
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  setRequestLocale(locale);
  const t = await getTranslations("marketing.pricing");
  const format = await getFormatter();

  return (
    <div className="relative">
      {/*
        A drafting grid behind the plans, fading out before the fold. It gives
        the cards something to sit ON — three panels floating on flat white is
        the look every pricing page has, and the grid is what the rest of this
        site is drawn against.
      */}
      <BlueprintGrid
        id="pricing-grid"
        opacity={0.3}
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] w-full text-petrol-700 [mask-image:linear-gradient(to_bottom,black,transparent)] dark:text-petrol-300"
      />

      <div className="relative mx-auto w-full max-w-6xl px-5 py-16 sm:py-20">
        <Reveal>
          <header className="max-w-2xl">
            <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
              {t("body")}
            </p>
          </header>
        </Reveal>

        <RevealGroup className="mt-12 grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <RevealItem key={plan.key} className="h-full">
              <section
                className={cn(
                  "flex h-full flex-col rounded-md border bg-surface p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg",
                  plan.featured
                    ? "border-accent shadow-md hover:border-accent"
                    : "border-border hover:border-accent/40",
                )}
              >
                {plan.featured && (
                  <p className="mb-3 inline-flex w-fit rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent-text">
                    {t("mostPopular")}
                  </p>
                )}

                <h2 className="font-display text-xl font-semibold text-foreground">
                  {t(`plans.${plan.key}.name`)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(`plans.${plan.key}.for`)}
                </p>

                <p className="mt-5 font-display text-3xl font-semibold tabular-nums numeric-isolate text-foreground">
                  {plan.monthly === null
                    ? t("custom")
                    : format.number(plan.monthly, {
                        style: "currency",
                        currency: "SAR",
                      })}
                  {plan.monthly !== null && (
                    <span className="ms-1 text-sm font-normal text-muted-foreground">
                      {t("perMonth")}
                    </span>
                  )}
                </p>

                <ul className="mt-6 grid flex-1 gap-2.5 text-sm">
                  {Array.from({ length: plan.features }, (_, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-success"
                        aria-hidden
                      />
                      <span className="text-muted-foreground">
                        {t(`plans.${plan.key}.feature${index + 1}`)}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link href={localeHref("/signup", locale)} className="mt-7">
                  <Button
                    className="w-full"
                    variant={plan.featured ? "primary" : "outline"}
                  >
                    {t("cta")}
                  </Button>
                </Link>
              </section>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal>
          <p className="mt-10 max-w-2xl text-sm text-muted-foreground">
            {t("note")}
          </p>
        </Reveal>
      </div>
    </div>
  );
}
