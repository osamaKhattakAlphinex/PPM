"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Page controls for a scoped list.
 *
 * Deliberately minimal — two buttons and a count. Numbered page links look
 * thorough and are worse here: the lists these sit under are filtered far more
 * often than they are paged through, and a row of numbers is a row of 44px
 * touch targets competing for the same thumb.
 *
 * The chevrons flip under `rtl:` rather than being swapped in JS. "Next" points
 * left in Arabic, and a direction-aware icon that only settles after hydration
 * is a visible flicker on every page change.
 */
export function Pagination({
  page,
  totalPages,
  total,
  isPending,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  isPending?: boolean;
  onChange: (page: number) => void;
}) {
  const t = useTranslations("masterData");

  if (total === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("resultCount", { total })}
        {totalPages > 1 ? ` · ${t("pageOf", { page, totalPages })}` : ""}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(page - 1)}
            disabled={page <= 1 || isPending}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(page + 1)}
            disabled={page >= totalPages || isPending}
          >
            {t("next")}
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
