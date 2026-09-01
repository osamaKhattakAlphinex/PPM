import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  directionOf,
  isLocale,
  localeHref,
  negotiateLocale,
  splitLocale,
  stripLocale,
} from "../config";

describe("splitLocale", () => {
  it("separates a locale prefix from the path below it", () => {
    expect(splitLocale("/en/app/assets")).toEqual({ locale: "en", pathname: "/app/assets" });
    expect(splitLocale("/ar/app")).toEqual({ locale: "ar", pathname: "/app" });
  });

  it("returns the root path for a bare locale", () => {
    expect(splitLocale("/en")).toEqual({ locale: "en", pathname: "/" });
    expect(splitLocale("/ar/")).toEqual({ locale: "ar", pathname: "/" });
  });

  it("reports no locale when the first segment is not one", () => {
    expect(splitLocale("/app/assets")).toEqual({ locale: null, pathname: "/app/assets" });
    // A path that merely starts with the letters is not a locale segment.
    expect(splitLocale("/english/app")).toEqual({ locale: null, pathname: "/english/app" });
    expect(splitLocale("/")).toEqual({ locale: null, pathname: "/" });
  });
});

describe("stripLocale", () => {
  it("gives every route rule one path shape to reason about", () => {
    expect(stripLocale("/en/app/assets/123")).toBe("/app/assets/123");
    expect(stripLocale("/ar/app/assets/123")).toBe("/app/assets/123");
    expect(stripLocale("/app/assets/123")).toBe("/app/assets/123");
  });
});

describe("localeHref", () => {
  it("prefixes an app-relative path", () => {
    expect(localeHref("/app/assets", "ar")).toBe("/ar/app/assets");
    expect(localeHref("/", "en")).toBe("/en");
  });

  it("is idempotent — a double prefix is not reachable by being careless", () => {
    expect(localeHref(localeHref("/app", "en"), "ar")).toBe("/ar/app");
    expect(localeHref("/en/app", "en")).toBe("/en/app");
  });

  it("tolerates a path with no leading slash", () => {
    expect(localeHref("app/assets", "en")).toBe("/en/app/assets");
  });
});

describe("directionOf", () => {
  it("flips only for Arabic", () => {
    expect(directionOf("en")).toBe("ltr");
    expect(directionOf("ar")).toBe("rtl");
  });
});

describe("isLocale", () => {
  it("rejects anything that is not one of ours", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    // The route param is attacker-controlled; a path traversal must not pass.
    expect(isLocale("../../etc/passwd")).toBe(false);
    expect(isLocale("EN")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("negotiateLocale", () => {
  it("prefers an explicit previous choice over the browser's list", () => {
    expect(negotiateLocale({ cookie: "ar", acceptLanguage: "en-GB,en;q=0.9" })).toBe("ar");
    expect(negotiateLocale({ cookie: "en", acceptLanguage: "ar-SA" })).toBe("en");
  });

  it("ignores a cookie value that is not a locale", () => {
    expect(negotiateLocale({ cookie: "de", acceptLanguage: "ar" })).toBe("ar");
    expect(negotiateLocale({ cookie: "", acceptLanguage: "ar" })).toBe("ar");
  });

  it("matches on the primary subtag, so every Arabic region counts", () => {
    expect(negotiateLocale({ acceptLanguage: "ar-SA,ar;q=0.9" })).toBe("ar");
    expect(negotiateLocale({ acceptLanguage: "ar-AE" })).toBe("ar");
    expect(negotiateLocale({ acceptLanguage: "ar-EG" })).toBe("ar");
  });

  it("honours quality values", () => {
    expect(negotiateLocale({ acceptLanguage: "fr;q=1.0,ar;q=0.8,en;q=0.5" })).toBe("ar");
    expect(negotiateLocale({ acceptLanguage: "ar;q=0.3,en;q=0.9" })).toBe("en");
  });

  it("skips a language explicitly refused with q=0", () => {
    expect(negotiateLocale({ acceptLanguage: "ar;q=0,en;q=0.5" })).toBe("en");
  });

  it("falls back to the default when nothing matches", () => {
    expect(negotiateLocale({ acceptLanguage: "fr,de;q=0.8" })).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale({})).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale({ acceptLanguage: "" })).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale({ acceptLanguage: "garbage;;;q=" })).toBe(DEFAULT_LOCALE);
  });
});
