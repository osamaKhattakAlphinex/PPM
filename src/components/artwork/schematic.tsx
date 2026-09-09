/**
 * The marketing site's imagery, drawn rather than photographed.
 *
 * Everything here is inline SVG, and that is a decision rather than a
 * limitation. A maintenance platform illustrated with stock photographs of
 * smiling people in hard hats looks like every other maintenance platform; a
 * plant-room schematic looks like the thing the product is actually about, and
 * it is the visual language a facility engineer already reads.
 *
 * Inline rather than files under `/public`, for three reasons that matter here:
 *
 *  1. **Theme.** These drawings are painted from the same CSS custom properties
 *     as the rest of the site, so they restyle themselves in dark mode. An
 *     `<img src="hero.svg">` cannot — it is an opaque document, it cannot see
 *     `currentColor`, and matching it to both themes means shipping two files
 *     and keeping them in step.
 *  2. **Weight.** No request, nothing to 404, nothing to wait for. The hero is
 *     part of the HTML that already had to arrive.
 *  3. **No third-party licence** attached to the product's front door.
 *
 * `next/image` is therefore not involved, and CLAUDE.md's rule about it is not
 * being skirted: that rule is about raster assets with intrinsic dimensions and
 * a network cost. The one place the product renders a real uploaded image — the
 * attachment gallery — does use it.
 *
 * Every drawing is `aria-hidden` and carries no meaning that is not also in the
 * text beside it.
 */

import type { CSSProperties } from "react";

/**
 * A drafting grid with a heavier rule every fifth line, the way a real
 * engineering sheet is ruled.
 *
 * A `<pattern>` rather than a repeating CSS gradient, because it lets the minor
 * and major rules differ in weight — which is the whole difference between "a
 * technical sheet" and "a table".
 */
export function BlueprintGrid({
  id,
  className,
  opacity = 0.5,
}: {
  /** SVG ids are document-global, so every instance needs its own. */
  id: string;
  className?: string;
  opacity?: number;
}) {
  return (
    <svg aria-hidden className={className} style={{ opacity }}>
      <defs>
        <pattern
          id={`${id}-minor`}
          width="28"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M28 0H0V28"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            strokeOpacity="0.35"
          />
        </pattern>
        <pattern
          id={`${id}-major`}
          width="140"
          height="140"
          patternUnits="userSpaceOnUse"
        >
          <rect width="140" height="140" fill={`url(#${id}-minor)`} />
          <path
            d="M140 0H0V140"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-major)`} />
    </svg>
  );
}

/**
 * Contour lines, as on a site survey.
 *
 * Hand-placed rather than generated: four nested closed curves at irregular
 * spacing read as terrain, while anything evenly offset reads as a target.
 */
export function ContourField({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 400"
      preserveAspectRatio="xMidYMid slice"
      className={className}
    >
      <defs>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${id}-fade)`} strokeWidth="1.25">
        <path d="M-40 300C90 250 150 330 260 300s180-120 300-90 120 10 120 10" />
        <path d="M-40 250C80 195 160 285 270 250s170-135 290-100 120 5 120 5" />
        <path d="M-40 196C70 140 170 240 280 200s160-150 280-115 120 0 120 0" />
        <path d="M-40 140C60 85 180 195 290 150s150-165 270-130 120-5 120-5" />
        <path d="M-40 84C50 30 190 150 300 100s140-180 260-145 120-10 120-10" />
      </g>
    </svg>
  );
}

/**
 * The hero drawing: a plant room, in elevation.
 *
 * Left to right it is the actual order of a chilled-water system — chiller,
 * pumps, riser, air handling unit, and the distribution board that feeds them —
 * because somebody who maintains one of these will read the order, and getting
 * it wrong is the kind of detail that makes a drawing look decorative rather
 * than informed.
 *
 * The brass accents mark the three things the product is about: a scheduled
 * visit (the gauge), an open fault (the warning triangle), and the meter that
 * ends up on an invoice.
 *
 * `flowing` animates the chilled-water dots along the pipe run. It is opt-out
 * rather than opt-in because the caller knows whether motion is wanted, and the
 * animation is additionally disabled by `prefers-reduced-motion` in CSS.
 */
export function PlantRoomScene({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      /*
       * Cropped to the drawing rather than to a round number. The content
       * starts at the alert triangle around y=118 and ends at the dimension
       * label at y=412; a viewBox with a hundred pixels of empty sky in it
       * reads as a layout gap nobody can explain.
       */
      viewBox="0 112 720 308"
      fill="none"
      className={className}
      style={style}
      role="presentation"
    >
      <defs>
        <linearGradient id="pr-chiller" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="var(--color-petrol-500)"
            stopOpacity="0.22"
          />
          <stop
            offset="100%"
            stopColor="var(--color-petrol-800)"
            stopOpacity="0.12"
          />
        </linearGradient>
        <linearGradient id="pr-ahu" x1="0" y1="0" x2="1" y2="1">
          <stop
            offset="0%"
            stopColor="var(--color-petrol-400)"
            stopOpacity="0.18"
          />
          <stop
            offset="100%"
            stopColor="var(--color-petrol-700)"
            stopOpacity="0.1"
          />
        </linearGradient>
        <linearGradient id="pr-pipe" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-petrol-600)" />
          <stop offset="100%" stopColor="var(--color-petrol-400)" />
        </linearGradient>
      </defs>

      {/* Floor line and a datum, as on a real elevation. */}
      <g stroke="currentColor" strokeOpacity="0.25">
        <path d="M20 372h680" strokeWidth="1.5" />
        <path d="M20 380h680" strokeWidth="0.75" strokeDasharray="4 6" />
      </g>

      {/* ---- Chiller ------------------------------------------------- */}
      <g>
        <rect
          x="44"
          y="196"
          width="176"
          height="176"
          rx="6"
          fill="url(#pr-chiller)"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.5"
        />
        {/* Condenser fans. */}
        {[92, 172].map((cx) => (
          <g key={cx}>
            <circle
              cx={cx}
              cy="238"
              r="26"
              stroke="currentColor"
              strokeOpacity="0.4"
              strokeWidth="1.25"
            />
            <g
              className="pr-fan"
              style={{ transformOrigin: `${cx}px 238px` }}
              stroke="var(--color-petrol-500)"
              strokeOpacity="0.7"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path
                d="M0-18 0 18M-18 0 18 0M-13-13 13 13M-13 13 13-13"
                transform={`translate(${cx} 238)`}
              />
            </g>
            <circle cx={cx} cy="238" r="3.5" fill="var(--color-petrol-600)" />
          </g>
        ))}
        {/* Louvres. */}
        <g stroke="currentColor" strokeOpacity="0.25" strokeWidth="1">
          {[288, 300, 312, 324, 336, 348].map((y) => (
            <path key={y} d={`M60 ${y}h148`} />
          ))}
        </g>
        <text
          x="132"
          y="186"
          textAnchor="middle"
          fill="currentColor"
          fillOpacity="0.55"
          fontSize="11"
          fontFamily="ui-monospace, monospace"
          letterSpacing="1.5"
        >
          CH-01
        </text>
      </g>

      {/* ---- Pipe run, with flow ------------------------------------- */}
      <g>
        <path
          d="M220 268h84c10 0 18 8 18 18v34c0 10 8 18 18 18h74"
          stroke="url(#pr-pipe)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeOpacity="0.75"
        />
        <path
          d="M220 300h58c10 0 18 8 18 18v26c0 10 8 18 18 18h100"
          stroke="currentColor"
          strokeOpacity="0.22"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Chilled water, moving. Paused by prefers-reduced-motion. */}
        <g className="pr-flow" fill="var(--color-petrol-300)">
          <circle r="3.5" cx="0" cy="0">
            <animateMotion
              dur="4.5s"
              repeatCount="indefinite"
              path="M220 268h84c10 0 18 8 18 18v34c0 10 8 18 18 18h74"
            />
          </circle>
          <circle r="3.5" cx="0" cy="0" fillOpacity="0.7">
            <animateMotion
              dur="4.5s"
              begin="1.5s"
              repeatCount="indefinite"
              path="M220 268h84c10 0 18 8 18 18v34c0 10 8 18 18 18h74"
            />
          </circle>
          <circle r="3.5" cx="0" cy="0" fillOpacity="0.45">
            <animateMotion
              dur="4.5s"
              begin="3s"
              repeatCount="indefinite"
              path="M220 268h84c10 0 18 8 18 18v34c0 10 8 18 18 18h74"
            />
          </circle>
        </g>

        {/* A gauge on the run — the scheduled check. */}
        <g transform="translate(300 246)">
          <circle
            r="17"
            fill="var(--color-background)"
            stroke="currentColor"
            strokeOpacity="0.45"
          />
          <circle
            r="17"
            fill="none"
            stroke="var(--color-brass-400)"
            strokeOpacity="0.9"
            strokeWidth="1.5"
          />
          <path
            d="M0 0 8-9"
            stroke="var(--color-brass-500)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle r="2" fill="var(--color-brass-500)" />
        </g>
      </g>

      {/* ---- Air handling unit --------------------------------------- */}
      <g>
        <rect
          x="414"
          y="228"
          width="150"
          height="144"
          rx="6"
          fill="url(#pr-ahu)"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.5"
        />
        {/* Filter bank — the thing a PPM visit actually changes. */}
        <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1">
          <rect x="430" y="246" width="40" height="108" rx="2" />
          <path
            d="M430 246 470 354M470 246 430 354M430 300h40"
            strokeOpacity="0.2"
          />
        </g>
        {/* Coil. */}
        <path
          d="M488 250c14 0 14 14 0 14s-14 14 0 14 14 14 0 14 14 14 0 14 14 14 0 14 14 14 0 14"
          stroke="var(--color-petrol-500)"
          strokeOpacity="0.6"
          strokeWidth="2"
          fill="none"
        />
        {/* Supply fan. */}
        <g transform="translate(534 300)">
          <circle
            r="20"
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeWidth="1.25"
          />
          <g className="pr-fan" style={{ transformOrigin: "0px 0px" }}>
            <path
              d="M0-14C6-8 6-2 0 0M0 14C-6 8-6 2 0 0M-14 0C-8-6-2-6 0 0M14 0C8 6 2 6 0 0"
              fill="var(--color-petrol-500)"
              fillOpacity="0.5"
            />
          </g>
        </g>
        {/* Duct, leaving the frame — the building beyond. */}
        <path
          d="M564 262h96M564 292h96"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="1.5"
        />
        <text
          x="489"
          y="218"
          textAnchor="middle"
          fill="currentColor"
          fillOpacity="0.55"
          fontSize="11"
          fontFamily="ui-monospace, monospace"
          letterSpacing="1.5"
        >
          AHU-02
        </text>
      </g>

      {/* ---- Distribution board, with one open fault ----------------- */}
      <g>
        <rect
          x="606"
          y="150"
          width="80"
          height="120"
          rx="5"
          fill="var(--color-surface)"
          fillOpacity="0.6"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.5"
        />
        <g stroke="currentColor" strokeOpacity="0.3" strokeWidth="1">
          {[172, 190, 208, 226, 244].map((y) => (
            <path key={y} d={`M618 ${y}h56`} />
          ))}
        </g>
        {/* The one breaker that has tripped. */}
        <rect
          x="616"
          y="203"
          width="60"
          height="10"
          rx="2"
          fill="var(--color-rust-500)"
          fillOpacity="0.75"
        />
        <g transform="translate(646 130)" className="pr-alert">
          <path
            d="M0-11 11 8H-11Z"
            fill="var(--color-rust-500)"
            fillOpacity="0.9"
            stroke="var(--color-rust-600)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <path
            d="M0-4v6"
            stroke="var(--color-stone-50, #fff)"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <circle cy="5" r="0.9" fill="var(--color-stone-50, #fff)" />
        </g>
        <text
          x="646"
          y="286"
          textAnchor="middle"
          fill="currentColor"
          fillOpacity="0.55"
          fontSize="11"
          fontFamily="ui-monospace, monospace"
          letterSpacing="1.5"
        >
          DB-4F
        </text>
      </g>

      {/* A dimension line, because engineers put dimensions on things. */}
      <g stroke="currentColor" strokeOpacity="0.3" strokeWidth="1">
        <path d="M44 396h176" />
        <path d="M44 391v10M220 391v10" />
      </g>
      <text
        x="132"
        y="412"
        textAnchor="middle"
        fill="currentColor"
        fillOpacity="0.4"
        fontSize="10"
        fontFamily="ui-monospace, monospace"
      >
        PLANT ROOM
      </text>
    </svg>
  );
}

/**
 * A valve tag: the brass disc wired to a valve, stamped with its reference.
 *
 * The product's oldest metaphor — an asset register is a drawer of these — and
 * the reason the palette has a brass in it at all. Used as a section marker.
 */
export function ValveTag({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      <svg aria-hidden width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle
          cx="11"
          cy="12"
          r="8.5"
          fill="var(--color-brass-200)"
          stroke="var(--color-brass-500)"
          strokeWidth="1.25"
        />
        <circle
          cx="11"
          cy="4.5"
          r="2"
          stroke="var(--color-brass-500)"
          strokeWidth="1.25"
        />
      </svg>
      <span>{label}</span>
    </span>
  );
}
