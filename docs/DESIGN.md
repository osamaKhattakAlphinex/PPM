# PPM Platform — Design System

This document defines the visual and motion language for the platform and the reasoning behind it. The brief was explicit: this must not read as a generic AI-generated dashboard. Generic reads as: navy sidebar + one blue accent + Inter + big soft shadow cards + 20px radii everywhere + a purple gradient somewhere. Every decision below is a deliberate move away from that default, chosen for a **serious B2B maintenance operations tool for the Gulf market**, used by admins, FM managers, supervisors, technicians and clients — often on a phone, in the field, in sunlight, in Arabic.

---

## 1. Palette — "Steel & Brass"

The domain is physical: pipes, plant rooms, HVAC units, generators, fire panels, brass fittings, valve tags, hazard tape. The palette leans into that material world instead of abstract "tech blue," and instead of the equally-default Gulf cliché of cream + terracotta (which reads hospitality/real-estate, not industrial ops).

Base hue is a deep **petrol teal** — read as pipework, uniforms, plant-room signage — paired with a **brass** accent (fittings, valve tags, warning plates). Status colors are desaturated, material versions of red/green/amber rather than saturated UI-kit red/green, so a screen full of status badges doesn't look like a slot machine.

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0E1917` | Deepest neutral. Dark-mode canvas; light-mode primary text. A near-black with a whisper of teal, never pure `#000`. |
| `petrol` | `#145A56` | Primary brand hue. Interactive primary, links, active nav, focus of the identity. Deep teal instead of navy — distinct, industrial, calm. |
| `brass` | `#BD8A32` | Accent. Primary CTAs' companion, key metrics/KPI numbers, active/selected states, focus rings. Warm counterweight to the cold teal. |
| `rust` | `#AE4530` | Danger / critical / SLA-breach. A muted clay-oxide red, not fire-engine red — reads "attention" without looking like a browser error page. |
| `moss` | `#45785B` | Success / completed / compliant. Muted patina green, sits comfortably next to petrol without competing with it. |
| `stone` | `#E7E2D9` | Light neutral surface. Warm-but-quiet, sits between clinical gray and cliché cream. |
| `mist` | `#7C8683` | Mid neutral. Borders, dividers, secondary text, disabled states — in both themes. |

Each has a full 50–900 tint/shade ramp generated for surfaces, hover/active states, and text-on-color contrast (defined as CSS variables, see §7). `brass` also doubles as the **warning** status color (industrial "hazard plate" amber) rather than inventing an eighth hue — one fewer color for engineers to keep straight, and warning tags read naturally as brass-yellow tape.

### Light theme

| Token | Value | Usage |
|---|---|---|
| `--background` | `#F6F4EF` | App canvas |
| `--surface` | `#FFFFFF` | Cards, table rows, inputs |
| `--surface-raised` | `#FFFFFF` | Modals, popovers (differentiated by shadow, not tint) |
| `--surface-sunken` | `#EFEBE2` | Table header, code blocks, disabled fields |
| `--border` | `#DCD6C8` | Hairline borders |
| `--border-strong` | `#C7BFAC` | Input borders, dividers that need to read |
| `--foreground` | `#0E1917` (ink) | Body text, headings |
| `--muted-foreground` | `#565F5C` | Meta text, labels, placeholders |
| `--on-primary` | `#F6F4EF` | Text on petrol/rust/moss fills |
| `--on-accent` | `#0E1917` (ink) | Text on a solid brass fill — see note below |
| `--accent-text` | `#815E22` (brass-700) | Brass used as text/icon color on a plain surface — see note below |
| `--primary` | `#145A56` (petrol) | Primary actions |
| `--primary-hover` | `#0F4643` | |
| `--accent` | `#BD8A32` (brass) | Highlights, KPI figures |
| `--danger` | `#AE4530` (rust) | |
| `--success` | `#45785B` (moss) | |
| `--warning` | `#BD8A32` (brass) | |
| `--ring` | `#BD8A32` (brass, solid, 2px offset) | All focus-visible outlines |

### Dark theme

Dark mode is not "invert the light theme" — surfaces are lifted (not black), and brand hues are lightened/desaturated slightly so they don't vibrate on a dark ground.

| Token | Value | Usage |
|---|---|---|
| `--background` | `#0E1917` (ink) | App canvas |
| `--surface` | `#152522` | Cards, table rows, inputs |
| `--surface-raised` | `#1B302C` | Modals, popovers |
| `--surface-sunken` | `#0A1412` | Table header, code blocks |
| `--border` | `#25403A` | Hairline borders |
| `--border-strong` | `#33534B` | Input borders |
| `--foreground` | `#EDEAE1` | Body text, headings |
| `--muted-foreground` | `#A7B0AB` | Meta text, labels |
| `--on-primary` | `#0E1917` | Text on light-tinted brand fills |
| `--on-accent` | `#0E1917` | Text on a solid brass fill (brass is light-toned in both themes, so this equals `--on-primary` here) |
| `--accent-text` | `#D9A853` (= `--accent`) | Brass as text/icon color on a plain surface — already passes at this value in dark mode |
| `--primary` | `#3FA89B` | Primary actions (lightened petrol) |
| `--primary-hover` | `#5CC0B2` | |
| `--accent` | `#D9A853` | Highlights, KPI figures (lightened brass) |
| `--danger` | `#D97A5F` | (lightened rust) |
| `--success` | `#6FAE86` | (lightened moss) |
| `--warning` | `#D9A853` | |
| `--ring` | `#D9A853` | |

**Contrast, checked, not assumed:** every `foreground`/`muted-foreground` pairing and every solid-fill pairing was run through the WCAG relative-luminance formula, and one combination failed: white-on-brass. Brass is anchored at a relatively light step of its ramp on purpose (it's a highlight color, not a saturated dark one), which means `on-primary` (near-white) on `accent` only reaches **2.79:1** in light mode — well under the 4.5:1 minimum. The fix is the two extra tokens above rather than darkening the brass swatch itself, which would have muddied the "Steel & Brass" identity everywhere else brass appears (fills, borders, the palette swatch). With `on-accent`/`accent-text` in place, every pairing below is ≥4.5:1 (small/normal text) except where noted ≥3:1 is the correct bar (large text, icons):

| Pairing | Light | Dark |
|---|---|---|
| `foreground` / `background` | 16.3:1 | 14.9:1 |
| `muted-foreground` / `background` | 6.0:1 | 8.1:1 |
| `on-primary` / `primary` | 7.3:1 | 6.2:1 |
| `on-accent` / `accent` | 5.9:1 | 8.3:1 |
| `on-primary` / `danger` | 5.2:1 | 5.9:1 |
| `on-primary` / `success` | 4.7:1 | 6.9:1 |
| `accent-text` / `surface` | 5.9:1 | 7.3:1 |

---

## 2. Type pairing

**Display — Inter (600/700).** Weight, not family, carries the display role. Inter is drawn for screens at UI sizes — tall x-height, open apertures, unambiguous `1`/`l`/`I` — and its variable axis means 600 and 700 cost nothing extra to load. Used for H1–H3, KPI numbers, and the nav wordmark, with the negative tracking in the scale below doing the work Inter's own display guidance asks for as size increases.

> Chosen to match an existing product surface the team is standardising on (`prime-air-service-web`), which pairs Inter with IBM Plex Sans Arabic. The trade-off is worth stating plainly: Inter is the default face of a great many dashboards, so it buys familiarity and legibility at the cost of the distinctiveness §1 asks for. Differentiation therefore has to come from the palette, the motion and the layout rather than from the type.

**Body — Inter (400/500).** One family covers both roles. This app spends most of its life as a work-order list, and Inter is at its best exactly there: at 13–14px in a dense table it stays legible, and its tabular figures line up cleanly under `numeric-isolate`. Loaded as a single variable file (100–900), so nothing is synthetically bolded and one Latin family replaces two.

**Arabic — IBM Plex Sans Arabic** for *both* display and body (varying weight, not family). Inter has no Arabic cut, so the RTL side swaps family wholesale on `dir="rtl"` — the same pairing the reference surface uses. Plex Sans Arabic sits at a matched x-height and stroke contrast next to Inter, which is what keeps EN/AR from looking mismatched where they appear side by side (bilingual labels, mixed-direction tables). Pairing two *unrelated* Arabic families for display vs. body is a common source of RTL layouts looking mismatched or, worse, hurting legibility at UI sizes — Arabic display faces with strong Latin-style "personality" are also far more likely to sacrifice legibility at 14–16px, which this app can't afford in a technician's table view. Weight carries the display/body distinction instead: 600–700 for headings, 400–500 for body.

Both are loaded self-hosted via `next/font/google` (downloaded at build time, served from our own origin, zero runtime request to Google, no CLS from a late font swap) — see `src/lib/fonts.ts`.

### Type scale

Modular scale, ratio 1.25 (major third), base 16px. Display face gets tighter tracking as size increases (its glyphs get relatively wider); Arabic gets more line-height at every step (diacritics, descenders, and generally taller default line boxes).

| Token | Size | Line-height (Latin) | Line-height (Arabic) | Tracking | Face | Typical use |
|---|---|---|---|---|---|---|
| `text-xs` | 12px | 16px | 20px | 0 | body | table meta, timestamps |
| `text-sm` | 14px | 20px | 24px | 0 | body | table cells, form labels |
| `text-base` | 16px | 24px | 28px | 0 | body | body copy, inputs |
| `text-lg` | 18px | 28px | 32px | 0 | body | lead paragraph, card title |
| `text-xl` | 20px | 28px | 32px | −0.01em | display | section title |
| `text-2xl` | 25px | 32px | 36px | −0.015em | display | panel/page title |
| `text-3xl` | 31px | 38px | 44px | −0.02em | display | page H1 |
| `text-4xl` | 39px | 46px | 52px | −0.02em | display | dashboard KPI figure |
| `text-5xl` | 49px | 56px | 64px | −0.025em | display | marketing/hero only |

Numerals (work order counts, SAR amounts, SLA timers) use `font-variant-numeric: tabular-nums` everywhere they appear in a table or a KPI so digits don't jitter as they update.

---

## 3. Motion language

Framer Motion is used to add *legibility*, not decoration: it shows what changed, what's interactive, and what's loading — nothing spins or bounces for its own sake. Baseline timing: **120–180ms** for micro-interactions, **200–240ms** for page/panel transitions, all `easeOut` on enter and `easeIn` on exit. Nothing loops except a skeleton shimmer and a spinner, and both are cosmetic, not attention-seeking.

- **Page transitions** — a route's content fades and rises 8px on enter (`opacity 0→1`, `y 8→0`, 200ms easeOut), no exit animation on the old page (avoids the common "old page slides out, layout jumps" jank on slower devices). Implemented once in the root `template.tsx`, not per-page.
- **List stagger on load** — a list/table's first paint staggers children by 30ms, capped at the first ~10 rows (`staggerChildren: 0.03`, `delayChildren: 0.02`); anything beyond that renders immediately, so a 500-row work-order table doesn't make row 500 wait 15 seconds. Re-fetches/re-sorts of already-mounted data never stagger — only first mount.
- **Hover / press** — buttons and clickable cards scale to `0.98` on press (`whileTap`) and lift 1–2px with a one-step shadow increase on hover (`whileHover`), 120–140ms. This is the app's only consistent "this is clickable" signal, so it's applied everywhere something is clickable and nowhere something isn't.
- **Skeletons** — a soft two-stop gradient sweep, 1.4s ease-in-out loop, opacity-only (no layout shift) — used for anything that fetches (tables, cards, KPI tiles). Skeleton shapes always match the real content's shape (a skeleton table row, not a generic gray box), so the stagger-in swap doesn't jump.
- **Modal / Sheet** — desktop dialog scales from 0.98→1 + fades, centered, 180ms; mobile bottom sheet slides up from `y: "100%"`, spring (`stiffness: 380, damping: 32`), and supports drag-to-dismiss (drag past 120px or fast flick down closes it). Backdrop is a plain opacity fade, never blurs (cheap on low-end field devices).
- **Toast** — anchored to the block-end/inline-end corner (logical positioning — inline-end flips automatically under RTL), enters with a vertical fade + rise, 180ms spring, and carries a shrinking progress bar (`scaleX 1→0` linear, mirrored via `rtl:origin-right`) tied to its actual dismiss timer rather than a separate decorative animation.

**`prefers-reduced-motion`**: the whole app is wrapped once in Framer Motion's `<MotionConfig reducedMotion="user">` (`src/components/providers/theme-provider.tsx`), so every `motion.*` component in the kit automatically drops transform-based animation (`y`, `scale`, `x`) down to an instant, opacity-only crossfade when the OS setting is on — no per-component opt-in required. The one animation outside Framer Motion's reach, the CSS skeleton shimmer, has its own `@media (prefers-reduced-motion: reduce)` rule in `globals.css` that swaps the moving gradient for a static opacity pulse. Sheet drag-to-dismiss is left enabled either way — it's direct manipulation driven by the user's own gesture in real time, not automatic motion, so it isn't what reduced-motion guidelines target.

---

## 4. Spacing, radius, elevation, border

**Spacing** uses Tailwind's default 4px grid as-is (no reinvented scale) — `1`=4px … `4`=16px … `8`=32px — with one rule: every tappable control has a minimum 44×44px hit area **wherever the pointer is coarse**. Controls are sized for a mouse (36px — `h-9`) and the `.touch-target` / `.touch-target-square` helpers in `globals.css` restore the 44px box under `@media (pointer: coarse)`. `min-height` outranks the utility+s `height`, so no `!important` is needed. Enforced in the component kit, not left to page authors.

**Radius** is softened but still short of the generic-dashboard tell, which is 16–24px radii on *everything*. Controls sit at 12px — round enough to feel current, tight enough on a 36px-tall button that the ends do not go pill-shaped:

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 8px | Badges, chips, small pills |
| `--radius-md` | 12px | Inputs, buttons, cards, dropdowns, table container |
| `--radius-lg` | 18px | Modal, bottom sheet (top corners only) |
| `--radius-full` | 9999px | Avatars, status dots, pill badges |

**Elevation** is used sparingly and only to indicate *layering* (something floats above the page: modal, popover, dropdown, sticky toolbar), never to decorate a card at rest. Cards at rest use a 1px `border`, not a shadow — another deliberate break from the "every card has a soft drop shadow" default. Shadows are tinted with `ink`, never pure black, so they don't look like generic CSS defaults.

| Token | Value (light) |
|---|---|
| `--shadow-sm` | `0 1px 2px rgb(14 25 23 / 0.06)` |
| `--shadow-md` | `0 4px 12px rgb(14 25 23 / 0.10)` |
| `--shadow-lg` | `0 12px 32px rgb(14 25 23 / 0.16)` |

Dark theme reuses the same shadow tokens at slightly higher opacity (shadows read weaker on dark grounds) — `0.24 / 0.32 / 0.40` — defined as a separate set under the dark selector.

**Border** — 1px hairline (`--border`) at rest everywhere; `--border-strong` (roughly double the contrast) for inputs and anything that needs to read as an edit target; a 2px `--focus-ring` (brass) with a 2px offset for keyboard focus, never relying on color alone (the offset+ring shape is visible on top of any surface/theme).

---

## 5. RTL / bilingual behavior

- `<html dir>` flips between `ltr`/`rtl` based on the active locale (`en`/`ar`) — set at the root, not per-component.
- All component spacing/positioning uses Tailwind's logical utilities (`ms-*`/`me-*`, `ps-*/pe-*`, `text-start`/`text-end`, `start-*`/`end-*`) instead of `ml-*`/`mr-*`/`left-*`/`right-*`, so the entire kit mirrors automatically — verified in `/style-guide` by toggling direction live.
- Tailwind's built-in `rtl:`/`ltr:` variants (keyed off the ancestor `dir` attribute) are used only for the rare case a logical utility doesn't exist (e.g. flipping a chevron icon).
- Numerals, SAR currency, and dates stay LTR-embedded inside RTL text (`unicode-bidi: isolate` on those spans, via the `.numeric-isolate` utility) so `1,204.50 SAR` never reorders inside an Arabic sentence.
- Any other Latin code-like fragment shown inside RTL prose (a var name, an ID, a slug) needs the same treatment — the `.bidi-isolate` utility — or the bidi algorithm can drag leading punctuation (e.g. the `--` in a CSS variable name) to the visual end of the string.

---

## 6. Implementation map

| Concern | File |
|---|---|
| Design tokens (CSS vars, light/dark, Tailwind `@theme` wiring) | `src/app/globals.css` |
| Self-hosted fonts | `src/lib/fonts.ts` |
| Class-merge helper | `src/lib/cn.ts` |
| Theme (light/dark) + locale (en/ar, dir) state, global `MotionConfig` | `src/components/providers/theme-provider.tsx` |
| Component kit | `src/components/ui/*` |
| Live review surface | `src/app/style-guide/page.tsx` |

## 7. Full token reference

See the `@theme` block and `:root` / `[data-theme="dark"]` selectors in `src/app/globals.css` for the generated Tailwind color scale (`petrol-50…900`, `brass-50…900`, `rust-50…900`, `moss-50…900`, `stone-50…900`, `mist-50…900`) built from the seven core hex values in §1.
