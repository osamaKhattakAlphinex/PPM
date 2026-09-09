import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { alternatesFor, SITE_NAME } from "@/lib/seo/site";
import { BlueprintGrid } from "@/components/artwork/schematic";
import { Reveal, RevealGroup, RevealItem } from "../_components/reveal";
import { pick, SCENARIO_GROUPS, TOTAL_SCENARIOS } from "./scenarios";

/**
 * What the platform does, as things you can go and check.
 *
 * Public, indexable and prerendered like the rest of the marketing site. It
 * exists for two audiences at once: somebody deciding whether the product does
 * their job, and somebody walking through it to confirm that it does. Both want
 * the same list, so there is one list rather than a features page and a
 * separate test plan that drift apart.
 *
 * Everything technical is deliberately absent. No screen ids, no field names,
 * no roles-as-constants, nothing about how any of it is stored — a scenario
 * that cannot be read by the facility manager who will run it is not a
 * scenario, it is a note to a developer.
 */
export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "scenarios" });

  return {
    title: `${t("metaTitle")} · ${SITE_NAME}`,
    description: t("metaDescription"),
    alternates: alternatesFor("/scenarios", locale),
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      url: alternatesFor("/scenarios", locale).canonical,
      locale: locale === "ar" ? "ar_SA" : "en_US",
      alternateLocale: locale === "ar" ? "en_US" : "ar_SA",
      type: "website",
    },
  };
}

export default async function ScenariosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  setRequestLocale(locale);

  const t = await getTranslations("scenarios");

  return (
    <main className="relative">
      <BlueprintGrid
        id="scenarios-grid"
        opacity={0.3}
        className="pointer-events-none absolute inset-x-0 top-0 h-[340px] w-full text-petrol-700 [mask-image:linear-gradient(to_bottom,black,transparent)] dark:text-petrol-300"
      />

      <div className="relative mx-auto w-full max-w-4xl px-5 py-16 sm:py-24">
        <Reveal>
          <header className="max-w-2xl">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">
              {t("eyebrow")}
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {t("title")}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              {t("intro")}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("count", {
                total: TOTAL_SCENARIOS,
                groups: SCENARIO_GROUPS.length,
              })}
            </p>
          </header>

          {/*
        A table of contents rather than a search box. The list is long, it is
        the same length for everybody, and a static page cannot filter without
        shipping JavaScript to do it — anchors cost nothing and work with the
        browser's own find.
      */}
          <nav
            aria-label={t("contents")}
            className="mt-12 border-y border-border py-6"
          >
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {SCENARIO_GROUPS.map((group) => (
                <li key={group.id}>
                  <a
                    href={`#${group.id}`}
                    className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {pick(group.title, locale)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </Reveal>

        <div className="mt-16 grid gap-16">
          {SCENARIO_GROUPS.map((group, index) => (
            <Reveal key={group.id}>
              <section id={group.id} className="scroll-mt-24">
                <div className="flex items-baseline gap-3">
                  {/*
                A number, so somebody reading this beside a colleague can say
                "section four, third one down" and be understood.
              */}
                  <span
                    aria-hidden
                    className="font-display text-sm font-semibold tabular-nums text-accent-text"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="font-display text-2xl font-semibold text-foreground">
                    {pick(group.title, locale)}
                  </h2>
                </div>

                <p className="mt-2 ps-8 text-muted-foreground">
                  {pick(group.summary, locale)}
                </p>

                <RevealGroup as="ol" className="mt-6 grid gap-3 ps-8">
                  {group.scenarios.map((scenario, scenarioIndex) => (
                    <RevealItem
                      as="li"
                      key={scenario.en}
                      className="flex gap-3 rounded-md border border-border bg-surface px-4 py-3 transition-colors duration-200 hover:border-accent/40"
                    >
                      <span
                        aria-hidden
                        className="pt-0.5 font-mono text-xs tabular-nums text-muted-foreground"
                      >
                        {index + 1}.{scenarioIndex + 1}
                      </span>
                      <span className="text-sm leading-relaxed text-foreground">
                        {pick(scenario, locale)}
                      </span>
                    </RevealItem>
                  ))}
                </RevealGroup>
              </section>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p className="mt-20 border-t border-border pt-6 text-sm text-muted-foreground">
            {t("footer")}
          </p>
        </Reveal>
      </div>
    </main>
  );
}
