# Deployment

What CI checks, how the environment is configured, how to run the platform on
either of the two hosts it is built for, and the checklist that has to be
complete before the first real tenant signs in.

---

## 1. CI

`.github/workflows/ci.yml`. One job, four checks, in the order that fails
fastest:

| Step | Command | What it catches |
|---|---|---|
| Typecheck | `pnpm typecheck` | `tsc --noEmit` over the whole tree. No `any`, no unchecked property access. |
| Lint | `pnpm lint:dal` | ESLint with `--max-warnings 0`, which includes the **data-access boundary rule** — a direct `Model.find(...)` or a `mongoose` import outside `src/lib/db` fails the build. |
| Test | `pnpm test` | All 51 suites, including the cross-module isolation sweep and the source audit described in `docs/SECURITY.md`. |
| Build | `pnpm build` | A real production build, which is also the only thing that proves the public pages still prerender. |

Plus one assertion that only a built artifact can make: **no secret in the
client bundle.** The step greps `.next/static` for an API-key shape and for the
build-time secret CI itself set. It catches the one mistake that is invisible in
review — a credential read into a Client Component, which Next then inlines into
the JavaScript every visitor downloads.

### The database in CI

The data-access suites test against a real mongod, because the isolation
guarantees are claims about what MongoDB returns and a mocked model can only
prove we built the filter we think we built. CI runs `mongo:8.0` as a service
container and points the suites at it with `MONGO_TEST_URI`. Without that
variable the helper falls back to `mongodb-memory-server`, which downloads its
own binary — right on a developer's machine, one more network dependency in CI,
and impossible on a network that blocks the download host.

Each vitest worker takes its own database on that server, because suites run in
parallel and `clearCollections` wipes everything it can see.

### Blocking merge

CI reports; **branch protection blocks**. Both are needed — a red check nobody
is required to act on is decoration. On GitHub: *Settings → Branches → Add
branch ruleset* for `main`, with

- **Require a pull request before merging** (so nothing lands unchecked),
- **Require status checks to pass** → select **`Typecheck, lint, test, build`**,
- **Require branches to be up to date before merging** (so a check cannot pass
  against a base that has since moved),
- **Block force pushes** and **Restrict deletions**.

The check name is the job's `name:`, not the workflow's, and it only appears in
the picker after the workflow has run once on the default branch.

---

## 2. Environment and secrets

Every value the platform reads is declared in `.env.example`, with a comment
explaining what it is for and what happens if it is wrong or absent. Copy it to
`.env.local` for development; set the same names in the host's environment for
production.

**Nothing is hardcoded, and nothing is committed.** `.gitignore` excludes
`.env*` and re-includes `.env.example` only. The audit test in
`src/lib/security/__tests__/action-surface.test.ts` asserts that no source file
carries a literal connection string with credentials or an API key.

### Required in every environment

| Variable | Notes |
|---|---|
| `MONGODB_URI` | Standard or SRV string, credentials included. Never in source. |
| `MONGODB_DB_NAME` | Kept out of the URI so one cluster can host dev, preview and prod databases separately. |
| `AUTH_SECRET` | ≥ 32 chars. **Generate a fresh one per environment**: `openssl rand -base64 32`. Rotating it signs everyone out, which is the correct response to a leak. |
| `NEXT_PUBLIC_SITE_URL` | The public origin, no trailing slash. Public by design — it is the address people type. It must still be right per environment: a production canonical on a preview build is how a preview deployment outranks the real site. |

### Production-specific

| Variable | Value | Why |
|---|---|---|
| `MONGODB_AUTO_INDEX` | `false` | Otherwise Mongoose builds declared indexes on model compile. A deploy that triggers an index build on a large collection is a deploy that locks it. Build them deliberately — see §5. |
| `NODE_ENV` | `production` | Set by every host. It is what switches HSTS on and what makes the seed script refuse to run. |
| `CRON_SECRET` | ≥ 24 chars | Required for `/api/jobs/notifications`. Unset, the route answers **503** rather than running unauthenticated. |
| `S3_*` | bucket, region, endpoint, key pair | Required on any serverless or multi-instance host: `UPLOAD_DIR` writes to local disk, which such a host either does not have or does not share. |

`ANTHROPIC_API_KEY` is optional; without it the AI Insights module renders a
"not configured" panel instead of failing.

### The `NEXT_PUBLIC_` rule

A `NEXT_PUBLIC_` variable is inlined into the JavaScript bundle at build time.
Putting a credential behind that prefix is not a misconfiguration, it is a
disclosure — and the code reads exactly like the safe kind, so review does not
catch it. `NEXT_PUBLIC_SITE_URL` is the only one in the product. The audit test
fails any `NEXT_PUBLIC_` name ending in `KEY`, `SECRET`, `TOKEN`, `PASSWORD`,
`CREDENTIAL`, `URI` or `DSN`.

---

## 3. MongoDB Atlas

### A least-privilege application user

The application needs to read and write its own database and nothing else. It
does **not** need `atlasAdmin`, `readWriteAnyDatabase`, or the ability to create
users, drop databases or read the oplog.

*Database Access → Add New Database User → Built-in role:* **`readWrite`**,
*scoped to the single database* the deployment uses (`ppm_platform`, or whatever
`MONGODB_DB_NAME` says). One user per environment, never shared between prod and
staging: a leaked staging credential must not open production.

Two more users, created separately and used by people rather than the app:

- a **`dbAdmin`** on the same database, used once to build indexes (§5) and then
  by nobody;
- a **`read`**-only user for anyone who needs to inspect production data.

### Network and transport

- **Network Access:** allow-list the deployment's egress addresses. On a
  serverless host that means a private endpoint or the platform's static IP
  feature. `0.0.0.0/0` plus a password is one secret away from public.
- TLS is on by default in Atlas and must not be disabled. `mongodb+srv://`
  implies it.
- **Backups:** enable Cloud Backup with point-in-time recovery. Choose the
  retention the client's contract requires, and then **restore once into a
  scratch cluster** — a backup nobody has restored is a hypothesis.

### Pool size

`MONGODB_MAX_POOL_SIZE` defaults to 10. On a serverless host, every warm
instance holds its own pool against the cluster's connection limit, so keep it
small (5 or less) and watch the connection count under load. On a single Node
host the default is fine.

---

## 4. Hosting

The build is `output: "standalone"`, so both paths below work from the same
artifact.

### Vercel

Import the repository; the framework preset is detected. Set the environment
variables from §2 for **Production** and **Preview** separately — a preview
deployment must never hold the production database URI or `AUTH_SECRET`.
`output: "standalone"` is ignored there, harmlessly.

Two Vercel-specific notes:

- **Uploads must go to S3.** A serverless function has no durable disk.
- **The notification job** is a Vercel Cron entry hitting
  `/api/jobs/notifications` with `Authorization: Bearer $CRON_SECRET`, at
  whatever hour suits the tenant's timezone.

### A Node host (container, VM, App Service)

```bash
pnpm install --frozen-lockfile
pnpm build

# `next build --output standalone` does not copy these two — they are served
# straight from disk and would otherwise 404.
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

NODE_ENV=production node .next/standalone/server.js   # listens on PORT, default 3000
```

Run it behind a TLS-terminating reverse proxy. The proxy must forward
`X-Forwarded-Proto` and `X-Forwarded-For`: the first is how the app knows to
emit HSTS and set `__Secure-` cookies, the second is the key the login rate
limiter counts on. A proxy that hides the client IP collapses every visitor into
one rate-limit bucket.

Schedule the notification job with cron:

```
0 6 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://app.example.com/api/jobs/notifications
```

### HTTPS and HSTS

TLS terminates at the platform (Vercel) or the reverse proxy (Node host); the
app is never the TLS endpoint. HSTS is emitted **only** when `NODE_ENV` is
`production`:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

That gate is deliberate rather than fussy. `max-age` is a promise the browser
holds the user to: send `includeSubDomains; preload` once from a staging box or
a localhost tunnel and every subdomain of that host is https-only for two years,
with no way to withdraw it from the server side.

Before submitting to the preload list, be certain **every** subdomain — including
ones the marketing team has not created yet — can serve HTTPS.

The rest of the headers, and the two Content-Security-Policies, are in
`src/lib/security/headers.ts` and applied by `src/middleware.ts` and
`next.config.ts`. See `docs/SECURITY.md` §6.

---

## 5. Pre-launch checklist

Run through this against the production environment. Every line is checkable,
and most are one command.

### Secrets and configuration

- [ ] `AUTH_SECRET` is a fresh 32+ byte value, unique to production, and is not
      the one in any other environment.
- [ ] `MONGODB_URI` uses the least-privilege `readWrite` user from §3, scoped to
      one database.
- [ ] `CRON_SECRET` is set — otherwise the notification job answers 503 and no
      overdue-PPM notice is ever raised.
- [ ] `NEXT_PUBLIC_SITE_URL` is the production origin, not a preview URL.
- [ ] `MONGODB_AUTO_INDEX=false`.
- [ ] `S3_*` configured, and the bucket is **private** — files are served only
      through the authenticated, scoped `/api/files/[id]` route, never by URL.
      Confirm by requesting an object URL directly and getting a 403.
- [ ] No `.env*` file other than `.env.example` is in the repository:
      `git ls-files | grep '^\.env'` returns only `.env.example`.

### Seeds

- [ ] `pnpm seed` is a development script and refuses to run when `NODE_ENV` is
      `production` — verified by reading `scripts/seed.ts:211`, and worth
      re-verifying after any edit.
- [ ] No seeded account exists in the production database. The seed creates one
      user per role with a shared password; a forgotten seed run is an
      unauthenticated way in. Check: `db.users.find({ email: /@example\./ })`
      returns nothing.
- [ ] The first real ADMIN was created deliberately, with a password only that
      person knows.

### Database

- [ ] Indexes built. With `MONGODB_AUTO_INDEX=false` nothing builds them on a
      deploy, which is the point — an index build holds a lock, and a deploy
      that triggers one on a large collection takes the product down for as long
      as it runs. So it is a separate command, run once with the `dbAdmin` user
      at a moment somebody chose:
      ```bash
      pnpm indexes            # create anything missing
      pnpm indexes --prune    # ...and drop anything no longer declared
      ```
      The script prints every index on every collection when it finishes, so the
      run verifies itself. Confirm that each one on a tenant-scoped collection
      leads with `organizationId` — an index that does not is an index the
      planner can only use after reading across every tenant's rows. See
      `docs/PERFORMANCE.md`.
- [ ] Backups enabled with point-in-time recovery, **and one restore performed**
      into a scratch cluster.
- [ ] Network access is an allow-list, not `0.0.0.0/0`.

### Security verification

Against the deployed origin, not localhost:

- [ ] Headers present:
      ```bash
      curl -sSI https://app.example.com/en | grep -iE \
        'strict-transport|content-security|x-content-type|x-frame|referrer|permissions'
      ```
      HSTS must appear here and must **not** appear on a staging host.
- [ ] `X-Powered-By` is absent.
- [ ] `curl -sS https://app.example.com/robots.txt` disallows `/app`, `/api`
      and `/style-guide`.
- [ ] An authenticated page requested without a cookie redirects to login rather
      than rendering: `curl -sSI https://app.example.com/en/app`.
- [ ] A route handler without a session returns 401, not a stack trace:
      `curl -sS https://app.example.com/api/reports/PM/pdf`.
- [ ] `/api/jobs/notifications` without the bearer token returns 401, and with a
      wrong one also returns 401 in the same time.
- [ ] Rate limits bite: eleven wrong passwords for one email in ten minutes gets
      a 429 with `Retry-After`. Remember the limitation in `docs/SECURITY.md` §5
      — counters are per instance.
- [ ] The client bundle carries no secret:
      `grep -rIl 'sk-ant-' .next/static` finds nothing. CI asserts this on every
      run.

### Application

- [ ] Sign in as each of the five roles and confirm the navigation, the landing
      page and the visible modules match: ADMIN and FM_MANAGER see everything,
      SUPERVISOR sees operations, TECHNICIAN lands on `/app/my-jobs`, CLIENT
      lands on `/app/portal` and sees only their own assets and work orders.
- [ ] Switch to Arabic and confirm the layout mirrors, the numbers stay legible
      and no string is untranslated.
- [ ] Generate one invoice PDF and one report PDF; confirm the Arabic renders
      (the Amiri font is committed, so this should not depend on the host).
- [ ] Trigger the notification job by hand and confirm the bell shows what it
      should, once, and not twice on a second run.
- [ ] `docs/TEST-CASES.md` executed end to end and signed off.

### After launch

- [ ] Someone is on the error log. `handleApiError` writes a request id with
      every failure; nothing reaches the client but that id.
- [ ] An uptime check hits a public page, not `/app` — `/app` correctly
      redirects and would read as a failure.
