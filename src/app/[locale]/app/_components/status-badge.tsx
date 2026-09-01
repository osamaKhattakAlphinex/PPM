"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

/** The three statuses master data uses, mapped to the palette's semantic tones. */
const TONE = {
  ACTIVE: "success",
  SUSPENDED: "danger",
  INACTIVE: "neutral",
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
