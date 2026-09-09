import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { loadAccountProfile } from "@/lib/account/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeading } from "../_components/page-heading";
import { ProfileForm, PasswordForm } from "./account-forms";

export const metadata: Metadata = { title: "Account" };

/**
 * A person's own account.
 *
 * Reachable by every signed-in role — `/app/account` grants all five in
 * `ROUTE_ACCESS` — because there is no role that should be unable to correct
 * their own name or change their own password.
 *
 * The identity panel is read-only and deliberately so: role, tenant and client
 * are decided by an administrator in `src/lib/admin/`, and a self-service
 * screen that could change them would be a privilege-escalation endpoint with
 * a friendly name. They are SHOWN rather than hidden because "which company am
 * I signed in to, and as what" is the question this page exists to answer.
 */
export default async function AccountPage() {
  const profile = await loadAccountProfile();

  const t = await getTranslations("account");
  const tr = await getTranslations("roles");
  const format = await getFormatter();

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeading title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("identity.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("identity.role")}
              </dt>
              <dd>
                <Badge variant="primary">{tr(profile.role)}</Badge>
              </dd>
            </div>

            <div className="grid gap-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("identity.organization")}
              </dt>
              <dd className="text-sm text-foreground">
                {profile.organizationName ?? "—"}
              </dd>
            </div>

            {/* Only a CLIENT user has one, so staff see no empty row. */}
            {profile.clientName ? (
              <div className="grid gap-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("identity.client")}
                </dt>
                <dd className="text-sm text-foreground">
                  {profile.clientName}
                </dd>
              </div>
            ) : null}

            <div className="grid gap-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("identity.lastLogin")}
              </dt>
              <dd className="text-sm text-foreground">
                {profile.lastLoginAt
                  ? format.dateTime(new Date(profile.lastLoginAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : t("identity.never")}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <ProfileForm profile={profile} />
      <PasswordForm />
    </div>
  );
}
