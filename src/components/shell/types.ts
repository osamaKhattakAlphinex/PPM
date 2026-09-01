import type { ModuleKey } from "@/lib/nav/modules";
import type { Role } from "@/lib/auth/roles";

/**
 * What the server layout hands the client shell.
 *
 * Deliberately small. The modules are already filtered to the caller's role
 * and their hrefs already resolved, so the client never re-derives a
 * permission — it renders a list it was given. And the user object carries a
 * display name, an email and a role, not the session: `organizationId` and
 * `clientId` are scoping keys, and scoping keys have no business being
 * serialised into a page where a browser extension can read them.
 */

export interface ShellModule {
  readonly key: ModuleKey;
  /** Unprefixed. The locale is added at render time by `localeHref`. */
  readonly href: string;
  readonly primary: boolean;
}

export interface ShellUser {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}
