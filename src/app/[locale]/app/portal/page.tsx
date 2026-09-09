import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { requireRole } from "@/lib/auth/guard";
import { loadPortalKpis } from "@/lib/dashboard/queries";
import { getOwnClient, listLocations } from "@/lib/master-data/queries";
import { localeHref, type Locale } from "@/lib/i18n/config";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "../_components/page-heading";
import { PortalFigures } from "./portal-figures";
import { StatusBadge } from "../_components/status-badge";

/**
 * The client portal home.
 *
 * This page is the visible half of the guarantee the whole tenancy model rests
 * on: **a CLIENT sees its own client record and its own sites, and nothing
 * else.** Neither read filters anything itself —
 *
 *  - `getOwnClient()` is a fixed query keyed on `scope.clientId`. There is no
 *    parameter for an id, so there is nothing to pass a different one to. The
 *    clients repository refuses a client-scoped session outright, which is why
 *    this purpose-built read exists rather than a filtered list.
 *  - `listLocations()` is the same call the staff screen makes. The data-access
 *    layer appends `clientId: scope.clientId` to the filter last, after
 *    anything a caller supplied, so the narrowing cannot be argued away.
 *
 * Both are asserted against a real mongod in
 * `src/lib/db/__tests__/master-data.test.ts`.
 */
export default async function PortalPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  await requireRole("CLIENT");

  const { locale } = await params;
  const t = await getTranslations("masterData");
  const tp = await getTranslations("masterData.portal");
  const tl = await getTranslations("masterData.locations");
  const tc = await getTranslations("masterData.clients");

  const [client, locations, figures] = await Promise.all([
    getOwnClient(),
    // A handful, newest page first. The full list is at /app/locations, which a
    // CLIENT may open — narrowed the same way.
    listLocations({ pageSize: 5 }),
    /**
     * The customer's own figures.
     *
     * A DIFFERENT function from the staff dashboard's, not the same one with a
     * flag, and the difference is the guarantee: `loadPortalKpis` reads only
     * collections a client scope can legally reach. Preventive maintenance is
     * absent entirely — `ppmSchedulesRepository` refuses a client scope, because
     * a PPM plan is the provider's internal schedule — so there is no compliance
     * figure here that could accidentally be widened to the whole organization.
     *
     * Every read inside it goes through the DAL, which appends
     * `clientId: scope.clientId` to the filter last.
     */
    loadPortalKpis(),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeading
        title={client?.name ?? tp("yourAccount")}
        subtitle={tp("scopeNote")}
      />

      <PortalFigures figures={figures} />

      {client && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{tp("yourAccount")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Row label={tc("code")}>
                <code className="text-sm">{client.code}</code>
              </Row>
              <Row label={t("filterStatus")}>
                <StatusBadge status={client.status} />
              </Row>
              <Row label={tc("contactName")}>{client.contactName ?? tc("noContact")}</Row>
              <Row label={tc("contactEmail")}>
                <span className="bidi-isolate">{client.contactEmail ?? tc("noContact")}</span>
              </Row>
              <Row label={tc("contactPhone")}>
                <span className="bidi-isolate">{client.contactPhone ?? tc("noContact")}</span>
              </Row>
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="mb-4 flex-row items-center justify-between gap-4">
          <CardTitle>{tp("yourSites")}</CardTitle>
          {locations.total > 0 && (
            <Badge variant="neutral">{t("resultCount", { total: locations.total })}</Badge>
          )}
        </CardHeader>
        <CardContent>
          {locations.items.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title={tl("empty")}
              description={tl("clientEmptyBody")}
              className="border-0 py-8"
            />
          ) : (
            <ul className="grid gap-3">
              {locations.items.map((location) => (
                <li
                  key={location.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{location.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {[location.building, location.address.district, location.address.city]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <StatusBadge status={location.status} />
                </li>
              ))}
            </ul>
          )}

          {locations.total > locations.items.length && (
            <div className="mt-5 flex justify-end">
              {/* A link, not a Button — `Button` renders a motion.button and has
                  no `asChild`, and a button that navigates loses middle-click,
                  open-in-new-tab and the browser's own affordances. */}
              <Link
                href={localeHref("/app/locations", locale)}
                className="inline-flex h-9 touch-target items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-medium text-foreground transition-colors hover:border-primary hover:bg-surface-sunken hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tl("title")}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}
