"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import {
  APPROVAL_STAGES,
  stageIndex,
  type ApprovalStage,
  type ApprovalStatus,
} from "@/lib/domain/approvals";

/**
 * Where a chain has got to, as five dots on a rule.
 *
 * The one thing this screen has to answer at a glance is "how far along is
 * this, and who is holding it up" — a percentage cannot say the second half, and
 * a text label cannot say the first. So the rule fills to the CURRENT desk and
 * the desk itself is named beneath it.
 *
 * The fill is animated because the press that advances a chain is on the same
 * row: without it, approving something changes a badge and nothing else, and
 * the thing the person actually did — moving it one desk along — is invisible.
 * `scaleX` rather than `width`, so the app's global `<MotionConfig
 * reducedMotion="user">` can drop it to an instant change; it cannot do that for
 * a width.
 *
 * A REJECTED chain keeps the fill it earned and turns rust: it did get that far,
 * and pretending otherwise would lose the only information the bar carries.
 */
export function StageProgress({
  stage,
  status,
  className,
}: {
  stage: ApprovalStage;
  status: ApprovalStatus;
  className?: string;
}) {
  const t = useTranslations("approvals.stage");

  const cleared = stageIndex(stage);
  const total = APPROVAL_STAGES.length - 1;
  const fraction = total === 0 ? 0 : cleared / total;

  const rejected = status === "REJECTED";

  return (
    <div className={cn("grid gap-1.5", className)}>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={cleared}
        aria-valuetext={t(stage)}
      >
        <motion.span
          className={cn(
            "absolute inset-y-0 start-0 w-full origin-[left_center] rounded-full rtl:origin-[right_center]",
            rejected ? "bg-danger" : "bg-accent",
          )}
          initial={false}
          animate={{ scaleX: fraction }}
          transition={{ duration: 0.32, ease: "easeOut" }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        {APPROVAL_STAGES.map((entry, index) => (
          <span
            key={entry}
            aria-hidden
            className={cn(
              "size-1.5 rounded-full transition-colors",
              index < cleared && (rejected ? "bg-danger" : "bg-accent"),
              index === cleared && (rejected ? "bg-danger" : "bg-accent-text"),
              index > cleared && "bg-border-strong",
            )}
          />
        ))}
        <span className="ms-1 text-xs text-muted-foreground">{t(stage)}</span>
      </div>
    </div>
  );
}
