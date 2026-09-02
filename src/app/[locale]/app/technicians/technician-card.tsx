"use client";

import { Cctv, Droplets, HardHat, Wind, Zap, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import type { TechnicianSummary } from "@/lib/technicians/dto";
import type { Trade } from "@/lib/domain/technicians";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { StatusBadge } from "../_components/status-badge";

/**
 * One technician, as a card.
 *
 * Two decisions worth stating, because both are deliberate departures from the
 * obvious:
 *
 *  1. **Trade is an icon, not a colour.** The tempting design gives each trade
 *     its own hue, which means five more colours competing with the one thing
 *     on this card that actually encodes urgency — the status badge. DESIGN.md
 *     §1 is explicit that status colours are desaturated so a screen of badges
 *     does not read as a slot machine; spending the palette on trades would
 *     undo that. So trade gets a glyph and a neutral chip, and colour stays
 *     reserved for state.
 *
 *  2. **One clickable thing, stretched.** The whole card opens the profile, but
 *     the only element in the accessibility tree that does so is the name
 *     button — its `::after` covers the card. A `role="button"` wrapper with
 *     more buttons inside it would be a keyboard trap and a screen-reader
 *     puzzle; this way the reading order is name, skills, actions, and each is
 *     exactly one tab stop.
 */

const TRADE_ICONS: Record<Trade, LucideIcon> = {
  HVAC: Wind,
  PLUMBING: Droplets,
  ELECTRICAL: Zap,
  // Extra-low voltage: CCTV, access control, fire alarm, BMS.
  ELV: Cctv,
  CIVIL: HardHat,
};

/** Chips beyond this are summarised as "+N" — a card is a summary, not a CV. */
const VISIBLE_SKILLS = 4;

/**
 * Up to two initials, taken from the first and last word of the name.
 *
 * `Array.from` rather than `name[0]`: a string index splits a surrogate pair
 * and an Arabic name is not the only thing that breaks. `toLocaleUpperCase` is
 * a no-op for Arabic, which has no case — the initials simply render as the
 * letters themselves, which is what an Arabic-reading user expects.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

export function TradeIcon({ trade, className }: { trade: Trade; className?: string }) {
  const Icon = TRADE_ICONS[trade];
  return <Icon className={className} aria-hidden />;
}

export function Avatar({
  name,
  trade,
  size = "md",
}: {
  name: string;
  trade: Trade;
  size?: "md" | "lg";
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-display font-semibold text-primary",
        size === "lg" ? "size-16 text-xl" : "size-12 text-base",
      )}
      aria-hidden
    >
      {initialsOf(name)}
      <span
        className={cn(
          "absolute flex items-center justify-center rounded-full border border-border bg-surface text-muted-foreground",
          size === "lg" ? "-bottom-1 -end-1 size-7" : "-bottom-0.5 -end-0.5 size-5",
        )}
      >
        <TradeIcon trade={trade} className={size === "lg" ? "size-3.5" : "size-3"} />
      </span>
    </div>
  );
}

export function TradeBadge({ trade }: { trade: Trade }) {
  const t = useTranslations("technicians.trades");
  return (
    <Badge variant="neutral">
      <TradeIcon trade={trade} className="size-3" />
      {t(trade)}
    </Badge>
  );
}

/**
 * A skill, as a filter.
 *
 * Clicking one narrows the list to everyone who has it, which is the question a
 * dispatcher actually arrives with — "who can braze?" — and it costs no extra
 * chrome because the chips were going to be on the card anyway.
 */
export function SkillChip({
  skill,
  onSelect,
  active,
}: {
  skill: string;
  onSelect?: (skill: string) => void;
  active?: boolean;
}) {
  const t = useTranslations("technicians");

  if (!onSelect) {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-xs text-muted-foreground">
        {skill}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(skill)}
      aria-label={t("filterBySkill", { skill })}
      className={cn(
        "relative z-10 inline-flex min-h-7 items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        active
          ? "border-accent/40 bg-accent/15 text-accent-text"
          : "border-border bg-surface-sunken text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      {skill}
    </button>
  );
}

export function TechnicianCard({
  technician,
  activeSkill,
  onOpenProfile,
  onSelectSkill,
  actions,
}: {
  technician: TechnicianSummary;
  /** The skill currently filtering the list, so its chip can show as selected. */
  activeSkill?: string;
  onOpenProfile: () => void;
  onSelectSkill: (skill: string) => void;
  /** Edit/delete, rendered only for a session that may manage the workforce. */
  actions?: React.ReactNode;
}) {
  const t = useTranslations("technicians");

  const visible = technician.skills.slice(0, VISIBLE_SKILLS);
  const overflow = technician.skills.length - visible.length;

  return (
    <Card interactive className="relative flex h-full w-full flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar name={technician.name} trade={technician.trade} />

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenProfile}
            className="rounded-sm text-start font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface after:absolute after:inset-0 after:rounded-md after:content-['']"
          >
            <span className="block truncate">{technician.name}</span>
            <span className="sr-only"> — {t("viewProfile")}</span>
          </button>
          <div className="mt-1.5">
            <TradeBadge trade={technician.trade} />
          </div>
        </div>

        <StatusBadge status={technician.status} />
      </div>

      {technician.skills.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {visible.map((skill) => (
            <SkillChip
              key={skill}
              skill={skill}
              active={skill === activeSkill}
              onSelect={onSelectSkill}
            />
          ))}
          {overflow > 0 && (
            <span className="inline-flex min-h-7 items-center rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground">
              {t("moreSkills", { count: overflow })}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("noSkills")}</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {technician.userEmail ? (
            <span className="bidi-isolate">{technician.userEmail}</span>
          ) : technician.userId ? (
            t("accountLinked")
          ) : (
            t("accountNone")
          )}
        </p>
        {actions && <div className="relative z-10 shrink-0">{actions}</div>}
      </div>
    </Card>
  );
}
