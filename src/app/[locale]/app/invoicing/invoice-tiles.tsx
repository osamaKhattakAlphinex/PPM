"use client";

import { motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { InvoiceTotalsView } from "@/lib/invoicing/dto";
import type { InvoiceDisplayStatus } from "@/lib/domain/invoicing";

/**
 * The four figures at the top of the invoicing screen: what has been billed,
 * what has come in, what is outstanding, and what is late.
 *
 * All four come from ONE scoped aggregation (`summariseInvoices`), computed
 * against the same midnight the row badges use — a tile that disagreed with the
 * row beneath it would be worse than no tile. All four are GROSS figures,
 * because gross is what a client pays and what a bank statement shows.
 *
 * THREE of the four are filters and one is not, and the markup says so. Paid,
 * pending and overdue each name a display status the list can be narrowed to,
 * so they are real `<button aria-pressed>`s. "Total invoiced" is the whole
 * ledger and narrowing to it would be the same as clearing the filter, so it is
 * a plain `<div>` with no hover treatment and no focus ring — a row where some
 * tiles respond to a click and others silently do nothing teaches an affordance
 * the screen does not have.
 *
 * Not built on `Card` for the pressable three: `Card` is a `motion.div`, and a
 * filter you can only reach with a mouse is one a keyboard user cannot reach at
 * all.
 */

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
};

const tileVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" as const } },
};

const TILE_BASE =
  "flex flex-col items-start gap-1 rounded-md border bg-surface p-4 text-start transition-colors";

/** DESIGN.md §2's KPI figure: display face, 3xl, tabular, LTR-isolated. */
const FIGURE =
  "font-display text-3xl font-semibold tabular-nums numeric-isolate text-foreground";

function Tile({ label, figure, note }: { label: string; figure: ReactNode; note: ReactNode }) {
  return (
    <motion.div variants={tileVariants} className={cn(TILE_BASE, "border-border")}>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className={FIGURE}>{figure}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </motion.div>
  );
}

function FilterTile({
  label,
  figure,
  note,
  isSelected,
  onPress,
}: {
  label: string;
  figure: ReactNode;
  note: ReactNode;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <motion.button
      type="button"
      variants={tileVariants}
      aria-pressed={isSelected}
      onClick={onPress}
      className={cn(
        TILE_BASE,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isSelected ? "border-accent bg-accent/10" : "border-border hover:border-border-strong",
      )}
    >
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className={FIGURE}>{figure}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </motion.button>
  );
}

export function InvoiceTiles({
  totals,
  selected,
  onSelect,
}: {
  totals: InvoiceTotalsView;
  selected: InvoiceDisplayStatus | "";
  onSelect: (status: InvoiceDisplayStatus | "") => void;
}) {
  const t = useTranslations("invoicing");
  const format = useFormatter();

  const money = (value: number) => format.number(value, "currency");
  const count = (value: number) => t("invoiceCount", { count: value });

  const toggle = (status: InvoiceDisplayStatus) => () =>
    onSelect(selected === status ? "" : status);

  return (
    <motion.div
      className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      initial="hidden"
      animate="visible"
      variants={gridVariants}
    >
      <Tile
        label={t("totalInvoiced")}
        figure={money(totals.invoiced)}
        note={count(totals.count)}
      />
      <FilterTile
        label={t("paid")}
        figure={money(totals.paid)}
        note={count(totals.paidCount)}
        isSelected={selected === "PAID"}
        onPress={toggle("PAID")}
      />
      <FilterTile
        label={t("pending")}
        figure={money(totals.pending)}
        note={count(totals.pendingCount)}
        isSelected={selected === "PENDING"}
        onPress={toggle("PENDING")}
      />
      <FilterTile
        label={t("overdue")}
        figure={money(totals.overdue)}
        note={count(totals.overdueCount)}
        isSelected={selected === "OVERDUE"}
        onPress={toggle("OVERDUE")}
      />
    </motion.div>
  );
}
