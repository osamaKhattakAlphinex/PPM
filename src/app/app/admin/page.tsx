import { requireRole } from "@/lib/auth/guard";
import { SessionSummary } from "../session-summary";

/**
 * PLACEHOLDER — administration is a later prompt. It exists now as the second
 * half of the middleware demonstration: any signed-in staff role can reach
 * /app, only ADMIN can reach this.
 */
export default async function AdminPage() {
  const { user } = await requireRole("ADMIN");

  return (
    <SessionSummary
      title="Administration"
      note="Reachable by ADMIN only. Every other role is refused by the middleware before this component runs, and again by requireRole() if it were called directly."
      user={user}
      clientId={null}
    />
  );
}
