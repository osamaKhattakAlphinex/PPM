import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { staticSecurityHeaders } from "./src/lib/security/headers";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  /**
   * Next sends `X-Powered-By: Next.js` by default. It tells an attacker which
   * framework to look up advisories for and tells a visitor nothing, so it is
   * off. Free, and one fewer thing to notice in a scan report.
   */
  poweredByHeader: false,

  /**
   * A self-contained server bundle in `.next/standalone`, for the container
   * deployment described in `docs/DEPLOYMENT.md`.
   *
   * OPT-IN rather than always on, because `next start` refuses to serve a
   * standalone build — it prints a warning and the app is then only runnable
   * through `node .next/standalone/server.js`. Breaking the stock `pnpm start`
   * for every developer, and for the Lighthouse run in `docs/SEO.md`, is a poor
   * trade for a smaller image nobody asked for on that machine. A container
   * build sets `NEXT_OUTPUT=standalone` and gets it.
   */
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  /**
   * `@node-rs/argon2` is a native addon (a `.node` binary). Bundling it breaks
   * the require path, so it stays external and is loaded from node_modules at
   * runtime.
   */
  serverExternalPackages: ["@node-rs/argon2", "mongoose"],

  /**
   * The half of the security headers that never varies by request.
   *
   * The Content-Security-Policy is NOT here: it carries a per-request nonce,
   * so it is built in `src/middleware.ts`. Everything below is constant, and
   * living here means it is attached even to responses the middleware's
   * matcher skips — static assets, `/api/auth/*`.
   *
   * See `src/lib/security/headers.ts` for what each one is for, and why HSTS
   * only appears in a production build.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...staticSecurityHeaders()],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
