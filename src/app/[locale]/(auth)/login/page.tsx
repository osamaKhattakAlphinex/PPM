import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { landingPathForRole } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/guard";
import { safeRedirectPath } from "@/lib/auth/schemas";
import { DEFAULT_LOCALE, isLocale, localeHref } from "@/lib/i18n/config";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · PPM Platform",
  // The authenticated app is noindex (set in the root layout); the sign-in door
  // to it should not be indexed either.
  robots: { index: false, follow: false },
};

/**
 * Two panels: an identity plate and the form.
 *
 * The plate is petrol with a brass rule and a hairline grid — a valve-tag
 * reference from DESIGN.md §1, not a gradient. It collapses on mobile, where a
 * technician signing in on a phone in the sun needs the form above the fold and
 * nothing else.
 */
export default async function LoginPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: rawLocale } = await routeParams;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  const user = await getCurrentUser();
  if (user) redirect(localeHref(landingPathForRole(user.role), locale));

  const params = await searchParams;
  const requested = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;
  // Checked here as well as in the action: this value ends up in a hidden field
  // that is posted straight back to us.
  const callbackUrl = safeRedirectPath(requested, "");

  // Auth.js redirects a failed direct POST to `pages.error`, which is this
  // page. The code it appends is not shown: it distinguishes cases the visitor
  // is not entitled to distinguish.
  const hasError = typeof params.error === "string" && params.error.length > 0;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section
        aria-hidden
        className="relative hidden overflow-hidden bg-petrol-800 lg:block"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.05) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      >
        <div className="flex h-full flex-col justify-between p-10">
          <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-brass-300">
            PPM Platform
          </p>

          <div className="max-w-md">
            <div className="mb-6 h-0.5 w-16 bg-brass-400" />
            <p className="font-display text-3xl font-semibold leading-tight text-stone-100">
              Planned maintenance, work orders and compliance — for every asset
              you look after.
            </p>
            <p className="mt-4 text-sm text-petrol-200">
              الصيانة الوقائية وأوامر العمل والامتثال
            </p>
          </div>

          <p className="text-xs text-petrol-200">
            Riyadh · Jeddah · Dammam &nbsp;—&nbsp; SAR
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-accent-text lg:hidden">
                PPM Platform
              </p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-foreground lg:mt-0">
                Sign in
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Use the work email your administrator set up for you.
              </p>
            </div>
            <ThemeToggle />
          </div>

          <LoginForm
            callbackUrl={callbackUrl || undefined}
            initialError={
              hasError ? "That email and password combination is not valid." : undefined
            }
          />

          <p className="mt-8 border-t border-border pt-5 text-xs text-muted-foreground">
            Accounts are created by your organization&rsquo;s administrator. If you cannot
            sign in, contact them to have your access checked.
          </p>
        </div>
      </section>
    </main>
  );
}
