import { requireRole } from "@/lib/auth/guard";
import { hasAnthropicKey } from "@/lib/env";
import { InsightsPanel } from "./insights-panel";

/**
 * AI Insights.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts` — and it
 * is the same one the route handler enforces, which is the check that actually
 * matters, since the route is reachable by POSTing to it directly.
 *
 * Management only. Three reasons, none of them arbitrary: the call costs money
 * on every press, the output is an opinion about how well the provider is
 * running its own contracts, and a client-scoped session would produce an
 * analysis of one customer's equipment that reads as a report card on their
 * provider.
 *
 * `hasAnthropicKey()` returns a BOOLEAN and crosses to the client as one. A
 * helper that returned the key would be one careless import away from the
 * browser bundle; this one cannot leak anything, because there is nothing in it
 * to leak.
 */
export default async function AiInsightsPage() {
  await requireRole("ADMIN", "FM_MANAGER");

  return <InsightsPanel isConfigured={hasAnthropicKey()} />;
}
