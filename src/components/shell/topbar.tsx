"use client";

import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";

import { LocaleToggle } from "@/components/ui/locale-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Brand } from "./brand";
import { UserMenu } from "./user-menu";
import type { ShellUser } from "./types";

/**
 * The top bar: the drawer trigger and wordmark on the inline-start side, the
 * three controls on the inline-end side.
 *
 * The wordmark appears here only below `lg` — above it, the sidebar already
 * carries one, and two wordmarks on one screen is a layout that has not
 * decided what it is.
 *
 * There is a menu button here AND a "More" tab in the bottom bar, deliberately
 * opening the same drawer: the header is where a tablet user reaches for it
 * and the bottom bar is where a phone user's thumb already is.
 */
export function Topbar({
  user,
  homeHref,
  onOpenMenu,
  menuButtonRef,
  isMenuOpen,
  title,
}: {
  user: ShellUser;
  homeHref: string;
  onOpenMenu: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  isMenuOpen: boolean;
  /** The active module's name. Desktop only — mobile shows the wordmark. */
  title?: string;
}) {
  const t = useTranslations("shell");

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-3 backdrop-blur-sm sm:px-5">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMenu}
        aria-label={t("openMenu")}
        aria-expanded={isMenuOpen}
        aria-haspopup="dialog"
        className="grid size-11 shrink-0 place-items-center rounded-sm border border-border-strong bg-surface text-foreground transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <Brand href={homeHref} compact className="min-w-0 lg:hidden" />

      {title ? (
        <h1 className="hidden min-w-0 truncate font-display text-lg font-semibold text-foreground lg:block">
          {title}
        </h1>
      ) : null}

      {/* Pushes the controls to the inline-end edge in both directions. */}
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <LocaleToggle />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
