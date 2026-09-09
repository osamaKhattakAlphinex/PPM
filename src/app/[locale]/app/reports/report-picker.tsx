"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { BarChart3, Boxes, FileDown, Printer, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ReportKind } from "@/lib/reports/kinds";
import { PageHeading } from "../_components/page-heading";

/**
 * The report menu, and the two things you do with a generated report.
 *
 * The cards are LINKS, not buttons, because the selection lives in the URL —
 * which makes a generated report shareable, back-button-friendly and
 * server-rendered. A button would have made it component state and lost all
 * three.
 *
 * The menu only lists what this session may actually run: `available` is
 * computed on the server from the caller's role against the per-report lists.
 * That is an affordance and not the control — `buildReportForScope` re-checks
 * the same lists before it reads anything, so hand-editing the query string
 * gets an authorization error rather than a document.
 */

const ICON: Record<ReportKind, LucideIcon> = {
  PM: BarChart3,
  ASSET: Boxes,
  FINANCIAL: Wallet,
};

export function ReportPicker({
  available,
  selected,
}: {
  available: ReportKind[];
  selected: ReportKind | null;
}) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * The href for one report, built from the CURRENT path.
   *
   * `usePathname()` already carries the locale prefix, so this needs no
   * `localeHref` — and using it would double the prefix.
   */
  const hrefFor = (kind: ReportKind): string => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("report", kind);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <>
      <PageHeading
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          selected ? (
            <div className="flex gap-2 print:hidden">
              {/*
                A plain link for the PDF, not a fetch: the route answers with a
                document and a Content-Disposition, so the browser's own viewer
                handles it — and a link survives middle-click, "open in new tab"
                and a JavaScript failure. The locale prefix is deliberately
                absent; this is an API route, not a page.
              */}
              <a
                href={`/api/reports/${selected}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                hrefLang={locale}
                className="inline-flex h-9 touch-target items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-medium text-foreground transition-colors hover:border-primary hover:bg-surface-sunken hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileDown className="size-4" aria-hidden />
                {t("downloadPdf")}
              </a>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                {t("print")}
              </Button>
            </div>
          ) : undefined
        }
      />

      <motion.div
        className="mb-6 grid gap-3 sm:grid-cols-3 print:hidden"
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
      >
        {available.map((kind) => {
          const Icon = ICON[kind];
          const isSelected = selected === kind;

          return (
            <motion.div
              key={kind}
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
              }}
            >
              <Link
                href={hrefFor(kind)}
                aria-current={isSelected ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col gap-1 rounded-md border p-4 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isSelected
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-border-strong",
                )}
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <Icon className="size-4 text-accent-text" aria-hidden />
                  {t(`kind.${kind}.title`)}
                </span>
                <span className="text-sm text-muted-foreground">{t(`kind.${kind}.body`)}</span>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
    </>
  );
}
