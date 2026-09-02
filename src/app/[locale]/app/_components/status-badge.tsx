"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

/**
 * Every status the app shows, mapped to the palette's semantic tones.
 *
 * `MAINTENANCE` (assets) is warning rather than neutral on purpose: an asset
 * under maintenance is live and owned, it just cannot be dispatched against
 * right now — which is a different thing from `INACTIVE`, meaning
 * decommissioned. A report that cannot tell "down today" from "gone" is one
 * nobody trusts twice.
 *
 * `ON_LEAVE` (technicians) is the same distinction about people, and takes the
 * same tone for the same reason: a technician on leave is on the payroll and
 * back next week, while `INACTIVE` means gone. A scheduler needs to see which
 * at a glance, and "not green" would collapse the two.
 */
const TONE = {
  ACTIVE: "success",
  SUSPENDED: "danger",
  INACTIVE: "neutral",
  MAINTENANCE: "warning",
  ON_LEAVE: "warning",
} as const;

export type MasterDataStatus = keyof typeof TONE;

export function StatusBadge({ status }: { status: MasterDataStatus }) {
  const t = useTranslations("masterData.status");

  return (
    <Badge variant={TONE[status]} dot>
      {t(status)}
    </Badge>
  );
}
