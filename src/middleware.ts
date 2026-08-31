import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";

import {
  FORBIDDEN_PATH,
  LOGIN_PATH,
  landingPathForRole,
  resolveRouteAccess,
} from "@/lib/auth/access";
import { authConfig } from "@/lib/auth/config";
import { roleSchema } from "@/lib/auth/roles";

/**
 * The first gate in front of `/app`.
 *
 * It runs on the Edge runtime, so it builds its own Auth.js instance from the
 * Edge-safe half of the config — `src/lib/auth/auth.ts` reaches MongoDB and
 * argon2 and would not load here. All this instance does is decrypt the session
 * cookie; it never issues one.
 *
 * What it decides:
 *
 *   no session            -> 302 to /login, carrying where they were going
 *   session, wrong role   -> 403, rendering /forbidden in place
 *   session, right role   -> through
 *   signed in, at /login  -> 302 to their own landing page
 *
 * What it is NOT: the security boundary. Middleware guards navigation, not
 * data. A server action is reachable by POSTing to the page it lives on, so
 * every action and route handler re-checks with `requireRole()` — see
 * `src/lib/auth/guard.ts`. This layer exists so an unauthorised request is
 * cheap to refuse and lands somewhere sensible, not so the ones behind it can
 * relax.
 */

const { auth } = NextAuth(authConfig);

/** A fetch/XHR caller gets JSON; anything that can render HTML gets the page. */
function wantsJson(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

function forbidden(request: NextRequest): NextResponse {
  if (wantsJson(request)) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "You do not have access to this." } },
      { status: 403 },
    );
  }

  // Rewritten, not redirected: the URL the user asked for stays in the address
  // bar and the status stays 403, so neither a person nor a crawler is told
  // that the page does not exist.
  const url = request.nextUrl.clone();
  url.pathname = FORBIDDEN_PATH;
  url.search = "";
  return NextResponse.rewrite(url, { status: 403 });
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = "";
  // Only the path and query — never an absolute URL, which would let a crafted
  // link bounce the user off-site after a successful sign-in.
  url.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export default auth((request) => {
  const { pathname } = request.nextUrl;
  const sessionUser = request.auth?.user;

  // Already signed in and asking for the login page: send them where they
  // belong instead of showing a form that would immediately bounce them.
  if (pathname === LOGIN_PATH && sessionUser) {
    const role = roleSchema.safeParse(sessionUser.role);
    if (role.success) {
      const url = request.nextUrl.clone();
      url.pathname = landingPathForRole(role.data);
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const rule = resolveRouteAccess(pathname);
  // Public path: nothing to enforce.
  if (!rule) return NextResponse.next();

  if (!sessionUser) return redirectToLogin(request);

  // The role comes out of a signed token, but it is still parsed rather than
  // trusted: a token from an older deploy, or one carrying a role that has
  // since been removed, must fail closed instead of matching nothing quietly.
  const role = roleSchema.safeParse(sessionUser.role);
  if (!role.success) return redirectToLogin(request);

  // A CLIENT session without a clientId cannot be narrowed to one customer, so
  // the data layer would refuse it anyway. Refuse it here too, at the door.
  if (role.data === "CLIENT" && !sessionUser.clientId) return forbidden(request);

  if (!rule.roles.includes(role.data)) return forbidden(request);

  return NextResponse.next();
});

export const config = {
  /**
   * Everything except Next's own assets and the Auth.js endpoints — those must
   * stay reachable while signed out, or signing in would require being signed
   * in. `/login` is included on purpose so an authenticated visitor gets
   * forwarded off it.
   */
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|woff2?)$).*)"],
};
