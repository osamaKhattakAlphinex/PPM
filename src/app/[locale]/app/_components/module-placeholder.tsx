import { getTranslations } from "next-intl/server";

import type { ModuleKey } from "@/lib/nav/modules";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Stands in for a module that is a later prompt.
 *
 * It exists so the shell has eleven real destinations to navigate between —
 * an active state, a page title and a transition are not demonstrable against
 * a route that 404s. Every one of these files is expected to be replaced
 * wholesale by its module.
 */
export async function ModulePlaceholder({ moduleKey }: { moduleKey: ModuleKey }) {
  const t = await getTranslations("modulePlaceholder");
  const nav = await getTranslations("nav");

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-3xl font-semibold text-foreground">{nav(moduleKey)}</h2>
        <Badge variant="warning" dot>
          {t("badge")}
        </Badge>
      </div>

      <Card>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("body")}</p>
          <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
            {t("scopeNote")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
