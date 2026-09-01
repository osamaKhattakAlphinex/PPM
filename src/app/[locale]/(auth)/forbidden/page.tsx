import Link from "next/link";
import { ShieldOff } from "lucide-react";

import { LOGIN_PATH, landingPathForRole } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/guard";
import { DEFAULT_LOCALE, isLocale, localeHref } from "@/lib/i18n/config";
import { Button } from "@/components/ui/button";

/**
 * Rendered in place by the middleware, with a 403, when a signed-in user asks
 * for an area their role does not cover. It is a rewrite rather than a
 * redirect, so the address bar still shows what they asked for.
 *
 * It deliberately says nothing about what lives at that path.
 */
export default async function ForbiddenPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale: rawLocale }, user] = await Promise.all([params, getCurrentUser()]);
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-6 flex size-12 items-center justify-center rounded-sm border border-border-strong bg-surface-sunken">
          <ShieldOff className="size-5 text-danger" aria-hidden />
        </span>

        <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">
          403 — no access
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-foreground">
          This area is not yours to open
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your account is signed in{user ? ` as ${user.role.replace("_", " ").toLowerCase()}` : ""},
          but that role does not cover this page. If you think it should, ask an administrator in
          your organization to review your access.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href={localeHref(user ? landingPathForRole(user.role) : LOGIN_PATH, locale)}>
            <Button variant="primary">{user ? "Back to your workspace" : "Sign in"}</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
