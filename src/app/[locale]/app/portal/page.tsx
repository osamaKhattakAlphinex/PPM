import { getTranslations } from "next-intl/server";

import { requireRole } from "@/lib/auth/guard";
import { SessionSummary } from "../session-summary";

/**
 * PLACEHOLDER — the client portal is a later prompt. It exists now so a CLIENT
 * user has somewhere to land, and so the role split is demonstrable end to end:
 * the same shell renders a shorter sidebar for this session.
 */
export default async function PortalPage() {
  const { user, scope } = await requireRole("CLIENT");
  const t = await getTranslations("dashboard");

  return (
    <SessionSummary
      title={t("title")}
      note="A CLIENT session is additionally scoped to one client id — every query the data layer builds carries it."
      user={user}
      clientId={scope.clientId?.toHexString() ?? null}
    />
  );
}
