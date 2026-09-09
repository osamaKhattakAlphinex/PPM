"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";

/**
 * Scroll-triggered entrance animation for the marketing pages.
 *
 * Three things about it are deliberate.
 *
 * **It respects `prefers-reduced-motion`.** Not by shortening the animation but
 * by not animating: `useReducedMotion()` returns true and the element is
 * rendered in its final state. Somebody who has asked their operating system
 * for less movement has usually asked for a reason, and a "subtle" fade is
 * still movement.
 *
 * **It fires once.** `viewport={{ once: true }}`, so scrolling back up does not
 * replay the page. An animation that repeats every time an element crosses the
 * fold stops being an entrance and becomes a distraction.
 *
 * **It cannot hide the page.** The initial state has `opacity: 0`, which is
 * rendered into the prerendered HTML — so without JavaScript the content would
 * never fade in. The public layout ships a `<noscript>` rule that overrides
 * every `[data-reveal]` back to visible. Marketing pages are the one place
 * where "it looked broken to somebody with JS off" is a real cost, and a
 * three-line stylesheet removes it.
 */

const DISTANCE = 14;

export type RevealDirection = "up" | "left" | "right" | "none";

function offsetFor(direction: RevealDirection) {
  switch (direction) {
    case "left":
      return { x: -DISTANCE, y: 0 };
    case "right":
      return { x: DISTANCE, y: 0 };
    case "none":
      return { x: 0, y: 0 };
    default:
      return { x: 0, y: DISTANCE };
  }
}

export function Reveal({
  children,
  delay = 0,
  direction = "up",
  className,
}: {
  children: ReactNode;
  /** Seconds. Use sparingly — a staggered list should use `RevealGroup`. */
  delay?: number;
  direction?: RevealDirection;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const offset = offsetFor(direction);

  return (
    <motion.div
      data-reveal
      className={className}
      initial={reduced ? false : { opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Which element the animated wrapper renders as.
 *
 * This exists because animation must not cost semantics. A `<dl>` whose items
 * are wrapped in plain divs is still a description list; a `<dl>` REPLACED by a
 * div is a pile of `<dt>` elements with no list for a screen reader to
 * announce, and Lighthouse's accessibility score notices immediately — which is
 * exactly how this was caught.
 */
type GroupElement = "div" | "dl" | "ul" | "ol";
type ItemElement = "div" | "li";

const GROUP_COMPONENTS = {
  div: motion.div,
  dl: motion.dl,
  ul: motion.ul,
  ol: motion.ol,
} as const;

const ITEM_COMPONENTS = {
  div: motion.div,
  li: motion.li,
} as const;

/**
 * A container whose children arrive one after another.
 *
 * The stagger is 60ms and the list is capped by the caller rather than here —
 * a twelve-item grid at 60ms takes three quarters of a second to finish, which
 * is on the edge of feeling slow rather than alive.
 */
const groupVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: DISTANCE },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

export function RevealGroup({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  /** Keep the element the content needs — a list stays a list. */
  as?: GroupElement;
}) {
  const reduced = useReducedMotion();
  const Component = GROUP_COMPONENTS[as];

  return (
    <Component
      data-reveal
      className={className}
      initial={reduced ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      variants={groupVariants}
    >
      {children}
    </Component>
  );
}

/** One child of a `RevealGroup`. Inherits the parent's timing. */
export function RevealItem({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  /** `li` inside a `ul`/`ol` group; a plain `div` is valid inside a `dl`. */
  as?: ItemElement;
}) {
  const reduced = useReducedMotion();
  const Component = ITEM_COMPONENTS[as];

  return (
    <Component
      data-reveal
      className={className}
      variants={reduced ? undefined : itemVariants}
    >
      {children}
    </Component>
  );
}

/**
 * The hero's own entrance: it is above the fold, so it animates on mount
 * rather than on scroll, and it leads the rest of the page slightly.
 */
export function HeroReveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      data-reveal
      className={className}
      initial={reduced ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
