import type { DefaultSession } from "next-auth";

import type { Role } from "@/lib/auth/roles";

/**
 * Auth.js ships a deliberately minimal `User`/`Session`/`JWT` (name, email,
 * image). This app's session has to carry the tenant identity as well, because
 * `getScope()` reads it on every single query — so the shapes are widened here
 * rather than cast at each call site. `no any` is a project rule; this is how
 * the framework's types are told about our claims instead.
 *
 * Keep these in step with `SessionUser` in `src/lib/auth/session.ts`, which is
 * what the data-access layer validates against.
 */

declare module "next-auth" {
  /** What `authorize()` returns and what the `jwt` callback receives as `user`. */
  interface User {
    role: Role;
    organizationId: string;
    /** Set for CLIENT users only. */
    clientId: string | null;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      organizationId: string;
      clientId: string | null;
    } & DefaultSession["user"];
  }
}

/**
 * `next-auth/jwt` is deliberately NOT augmented here. That module only
 * re-exports `@auth/core/jwt`, so `declare module "next-auth/jwt"` creates a
 * second, unrelated `JWT` interface rather than merging into the real one — the
 * compiler accepts it and the claims stay `unknown` at every call site.
 *
 * The token is parsed with `tokenClaimsSchema` in `src/lib/auth/config.ts`
 * instead, which is the better answer anyway: the JWT is the one input to the
 * session that a caller could have tampered with, so it earns a real check
 * rather than a type assertion.
 */
