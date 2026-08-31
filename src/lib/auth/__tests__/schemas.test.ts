import { describe, expect, it } from "vitest";

import {
  credentialsSchema,
  emailSchema,
  loginFormSchema,
  passwordSchema,
  registerUserSchema,
  safeRedirectPath,
} from "../schemas";

describe("emailSchema", () => {
  it("normalises before validating, so the stored form is what is looked up", () => {
    expect(emailSchema.parse("  Admin@PPM.Local  ")).toBe("admin@ppm.local");
  });

  it("rejects anything that is not an address", () => {
    for (const value of ["", "admin", "admin@", "@ppm.local", "a b@ppm.local"]) {
      expect(emailSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects an object, which is how a NoSQL operator arrives", () => {
    expect(emailSchema.safeParse({ $gt: "" }).success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("requires 12 characters and caps the length", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("twelve chars").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });
});

describe("credentialsSchema", () => {
  it("strips the fields Auth.js adds to the sign-in body", () => {
    const parsed = credentialsSchema.parse({
      email: "admin@ppm.local",
      password: "whatever",
      csrfToken: "abc",
      callbackUrl: "/app",
      redirect: "true",
    });

    expect(parsed).toEqual({ email: "admin@ppm.local", password: "whatever" });
  });

  it("does not apply the password policy at sign-in", () => {
    // A short password is a WRONG password here, not an invalid one — enforcing
    // the policy would reveal which stored passwords predate it.
    expect(credentialsSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(true);
  });

  it("refuses an operator object in place of a password", () => {
    expect(
      credentialsSchema.safeParse({ email: "a@b.co", password: { $ne: null } }).success,
    ).toBe(false);
  });
});

describe("loginFormSchema", () => {
  it("rejects unknown fields", () => {
    const result = loginFormSchema.safeParse({
      email: "admin@ppm.local",
      password: "whatever",
      role: "ADMIN",
    });

    expect(result.success).toBe(false);
  });
});

describe("registerUserSchema", () => {
  const base = {
    name: "Omar Nasser",
    email: "omar@ppm.local",
    password: "a long enough password",
    role: "TECHNICIAN" as const,
  };

  it("accepts a staff user with no client", () => {
    expect(registerUserSchema.safeParse(base).success).toBe(true);
  });

  it("requires a clientId for a CLIENT user", () => {
    expect(registerUserSchema.safeParse({ ...base, role: "CLIENT" }).success).toBe(false);
  });

  it("forbids a clientId on a staff user", () => {
    const result = registerUserSchema.safeParse({
      ...base,
      clientId: "5f2b1c4e9d3a7b8c6e0f1a2b",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a CLIENT user with a well-formed clientId", () => {
    const result = registerUserSchema.safeParse({
      ...base,
      role: "CLIENT",
      clientId: "5f2b1c4e9d3a7b8c6e0f1a2b",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a clientId that is not an object id", () => {
    const result = registerUserSchema.safeParse({ ...base, role: "CLIENT", clientId: "1" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown role and unknown fields", () => {
    expect(registerUserSchema.safeParse({ ...base, role: "SUPERADMIN" }).success).toBe(false);
    expect(
      registerUserSchema.safeParse({ ...base, organizationId: "5f2b1c4e9d3a7b8c6e0f1a2b" }).success,
    ).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  const fallback = "/app/start";

  it("keeps an in-app path", () => {
    expect(safeRedirectPath("/app/work-orders?status=open", fallback)).toBe(
      "/app/work-orders?status=open",
    );
  });

  it("refuses everything that could leave the site", () => {
    const hostile = [
      "https://evil.example/login",
      "//evil.example",
      "/\\evil.example",
      "http://evil.example",
      "javascript:alert(1)",
      "app/relative",
      "",
      "/app\nSet-Cookie: a=b",
      "/app\r\nLocation: https://evil.example",
    ];

    for (const value of hostile) {
      expect(safeRedirectPath(value, fallback)).toBe(fallback);
    }
  });

  it("refuses a non-string, and anything absurdly long", () => {
    expect(safeRedirectPath(undefined, fallback)).toBe(fallback);
    expect(safeRedirectPath({ toString: () => "/app" }, fallback)).toBe(fallback);
    expect(safeRedirectPath(`/${"a".repeat(3000)}`, fallback)).toBe(fallback);
  });
});
