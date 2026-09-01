import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

/**
 * The title block every module screen opens with.
 *
 * Shared so the three master-data screens cannot drift into three slightly
 * different heading sizes — DESIGN.md §2 sets one display size for a page
 * title, and a screen that quietly picks another is how a design system stops
 * being one.
 */
export function PageHeading({
  title,
  subtitle,
  action,
  note,
}: {
  title: string;
  subtitle?: string;
  /** Usually the primary "New …" button. Omitted for a read-only session. */
  action?: ReactNode;
  /** A short standing note, e.g. that this session may only read. */
  note?: string;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="font-display text-3xl font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
        {note && (
          <Badge variant="neutral" className="mt-3" dot>
            {note}
          </Badge>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
