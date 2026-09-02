"use client";

import { useTranslations } from "next-intl";

import { Brand } from "./brand";
import { NavList } from "./nav-list";
import type { ShellModule } from "./types";

/**
 * The desktop sidebar. Hidden below `lg`, where the drawer and the bottom bar
 * take over — see `mobile-drawer.tsx` and `bottom-tabs.tsx`.
 *
 * `bg-surface-sunken` with a hairline `border-e`, not a dark slab. A navy
 * sidebar is the single clearest tell of a generic dashboard (DESIGN.md §1),
 * and a permanently dark rail next to a light content area also forces the eye
 * to re-adapt on every glance between the two.
 */
export function Sidebar({
  modules,
  activeKey,
  homeHref,
}: {
  modules: readonly ShellModule[];
  activeKey: string | null;
  homeHref: string;
}) {
  const t = useTranslations("shell");
  const nav = useTranslations("nav");

  return (
    <aside
      // `border-e` is the inline-end edge: the right in English, the left in
      // Arabic. The whole rail mirrors with no rtl: variant anywhere.
      //
      // `sticky top-0` with an explicit `h-dvh` pins the rail to the viewport:
      // the page scrolls behind it and the nav stays put. The height has to be
      // stated — a flex item stretched by `align-items: stretch` has no
      // resolved height of its own, and `position: sticky` on a box as tall as
      // the whole document has nothing left to stick within. The internal
      // `overflow-y-auto` on the nav then scrolls the module list on a short
      // screen instead of clipping it.
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-border bg-surface-sunken lg:flex"
    >
      <div className="px-3 py-4">
        <Brand href={homeHref} />
      </div>

      <nav aria-label={t("primaryNavigation")} className="flex-1 overflow-y-auto px-2.5 pb-4">
        <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-mist-500">
          {nav("sectionLabel")}
        </p>
        <NavList modules={modules} activeKey={activeKey} layoutIdPrefix="sidebar" />
      </nav>

      {/*
        A quiet footer rule. It exists so the nav column has a visible end —
        without it the last item floats in an ambiguous amount of space, which
        reads as an unfinished list rather than a complete one.
      */}
      <div className="border-t border-border px-5 py-3">
        <p className="text-[11px] leading-relaxed text-mist-500">
          <span className="numeric-isolate">SAR</span> · Riyadh
        </p>
      </div>
    </aside>
  );
}
