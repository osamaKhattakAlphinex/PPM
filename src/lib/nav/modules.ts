import type { Role } from "../auth/roles";

/**
 * The eleven modules, and who may see each one.
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
  "assets",
  "preventive",
  "corrective",
  "checklists",
  "amc",
  "reports",
  "approvals",
  "invoicing",
  "technicians",
  "aiInsights",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULES: readonly ModuleDefinition[] = [
  {
    key: "dashboard",
    href: "/app",
    roles: EVERYONE,
    primary: true,
    clientHref: "/app/portal",
    exact: true,
  },
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
  { key: "aiInsights", href: "/app/ai-insights", roles: MANAGEMENT },
] as const;

/** The href this role should use for this module. */
export function moduleHref(module: ModuleDefinition, role: Role): string {
  return role === "CLIENT" && module.clientHref ? module.clientHref : module.href;
}

/** Every module this role may open, in table order. */
export function modulesForRole(role: Role): ModuleDefinition[] {
  return MODULES.filter((module) => module.roles.includes(role));
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

  for (const module of modulesForRole(role)) {
    const href = moduleHref(module, role);
    const matches =
      pathname === href || (!module.exact && pathname.startsWith(`${href}/`));
    if (!matches) continue;
    if (!best || href.length > best.length) best = { key: module.key, length: href.length };
  }

  return best?.key ?? null;
}
