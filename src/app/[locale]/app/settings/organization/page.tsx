import { getTranslations } from "next-intl/server";

import { requireRole } from "@/lib/auth/guard";
import { getOrganization } from "@/lib/master-data/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "../../_components/page-heading";
import { OrganizationForm } from "./organization-form";

/**
 * The tenant's own profile.
 *
 * ADMIN and FM_MANAGER only. `/app/settings` already carries that rule in
 * `ROUTE_ACCESS`, so the middleware refuses everyone else before this renders —
 * and `requireRole` refuses them again here, because middleware guards
 * navigation and this guards data.
 *
 * There is no create and no delete. Provisioning an organization happens before
 * anyone belongs to it (`ensureOrganization`), and a tenant deleting itself
 * would lock out every one of its own users in one click.
 */
export default async function OrganizationSettingsPage() {
  await requireRole("ADMIN", "FM_MANAGER");

  const t = await getTranslations("masterData.organization");
  const organization = await getOrganization();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading title={t("title")} subtitle={t("subtitle")} />

      {organization ? (
        <OrganizationForm organization={organization} />
      ) : (
        // Only reachable if the session points at an organization that has been
        // removed underneath it. Generic on purpose — the id stays in the log.
        <EmptyState title={t("missing")} />
      )}
    </div>
  );
}
