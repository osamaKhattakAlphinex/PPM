# PPM Platform

A multi-tenant facility maintenance management system (CMMS) for the Gulf
market. Bilingual English/Arabic with full RTL, currency in SAR, and five roles:
ADMIN, FM_MANAGER, SUPERVISOR, TECHNICIAN, CLIENT.

## What it does

| Area | Modules |
|---|---|
| Master data | Organizations, clients, locations, assets, technicians |
| Operations | Preventive maintenance schedules, corrective work orders, checklists |
| Money and governance | AMC contracts, a five-stage approval chain, invoicing with 15% VAT |
| Insight | Dashboard, PM/asset/financial reports with PDF export, AI-written insights |
| Field and portal | A technician's own job list with attendance, a client portal |
| Platform | Notifications, secure file uploads, a public marketing site |

## Running it

Requires Node 24 (`.nvmrc`), pnpm, and a MongoDB — local or Atlas.

```bash
pnpm install
cp .env.example .env.local     # then fill in MONGODB_URI and AUTH_SECRET
pnpm seed                      # one org, one client, a user per role
pnpm dev
```

`AUTH_SECRET` needs 32+ characters: `openssl rand -base64 32`.

The seed prints the accounts it creates. They all share one password, the seed
refuses to run when `NODE_ENV=production`, and no seeded account should ever
exist in a real deployment — see the checklist in `docs/DEPLOYMENT.md`.

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint:dal` | ESLint with zero warnings tolerated, including the data-access boundary rule |
| `pnpm test` | The full suite |
| `pnpm seed` | Local development data |
| `pnpm indexes` | Build the declared MongoDB indexes deliberately (`--prune` also drops undeclared ones) |

## How it is built

Next.js App Router and TypeScript, MongoDB through Mongoose, Auth.js, zod,
Tailwind and Framer Motion. Reads are Server Components, writes are Server
Actions; route handlers exist only for files, PDFs, the AI stream and the
scheduled job.

Two rules shape almost every file, and both are in `CLAUDE.md`:

**Feature code never touches a Mongoose model.** Everything goes through a
tenant-scoped data-access layer that injects `organizationId` — and `clientId`
for client users — into every query, update and delete. If the scope cannot be
resolved from the session, the query fails closed and returns nothing. The rule
is enforced by a custom ESLint rule, by the absence of any unscoped accessor to
call, and by a test that reads the source.

**Every mutation goes through one wrapper.** `defineAction` authenticates,
checks the role, resolves the scope from the session, rate-limits, and parses
the payload with a strict zod schema — in that order — before a handler runs.
The handler receives a scope it did not construct and cannot widen.

## Documentation

| Document | What is in it |
|---|---|
| `CLAUDE.md` | The rules the codebase is held to |
| `docs/DESIGN.md` | The design system: palette, type, motion, components |
| `docs/SECURITY.md` | Controls, the audit and its findings, known limitations |
| `docs/PERFORMANCE.md` | Indexes, read shapes, bundle sizes, Lighthouse scores |
| `docs/SEO.md` | The public site, its metadata, and the static-CSP problem |
| `docs/DEPLOYMENT.md` | CI, environment, Atlas, hosting, the pre-launch checklist |
| `docs/TEST-CASES.md` | Every module's test cases in plain language, for manual sign-off |

## Tests

51 suites. Pure logic — state machines, VAT arithmetic, filename safety, prompt
fencing, role policy — runs anywhere. The data-access suites run against a real
mongod, because the isolation guarantees are claims about what MongoDB returns
and a mocked model can only prove we built the filter we meant to build.

```bash
pnpm test                                        # downloads a mongod on first run
MONGO_TEST_URI=mongodb://127.0.0.1:27017 pnpm test   # ...or uses one you already have
```
