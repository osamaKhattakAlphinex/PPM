import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The audit, as a test.
 *
 * CLAUDE.md requires that every mutation authenticates, checks a role, resolves
 * the tenant scope from the SESSION, and validates its input with zod. Every
 * individual action does — but "every action does" is a claim about a set that
 * grows, and a per-action test cannot make it. This suite reads the SOURCE and
 * asserts the shape of the whole surface, so an action written next year that
 * forgets one of the four fails here rather than shipping.
 *
 * It is a lint rule written as a test, and that is deliberate: a custom ESLint
 * rule would be more precise and would also be a second place to look. The
 * assertions below are coarse and few, and each one names a real hole.
 *
 * Pure: it reads files. No database, no session.
 */

const SRC = path.join(process.cwd(), "src");

function walk(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      // Tests are not the surface under audit.
      if (entry === "__tests__" || entry === "node_modules") continue;
      found.push(...walk(full));
      continue;
    }

    if (full.endsWith(".ts") || full.endsWith(".tsx")) found.push(full);
  }

  return found;
}

const FILES = walk(SRC).map((file) => ({
  path: path.relative(process.cwd(), file),
  source: readFileSync(file, "utf8"),
}));

/** Every module that declares at least one server action. */
const ACTION_FILES = FILES.filter((file) =>
  file.source.includes("defineAction({"),
);

/** Every route handler: a file under `src/app/api` exporting GET or POST. */
const ROUTE_FILES = FILES.filter(
  (file) =>
    file.path.includes(`app${path.sep}api${path.sep}`) &&
    /export async function (GET|POST|PUT|PATCH|DELETE)\b/.test(file.source),
);

describe("server actions", () => {
  it("exist, so this suite is auditing something", () => {
    expect(ACTION_FILES.length).toBeGreaterThan(8);
  });

  /**
   * `defineAction` performs all four steps in one place, so declaring an action
   * through it IS the check. What each declaration must still supply is a role
   * list and a schema — omit either and the wrapper cannot do its job.
   */
  it("declares a role list and a zod schema on every action", () => {
    for (const file of ACTION_FILES) {
      const declarations = file.source.split("defineAction({").slice(1);

      for (const declaration of declarations) {
        // The body of one declaration, up to its handler.
        const head = declaration.split("handler")[0] ?? "";
        const name = /name:\s*"([^"]+)"/.exec(head)?.[1] ?? "(unnamed)";

        expect(head, `${file.path}: ${name} has no roles`).toMatch(/roles:/);
        expect(head, `${file.path}: ${name} has no input schema`).toMatch(
          /input:/,
        );
      }
    }
  });

  /**
   * The single most important property in the product: the ORGANIZATION comes
   * from the session and from nowhere else. `defineAction` hands the handler a
   * `scope` it did not construct, so an action that reads `organizationId` out
   * of its payload — or assembles a scope from one — is choosing its own
   * tenant, which is the whole attack.
   *
   * There is no legitimate case, so there is no exception.
   */
  it("never takes an organization from a payload", () => {
    for (const file of ACTION_FILES) {
      expect(
        file.source,
        `${file.path} reads organizationId from input`,
      ).not.toMatch(/input\.organizationId\b/);
      expect(file.source, `${file.path} builds its own scope`).not.toMatch(
        /organizationId:\s*input\./,
      );
    }
  });

  /**
   * `clientId` is the harder half, because unlike the organization it IS
   * sometimes a legitimate field on a form: a manager raising an invoice or a
   * contract picks the client it is for, and that choice arrives in the
   * payload. What must never happen is that the id is believed.
   *
   * So the rule is conditional rather than absolute — an action may read
   * `input.clientId` only if the same file also proves it belongs to the
   * caller's organization first. All three helpers below do exactly that, by
   * reading the client back THROUGH the session's scope; a file that reads the
   * id without calling one of them is trusting a number from a browser.
   *
   * (A CLIENT-role caller never reaches this: their scope carries their own
   * clientId, and the data-access layer overwrites the field with it on write.)
   */
  it("verifies any clientId that arrives in a payload", () => {
    const VERIFIERS =
      /requireClientInScope\(|clientExistsInScope\(|clientBelongsToOrganization\(/;

    for (const file of ACTION_FILES) {
      if (!/input\.clientId\b/.test(file.source)) continue;

      expect(
        file.source,
        `${file.path} trusts a clientId from the payload`,
      ).toMatch(VERIFIERS);
    }
  });

  /**
   * `z.object` STRIPS unknown keys; `z.strictObject` rejects them. CLAUDE.md
   * asks for rejection, and the difference is not cosmetic — a stripped key is
   * a key nobody was told about.
   */
  it("uses strictObject for payload schemas", () => {
    const schemaFiles = FILES.filter(
      (file) =>
        file.path.includes(`${path.sep}schemas.ts`) &&
        file.source.includes("z."),
    );

    expect(schemaFiles.length).toBeGreaterThan(4);

    for (const file of schemaFiles) {
      // `z.object(` is the shape to catch. Schemas derived from a model with
      // `.pick()` inherit strictness from `entity()` and never appear here.
      //
      // One schema in the product genuinely cannot be strict — the credentials
      // record Auth.js hands to `authorize()` carries its own envelope fields
      // (csrfToken, callbackUrl) alongside ours, so rejecting unknown keys
      // there would reject every sign-in. It is annotated in the source, and
      // the annotation is what this test counts: a future exception has to be
      // written down next to the code before it passes here.
      const looseObjects = (file.source.match(/\bz\.object\(/g) ?? []).length;
      const allowed = (file.source.match(/audit-allow: z\.object\b/g) ?? [])
        .length;

      expect(
        looseObjects - allowed,
        `${file.path} uses z.object instead of z.strictObject`,
      ).toBe(0);
    }
  });
});

describe("route handlers", () => {
  it("exist, so this suite is auditing something", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(4);
  });

  /**
   * A route handler does NOT go through `defineAction`, so each one has to do
   * the four steps itself. Every route in this product either authenticates
   * with `requireRole` or is the two deliberate exceptions:
   *
   *  - the Auth.js handler, which IS the authentication;
   *  - the scheduled job, which has no user and authenticates with a shared
   *    secret compared in constant time.
   */
  it("authenticates, or is one of the two documented exceptions", () => {
    for (const file of ROUTE_FILES) {
      const isAuthEndpoint = file.path.includes("[...nextauth]");
      const isScheduledJob = file.path.includes(
        `api${path.sep}jobs${path.sep}`,
      );

      if (isAuthEndpoint) continue;

      if (isScheduledJob) {
        expect(file.source, `${file.path} has no shared-secret check`).toMatch(
          /CRON_SECRET/,
        );
        expect(
          file.source,
          `${file.path} compares the secret unsafely`,
        ).toMatch(/timingSafeEqual/);
        continue;
      }

      expect(file.source, `${file.path} does not call requireRole`).toMatch(
        /requireRole\(/,
      );
    }
  });

  /**
   * Never a stack trace, never a Mongo error. Every handler funnels failures
   * through `handleApiError`, which logs server-side with a request id and
   * returns a generic body.
   */
  it("routes every failure through the non-leaky error handler", () => {
    for (const file of ROUTE_FILES) {
      if (file.path.includes("[...nextauth]")) continue;
      expect(file.source, `${file.path} does not use handleApiError`).toMatch(
        /handleApiError\(/,
      );
    }
  });
});

describe("the data-access boundary", () => {
  /**
   * The rule the ESLint plugin enforces, asserted a second way. A feature file
   * that imported mongoose would already fail `pnpm lint`; this catches the
   * case where somebody adds an eslint-disable to get past it.
   */
  it("keeps mongoose inside src/lib/db", () => {
    const offenders = FILES.filter(
      (file) =>
        !file.path.includes(`lib${path.sep}db${path.sep}`) &&
        !file.path.endsWith(`lib${path.sep}db.ts`) &&
        /from "mongoose"/.test(file.source),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  /**
   * `Model.aggregate` reaches the database under MongoDB's rules rather than
   * ours — a pipeline's first stage decides what it can see. The one place it
   * may be written is the layer that can prove the `$match` is scoped.
   */
  it("keeps aggregation pipelines inside src/lib/db", () => {
    const offenders = FILES.filter(
      (file) =>
        !file.path.includes(`lib${path.sep}db${path.sep}`) &&
        /\.aggregate\(/.test(file.source),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});

describe("secrets", () => {
  /**
   * A `NEXT_PUBLIC_` variable is inlined into the client bundle by Next at
   * build time. Naming a secret with that prefix is therefore not a
   * configuration mistake but a disclosure, and it is invisible in review
   * because the code reads exactly like the safe kind.
   */
  it("never puts a credential behind a NEXT_PUBLIC_ name", () => {
    const publicNames = new Set<string>();

    for (const file of FILES) {
      for (const match of file.source.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
        publicNames.add(match[0]);
      }
    }

    for (const name of publicNames) {
      expect(
        name,
        `${name} looks like a credential on a public variable`,
      ).not.toMatch(/(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|URI|DSN)$/);
    }
  });

  /**
   * The AI key is the one credential that a Client Component could plausibly
   * reach for, because the feature it powers has a browser half. It is read in
   * exactly one place.
   */
  it("reads the Anthropic key in one module only", () => {
    const readers = FILES.filter((file) =>
      /ANTHROPIC_API_KEY/.test(file.source),
    ).map((file) => file.path);

    // `env.ts` declares it; the route handler uses it. Nothing else.
    expect(readers.sort()).toEqual(
      [
        path.join("src", "app", "api", "ai", "insights", "route.ts"),
        path.join("src", "lib", "env.ts"),
      ].sort(),
    );
  });

  /** Nothing in the source may carry a literal credential. */
  it("has no hardcoded connection string or key", () => {
    for (const file of FILES) {
      // A real MongoDB URI with credentials in it.
      expect(
        file.source,
        `${file.path} hardcodes a connection string`,
      ).not.toMatch(/mongodb(\+srv)?:\/\/[^\s"']*:[^\s"']*@/);
      // An Anthropic key.
      expect(file.source, `${file.path} hardcodes an API key`).not.toMatch(
        /sk-ant-[A-Za-z0-9]/,
      );
    }
  });
});
