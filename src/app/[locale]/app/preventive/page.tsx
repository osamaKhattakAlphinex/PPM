import { listAssets } from "@/lib/assets/queries";
import { requireRole } from "@/lib/auth/guard";
import { listTechnicians } from "@/lib/technicians/queries";
import {
  canExecutePpm,
  canManagePpm,
  listPpmSchedules,
  summarisePpmSchedules,
  PPM_READERS,
} from "@/lib/preventive/queries";
import { PreventiveManager, type PickerOption } from "./preventive-manager";

/**
 * The preventive-maintenance schedule.
 *
 * The guard repeats the policy the middleware applied on the way in, and that
 * repetition is the point: middleware protects navigation, `requireRole()`
 * protects data. The role list is the one in `src/lib/nav/modules.ts`, which is
 * also what built this module's sidebar entry and its route rule.
 *
 * There is no `if (role === "CLIENT")` anywhere below, because there is no such
 * session here to handle: `PpmSchedule` has no `clientId`, so the data-access
 * layer refuses a client-scoped session rather than widening it, and the module
 * table keeps the route to STAFF for the same reason. A customer does not get to
 * read its provider's whole maintenance plan.
 */
export default async function PreventivePage() {
  const { user } = await requireRole(...PPM_READERS);
  const canManage = canManagePpm(user.role);

  const [page, summary, pickers] = await Promise.all([
    listPpmSchedules(),
    summarisePpmSchedules(),
    canManage ? loadPickerOptions() : Promise.resolve(EMPTY_PICKERS),
  ]);

  return (
    <PreventiveManager
      initialPage={page}
      initialSummary={summary}
      canManage={canManage}
      canExecute={canExecutePpm(user.role)}
      assetOptions={pickers.assets}
      technicianOptions={pickers.technicians}
    />
  );
}

interface PickerOptions {
  assets: PickerOption[];
  technicians: PickerOption[];
}

const EMPTY_PICKERS: PickerOptions = { assets: [], technicians: [] };

/**
 * The two pickers on the create sheet — loaded ONLY for a session that may plan.
 *
 * The condition is not an optimisation, it is a correctness requirement.
 * `listTechnicians()` is gated on `TECHNICIAN_READERS`, which deliberately
 * excludes the TECHNICIAN role — a technician may not enumerate the workforce
 * directory — so calling it unconditionally would throw an authorization error
 * for exactly the people this screen exists to serve. They cannot create a
 * schedule either, so there is nothing for them to pick from.
 *
 * The assignee's NAME still appears on every row for every reader; that comes
 * from a much narrower read in `listPpmSchedulesForScope`, over ids that were
 * already in a scoped result.
 *
 * Both are capped at the DAL's maximum page size. That is a real limit, not a
 * rounding: a tenant with more than 100 assets needs a typeahead here rather
 * than a `<select>`, and that is a later prompt. The cap fails visibly (an asset
 * missing from the list) rather than silently returning an unbounded query.
 */
async function loadPickerOptions(): Promise<PickerOptions> {
  const [assets, technicians] = await Promise.all([
    listAssets({ pageSize: 100, status: "ACTIVE" }),
    // ON_LEAVE people are excluded as well as INACTIVE ones: assigning next
    // Tuesday's service to someone who is away until the 14th is the mistake
    // the technician status field exists to prevent.
    listTechnicians({ pageSize: 100, status: "ACTIVE" }),
  ]);

  return {
    assets: assets.items.map((asset) => ({ id: asset.id, name: asset.name })),
    technicians: technicians.items.map((person) => ({ id: person.id, name: person.name })),
  };
}
