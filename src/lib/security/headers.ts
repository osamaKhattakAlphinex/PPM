/**
 * The response headers every request leaves with.
 *
 * Split in two on purpose:
 *
 *  - the static set (`STATIC_SECURITY_HEADERS`) is identical for every request
 *    and is emitted by `next.config.ts`, so it is attached even to responses
 *    the middleware never sees;
 *  - the CSP is per-request, because it carries a fresh nonce, so it is built
 *    here and attached by `src/middleware.ts`.
 *
 * No `node:*` imports and no `server-only`: this runs on the Edge runtime.
 */

/** A single header, in the shape `next.config.ts` wants. */
export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}

/**
 * Extra origins the app is allowed to talk to, from the environment.
 *
 * Read from `process.env` directly rather than through `src/lib/env.ts`: that
 * module demands MONGODB_URI, and the middleware — which needs this — runs on
 * the Edge, where nothing connects to Mongo.
 *
 * Space-separated, e.g. `NEXT_PUBLIC_CSP_IMG_ORIGINS="https://cdn.example.com"`.
 * Anything that is not a plain https origin is dropped rather than trusted: a
 * typo must not be able to widen the policy to `*`.
 */
function extraOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((origin) => origin.trim())
    .filter((origin) => /^https:\/\/[^\s'";*]+$/.test(origin));
}

export interface CspOptions {
  readonly nonce: string;
  /** Dev needs `unsafe-eval` (React Refresh) and a websocket for HMR. */
  readonly isDevelopment?: boolean;
  /** Additional https origins for `img-src` — an uploads CDN, say. */
  readonly imageOrigins?: readonly string[];
  /** Additional https origins for `connect-src` — an AI provider, say. */
  readonly connectOrigins?: readonly string[];
}

/**
 * Build the Content-Security-Policy for one request.
 *
 * Two directives are worth explaining, because they are the two a reviewer
 * will stop on:
 *
 * `script-src` uses a nonce plus `strict-dynamic`. `strict-dynamic` makes the
 * host allowlist irrelevant — only the nonced bootstrap runs, and whatever IT
 * loads inherits the trust. That is exactly how Next hydrates, and it closes
 * the usual "the allowlisted CDN also hosts a JSONP endpoint" bypass. Next.js
 * finds the nonce by reading the CSP off the *request* headers, which is why
 * `src/middleware.ts` sets it on the request as well as the response.
 *
 * `style-src` keeps `unsafe-inline`, and that is a deliberate, bounded
 * concession rather than an oversight: Framer Motion animates by writing to
 * `element.style` every frame, and next/font emits an inline `@font-face`
 * block. Neither can carry a nonce. Inline *style* is a far weaker primitive
 * than inline script — with `script-src` locked down and
 * `base-uri`/`object-src`/`form-action` closed, what is left is defacement,
 * not code execution.
 *
 * Fonts are self-hosted by next/font (downloaded at build time, served from
 * our own origin), so `font-src` is `'self'` alone — no fonts.gstatic.com, and
 * in fact no third-party origin anywhere in the policy.
 */
export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDevelopment = false } = options;

  const imageOrigins = options.imageOrigins ?? [];
  const connectOrigins = options.connectOrigins ?? [];

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],

    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        // React Refresh compiles modules with `eval` — dev only.
        ...(isDevelopment ? ["'unsafe-eval'"] : []),
      ],
    ],

    // See the note above: bounded, and the only way Framer Motion works.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["style-src-attr", ["'unsafe-inline'"]],

    ["font-src", ["'self'"]],

    // `data:` for inlined SVG and placeholder pixels, `blob:` for next/image's
    // client-side work and for previewing a file before it uploads.
    ["img-src", ["'self'", "data:", "blob:", ...imageOrigins]],

    ["media-src", ["'self'", "blob:"]],

    ["connect-src", ["'self'", ...(isDevelopment ? ["ws:", "wss:"] : []), ...connectOrigins]],

    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],

    // Nothing is embedded, nothing embeds us. `frame-ancestors` is the CSP
    // half of the X-Frame-Options pair, and the half modern browsers honour.
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],

    // No plugins, and no `<base href>` rewriting of where relative scripts
    // load from — the classic way a nonce policy is turned inside out.
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],

    // A form on our page may only post back to us. Stops an injected
    // `<form action="https://attacker">` from harvesting a password field.
    ["form-action", ["'self'"]],
  ];

  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);

  // Meaningless over http://localhost, and breaks a plain-http dev proxy.
  if (!isDevelopment) policy.push("upgrade-insecure-requests");

  return policy.join("; ");
}

/**
 * Headers that never vary by request.
 *
 * HSTS is not in this list — see `strictTransportSecurityHeader()`. Everything
 * else is correct in every environment, including over http on localhost.
 */
export const STATIC_SECURITY_HEADERS: readonly HeaderEntry[] = [
  // Never let a browser sniff a JSON or text response into script.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Redundant with `frame-ancestors 'none'` on modern browsers, kept for the
  // ones that never implemented CSP framing. Costs one header.
  { key: "X-Frame-Options", value: "DENY" },

  // Origin cross-site, full path same-origin. A work-order URL carries ids
  // that have no business in a third party's referrer log.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Deny rather than inherit a permissive default. `camera=()` will need to
  // become `camera=(self)` on the day the technician view photographs an
  // asset — a deliberate future edit, not a default to leave open now.
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "browsing-topics=()",
      "camera=()",
      "display-capture=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "interest-cohort=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", "),
  },

  // Severs the `window.opener` reference a popup would otherwise keep.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },

  // Our own assets only; stops another origin embedding them and using load
  // timing as a side channel.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },

  { key: "X-DNS-Prefetch-Control", value: "off" },
] as const;

/**
 * HSTS, or nothing.
 *
 * Separate, and production-only, because `max-age` is a promise the browser
 * holds the user to: send `includeSubDomains; preload` from a staging box or a
 * localhost tunnel and every subdomain of that host is https-only for two
 * years, with no way to withdraw it from the server side. The environment
 * decides, not a constant somebody has to remember to flip.
 */
export function strictTransportSecurityHeader(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): HeaderEntry | null {
  if (nodeEnv !== "production") return null;
  return {
    key: "Strict-Transport-Security",
    // Two years, subdomains included, eligible for the preload list.
    value: "max-age=63072000; includeSubDomains; preload",
  };
}

/** The full static set for `next.config.ts`, HSTS included where it applies. */
export function staticSecurityHeaders(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): HeaderEntry[] {
  const hsts = strictTransportSecurityHeader(nodeEnv);
  return hsts ? [...STATIC_SECURITY_HEADERS, hsts] : [...STATIC_SECURITY_HEADERS];
}

/**
 * A fresh 128-bit nonce, base64.
 *
 * `crypto` here is the Web Crypto global, which exists in both the Edge
 * runtime and Node 22+. Importing `node:crypto` would not load on the Edge.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Everything the middleware needs in order to stamp one response. */
export function buildRequestSecurityHeaders(options: { isDevelopment?: boolean } = {}): {
  nonce: string;
  contentSecurityPolicy: string;
} {
  const nonce = generateNonce();
  return {
    nonce,
    contentSecurityPolicy: buildContentSecurityPolicy({
      nonce,
      isDevelopment: options.isDevelopment ?? process.env.NODE_ENV !== "production",
      imageOrigins: extraOrigins(process.env.NEXT_PUBLIC_CSP_IMG_ORIGINS),
      connectOrigins: extraOrigins(process.env.NEXT_PUBLIC_CSP_CONNECT_ORIGINS),
    }),
  };
}
