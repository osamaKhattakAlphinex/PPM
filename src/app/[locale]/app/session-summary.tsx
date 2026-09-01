import { getTranslations } from "next-intl/server";

import type { SessionUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * PLACEHOLDER — the dashboard is a later prompt.
 *
 * All this does is show what the session actually carries, which is the thing
 * worth seeing right now: the four claims `getScope()` reads before it will
 * build a single query.
 *
 * The page chrome it used to draw — the wordmark, the heading block, the sign
 * out button — is gone: all three now belong to the shell.
 */
export async function SessionSummary({
  title,
  note,
  user,
  clientId,
}: {
  title: string;
  note: string;
  user: SessionUser;
  clientId: string | null;
}) {
  const roleLabel = await getTranslations("roles");

  const claims: ReadonlyArray<[string, string]> = [
    ["userId", user.id],
    ["role", user.role],
    ["organizationId", user.organizationId],
    ["clientId", clientId ?? "— (staff session: whole organization)"],
  ];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6">
        <h2 className="font-display text-3xl font-semibold text-foreground">{title}</h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">{note}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3">
            {claims.map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <dt className="bidi-isolate w-40 shrink-0 text-sm font-medium text-muted-foreground">
                  {label}
                </dt>
                <dd className="bidi-isolate font-mono text-sm text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="accent">{user.name ?? "unnamed"}</Badge>
            <Badge variant="neutral">{roleLabel(user.role)}</Badge>
            <Badge variant="neutral" className="bidi-isolate">
              {user.email ?? "no email"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
