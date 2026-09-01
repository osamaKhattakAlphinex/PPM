import { afterEach, describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildRequestSecurityHeaders,
  generateNonce,
  staticSecurityHeaders,
  STATIC_SECURITY_HEADERS,
  strictTransportSecurityHeader,
} from "../headers";

/** Pull one directive out of a CSP string as a list of sources. */
function directive(policy: string, name: string): string[] {
  const found = policy
    .split("; ")
    .find((part) => part === name || part.startsWith(`${name} `));
  if (!found) return [];
  return found.split(" ").slice(1);
}

describe("buildContentSecurityPolicy", () => {
  const prod = () => buildContentSecurityPolicy({ nonce: "TESTNONCE", isDevelopment: false });

  it("carries the nonce and strict-dynamic in script-src", () => {
    expect(directive(prod(), "script-src")).toEqual(
      expect.arrayContaining(["'nonce-TESTNONCE'", "'strict-dynamic'"]),
    );
  });

  it("never allows inline or eval'd script in production", () => {
    const scriptSrc = directive(prod(), "script-src");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("allows eval and websockets in development only", () => {
    const dev = buildContentSecurityPolicy({ nonce: "n", isDevelopment: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(directive(prod(), "connect-src")).not.toContain("ws:");
  });

  it("closes the directives that turn a nonce policy inside out", () => {
    const policy = prod();
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "form-action")).toEqual(["'self'"]);
  });

  it("serves fonts from our own origin only — they are self-hosted by next/font", () => {
    expect(directive(prod(), "font-src")).toEqual(["'self'"]);
    expect(prod()).not.toContain("gstatic");
    expect(prod()).not.toContain("googleapis");
  });

  it("upgrades insecure requests in production but not in development", () => {
    expect(prod()).toContain("upgrade-insecure-requests");
    expect(buildContentSecurityPolicy({ nonce: "n", isDevelopment: true })).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  it("appends configured extra origins to the directive they belong to", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "n",
      isDevelopment: false,
      imageOrigins: ["https://cdn.example.com"],
      connectOrigins: ["https://api.example.com"],
    });

    expect(directive(policy, "img-src")).toContain("https://cdn.example.com");
    expect(directive(policy, "connect-src")).toContain("https://api.example.com");
    // …and only to that one.
    expect(directive(policy, "connect-src")).not.toContain("https://cdn.example.com");
  });
});

describe("buildRequestSecurityHeaders", () => {
  const originalImgOrigins = process.env.NEXT_PUBLIC_CSP_IMG_ORIGINS;

  afterEach(() => {
    if (originalImgOrigins === undefined) delete process.env.NEXT_PUBLIC_CSP_IMG_ORIGINS;
    else process.env.NEXT_PUBLIC_CSP_IMG_ORIGINS = originalImgOrigins;
  });

  it("drops a malformed extra origin rather than widening the policy", () => {
    // A wildcard, an http origin and a value carrying a quote — each is a way
    // a typo in an env var could otherwise defeat the whole directive.
    process.env.NEXT_PUBLIC_CSP_IMG_ORIGINS = "* http://cdn.example.com https://ok.example.com";

    const { contentSecurityPolicy } = buildRequestSecurityHeaders({ isDevelopment: false });
    const imgSrc = directive(contentSecurityPolicy, "img-src");

    expect(imgSrc).toContain("https://ok.example.com");
    expect(imgSrc).not.toContain("*");
    expect(imgSrc).not.toContain("http://cdn.example.com");
  });

  it("issues a different nonce every call", () => {
    const first = buildRequestSecurityHeaders().nonce;
    const second = buildRequestSecurityHeaders().nonce;
    expect(first).not.toEqual(second);
  });
});

describe("generateNonce", () => {
  it("is base64 and long enough to be unguessable", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // 16 random bytes -> 24 base64 characters.
    expect(nonce.length).toBeGreaterThanOrEqual(20);
  });
});

describe("strictTransportSecurityHeader", () => {
  it("is emitted in production only", () => {
    expect(strictTransportSecurityHeader("production")).not.toBeNull();
    expect(strictTransportSecurityHeader("development")).toBeNull();
    expect(strictTransportSecurityHeader("test")).toBeNull();
    expect(strictTransportSecurityHeader(undefined)).toBeNull();
  });

  it("asks for two years, subdomains and preload", () => {
    const header = strictTransportSecurityHeader("production");
    expect(header?.value).toContain("max-age=63072000");
    expect(header?.value).toContain("includeSubDomains");
    expect(header?.value).toContain("preload");
  });
});

describe("staticSecurityHeaders", () => {
  it("includes the always-on set", () => {
    const keys = staticSecurityHeaders("development").map((header) => header.key);
    expect(keys).toEqual(expect.arrayContaining(STATIC_SECURITY_HEADERS.map((h) => h.key)));
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
  });

  it("adds HSTS only in production", () => {
    expect(staticSecurityHeaders("development").map((h) => h.key)).not.toContain(
      "Strict-Transport-Security",
    );
    expect(staticSecurityHeaders("production").map((h) => h.key)).toContain(
      "Strict-Transport-Security",
    );
  });

  it("denies the hardware permissions the app does not use", () => {
    const permissions = staticSecurityHeaders("production").find(
      (header) => header.key === "Permissions-Policy",
    )?.value;

    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("microphone=()");
    expect(permissions).toContain("geolocation=()");
  });
});
