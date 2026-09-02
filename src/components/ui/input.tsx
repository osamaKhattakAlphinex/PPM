import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * `h-9` (36px) rather than the 44px finger target — `.touch-target` restores
 * that on a coarse pointer, so a phone still gets a full-size box while a
 * desktop form stays compact. See globals.css.
 */
export const inputBaseClass =
  "touch-target h-9 w-full rounded-md border border-border-strong bg-surface ps-3 pe-3 text-sm text-foreground placeholder:text-muted-foreground transition-[border-color,box-shadow,background-color] duration-150 hover:border-primary/50 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60 disabled:hover:border-border-strong";

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return <input ref={ref} className={cn(inputBaseClass, className)} {...props} />;
});
Input.displayName = "Input";
