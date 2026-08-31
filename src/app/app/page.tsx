import { requireRole } from "@/lib/auth/guard";
import { SessionSummary } from "./session-summary";

/**
 * PLACEHOLDER — the staff dashboard is a later prompt.
 *
 * The guard here is the same policy the middleware applied on the way in, and
 * that repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. Only the second one is a security boundary.
 */
export default async function AppHomePage() {
  const { user } = await requireRole("ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN");

  return (
    <SessionSummary
      title="Workspace"
      note="Signed in. The dashboard is not built yet — this page exists to show what the session carries into every scoped query."
      user={user}
      clientId={null}
    />
  );
}
