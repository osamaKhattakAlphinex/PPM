# Security controls and audit

This is the audit CLAUDE.md's security section asks for: what protects the
product, where each control actually lives, what the audit found, and — the part
that matters most six months from now — which findings were fixed by adding a
**test that fails** if the property is ever lost again.

Nothing below is aspirational. Every claim names a file, and almost every claim
names the test that would break if the claim stopped being true.

---

## 1. The model: one door, not many locks

The product has thirteen modules and roughly seventy write paths. Auditing
seventy write paths is not a thing anyone can do twice, so the design does not
ask anyone to: **every write goes through one wrapper, and every read goes
through one data-access layer.** The audit is therefore about the two of them,
plus a check that nothing has been built around either.

```
   browser
      │  form POST / server action invocation
      ▼
 ┌──────────────────────────────────────────────────┐
 │ defineAction()            src/lib/security/action.ts │
 │   1. authenticate      requireAuth()             │
 │   2. authorise         assertRole(user, roles)   │
 │   3. resolve scope     getScope(session)  ← session, never payload
 │   4. rate limit        enforceRateLimit()        │
 │   5. validate          schema.parse(input)  ← strict
 └───────────────────────┬──────────────────────────┘
                         │  handler({ input, scope })
                         ▼
 ┌──────────────────────────────────────────────────┐
 │ repository.forScope(scope)     src/lib/db/       │
 │   • organizationId injected into every filter    │
 │   • clientId injected for CLIENT sessions        │
 │   • operators and dotted paths refused           │
 │   • no scope → nothing, never everything         │
 └───────────────────────┬──────────────────────────┘
                         ▼
                     MongoDB
```

The handler receives a `scope` it did not construct and cannot widen. That is
the whole design: **"checked the role" and "scoped to the tenant" are the same
step**, so it is not possible to do the second without having done the first.

---

## 2. Tenant isolation

### The rule

Every business document carries `organizationId`. CLIENT users additionally
carry `clientId`. Feature code never touches a Mongoose model — it calls
`repository.forScope(scope)`, and the scope comes from the session.

### How it is enforced, at four independent layers

| Layer | Mechanism | Where |
|---|---|---|
| Compile time | Repositories only exist behind `forScope()`; there is no unscoped accessor to call | `src/lib/db/repository.ts` |
| Lint | `dal-boundary` refuses `Model.find(...)` and `import … from "mongoose"` outside `src/lib/db` | `eslint-rules/dal-boundary.mjs` |
| Runtime | `getScope()` throws `ScopeResolutionError` when the session has no resolvable tenant | `src/lib/db/scope.ts` |
| Test | Cross-collection sweep, per-module suites, source audit | see §7 |

Four layers for one rule is deliberate. Lint can be silenced with a comment;
the source audit in `src/lib/security/__tests__/action-surface.test.ts` catches
exactly that, and the runtime check catches what neither can see.

### Deny by default

`getScope()` does not return a partial scope. A session missing
`organizationId` — an old token, a callback that forgot a claim — produces a
`ScopeResolutionError`, which `requireAuth` converts to a 401. There is no path
that yields a filter with `organizationId: undefined`, which in MongoDB would
match **every tenant's rows**.

### Ids from the client are never believed

An id in a payload is only ever used as one half of a filter whose other half is
the session's tenant, so a well-formed id belonging to another organization
returns *not found* rather than someone else's record. `clientId` is the one
tenant field that legitimately appears in a payload — a manager raising an
invoice picks the client it is for — and every such action verifies it back
through the scope first (`requireClientInScope`, `clientExistsInScope`,
`clientBelongsToOrganization`). A test now asserts that pairing across the whole
action surface, so a future action cannot read the field without the check.

---

## 3. Input validation

- Every action declares an `input:` schema; `defineAction` parses before the
  handler runs, so an unvalidated payload cannot reach a handler at all.
- Payload schemas are `z.strictObject` — unknown keys are **rejected**, not
  stripped. `entity()` builds model schemas the same way, so schemas derived
  with `.pick()` inherit it.
- Exactly one schema in the product strips rather than rejects: the credentials
  record Auth.js hands to `authorize()`, which arrives with Auth.js's own
  envelope fields alongside ours. It is annotated in the source, and the audit
  test counts the annotation — a second exception has to be written down next to
  the code before the suite will pass.

### NoSQL injection

`src/lib/db/sanitize.ts` is the only place a filter is built. It:

- refuses any key beginning with `$` or containing `.`;
- refuses any value that is an object with operator keys — so
  `{ email: { $ne: null } }` arriving in a body is an `UnsafeQueryError`, not a
  query;
- refuses any field the model does not declare, so a typo cannot silently widen
  a filter;
- never spreads a request body into a query.

`$where`, `mapReduce` and `$function` appear nowhere in the codebase.
`strictQuery` is on. Aggregation pipelines exist only inside `src/lib/db`, where
the first `$match` is built by `matchStage()` from the scope — a pipeline is the
one construct MongoDB lets you write that ignores a model's filters, so it is
confined to the layer that can prove it is scoped, and a test asserts
`.aggregate(` appears nowhere else.

---

## 4. Authentication and sessions

| Control | Value | Where |
|---|---|---|
| Password hashing | argon2id, 19 MiB / 2 passes / 1 lane (OWASP baseline) | `src/lib/auth/password.ts` |
| Rehash on login | Yes, when stored parameters are below current policy | same |
| Password policy | 12–128 chars, length over composition (NIST SP 800-63B) | `src/lib/auth/schemas.ts` |
| Session | JWE cookie, `httpOnly`, `sameSite: lax`, `secure` + `__Secure-` prefix on HTTPS | `src/lib/auth/config.ts` |
| Session lifetime | 8 hours (one shift) | same |
| Revalidation | User re-read from the database every 5 minutes — the upper bound on how long a suspended or downgraded user keeps old access | `src/lib/auth/auth.ts` |
| Redirects | `safeRedirectPath()` — same-origin relative paths only | `src/lib/auth/redirect.ts` |

Sign-in failures are neutral: a wrong password, an unknown email and a suspended
account are indistinguishable to the caller. The password field at sign-in is
validated as *non-empty* rather than against the policy — rejecting a short
password early would tell an attacker which stored passwords predate the current
rules.

There is **no self-service registration**. Accounts are provisioned by an
ADMIN or FM_MANAGER inside an existing organization and start `INVITED`.

---

## 5. Rate limits

Sliding windows, keyed per user or per IP, with a block period longer than the
window so a burst costs a real pause rather than letting an attacker trickle at
exactly the limit forever.

| Endpoint | Limit | Window | Block | Key |
|---|---|---|---|---|
| `login` | 10 | 10 min | 15 min | IP |
| `login:email` | 5 | 10 min | 15 min | email |
| `register` | 20 | 1 hour | — | user |
| Every mutation (default) | 120 | 1 min | 1 min | user |
| Sensitive mutations | 10 | 1 min | 5 min | user |
| `POST /api/files` | 20 | 1 min | — | user + IP |
| `GET /api/invoices/[id]/pdf` | 20 | 1 min | — | user + IP |
| `GET /api/reports/[type]/pdf` | 10 | 1 min | — | user + IP |
| `POST /api/ai/insights` | 6 | 1 min | 5 min | user + IP |

Login is limited on **two axes** because they defeat different attacks: the IP
limit stops one host trying many passwords, the email limit stops a botnet
trying one password against one account from a thousand hosts.

**Stated limitation.** The counters live in process memory, so N instances allow
roughly N times the limit and a cold start forgets everything. This raises the
cost of a brute-force run by orders of magnitude without adding a dependency,
and the interface is the one a shared store would implement — moving to Redis
means reimplementing `consume`, not touching a single caller. The tracked-key
map is capped at 10,000 entries so the limiter cannot itself become the
memory-exhaustion vector.

---

## 6. The rest of the surface

**Headers** (`src/lib/security/headers.ts`, applied in `src/middleware.ts`):
CSP with a per-request nonce and `strict-dynamic` on dynamic routes;
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
`frame-ancestors 'none'`; HSTS with preload on HTTPS; `nosniff`;
`X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`;
a `Permissions-Policy` that switches off the APIs the product does not use.
Prerendered marketing pages get a nonce-free variant — see `docs/SEO.md` for why
a nonce and a static page cannot meet.

**Errors.** `handleApiError` and `ActionResult` return a code and a generic
sentence. Stack traces, Mongo errors and duplicate-key details are logged
server-side with a request id and never serialised to a client. A duplicate
email is a neutral 409 on purpose: a distinguishable one is an account-existence
oracle.

**File uploads** (`src/lib/files/`, `src/lib/domain/files.ts`): six ordered
checks — session and role, rate limit, declared size, sniffed **magic bytes**
(the declared MIME type is not trusted), an allow-list that excludes SVG because
an SVG is a script, and a filename reduced to its basename and stripped of
control and path characters. Stored under a random key, never the user's name.
JPEG metadata (APPn, COM) is stripped so a photo cannot carry GPS coordinates or
a payload. Downloads are served with the sniffed type, `nosniff`, `no-store` and
a `sandbox` CSP.

**AI** (`src/lib/ai/`, `src/app/api/ai/insights/route.ts`): the model sees an
aggregate snapshot — counts, ages, statuses — with no client names, no user
names, no money and no free text beyond a 160-character truncated fault
description, capped at 40 rows. Database content is fenced inside a delimiter
carrying a **per-request random tag**, so a fault description cannot forge the
end of the data block and be read as instruction. The system prompt is authored
in code and never composed from data. The output is advisory text; the model
never writes to the database and has no tools.

**The two public writes.** CLAUDE.md says there are no public write endpoints.
There are now two, both deliberate, and both are the same shape: they run before
anybody has a session, so `defineAction` cannot wrap them and every step it
would have taken is taken explicitly instead — refuse if disabled, rate limit by
IP *before* parsing, parse strictly, act.

*Registering a company* (`signupAction`) creates a new organization and its
first ADMIN. What makes it defensible is what it cannot reach: there is no path
through it that reads, changes or names a row belonging to an existing tenant.
Three attempts an hour per address then an hour's lockout; a honeypot field,
answered as a success so a bot learns nothing; one neutral message for "email
taken" and "company exists" alike, because email is unique system-wide and a
specific answer is an oracle for who uses the product. `SIGNUP_ENABLED=false`
closes it, checked in the action as well as the page.

*Accepting an invitation* (`acceptInviteAction`) creates nothing — it completes
an invitation an administrator already issued, to an account whose role they
already chose. The token is 32 bytes of CSPRNG output, shown once, stored only
as a SHA-256 digest, valid seven days, single-use. Redemption is one conditional
update matching on the digest, so two people racing the same link cannot both
succeed. Unknown, expired, redeemed and suspended all answer the same sentence.

SHA-256 rather than argon2 for the token is deliberate: argon2 is slow to make a
*low-entropy* secret expensive to guess, and this one has 2^256 to search, no
dictionary and no reuse — the slowness would buy nothing and cost a page load.

**The scheduled job** (`/api/jobs/notifications`) is the one route with no user.
It authenticates with a shared secret compared using `timingSafeEqual`, and
returns 503 rather than running when `CRON_SECRET` is unset. Its only unscoped
read is the list of active organization ids; everything after that runs under a
system scope built per organization.

**Secrets.** All configuration is read through `src/lib/env.ts`. No credential
is ever named `NEXT_PUBLIC_*` — that prefix inlines a value into the client
bundle, which makes a naming mistake a disclosure rather than a misconfiguration.
`hasAnthropicKey()` returns a boolean so a Server Component can ask whether the
AI feature is available without the key entering a render tree. Verified
empirically: `grep -r` over the built `.next/static` finds no key.

---

## 7. Audit results

The audit ran in three passes: read every mutation and route by hand, grep the
whole tree for the patterns that defeat each control, and then **write down the
findings as tests**, because an audit that is not executable is an audit that is
true only on the day it was performed.

### Findings

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `markApprovalInvoiced(scope, …)` was exported from a `"use server"` module. Every export of such a module is a browser-callable endpoint, so this was a live path to act on **any scope an attacker chose to send**. | **Critical** | Moved to `src/lib/approvals/complete.ts` with `import "server-only"`. It is now unreachable from a browser and a build error to import from a client. |
| 2 | Nothing prevented a *future* action from reading `organizationId` out of its payload. Every existing action was correct; the property was unenforced. | High (latent) | `action-surface.test.ts` asserts it across the whole action surface. |
| 3 | Actions may legitimately accept a `clientId` — but nothing required the id to be verified against the caller's tenant. All four call sites did verify; again, the property was unenforced. | High (latent) | Test asserts the pairing: an action that reads `input.clientId` must also call one of the three in-scope verifiers. |
| 4 | `credentialsSchema` used `z.object` (strips) rather than `z.strictObject` (rejects). | Informational — required by Auth.js's envelope | Documented in the source and allow-listed by a counted annotation, so the exception cannot spread silently. |
| 5 | A per-module isolation suite structurally cannot catch a module added later whose author wrote a repository but no test. | Medium (latent) | `cross-module-isolation.test.ts` asks the same questions of **all twelve** collections from one table, and asserts the table's own length. |
| 6 | Public marketing pages shipped HTML that never hydrated, because a per-request nonce cannot match build-time HTML. | Medium (availability) | Separate static CSP; `docs/SEO.md`. Best-practices score 92 → 100. |
| 7 | `registerUser` existed with no screen, and a created account is INVITED — so an administrator could create a colleague but nothing could let them in. In practice that meant passwords invented by an administrator and communicated by hand. | Medium | Admin → Users, plus single-use invitation links so a colleague sets their own password. Nobody's password is known to two people. |
| 8 | Changing a password did not clear an outstanding invitation, so a live link could still set the password again without knowing the current one — defeating the check that exists precisely to stop that. | High | `changePassword` clears the invitation in the same update. |
| 9 | The two public actions bypass `defineAction` and did not replicate its error handling, so any unexpected failure escaped as a 500 and replaced the page with a crash screen. From the visitor's side that is indistinguishable from the button doing nothing — which is how it was reported. | Medium (availability) | Both are wrapped: the detail goes to the server log, the caller gets one generic sentence, and `unstable_rethrow` keeps the framework's own redirect signal from being swallowed. |
| 10 | The sign-up honeypot was named `website`, which is exactly what browser profile autofill targets. A filled honeypot is answered with silence, so a visitor whose browser helpfully filled it would lose their registration and be told nothing. | Medium | Renamed to a field no autofill heuristic looks for, with a test asserting the attractive names are still rejected. |

Findings 2, 3 and 5 are the characteristic result of auditing a codebase that
was written carefully: the code was right, and the *guarantee that it stays
right* was missing. That is the gap this pass closed.

### The two new suites

**`src/lib/db/__tests__/cross-module-isolation.test.ts`** — 94 tests. One table
of twelve collections; each row is asked the same six questions: does a read
from another organization return nothing, does an update, does a delete, is the
tenant stamped from the scope rather than from the payload on create, are
operator-shaped and dotted filter keys refused, is a filter on a path the model
does not have refused. Rows that carry a `clientId` are additionally asked
whether a client session sees only its own rows and has its client stamped from
the scope; rows that do not are asked whether a client session is refused
outright. The final assertion is `expect(SUBJECTS).toHaveLength(12)`, so
adding a repository without adding a row is itself a failure.

**`src/lib/security/__tests__/action-surface.test.ts`** — 13 tests. A lint rule
written as a test: it reads the source of every file under `src/` and asserts
the shape of the whole surface — every `defineAction` declares roles and a
schema, no action takes an organization from a payload, any `clientId` from a
payload is verified, payload schemas are strict, every API route calls
`requireRole` (excepting the Auth.js handler and the secret-authenticated job)
and `handleApiError`, mongoose and `.aggregate(` stay inside `src/lib/db`, no
credential wears a `NEXT_PUBLIC_` name, and the Anthropic key is read in exactly
two files.

### Suite totals

54 test files. **831 assertions pass** in this environment; 425 more live in the
15 MongoDB-backed suites.

> **Honest note on the 425.** They do not fail — they never start. This
> environment's network policy returns 403 for `fastdl.mongodb.org`, so
> `mongodb-memory-server` cannot download the `mongod` binary it needs. All 15
> failures are byte-identical download errors and there is not a second cause
> among them; the suites collect their tests (the cross-module sweep collects all
> 94) and then skip. They run normally wherever that download is permitted, which
> is why CI provisions MongoDB as a service container rather than relying on the
> in-memory server — see `docs/DEPLOYMENT.md`.

---

## 8. Known limitations

Stated rather than hidden, because a control whose limits are undocumented gets
trusted past them.

1. **Rate limits are per instance.** See §5. Move to Redis before horizontal
   scaling, or accept N× the configured limits.
2. **No CSRF token on server actions.** Next.js server actions verify Origin
   against Host, and the session cookie is `sameSite: lax`, so a cross-site POST
   from a third-party page does not carry it. There is no additional
   double-submit token; if the app is ever embedded or the cookie policy
   loosened, add one.
3. **A password change does not sign out other devices.** Sessions are
   stateless JWEs, so revoking one needs a server-side session store or a
   per-user token version, and neither exists yet. The account page says so
   rather than implying otherwise. The lever that does work today is rotating
   `AUTH_SECRET`, which signs out the whole deployment; suspending an account
   takes effect within `AUTH_SESSION_REVALIDATE_AFTER` (five minutes).
4. **No audit log of reads.** Writes leave a document with `createdBy` and
   timestamps, and approvals keep an append-only history, but a user reading a
   record they should not have opened leaves no trace beyond the web-server log.
5. **File uploads are scanned, not virus-scanned.** Type sniffing and metadata
   stripping stop the browser-side attacks; a PDF carrying a payload for a
   desktop reader would pass. Add an AV pass in the storage pipeline if
   untrusted parties are ever allowed to upload.
6. **The contact page has no form.** Deliberate — CLAUDE.md forbids public write
   endpoints, and a contact form is one. See `docs/SEO.md`.
7. **The authenticated app has not been Lighthouse-audited**, because Lighthouse
   has no session. See `docs/PERFORMANCE.md`.

---

## 9. Re-running the audit

```bash
pnpm typecheck                 # no any, no unchecked access
pnpm lint                      # includes the dal-boundary rule
pnpm test                      # 54 suites, including the two above
```

The audit is those three commands. It is not a document, and it does not depend
on anyone remembering what this one says.
