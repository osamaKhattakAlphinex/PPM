import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * A multi-line field, matching the input's box so the two line up in a mixed
 * form.
 *
 * The class list is spelled out rather than composed from `inputBaseClass`,
 * because the two tokens that make that constant work for a single line are
 * exactly the two a textarea must not have: `h-9`, which would fix it at one
 * line, and `touch-target`, whose `min-height: 2.75rem` under a coarse pointer
 * would compete with this box's own minimum and could win. Everything else —
 * the border, the hover and focus treatment, the `aria-[invalid=true]` danger
 * border that `Field` drives — is deliberately identical, and should be changed
 * in both places together.
 *
 * `min-h-24` is about three lines: enough that a fault report does not feel
 * like a search box. `resize-y` lets someone with more to say make room without
 * the layout being able to break sideways.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          "min-h-24 w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2",
          "text-sm leading-relaxed text-foreground placeholder:text-muted-foreground",
          "transition-[border-color,box-shadow,background-color] duration-150",
          "hover:border-primary/50 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "aria-[invalid=true]:border-danger",
          "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60 disabled:hover:border-border-strong",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
