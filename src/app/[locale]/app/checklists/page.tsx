import { requireRole } from "@/lib/auth/guard";
import {
  CHECKLIST_READERS,
  canManageChecklists,
  canRunChecklists,
  listChecklistRuns,
  listChecklists,
} from "@/lib/checklists/queries";
import { listPpmSchedules } from "@/lib/preventive/queries";
import { listWorkOrders } from "@/lib/corrective/queries";
import { ChecklistsManager } from "./checklists-manager";
import type { JobOption } from "./run-sheet";

/**
 * Checklists — the procedure library and the runs it has produced.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts`, which is
 * also what built this module's sidebar entry and its route rule.
 *
 * There is no CLIENT session to think about here, unlike corrective. Neither
 * `Checklist` nor `ChecklistRun` carries a `clientId`, so the data-access layer
 * refuses a client-scoped session outright rather than widening it to the
 * organization — and `nav/modules.ts` gives the route to STAFF for exactly that
 * reason. The two must agree: a route open to a role whose queries the DAL
 * would refuse is a 500, not a security boundary.
 *
 * The two capabilities below are decided HERE, on the server, and passed down
 * as booleans. Hiding a button only hides an affordance; every action re-checks
 * the role on every call.
 */
export default async function ChecklistsPage() {
  const { user } = await requireRole(...CHECKLIST_READERS);

  const canRun = canRunChecklists(user.role);

  const [checklists, runs, jobs] = await Promise.all([
    listChecklists(),
    listChecklistRuns(),
    loadJobOptions(canRun),
  ]);

  return (
    <ChecklistsManager
      initialChecklists={checklists}
      initialRuns={runs}
      canManage={canManageChecklists(user.role)}
      canRun={canRun}
      ppmOptions={jobs.ppm}
      workOrderOptions={jobs.workOrders}
    />
  );
}

interface JobOptions {
  ppm: JobOption[];
  workOrders: JobOption[];
}

/**
 * The two job pickers, loaded only for a session that can actually attach a
 * checklist to something.
 *
 * Both reads are gated by their own modules' role lists, and both of those
 * lists include every role in `CHECKLIST_READERS` — `PPM_READERS` is the four
 * staff roles exactly, and `WORK_ORDER_READERS` is those four plus CLIENT — so
 * neither can 403 a session that got this far. That is checked here rather than
 * assumed, because it is the kind of agreement that quietly stops holding when
 * a role list is narrowed in another file.
 *
 * The terminal-state filters are correctness, not tidiness. A checklist is
 * evidence of work being done, so it can only be attached to a job that is
 * still open: `requireOpenJobInScope` refuses a COMPLETED visit or a CLOSED
 * work order outright, and offering them here would be showing options that are
 * guaranteed to fail. The filtering is done after the read rather than as a
 * query filter so that both lists come back through the SAME entry points the
 * preventive and corrective screens use — one definition of "a job this session
 * may see", rather than a second one written here.
 *
 * Both are capped at the DAL's maximum page size. That is a real limit, not a
 * rounding: a tenant with more than 100 jobs needs a typeahead here rather than
 * a `<select>`, and that is a later prompt. The cap fails visibly (a job
 * missing from the list) rather than silently returning an unbounded query —
 * and because the terminal states are filtered afterwards, a tenant with many
 * closed tickets will see fewer than 100 options, which is the honest failure
 * of the same limit rather than a separate bug.
 */
async function loadJobOptions(canRun: boolean): Promise<JobOptions> {
  if (!canRun) return { ppm: [], workOrders: [] };

  const [schedules, workOrders] = await Promise.all([
    listPpmSchedules({ pageSize: 100 }),
    listWorkOrders({ pageSize: 100 }),
  ]);

  return {
    /**
     * A visit has no name of its own, so it is labelled by the asset it
     * maintains and the day it is due — which is how a supervisor refers to it
     * out loud. `assetName` is null when the asset has since been deleted; the
     * date alone is still enough to tell two visits apart.
     */
    ppm: schedules.items
      .filter((schedule) => schedule.status !== "COMPLETED")
      .map((schedule) => ({
        id: schedule.id,
        label: `${schedule.assetName ?? "—"} · ${schedule.dueDate.slice(0, 10)}`,
      })),

    /** A work order says what it is in its own words. */
    workOrders: workOrders.items
      .filter((workOrder) => workOrder.status !== "CLOSED")
      .map((workOrder) => ({ id: workOrder.id, label: workOrder.issue })),
  };
}
