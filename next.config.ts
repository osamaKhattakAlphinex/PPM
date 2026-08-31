import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `@node-rs/argon2` is a native addon (a `.node` binary). Bundling it breaks
   * the require path, so it stays external and is loaded from node_modules at
   * runtime.
   */
  serverExternalPackages: ["@node-rs/argon2", "mongoose"],

  /**
   * Baseline security headers.
   *
   * CSP and HSTS are deliberately NOT here yet: a useful CSP for an App Router
   * app needs per-request nonces threaded through the middleware, and HSTS
   * should only be switched on once the production domain is settled and
   * serving HTTPS — turning it on early can lock a domain out of plain HTTP for
   * as long as `max-age`. Both belong in their own pass. What is below is the
   * part that is correct in every environment and costs nothing.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never let a browser sniff a JSON or text response into script.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No framing at all: this app has no embeddable surface, and it is
          // the clickjacking defence that works without a CSP.
          { key: "X-Frame-Options", value: "DENY" },
          // Send the origin cross-site, the full path same-origin. A work-order
          // URL carries ids that have no business in a third party's logs.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing here uses these; deny them rather than inherit a default.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Isolates the browsing context from cross-origin popup references.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
