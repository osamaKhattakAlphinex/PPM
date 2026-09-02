import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { inputBaseClass } from "./input";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="group relative">
        <select
          ref={ref}
          // Shares the input's box so the two line up in a mixed form; only the
          // padding differs, to leave room for the chevron.
          className={cn(inputBaseClass, "appearance-none ps-3 pe-9", className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-hover:text-foreground"
          aria-hidden
        />
      </div>
    );
  }
);
Select.displayName = "Select";
