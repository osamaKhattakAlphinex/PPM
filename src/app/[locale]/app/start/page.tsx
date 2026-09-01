import { redirect } from "next/navigation";

import { landingPathForRole } from "@/lib/auth/access";
import { requireAuth } from "@/lib/auth/guard";
import { DEFAULT_LOCALE, isLocale, localeHref } from "@/lib/i18n/config";

/**
 * Post-login dispatcher.
 *
 * The login action cannot know which landing page to aim at — the role is only
 * known once the credentials have been verified, and the session cookie is
 * issued on the redirect itself. So sign-in points here, and here reads the
 * session and forwards. It renders nothing.
 *
 * The locale is carried through from the URL rather than re-negotiated, so a
 * user who signed in on the Arabic page lands on the Arabic dashboard.
 */
export default async function StartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ user }, { locale }] = await Promise.all([requireAuth(), params]);
  redirect(localeHref(landingPathForRole(user.role), isLocale(locale) ? locale : DEFAULT_LOCALE));
}
