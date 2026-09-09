import { requireRole } from "@/lib/auth/guard";
import { loadMyJobs, MY_JOBS_ROLES } from "@/lib/technician-view/queries";
import { MyJobsView } from "./my-jobs-view";

/**
 * The technician's own screen.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts`.
 *
 * TECHNICIAN only, and that is narrower than any other module in the app. "My
 * jobs" is defined by the session: `loadMyJobs` resolves a technician record by
 * the signed-in user's own id and filters both lists by it, so there is no
 * parameter anywhere on this route by which one technician could ask for
 * another's day. A supervisor's version of this question is the attendance
 * board and the PPM calendar — different screens, different reads.
 *
 * It is also where a technician LANDS after signing in (see
 * `landingPathForRole`), because they sign in on a phone, at a site, to find
 * out what they are doing.
 */
export default async function MyJobsPage() {
  await requireRole(...MY_JOBS_ROLES);

  const data = await loadMyJobs();

  return <MyJobsView initial={data} />;
}
