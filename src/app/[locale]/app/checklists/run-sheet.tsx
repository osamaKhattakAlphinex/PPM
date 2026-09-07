"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, CircleCheckBig, Wrench } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import {
  canCompleteRun,
  ITEM_NOTE_MAX_LENGTH,
  runProgress,
  type ChecklistJobType,
} from "@/lib/domain/checklists";
import type { ChecklistRunSummary } from "@/lib/checklists/dto";
import {
  completeChecklistRunAction,
  setChecklistRunItemAction,
  startChecklistRunAction,
} from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ChecklistRunBadge } from "../_components/checklist-run-badge";

/** A job a checklist can be attached to, as offered by the picker. */
export interface JobOption {
  id: string;
  label: string;
}

/**
 * The run sheet — one checklist, being carried out.
 *
 * Two states in one component, because they are two halves of one task:
 *
 *  1. NOT YET ATTACHED. Pick the job this procedure is being done for. A run
 *     has no meaning without a job — it is evidence, and evidence is of
 *     something.
 *  2. RUNNING. The steps, tickable, with a note per line and a progress bar
 *     that says both how far through it is and whether it can be signed.
 *
 * The second state is what the technician actually lives in, so it is built for
 * a phone held in one hand: 28px tick boxes with the whole row as the label,
 * one column, no horizontal scrolling, and the sign-off button pinned in the
 * dialog footer where a long list cannot push it off screen.
 *
 * ## Optimism
 *
 * Every tick is applied locally before the round trip and reconciled from the
 * server's reply. That is not polish — this screen is used on a phone in a
 * plant room on a bad connection, and a box that does not tick on the press is
 * a box that gets pressed twice. `runProgress` and `canCompleteRun` are
 * imported from the domain module rather than reimplemented, so the bar and the
 * button's enabled state are computed by the very functions the server checks
 * against.
 */
export function RunSheet({
  checklistId,
  checklistName,
  run,
  onRunChange,
  canRun,
  ppmOptions,
  workOrderOptions,
}: {
  /** The template being run. Only used while attaching. */
  checklistId: string;
  checklistName: string;
  /** Null until a job is chosen and the run exists on the server. */
  run: ChecklistRunSummary | null;
  onRunChange: (run: ChecklistRunSummary) => void;
  canRun: boolean;
  ppmOptions: JobOption[];
  workOrderOptions: JobOption[];
}) {
  const t = useTranslations("checklists");
  const tm = useTranslations("masterData");
  const format = useFormatter();
  const { toast } = useToast();

  const [jobType, setJobType] = useState<ChecklistJobType>("PPM");
  const [isAttaching, startAttaching] = useTransition();
  const [isTicking, startTicking] = useTransition();
  const [isCompleting, startCompleting] = useTransition();

  /**
   * The optimistic copy.
   *
   * A plain state rather than `useOptimistic`, because unlike a work-order
   * transition this is not one press against one server round trip: a
   * technician ticks five boxes in a row, and each press has to hold until its
   * OWN reply lands rather than being discarded when the transition that
   * produced it settles. Reconciled from every server reply below, so the
   * server is still the authority on what the run says.
   */
  const [local, setLocal] = useState<ChecklistRunSummary | null>(run);
  const current = local ?? run;

  function adopt(next: ChecklistRunSummary): void {
    setLocal(next);
    onRunChange(next);
  }

  // --- Attaching ------------------------------------------------------------

  const jobOptions = jobType === "PPM" ? ppmOptions : workOrderOptions;

  function attach(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const raw = new FormData(event.currentTarget).get("jobId");
    const jobId = typeof raw === "string" ? raw : "";
    if (!jobId) return;

    startAttaching(async () => {
      const response = await startChecklistRunAction({ checklistId, jobType, jobId });

      if (response.ok) {
        adopt(response.data);
        // Deliberately not a "created" toast: the action returns the EXISTING
        // run when this job already has one, so "attached" would sometimes be
        // a small lie. The sheet appearing is the feedback.
        return;
      }

      toast({
        title: response.error.fields?.jobId ?? response.error.message,
        variant: "danger",
      });
    });
  }

  if (!current) {
    return (
      <form id="run-attach-form" className="grid gap-4" onSubmit={attach}>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("attachIntro", { name: checklistName })}
        </p>

        {/*
          A segmented pair rather than a third <select>. There are exactly two
          kinds of job and the choice changes what the picker below contains, so
          making it visible costs one row and saves a person opening a dropdown
          to discover the option they wanted was there.
        */}
        <Field label={t("jobType")}>
          {/*
            Toggle buttons with `aria-pressed`, deliberately NOT
            `role="radiogroup"` + `role="radio"`. A radiogroup promises arrow-key
            navigation over a roving tabindex, and implementing that for two
            options would be more machinery than the control deserves — while
            CLAIMING it and not implementing it is worse than not claiming it,
            because a screen-reader user then presses an arrow key that does
            nothing. Two tabbable toggles keep the promise they make.
          */}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "PPM", icon: CalendarClock },
                { value: "WORK_ORDER", icon: Wrench },
              ] as const
            ).map(({ value, icon: Icon }) => {
              const selected = jobType === value;

              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setJobType(value)}
                  className={cn(
                    "touch-target flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    selected
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border-strong text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t(`jobTypes.${value}`)}
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label={t("job")}
          hint={jobOptions.length === 0 ? t("noJobs") : t("jobHint")}
          required
        >
          <Select name="jobId" defaultValue="" required disabled={jobOptions.length === 0}>
            <option value="">—</option>
            {jobOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          The primary action sits in the BODY rather than the dialog footer,
          which is where the other screens put theirs. Two reasons, both
          specific to this sheet: the footer button would have to reach across
          the DOM by `form=` and still could not show this component's pending
          state, and — more importantly — the sheet's second state puts its own
          primary action (Sign off) in the body too, so keeping them in the same
          place means the button does not jump when the sheet changes state
          under the person using it.
        */}
        <Button
          type="submit"
          isLoading={isAttaching}
          disabled={!canRun || jobOptions.length === 0}
          className="w-full"
        >
          {t("attach")}
        </Button>
      </form>
    );
  }

  // --- Running --------------------------------------------------------------

  const progress = runProgress(current.items);
  const completable = canCompleteRun(current.items);
  const isDone = current.status === "COMPLETED";
  const busy = isTicking || isCompleting;

  function tick(index: number, done: boolean): void {
    if (isDone || !canRun) return;

    const previous = current!;

    // Applied before the request, and carrying the timestamp too so the "ticked
    // at" line does not appear a beat after the box fills.
    setLocal({
      ...previous,
      items: previous.items.map((item, position) =>
        position === index
          ? { ...item, done, completedAt: done ? new Date().toISOString() : null }
          : item,
      ),
    });

    startTicking(async () => {
      const response = await setChecklistRunItemAction({ runId: previous.id, index, done });

      if (response.ok) {
        adopt(response.data);
        return;
      }

      // Roll back to exactly what we had. A field message means the run moved
      // under us — someone else signed it off — so the truth is whatever the
      // server just refused us against.
      setLocal(previous);
      toast({
        title: response.error.fields?.runId ?? response.error.message,
        variant: "danger",
      });
    });
  }

  function saveNote(index: number, note: string): void {
    if (isDone || !canRun) return;

    const previous = current!;
    const item = previous.items[index];
    const trimmed = note.trim();
    // Nothing changed — do not spend a round trip, and do not stamp the run's
    // updatedAt for a field a person tabbed through.
    if ((item.note ?? "") === trimmed) return;

    startTicking(async () => {
      const response = await setChecklistRunItemAction({
        runId: previous.id,
        index,
        done: item.done,
        note: trimmed === "" ? null : trimmed,
      });

      if (response.ok) {
        adopt(response.data);
        return;
      }

      toast({
        title: response.error.fields?.runId ?? response.error.message,
        variant: "danger",
      });
    });
  }

  function complete(): void {
    const previous = current!;

    startCompleting(async () => {
      const response = await completeChecklistRunAction({ runId: previous.id });

      if (response.ok) {
        adopt(response.data);
        toast({ title: t("completedToast"), variant: "success" });
        return;
      }

      toast({
        title: response.error.fields?.runId ?? response.error.message,
        variant: "danger",
      });
    });
  }

  return (
    <div className="grid gap-4">
      {/* --- Header: what job, how far --- */}
      <div className="grid gap-3 rounded-md border border-border bg-surface-sunken/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {current.jobType === "PPM" ? (
              <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate text-sm font-medium text-foreground">
              {current.jobLabel ?? t("jobUnknown")}
            </span>
          </div>
          <ChecklistRunBadge status={current.status} />
        </div>

        {/*
          The bar and the count say two different things on purpose. The bar is
          "how much of this is done"; the line under it is "what is stopping it
          being signed" — and a run can be 90% ticked with the one required step
          outstanding, which the bar alone would misrepresent as nearly finished.
        */}
        <div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("progressLabel")}
          >
            <motion.div
              className={cn("h-full rounded-full", completable ? "bg-success" : "bg-primary")}
              initial={false}
              animate={{ width: `${progress.percent}%` }}
              transition={{ duration: 0.24, ease: "easeOut" }}
            />
          </div>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="tabular-nums numeric-isolate">
              {t("progressCount", { done: progress.done, total: progress.total })}
            </span>
            {progress.requiredOutstanding > 0 && (
              <span className="font-medium text-accent-text">
                {t("requiredOutstanding", { count: progress.requiredOutstanding })}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* --- The steps --- */}
      <ol className="grid gap-2">
        {current.items.map((item, index) => (
          <li
            key={index}
            className={cn(
              "rounded-md border p-3 transition-colors",
              item.done ? "border-success/30 bg-success/5" : "border-border bg-surface",
            )}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                size="lg"
                checked={item.done}
                disabled={isDone || !canRun || busy}
                onChange={(next) => tick(index, next)}
                label={item.label}
              />

              <div className="min-w-0 flex-1">
                {/*
                  The label is a <span>, not a <label for>: the tick box is a
                  button with its own accessible name, and wrapping it in a
                  label would announce the text twice. Struck through when done
                  — the universal "this is dealt with" without needing a second
                  colour.
                */}
                <p
                  className={cn(
                    "text-sm leading-relaxed",
                    item.done ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {item.label}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {item.required ? (
                    <span className="text-xs font-medium text-accent-text">{t("required")}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("optional")}</span>
                  )}
                  <AnimatePresence initial={false}>
                    {item.completedAt && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-xs tabular-nums numeric-isolate text-muted-foreground"
                      >
                        {format.dateTime(new Date(item.completedAt), "short")}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>

                {/*
                  The note is committed on BLUR rather than on every keystroke:
                  each save is a whole-array write (see the action), and one per
                  character would be both wasteful and a race with itself. A
                  completed run shows its notes read-only, because the record is
                  closed.
                */}
                {isDone ? (
                  item.note && (
                    <p className="mt-2 rounded-md bg-surface-sunken px-2.5 py-1.5 text-xs text-muted-foreground">
                      {item.note}
                    </p>
                  )
                ) : (
                  <input
                    defaultValue={item.note ?? ""}
                    // Keyed on the note so a server reconcile refreshes the
                    // uncontrolled field; without it a rolled-back save would
                    // leave the old text on screen.
                    key={`${index}-${item.note ?? ""}`}
                    onBlur={(event) => saveNote(index, event.target.value)}
                    maxLength={ITEM_NOTE_MAX_LENGTH}
                    disabled={!canRun || busy}
                    placeholder={t("notePlaceholder")}
                    aria-label={t("noteLabel", { step: item.label })}
                    className="mt-2 w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground hover:border-border focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  />
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* --- Sign-off --- */}
      {isDone ? (
        <p className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2.5 text-sm text-foreground">
          <CircleCheckBig className="size-4 shrink-0 text-success" aria-hidden />
          {current.completedAt
            ? t("signedOffAt", { date: format.dateTime(new Date(current.completedAt), "short") })
            : t("signedOff")}
        </p>
      ) : (
        canRun && (
          <Button
            onClick={complete}
            disabled={!completable || busy}
            isLoading={isCompleting}
            className="w-full"
          >
            <CircleCheckBig className="size-4" aria-hidden />
            {t("signOff")}
          </Button>
        )
      )}

      {!canRun && (
        <p className="text-sm text-muted-foreground">{tm("readOnly")}</p>
      )}
    </div>
  );
}
