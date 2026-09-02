"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { MAX_SKILLS, SKILL_MAX_LENGTH } from "@/lib/domain/technicians";
import { Input } from "@/components/ui/input";

/**
 * The skills editor: type a skill, press Enter, it becomes a chip.
 *
 * A comma-separated text field would have been a third of this code and is what
 * this control replaces. It was rejected because the round trip is lossy in a
 * way users notice: "Chiller overhaul, brazing" saved and reopened is one
 * string again, so an edit that removes the second skill means retyping the
 * first, and a stray comma inside a skill name silently splits it.
 *
 * Chips also make the two limits visible instead of surprising: the counter
 * shows how many of `MAX_SKILLS` are used, and the input stops accepting at the
 * cap rather than failing validation after submit.
 *
 * Enter is intercepted (`preventDefault`) so it commits a chip rather than
 * submitting the form around it — the single most likely way to lose a
 * half-typed skill.
 */
export function SkillsInput({
  name,
  value,
  onChange,
}: {
  /** Only used to build stable ids; the value is submitted by the parent. */
  name: string;
  value: string[];
  onChange: (skills: string[]) => void;
}) {
  const t = useTranslations("technicians");
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const atCapacity = value.length >= MAX_SKILLS;

  function commit(raw: string): void {
    const skill = raw.trim();
    if (!skill || atCapacity) return;

    // Case-insensitive duplicate check, matching the server-side normalisation
    // in `src/lib/technicians/schemas.ts` — so the form cannot build a payload
    // the action would silently collapse.
    const exists = value.some((existing) => existing.toLocaleLowerCase() === skill.toLocaleLowerCase());
    if (!exists) onChange([...value, skill]);

    setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }
    // Backspace on an empty field removes the last chip — the standard gesture
    // for this control, and the only way to fix a typo without reaching for the
    // mouse.
    if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5" role="list">
        <AnimatePresence initial={false}>
          {value.map((skill) => (
            <motion.span
              key={skill.toLocaleLowerCase()}
              role="listitem"
              layout
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-sunken py-0.5 ps-2.5 pe-1 text-xs text-foreground"
            >
              {skill}
              <button
                type="button"
                onClick={() => {
                  onChange(value.filter((item) => item !== skill));
                  inputRef.current?.focus();
                }}
                aria-label={t("removeSkill", { skill })}
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      <Input
        ref={inputRef}
        id={name}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        // Committing on blur too: a user who types a skill and clicks Save
        // means to keep it, and losing it silently is the worst outcome here.
        onBlur={() => commit(draft)}
        placeholder={atCapacity ? t("skillsFull") : t("skillsPlaceholder")}
        maxLength={SKILL_MAX_LENGTH}
        disabled={atCapacity}
      />

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t("skillsCount", { count: value.length, max: MAX_SKILLS })}
      </p>
    </div>
  );
}
