"use client";

import { useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Edit and delete for one row.
 *
 * Rendered only when the session may manage the entity — but that is a UI
 * decision, not the control. Hiding a button hides an affordance; the action
 * behind it re-checks the role on every call, so a technician who reconstructs
 * the request gets a FORBIDDEN envelope rather than a write.
 *
 * The labels are visually hidden rather than absent: the icons are unambiguous
 * to a sighted user scanning a dense table, and meaningless to a screen reader.
 */
export function RecordActions({
  name,
  onEdit,
  onDelete,
  disabled,
}: {
  /** The record's name, so the accessible label says which row it acts on. */
  name: string;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("masterData");

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={onEdit}
        disabled={disabled}
        aria-label={`${t("edit")} — ${name}`}
      >
        <Pencil className="size-4" aria-hidden />
        <span className="sr-only md:not-sr-only md:inline">{t("edit")}</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={disabled}
        aria-label={`${t("delete")} — ${name}`}
        className="text-danger hover:bg-danger/10"
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">{t("delete")}</span>
      </Button>
    </div>
  );
}
