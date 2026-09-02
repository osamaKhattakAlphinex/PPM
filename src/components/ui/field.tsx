import { cloneElement, isValidElement, useId, type ReactElement } from "react";

import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Lets a caller span the field across a form grid, e.g. `@lg:col-span-2`. */
  className?: string;
  /** A single form control (Input/Select) — id/aria wiring is injected automatically. */
  children: ReactElement<Record<string, unknown>>;
}) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = error ? errorId : hint ? hintId : undefined;

  const existingId = children.props.id;
  const resolvedId = typeof existingId === "string" ? existingId : inputId;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: resolvedId,
        "aria-invalid": Boolean(error) || undefined,
        "aria-describedby": describedBy,
      })
    : children;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={resolvedId} className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ms-1 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
