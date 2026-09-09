import type { Metadata } from "next";
import type { ReactNode } from "react";

import { requireAuth } from "@/lib/auth/guard";
import { landingPathForRole } from "@/lib/auth/access";
import { isPrimaryFor, moduleHref, modulesForRole } from "@/lib/nav/modules";
import { loadFeed } from "@/lib/notifications/queries";
import { AppShell } from "@/components/shell/app-shell";
import type { ShellModule } from "@/components/shell/types";

/**
 * The authenticated shell.
 *
 * `noindex, nofollow`, asserted here as well as in the locale layout above it.
 * The repetition is deliberate: the moment a public marketing page overrides
 * the parent's robots metadata, `/app` would silently inherit that override.
 * Stating it on the segment that must never be indexed removes that
 * dependency, and `nocache`/`noarchive` also keep a signed-in page out of a
 * search engine's cached copy.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  /**
   * The middleware already refused an anonymous request before this rendered.
   * This call is not a duplicate of that check — it is the one that matters:
   * middleware guards navigation, and this is what guards data. It is also
   * where the role comes from, and the nav is built from the role.
   */
  const { user } = await requireAuth();

  /**
   * Filtered on the SERVER. A client-side filter would ship the full module
   * table to every browser, which tells a technician exactly which modules
   * exist above them — small, but it is information they were not given, and
   * there is no reason to send it.
   */
  const modules: ShellModule[] = modulesForRole(user.role).map((module) => ({
    key: module.key,
    href: moduleHref(module, user.role),
    // Per-role, not per-module: a technician's bottom bar leads with "My jobs"
    // and drops the dashboard, which would otherwise be a fifth tab in a
    // four-tab bar. See `isPrimaryFor`.
    primary: isPrimaryFor(module, user.role),
  }));

  /**
   * The bell's first page, read on the server so the unread badge is correct on
   * first paint.
   *
   * Failures are swallowed to `undefined` rather than propagated, and that is a
   * deliberate resilience decision: this is the SHELL, wrapping every screen in
   * the product, and a notification query that fails must not take the whole
   * app down with it. The bell simply does not render.
   */
  const notifications = await loadFeed().catch((error: unknown) => {
    console.error("[shell] notification feed failed", error);
    return undefined;
  });

  return (
    <AppShell
      modules={modules}
      notifications={notifications}
      homeHref={landingPathForRole(user.role)}
      user={{
        name: user.name ?? user.email ?? "—",
        email: user.email ?? "",
        role: user.role,
      }}
    >
      {children}
    </AppShell>
  );
}
