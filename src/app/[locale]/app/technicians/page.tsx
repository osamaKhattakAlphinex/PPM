import { requireRole } from "@/lib/auth/guard";
import { ModulePlaceholder } from "../_components/module-placeholder";

/**
 * PLACEHOLDER — this module is a later prompt.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, requireRole()
 * protects data. The role list is the one in src/lib/nav/modules.ts, which is
 * also what built this module's sidebar entry and its route rule.
 */
export default async function Page() {
  await requireRole("ADMIN", "FM_MANAGER", "SUPERVISOR");
  return <ModulePlaceholder moduleKey="technicians" />;
}