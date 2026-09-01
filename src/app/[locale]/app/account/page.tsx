import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/lib/auth/guard";
import { SessionSummary } from "../session-summary";

/**
 * PLACEHOLDER — account settings are a later prompt. It exists now because the
 * user menu links here for every role, and a nav item that 404s is worse than
 * one that says "not yet".
 */
export default async function AccountPage() {
  const { user, scope } = await requireAuth();
  const t = await getTranslations("userMenu");

  return (
    <SessionSummary
      title={t("account")}
      note="Profile, password and notification preferences will live here. For now it shows the same session claims the dashboard does."
      user={user}
      clientId={scope.clientId?.toHexString() ?? null}
    />
  );
}
