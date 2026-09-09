import type { Role } from "../auth/roles";

/**
 * The fourteen modules, and who may see each one.
 *
 * This table is the single source of truth for two things that must never
 * disagree: what the sidebar renders, and what the middleware lets through. A
 * nav item the user cannot open is a bug; a route with no nav entry is a
 * feature nobody finds. Deriving `ROUTE_ACCESS` from this list (see
 * `src/lib/auth/access.ts`) makes the two impossible to drift apart.
 *
 * The `roles` here are for *navigation and route entry*. They are not the
 * security boundary — every server action and route handler re-checks with
 * `requireRole()`, and every query is scoped by the DAL regardless. See
 * CLAUDE.md > Data isolation.
 *
 * Pure: no React, no icons, no `next/*`. The Edge middleware imports it.
 */

const STAFF: readonly Role[] = ["ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN"];
const MANAGEMENT: readonly Role[] = ["ADMIN", "FM_MANAGER"];
const EVERYONE: readonly Role[] = ["ADMIN", "FM_MANAGER", "SUPERVISOR", "TECHNICIAN", "CLIENT"];

export interface ModuleDefinition {
  /** Stable id. Doubles as the messages key: `nav.<key>`. */
  readonly key: ModuleKey;
  /** Unprefixed path. The locale is added at render time. */
  readonly href: string;
  readonly roles: readonly Role[];
  /**
   * Shown in the mobile bottom tab bar. Four at most per role — a fifth slot
   * is taken by the drawer trigger, and five 44px targets is already the
   * practical limit on a 360px-wide phone held in one hand.
   */
  readonly primary?: boolean;
  /**
   * Roles for which this module is NOT a bottom-bar destination, even though it
   * is `primary` for everyone else.
   *
   * Exists for exactly one case, and the case is the reason the bar has a limit
   * at all: a technician's home is "My jobs", not the operations dashboard, and
   * with both marked primary a technician would have five tabs in a five-slot
   * bar whose fifth slot belongs to the drawer trigger. Dropping the dashboard
   * for that one role is the honest fix — it is still in their drawer, one tap
   * away, and it was never the screen they open at the start of a shift.
   */
  readonly notPrimaryFor?: readonly Role[];
  /**
   * For CLIENT users this module lives somewhere else. Only "dashboard" uses
   * it: a client's home is their portal, not the operations overview.
   */
  readonly clientHref?: string;
  /**
   * Highlight this item only on its exact path, never on a path below it.
   *
   * The dashboard needs it: its href is `/app`, which is a prefix of every
   * other module, so without this it would light up alongside whatever the
   * user is actually looking at.
   */
  readonly exact?: boolean;
}

export const MODULE_KEYS = [
  "dashboard",
  "myJobs",
  "assets",
  "preventive",
  "corrective",
  "checklists",
  "amc",
  "reports",
  "approvals",
  "invoicing",
  "technicians",
  "clients",
  "locations",
  "aiInsights",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULES: readonly ModuleDefinition[] = [
  {
    key: "dashboard",
    href: "/app",
    roles: EVERYONE,
    primary: true,
    notPrimaryFor: ["TECHNICIAN"],
    clientHref: "/app/portal",
    exact: true,
  },
  /**
   * The technician's own screen: their shift and their jobs, nobody else's.
   *
   * TECHNICIAN only, and the narrowness is the feature. "My jobs" means the
   * signed-in person's jobs — the list is filtered by a technician record
   * resolved from the session — so there is nothing on it for a role that has
   * no technician record. A supervisor's view of the same data is the
   * attendance board and the PPM calendar, which are different screens with
   * different questions.
   *
   * `primary`, because it is the first thing a technician opens on a phone and
   * belongs in the bottom tab bar rather than three taps into a drawer.
   */
  { key: "myJobs", href: "/app/my-jobs", roles: ["TECHNICIAN"], primary: true },
  { key: "assets", href: "/app/assets", roles: EVERYONE, primary: true },
  // Planned maintenance: the schedule technicians work from.
  { key: "preventive", href: "/app/preventive", roles: STAFF, primary: true },
  // Reactive work orders — the one thing a client raises directly.
  { key: "corrective", href: "/app/corrective", roles: EVERYONE, primary: true },
  { key: "checklists", href: "/app/checklists", roles: STAFF },
  // Annual maintenance contracts: commercial, so management and the client
  // whose contract it is. A supervisor schedules work; they do not price it.
  { key: "amc", href: "/app/amc", roles: [...MANAGEMENT, "CLIENT"] },
  { key: "reports", href: "/app/reports", roles: [...MANAGEMENT, "SUPERVISOR", "CLIENT"] },
  { key: "approvals", href: "/app/approvals", roles: [...MANAGEMENT, "SUPERVISOR"] },
  { key: "invoicing", href: "/app/invoicing", roles: [...MANAGEMENT, "CLIENT"] },
  { key: "technicians", href: "/app/technicians", roles: [...MANAGEMENT, "SUPERVISOR"] },
  /**
   * Master data. Both are readable by every staff role — a technician needs to
   * know which site a work order is at — while creating and editing is
   * ADMIN/FM_MANAGER, checked in the actions rather than here.
   *
   * The two differ on CLIENT, and the difference is the whole shape of the
   * tenancy model:
   *
   *  - `clients` is STAFF only. The collection has no `clientId` to narrow by,
   *    so serving a CLIENT session would mean serving it the organization's
   *    entire customer list. A client reaches its own record at `/app/portal`.
   *  - `locations` includes CLIENT, and needs no special case anywhere: the
   *    collection carries a `clientId`, so the data-access layer narrows a
   *    client-scoped session to its own sites before the query runs.
   */
  { key: "clients", href: "/app/clients", roles: STAFF },
  { key: "locations", href: "/app/locations", roles: EVERYONE },
  { key: "aiInsights", href: "/app/ai-insights", roles: MANAGEMENT },
] as const;

/**
 * The href this role should use for this module.
 *
 * The parameter is `entry` rather than the obvious `module`: `module` is a
 * reserved binding in a CommonJS scope, and `@next/next/no-assign-module-variable`
 * rejects it — an ESLint *error*, which fails `next build`.
 */
export function moduleHref(entry: ModuleDefinition, role: Role): string {
  return role === "CLIENT" && entry.clientHref ? entry.clientHref : entry.href;
}

/**
 * Is this module a bottom-bar destination for this role?
 *
 * The shell and the test that guards the four-tab limit both read THIS rather
 * than `entry.primary`, so the per-role exception cannot be honoured in one
 * place and forgotten in the other.
 */
export function isPrimaryFor(entry: ModuleDefinition, role: Role): boolean {
  if (!entry.primary) return false;
  return !entry.notPrimaryFor?.includes(role);
}

/** Every module this role may open, in table order. */
export function modulesForRole(role: Role): ModuleDefinition[] {
  return MODULES.filter((entry) => entry.roles.includes(role));
}

/**
 * The item whose section the user is currently in.
 *
 * Longest matching href wins, so `/app/assets/6512…` highlights Assets and not
 * some shallower entry. Two details that are easy to get wrong:
 *
 *  - a match is the href itself or a path under `href + "/"`, never a plain
 *    string prefix — otherwise `/app/assets-archive` would highlight Assets;
 *  - `exact` modules match only themselves, which is what keeps the dashboard
 *    at `/app` from matching every path in the app.
 *
 * Compare against an UNPREFIXED path (see `stripLocale`).
 */
export function activeModuleKey(pathname: string, role: Role): ModuleKey | null {
  let best: { key: ModuleKey; length: number } | null = null;

  for (const entry of modulesForRole(role)) {
    const href = moduleHref(entry, role);
    const matches = pathname === href || (!entry.exact && pathname.startsWith(`${href}/`));
    if (!matches) continue;
    if (!best || href.length > best.length) best = { key: entry.key, length: href.length };
  }

  return best?.key ?? null;
}
