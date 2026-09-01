import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { staticSecurityHeaders } from "./src/lib/security/headers";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
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
