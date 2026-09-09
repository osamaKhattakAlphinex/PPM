# Performance pass

A measured pass over the three things CLAUDE.md's performance section names:
the indexes behind every hot query, the shape of the reads, and the size of the
client bundle. What follows is what was audited, what was changed, and the
numbers on both sides of the change.

## 1. Indexes

Every tenant-scoped collection is indexed **tenant-first**, because every filter
the data-access layer builds starts with `organizationId` — an index that does
not lead with it is an index the planner can only use after it has already read
across every tenant's rows.

The audit walked all 15 models against the queries that actually run. Sixty-two
indexes were already declared; the three below were missing, and each was
missing for the same reason — a screen added after the model was written asks a
question the original index cannot answer.

| Collection | Added | The query it serves |
|---|---|---|
| `work_orders` | `{ organizationId, technicianId, status, createdAt: -1 }` | "My jobs": one technician's open tickets, newest first. The previous index stopped at `status`, so the sort was done in memory. |
| `work_orders` | `{ organizationId, createdAt: -1 }` | The six-month trend and the AI module's recent-fault window. Both are a bare range on `createdAt` with no status or priority term, so no compound above could serve them. |
| `assets` | `{ organizationId, health: 1 }` | The asset report's "worst condition" list and the AI module's weakest-equipment snapshot, both sorting by `health` across the whole tenant. |

The last one is the one that would have hurt. A sort with no index is done in
memory, and mongod **aborts** a sort past 32MB rather than degrading — so it
would have worked in development and failed on the first tenant with a real
asset register.

### The two indexes that do not lead with the tenant

Deliberate, and both are correct:

- `users { email: 1 }` — unique across the whole system, because sign-in
  resolves a user before any tenant is known.
- `organizations { name: 1 }` — the organization collection is not itself
  tenant-scoped; it *is* the tenants.

### Soft deletes

The base plugin adds `{ organizationId, deletedAt, createdAt: -1 }` and
`{ deletedAt: 1 }` to every model, and every filter the DAL builds carries
`deletedAt: null`. The compounds above deliberately do **not** repeat
`deletedAt`: with a tenant and an equality key in front, the candidate set is
already small enough that filtering the deleted rows out of it costs nothing,
and adding a fourth key to sixty indexes would cost a write on every insert.

### Building them in production

`MONGODB_AUTO_INDEX=false` in production, and the indexes are built by a
deliberate migration rather than on model compile — see the pre-launch checklist
in `docs/DEPLOYMENT.md`. A deploy that triggers an index build on a large
collection is a deploy that locks it.

## 2. Reads

Three properties were checked across every module, and all three already held —
they are properties of the data-access layer rather than of any call site, which
is why:

- **`.lean()` everywhere.** `find`, `findOne`, `findById` and `paginate` all end
  in `.lean()`. There is no path through the repository that returns a hydrated
  Mongoose document to feature code.
- **Nothing unbounded.** `find()` caps at `DEFAULT_FIND_LIMIT` (100) and
  `MAX_FIND_LIMIT` (1,000) whatever the caller passes; `paginate()` caps at
  `MAX_PAGE_SIZE`. A forgotten filter cannot stream a collection.
- **Projections on the hot reads.** Every read that exists to resolve a name or
  a foreign key projects only what it needs — `assetNamesFor`, `clientNamesFor`,
  `actorNamesFor`, the dashboard's upcoming list, the report detail lists, the
  AI snapshot.

### One change: the session, once per request

`auth()` decrypts and verifies a JWE cookie and — inside the revalidation
window — reads the user back from the database to re-check their role, status
and tenant. Every guarded page calls `requireRole()`; the shell layout calls
`requireAuth()` for the navigation and again for the notification feed; a page
with three parallel reads calls it once per read.

`requireAuth` now resolves the session through React's `cache()`, which memoises
per **request** and never across them. On the dashboard that is **seven session
resolutions per render down to one** — and on a revalidating session, six fewer
database round trips before a single figure is read.

The parse is deliberately *outside* the memo: memoising the raw session is a
performance decision, and re-validating it on every call is a security one.

## 3. Bundle

`recharts` is the largest client dependency in the tree and only three screens
draw a chart, so it is behind `next/dynamic` with `ssr: false` and a
height-matched skeleton — `ssr: false` is a correctness requirement as much as a
size one, since `ResponsiveContainer` measures a parent element that does not
exist on the server.

`@react-pdf/renderer` and `@aws-sdk/client-s3` never reach the client at all:
both are used only inside route handlers, and the S3 driver is additionally
imported lazily so a deployment on local disk never loads it.

Measured on a production build:

| Route | Route JS | First Load JS |
|---|---|---|
| Shared by every page | — | **103 kB** |
| `/[locale]` (landing) | 2.33 kB | 161 kB |
| `/[locale]/app` (dashboard, two charts) | 4.23 kB | 206 kB |
| `/[locale]/app/checklists` (largest) | 12.7 kB | 224 kB |
| `/[locale]/app/my-jobs` | 8.24 kB | 176 kB |

The dashboard draws two charts and adds 4.23 kB of route JavaScript, which is
the split working: recharts is fetched when the chart mounts, not when the app
loads. A technician whose whole job is `/my-jobs` never downloads it.

Icons are imported per-icon from `lucide-react` throughout, so only the icons a
route actually renders are bundled.

## 4. Images

`next/image` is used for the one place the product renders an uploaded file —
the attachment gallery — with explicit `width`/`height` so the grid does not
reflow when a thumbnail arrives.

It is `unoptimized` there, and that is a correctness requirement rather than a
concession: the optimiser fetches the source URL from the server's own runtime,
which carries no session cookie, so every thumbnail behind `/api/files/[id]`
would come back 401. The component is still worth using for the layout
reservation and the lazy loading.

The marketing pages ship **no images at all**. The hero is a CSS radial
gradient: a few bytes, no request, cannot fail to load, and it adapts to both
themes without a second asset.

## 5. Measured result

Lighthouse 12, desktop preset, headless Chromium, against `next start` on a
production build.

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/en` | 99 | 100 | 100 | 100 |
| `/en/pricing` | 100 | 100 | 100 | 100 |
| `/ar` | 99 | 100 | 100 | 100 |

Before the static-CSP fix recorded in `docs/SEO.md`, best practices scored **92**
with the console full of CSP violations — the public pages were shipping HTML
that never hydrated. That is the one regression this pass caught, and it was
caught by measuring rather than by reading.

**The authenticated app is not in this table, and cannot be.** Lighthouse has no
session, so `/app` answers a redirect to the login page. Auditing it needs a
seeded database and an authenticated Lighthouse run, which belongs with the CI
work rather than here. What *is* verified above is the part a public audit can
reach, plus the bundle sizes and the query plans, which are the two things that
decide the authenticated experience.
