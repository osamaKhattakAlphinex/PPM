import Link from "next/link";

import { logoutAction } from "@/lib/auth/actions";
import type { SessionUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * PLACEHOLDER — the dashboard is a later prompt.
 *
 * All this does is show what the session actually carries, which is the thing
 * worth seeing right now: the four claims `getScope()` reads before it will
 * build a single query.
 */
export function SessionSummary({
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
  const claims: ReadonlyArray<[string, string]> = [
    ["userId", user.id],
    ["role", user.role],
    ["organizationId", user.organizationId],
    ["clientId", clientId ?? "— (staff session: whole organization)"],
  ];

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">
            PPM Platform
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">{title}</h1>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-5 text-sm text-muted-foreground">{note}</p>

          <dl className="grid gap-3">
            {claims.map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <dt className="w-40 shrink-0 text-sm font-medium text-muted-foreground">{label}</dt>
                <dd className="bidi-isolate font-mono text-sm text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="accent">{user.name ?? "unnamed"}</Badge>
            <Badge variant="neutral">{user.email ?? "no email"}</Badge>
          </div>
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        Try{" "}
        <Link href="/app/admin" className="text-accent-text underline underline-offset-4">
          /app/admin
        </Link>{" "}
        with a non-admin session: the middleware answers 403 before this page renders.
      </p>
    </main>
  );
}
