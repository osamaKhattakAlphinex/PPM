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
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_HEADER,
  localeHref,
  negotiateLocale,
  splitLocale,
  type Locale,
} from "@/lib/i18n/config";
import { buildRequestSecurityHeaders } from "@/lib/security/headers";

/**
 * The first gate in front of every request. Three jobs, in this order:
 *
 *   1. Locale.   Put a locale in the path if there isn't one, so everything
 *                below (and every page) can assume `/en/...` or `/ar/...`.
 *   2. Access.   Decide whether this session may open this path.
 *   3. Headers.  Stamp the per-request CSP on whatever response results.
 *
 * It runs on the Edge runtime, so it builds its own Auth.js instance from the
 * Edge-safe half of the config — `src/lib/auth/auth.ts` reaches MongoDB and
 * argon2 and would not load here. All this instance does is decrypt the
 * session cookie; it never issues one.
 *
 * What it is NOT: the security boundary. Middleware guards navigation, not
 * data. A server action is reachable by POSTing to the page it lives on, so
 * every action and route handler re-checks with `requireRole()` — see
 * `src/lib/auth/guard.ts` and `src/lib/security/action.ts`. This layer exists
 * so an unauthorised request is cheap to refuse and lands somewhere sensible,
 * not so the ones behind it can relax.
 *
 * Locale routing is hand-written rather than delegated to `next-intl`'s own
 * middleware, and that is deliberate. The CSP nonce has to reach Next through
 * the *request* headers of the response that renders the page, which means
 * this file must be the one constructing that response. Chaining a middleware
 * that builds its own response would break that thread. next-intl still does
 * everything else — message loading, formatting, the client provider — via
 * `src/lib/i18n/request.ts`.
 */

const { auth } = NextAuth(authConfig);

/** A fetch/XHR caller gets JSON; anything that can render HTML gets the page. */
function wantsJson(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

function forbidden(request: NextRequest, locale: Locale): NextResponse {
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
  url.pathname = localeHref(FORBIDDEN_PATH, locale);
  url.search = "";
  return NextResponse.rewrite(url, { status: 403 });
}

function redirectToLogin(request: NextRequest, locale: Locale, bare: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = localeHref(LOGIN_PATH, locale);
  url.search = "";
  // Only the path and query — never an absolute URL, which would let a crafted
  // link bounce the user off-site after a successful sign-in. The locale
  // prefix is kept so they come back in the language they left in.
  url.searchParams.set("callbackUrl", `${localeHref(bare, locale)}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export default auth((request) => {
  const { nonce, contentSecurityPolicy } = buildRequestSecurityHeaders();

  /**
   * The CSP goes on the REQUEST as well as the response. Next.js looks for it
   * there to find the nonce, and stamps that nonce onto every script tag it
   * renders itself — the hydration bootstrap and the flight-data chunks.
   * Without this, `strict-dynamic` would block Next's own scripts and the app
   * would render as static HTML that never hydrates.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  const finish = (response: NextResponse, locale?: Locale): NextResponse => {
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    if (locale && request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
      response.cookies.set(LOCALE_COOKIE, locale, {
        path: "/",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: "lax",
        // Readable by the client: the language switcher writes it too.
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  };

  const forward = (locale?: Locale) =>
    finish(NextResponse.next({ request: { headers: requestHeaders } }), locale);

  const { pathname } = request.nextUrl;

  // --- 1. Locale ------------------------------------------------------------

  const split = splitLocale(pathname);

  if (!split.locale) {
    // No locale in the path. Pick one from the visitor's last choice or their
    // browser, and send them to the same page with the prefix in place — a
    // 307, so a POST that lands here is not silently turned into a GET.
    const locale = negotiateLocale({
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get("accept-language"),
    });

    const url = request.nextUrl.clone();
    url.pathname = localeHref(pathname, locale);
    return finish(NextResponse.redirect(url, 307), locale);
  }

  const locale = split.locale;
  // Every rule below is written against the unprefixed path, so no route
  // policy ever has to know that locales exist.
  const bare = split.pathname;

  // Hand the resolved locale to `src/lib/i18n/request.ts` on the request
  // itself. It has to be readable before the first component renders — see the
  // note in that file for the race this closes.
  requestHeaders.set(LOCALE_HEADER, locale);

  // --- 2. Access ------------------------------------------------------------

  const sessionUser = request.auth?.user;

  // Already signed in and asking for the login page: send them where they
  // belong instead of showing a form that would immediately bounce them.
  if (bare === LOGIN_PATH && sessionUser) {
    const role = roleSchema.safeParse(sessionUser.role);
    if (role.success) {
      const url = request.nextUrl.clone();
      url.pathname = localeHref(landingPathForRole(role.data), locale);
      url.search = "";
      return finish(NextResponse.redirect(url), locale);
    }
  }

  const rule = resolveRouteAccess(bare);
  // Public path: nothing to enforce.
  if (!rule) return forward(locale);

  if (!sessionUser) return finish(redirectToLogin(request, locale, bare), locale);

  // The role comes out of a signed token, but it is still parsed rather than
  // trusted: a token from an older deploy, or one carrying a role that has
  // since been removed, must fail closed instead of matching nothing quietly.
  const role = roleSchema.safeParse(sessionUser.role);
  if (!role.success) return finish(redirectToLogin(request, locale, bare), locale);

  // A CLIENT session without a clientId cannot be narrowed to one customer, so
  // the data layer would refuse it anyway. Refuse it here too, at the door.
  if (role.data === "CLIENT" && !sessionUser.clientId) {
    return finish(forbidden(request, locale), locale);
  }

  if (!rule.roles.includes(role.data)) return finish(forbidden(request, locale), locale);

  return forward(locale);
});

export const config = {
  /**
   * Everything except Next's own assets and the Auth.js endpoints — those must
   * stay reachable while signed out, or signing in would require being signed
   * in, and they must not be given a locale prefix. `/login` is included on
   * purpose so an authenticated visitor gets forwarded off it.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|woff2?)$).*)",
  ],
};
