"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import { Input } from "./input";

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * A password field with a reveal toggle.
 *
 * Every prop — `id`, `aria-invalid`, `aria-describedby` — lands on the real
 * `<input>`, so `Field` can keep cloning its child and wiring the label the
 * way it does for a plain `Input`. The wrapper takes only the class name.
 *
 * The toggle is a `<button type="button">`: inside a form, the default type is
 * `submit`, and a reveal control that posts the form is a trap a keyboard user
 * falls into every time. It is left out of the tab order (`tabIndex={-1}`) for
 * the same reason a password manager's is — Tab from the field should reach
 * the submit button — and stays reachable by pointer and by the live region
 * that announces the change.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const t = useTranslations("password");
    const [isVisible, setIsVisible] = useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          // Toggling the `type` attribute rather than swapping the element
          // keeps the same DOM node, so the caret position, the value and any
          // password manager already attached to it all survive the flip.
          type={isVisible ? "text" : "password"}
          // Room for the toggle at the inline-end edge — the right in English,
          // the left in Arabic, with no rtl: variant needed.
          className={cn("pe-10", className)}
          {...props}
        />

        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          tabIndex={-1}
          aria-label={isVisible ? t("hide") : t("show")}
          aria-pressed={isVisible}
          className="absolute end-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isVisible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>

        {/*
          `aria-label` on the button changes as it is pressed, and a change to
          the name of the element you just activated is not reliably announced.
          This says what happened to the FIELD, which is the part that matters:
          a screen reader user needs to know the password is now on screen.
        */}
        <span aria-live="polite" className="sr-only">
          {isVisible ? t("shown") : t("hidden")}
        </span>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";
