"use client";

import { motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { ContractTotals } from "@/lib/amc/dto";
import { cn } from "@/lib/cn";
import { EXPIRING_WINDOW_DAYS, type ContractDisplayStatus } from "@/lib/domain/amc";

/**
 * The four figures at the top of the AMC screen: how much is running, how much
 * is about to run out, what the book is worth, and how well it is being
 * delivered.
 *
 * The screen's answer to the first questions a commercial manager asks before
 * any individual contract matters. All four come from ONE scoped aggregation
 * (`summariseContracts`), computed against the same midnight the row badges use
 * — a tile that disagreed with the row beneath it would be worse than no tile.
 *
 * TWO of the four are filters and two are not, and the markup says so.
 * `active` and `expiring` name a derived status the list can be narrowed to, so
 * they are real `<button aria-pressed>`s. Contract value and average compliance
 * are not subsets of anything — there is no "show me the rows that make up this
 * average" — so they are plain `<div>`s with no hover treatment and no focus
 * ring. A row where half the tiles respond to a click and half silently do
 * nothing teaches an affordance the screen does not have.
 *
 * Not built on `Card` for the pressable pair: `Card` is a `motion.div`, and a
 * filter you can only reach with a mouse is one a keyboard user cannot reach at
 * all. The resting style is the same 1px-border-no-shadow card DESIGN.md §4
 * specifies, so all four still read as one family.
 */

/*
 * No stagger cap here, unlike `priority-tiles.tsx` and the `Table` rows. Those
 * guard against a list long enough that the last item would wait seconds for
 * its turn; this grid is exactly four tiles and always will be.
 */
const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
};

const tileVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" as const } },
};

/** The resting card surface, shared by the pressable tiles and the static ones. */
const TILE_BASE =
  "flex flex-col items-start gap-1 rounded-md border bg-surface p-4 text-start transition-colors";

/** DESIGN.md §2's KPI figure: display face, 4xl, tabular, LTR-isolated. */
const FIGURE = "font-display text-4xl font-semibold tabular-nums numeric-isolate text-foreground";

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
      onClick={onPress}
      aria-pressed={isSelected}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99, y: 0 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      className={cn(
        TILE_BASE,
        "group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected ? "border-primary bg-primary/5" : "border-border hover:border-border-strong",
      )}
    >
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className={FIGURE}>{figure}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </motion.button>
  );
}

export function ContractTiles({
  totals,
  selected,
  onSelect,
}: {
  totals: ContractTotals;
  /** The derived status currently filtering the list, if any. */
  selected: ContractDisplayStatus | "";
  /** Called with "" when the active tile is pressed again, to clear the filter. */
  onSelect: (status: ContractDisplayStatus | "") => void;
}) {
  const t = useTranslations("amc");
  const format = useFormatter();

  const toggle = (status: ContractDisplayStatus) => () =>
    onSelect(selected === status ? "" : status);

  return (
    <motion.div
      className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
      initial="hidden"
      animate="visible"
      variants={gridVariants}
    >
      <FilterTile
        label={t("tiles.active")}
        figure={totals.active}
        note={t("tiles.activeHint")}
        isSelected={selected === "ACTIVE"}
        onPress={toggle("ACTIVE")}
      />

      <FilterTile
        label={t("tiles.expiring")}
        figure={totals.expiring}
        note={t("tiles.expiringHint", { days: EXPIRING_WINDOW_DAYS })}
        isSelected={selected === "EXPIRING"}
        onPress={toggle("EXPIRING")}
      />

      {/*
        The money figure goes through the `currency` format declared once in
        `src/lib/i18n/request.ts`, never a hard-coded "SAR" and never a
        hand-rolled decimal count. The DTO already divided halalas into riyals
        on the server, because this is a display float and nothing here may add
        two of them.
      */}
      <Tile
        label={t("tiles.value")}
        figure={format.number(totals.totalValue, "currency")}
        note={t("tiles.valueHint")}
      />

      {/*
        `null` means nothing is being delivered — no live, begun, unexpired
        contract to average. It renders as a dash, never as 0: "0% compliant"
        and "no contracts being delivered" are opposite statements about a
        provider, and a zero here would accuse them of the first.
      */}
      <Tile
        label={t("tiles.compliance")}
        figure={
          totals.averageCompliance === null ? t("tiles.noData") : `${totals.averageCompliance}%`
        }
        note={t("tiles.complianceHint")}
      />
    </motion.div>
  );
}
