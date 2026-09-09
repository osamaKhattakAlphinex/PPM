import { requireRole } from "@/lib/auth/guard";
import { listApprovals, summariseApprovalsForCaller } from "@/lib/approvals/queries";
import { APPROVALS_ROUTE_ROLES } from "@/lib/approvals/route-roles";
import { ApprovalsQueue } from "./approvals-queue";

/**
 * Approvals — the queue, and the two buttons that move it.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts`, which is
 * also what built this module's sidebar entry and its route rule.
 *
 * That list is NARROWER than `APPROVAL_READERS` in `src/lib/approvals/queries.ts`,
 * and the difference is deliberate rather than drift. The queries are open to
 * every role that stands at a desk in the chain, including TECHNICIAN and
 * CLIENT; this ROUTE is management and supervisors, because the other two reach
 * their own approvals from where they already are — a technician from "My jobs",
 * a customer from their portal. Widening the query list without widening the
 * route is the safe direction: a route open to a role whose queries would be
 * refused is a 500, not a boundary.
 *
 * No `params`, no `setRequestLocale`, no `metadata`: the locale is resolved from
 * the request header in `src/lib/i18n/request.ts`, and `noindex` is inherited
 * from the two layouts above this one.
 */
export default async function ApprovalsPage() {
  const { user } = await requireRole(...APPROVALS_ROUTE_ROLES);

  const [page, totals] = await Promise.all([
    listApprovals(),
    summariseApprovalsForCaller(),
  ]);

  return (
    <ApprovalsQueue
      initialPage={page}
      initialTotals={totals}
      isClientSession={user.role === "CLIENT"}
    />
  );
}
