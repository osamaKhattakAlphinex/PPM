"use client";

import { forwardRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  [
    "group relative isolate inline-flex select-none items-center justify-center gap-2 overflow-hidden",
    "whitespace-nowrap rounded-md font-medium leading-none",
    "transition-[background-color,border-color,color,box-shadow] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary shadow-sm hover:bg-primary-hover hover:shadow-md",
        accent: "bg-accent text-on-accent shadow-sm hover:bg-accent-hover hover:shadow-md",
        outline:
          "border border-border-strong bg-transparent text-foreground hover:border-primary hover:bg-surface-sunken hover:text-primary hover:shadow-sm",
        ghost: "bg-transparent text-foreground hover:bg-surface-sunken hover:text-primary",
        danger: "bg-danger text-on-primary shadow-sm hover:bg-danger-hover hover:shadow-md",
      },
      size: {
        // Mouse-sized on purpose; `.touch-target` puts the 44px box back on a
        // coarse pointer. See globals.css.
        sm: "touch-target-sm h-8 px-3 text-xs",
        md: "touch-target h-9 px-4 text-sm",
        lg: "touch-target h-10 px-5 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

/** The variants painted with a solid fill — the only ones a sheen reads on. */
const SOLID_VARIANTS = new Set(["primary", "accent", "danger"]);

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "ref" | "children">,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, isLoading, disabled, children, ...props }, ref) => {
    const isSolid = SOLID_VARIANTS.has(variant ?? "primary");

    return (
      <motion.button
        ref={ref}
        type={props.type ?? "button"}
        className={cn(buttonVariants({ variant, size }), className)}
        // A 1px lift on hover and a press that actually gives — the hover state
        // is colour + elevation + movement together, so it registers without
        // any single part having to shout. `MotionConfig reducedMotion="user"`
        // (theme provider) drops the transform when the OS asks it to.
        whileHover={disabled || isLoading ? undefined : { y: -1 }}
        whileTap={disabled || isLoading ? undefined : { scale: 0.97, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {/*
          A single sheen crossing the face on hover. `-z-10` is safe here
          because the button sets `isolate`, so the span is behind the label
          but still in front of the button's own fill. Purely decorative:
          hidden outright when the OS asks for reduced motion, since a
          non-animated sheen is just a stray gradient.

          The duration lives on the hover state, not the base: the sweep takes
          500ms going in and snaps back in 0ms on mouse-out, so the pointer
          leaving does not drag a second sheen back across the face.
        */}
        {isSolid && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-0 ease-out group-hover:translate-x-full group-hover:duration-500 motion-reduce:hidden"
          />
        )}
        {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
      </motion.button>
    );
  }
);
Button.displayName = "Button";
