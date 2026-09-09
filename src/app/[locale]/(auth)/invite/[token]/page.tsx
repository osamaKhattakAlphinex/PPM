import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { findInvitedAccount } from "@/lib/db";
import { DEFAULT_LOCALE, isLocale, localeHref } from "@/lib/i18n/config";
import { hashInviteToken } from "@/lib/signup/tokens";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = {
  title: "Accept your invitation · PPM Platform",
  /**
   * `noindex, nofollow, noarchive`, and this is the one page where it is not
   * boilerplate: the URL CONTAINS the secret. A crawler that indexed it would
   * publish a working password-set link, and an archive would keep it working
   * after the page was gone.
   */
  robots: { index: false, follow: false, noarchive: true, nocache: true },
};

/**
 * Accept an invitation.
 *
 * The page looks the token up so it can greet the person by name and refuse an
 * expired link before showing a form that cannot work. That read authorises
 * nothing: the action re-hashes the token and re-checks the digest and expiry
 * inside its own conditional update, so this page being wrong — or skipped
 * entirely by POSTing straight to the action — changes no outcome.
 *
 * Every failure renders the same panel. An unknown token, an expired one, one
 * already redeemed and a suspended account are genuinely indistinguishable
 * here, which is the only way to be sure the page cannot be used to probe
 * which invitations exist.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = await getTranslations("invite");

  // A token of the wrong shape never reaches the database.
  const invited = /^[0-9a-f]{64}$/.test(token)
    ? await findInvitedAccount(hashInviteToken(token))
    : null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">
              PPM Platform
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">
              {invited ? t("title") : t("invalidTitle")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {invited
                ? t("subtitle", { name: invited.name })
                : t("invalidBody")}
            </p>
          </div>
          <ThemeToggle />
        </div>

        {invited ? (
          <>
            {/*
              The email is shown, not editable. It tells the person which
              account they are about to take over — worth knowing before they
              choose a password — and it comes from the token, so there is
              nothing here for a visitor to change it to.
            */}
            <p className="mb-5 rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-sm text-muted-foreground">
              {t("forAccount")} <span dir="ltr">{invited.email}</span>
            </p>
            <InviteForm token={token} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Link
              href={localeHref("/login", locale)}
              className="font-medium text-accent-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("goToSignIn")}
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
