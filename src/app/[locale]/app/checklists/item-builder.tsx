"use client";

import { useRef, useState } from "react";
import { AnimatePresence, Reorder, useDragControls, type DragControls } from "framer-motion";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import {
  ITEM_LABEL_MAX_LENGTH,
  MAX_CHECKLIST_ITEMS,
  MIN_CHECKLIST_ITEMS,
} from "@/lib/domain/checklists";
import { Button } from "@/components/ui/button";
import { Input, inputBaseClass } from "@/components/ui/input";

/**
 * The checklist builder: the list of steps, in the order they will be carried
 * out.
 *
 * ORDER IS DATA here, not decoration. A procedure that says "isolate the
 * supply" after "open the panel" is a different procedure, and a dangerous one,
 * so reordering has to be a first-class gesture rather than something achieved
 * by deleting and retyping. That is the whole reason this control exists
 * instead of a textarea of one-per-line steps.
 *
 * ## Identity
 *
 * Rows are keyed by a client-side `uid`, never by label or index. Both of the
 * obvious alternatives break in ordinary use: two steps may legitimately share
 * a label ("Torque bolt", once per side), and an index-keyed list re-mounts
 * every row below the one that moved — which loses the caret of whatever field
 * was being typed in. The uid never leaves the browser; the payload is
 * `{ label, required }` in array order, because on the server the position IS
 * the identity (see `db/models/checklist.ts`).
 *
 * ## Three ways to reorder, and why it is not two
 *
 *  - DRAG, via `Reorder` and a dedicated grip. The grip rather than the whole
 *    row, because the row contains a text input and dragging from inside it
 *    would fight text selection on desktop and the caret on a phone.
 *  - The UP/DOWN buttons, which are not a fallback but the primary path for two
 *    groups of people: anyone using a keyboard (a drag has no keyboard
 *    equivalent, so a drag-only control is inaccessible by construction) and
 *    anyone on a phone, where the builder is presented inside a bottom sheet
 *    that is itself draggable. Framer blocks a child drag from propagating to a
 *    parent drag by default, so the grip does work there — but "works" and
 *    "comfortable, one-handed, first time" are different bars, and the buttons
 *    clear the second one.
 *
 * Both paths call the same `onChange`, so there is one definition of what the
 * order now is.
 */

/** One row while it is being edited. `uid` is browser-only; see above. */
export interface DraftItem {
  uid: string;
  label: string;
  required: boolean;
}

/**
 * A stable id for a row.
 *
 * `crypto.randomUUID` where it exists — every browser this app supports — with
 * a counter fallback so the control still works in an insecure context or an
 * older WebView, which a technician's site-issued device may well be. The value
 * is never persisted and never compared across sessions, so a weak fallback
 * costs nothing.
 */
let fallbackId = 0;
export function newDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `item-${fallbackId}`;
}

export function toDraftItems(
  items: readonly { label: string; required: boolean }[],
): DraftItem[] {
  return items.map((item) => ({ uid: newDraftId(), label: item.label, required: item.required }));
}

export function ItemBuilder({
  items,
  onChange,
  error,
  disabled,
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  /** A field message from the server, e.g. a label that sanitised to nothing. */
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("checklists");
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLInputElement>(null);

  const atCapacity = items.length >= MAX_CHECKLIST_ITEMS;

  function commitDraft(): void {
    const label = draft.trim();
    if (!label || atCapacity) return;

    // `required: true` to match the model's default. A step added without a
    // thought about it should hold the run open, not wave it through.
    onChange([...items, { uid: newDraftId(), label, required: true }]);
    setDraft("");
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const next = [...items];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    onChange(next);
  }

  function patch(uid: string, changes: Partial<DraftItem>): void {
    onChange(items.map((item) => (item.uid === uid ? { ...item, ...changes } : item)));
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{t("steps")}</span>
        {/*
          The count is `aria-live` so a screen reader hears the list grow, and
          tabular so the digits do not shift the label beside them.
        */}
        <span className="text-xs tabular-nums numeric-isolate text-muted-foreground" aria-live="polite">
          {t("stepCount", { count: items.length, max: MAX_CHECKLIST_ITEMS })}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("noSteps")}
        </p>
      ) : (
        /*
          `Reorder.Group` owns the drag reordering; `values` and `onReorder` are
          the whole contract. Rows carry `layout`, so a row displaced by a drag
          or by an arrow press ANIMATES into its new position rather than
          teleporting — which is what makes a reorder legible as a movement
          instead of a repaint.
        */
        <Reorder.Group
          axis="y"
          values={items}
          onReorder={onChange}
          className="grid gap-2"
          // The list is a list. Without this the group is a bare <ul> of
          // <li>s whose semantics are fine, but the label is what tells a
          // screen-reader user what they have landed in.
          aria-label={t("steps")}
        >
          <AnimatePresence initial={false}>
            {items.map((item, index) => (
              <BuilderRow
                key={item.uid}
                item={item}
                index={index}
                total={items.length}
                disabled={disabled}
                onLabelChange={(label) => patch(item.uid, { label })}
                onRequiredChange={(required) => patch(item.uid, { required })}
                onMove={(direction) => move(index, direction)}
                onRemove={() => onChange(items.filter((row) => row.uid !== item.uid))}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}

      {/*
        Adding is its own field below the list rather than a blank row appended
        to it. A blank row would be a row that fails validation the moment it
        exists, and the builder would open every checklist showing an error.
      */}
      <div className="flex items-start gap-2">
        <Input
          ref={draftRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter commits a step rather than submitting the form around it —
            // the single most likely way to lose a half-typed line.
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitDraft();
          }}
          placeholder={atCapacity ? t("stepsFull") : t("stepPlaceholder")}
          maxLength={ITEM_LABEL_MAX_LENGTH}
          disabled={disabled || atCapacity}
          aria-label={t("addStep")}
        />
        <Button
          variant="outline"
          onClick={commitDraft}
          disabled={disabled || atCapacity || draft.trim().length === 0}
          aria-label={t("addStep")}
        >
          <Plus className="size-4" aria-hidden />
          <span className="sr-only @sm:not-sr-only @sm:inline">{t("addStep")}</span>
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("stepsHint", { min: MIN_CHECKLIST_ITEMS })}
        </p>
      )}
    </div>
  );
}

/**
 * One editable step.
 *
 * Its own component because `useDragControls` is a hook and cannot be called
 * inside a `map` callback — and controls are what let the drag start from the
 * grip alone while the rest of the row stays a normal, selectable, typeable
 * form control. `dragListener={false}` turns off the whole-row listener that
 * `Reorder.Item` would otherwise install.
 */
function BuilderRow({
  item,
  index,
  total,
  disabled,
  onLabelChange,
  onRequiredChange,
  onMove,
  onRemove,
}: {
  item: DraftItem;
  index: number;
  total: number;
  disabled?: boolean;
  onLabelChange: (label: string) => void;
  onRequiredChange: (required: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("checklists");
  const controls: DragControls = useDragControls();

  const position = t("stepPosition", { index: index + 1, total });

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      // Lifts off the page while held, so it is obvious which row is moving.
      whileDrag={{ scale: 1.01, boxShadow: "0 8px 20px -8px rgb(14 25 23 / 0.35)", zIndex: 1 }}
      className="rounded-md border border-border bg-surface"
    >
      {/*
        Two rows on a phone, one on a tablet and up. The label field is the
        thing being typed into, so it takes the full width on a narrow screen
        and the controls sit under it at full touch size rather than being
        squeezed into a 40px column beside it.

        `@container` units, not viewport ones: this control lives inside a
        dialog whose width is set by the dialog, and `sm:` would go two-up
        because the WINDOW is 640px even when the sheet is 360px. See the note
        on `Modal`.
      */}
      <div className="flex flex-col gap-2 p-2 @lg:flex-row @lg:items-center">
        <div className="flex items-center gap-1">
          <span
            // `touch-action: none` is required for a touch drag: without it the
            // browser claims the gesture for scrolling before framer sees it.
            style={{ touchAction: "none" }}
            onPointerDown={(event) => {
              if (disabled) return;
              controls.start(event);
            }}
            role="presentation"
            className={cn(
              "grid size-8 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground",
              "transition-colors hover:bg-surface-sunken hover:text-foreground active:cursor-grabbing",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            {/*
              The grip is `aria-hidden` and NOT focusable, on purpose: a drag
              handle a keyboard can focus but not operate is a trap. The
              keyboard path is the two buttons beside it, which are real
              controls with real labels.
            */}
            <GripVertical className="size-4" aria-hidden />
          </span>

          <span className="w-6 shrink-0 text-center text-xs tabular-nums numeric-isolate text-muted-foreground">
            {index + 1}
          </span>

          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              className="px-1.5"
              onClick={() => onMove(-1)}
              disabled={disabled || index === 0}
              aria-label={t("moveUp", { position })}
            >
              <ChevronUp className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="px-1.5"
              onClick={() => onMove(1)}
              disabled={disabled || index === total - 1}
              aria-label={t("moveDown", { position })}
            >
              <ChevronDown className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <input
          value={item.label}
          onChange={(event) => onLabelChange(event.target.value)}
          maxLength={ITEM_LABEL_MAX_LENGTH}
          disabled={disabled}
          aria-label={t("stepLabel", { position })}
          // Borderless inside its own bordered row: a box in a box reads as two
          // controls, and the row already is the control.
          className={cn(inputBaseClass, "flex-1 border-transparent bg-transparent hover:border-border-strong")}
        />

        <div className="flex shrink-0 items-center justify-between gap-1 @lg:justify-end">
          {/*
            A labelled pill rather than a bare checkbox. "Required" is the whole
            meaning of the control and it has to be readable at a glance while
            scanning twenty rows — a tick box with the word somewhere above it
            is not. `aria-pressed` because this is a toggle button, and its
            accessible name already contains the state's subject.
          */}
          <button
            type="button"
            onClick={() => onRequiredChange(!item.required)}
            disabled={disabled}
            aria-pressed={item.required}
            aria-label={t("toggleRequired", { position })}
            className={cn(
              "touch-target-sm rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:cursor-not-allowed disabled:opacity-50",
              item.required
                ? "border-accent/30 bg-accent/10 text-accent-text"
                : "border-border-strong bg-surface-sunken text-muted-foreground",
            )}
          >
            {item.required ? t("required") : t("optional")}
          </button>

          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger/10"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t("removeStep", { position })}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </Reorder.Item>
  );
}
