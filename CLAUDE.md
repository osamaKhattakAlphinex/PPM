## Product
PPM Platform: a multi-tenant facility maintenance management system (CMMS) for the Gulf market. Bilingual English/Arabic (RTL). Currency SAR. Roles: ADMIN, FM_MANAGER, SUPERVISOR, TECHNICIAN, CLIENT.

## Stack
Next.js App Router + TypeScript, MongoDB via Mongoose, Auth.js for authentication, Tailwind + Framer Motion for UI, zod for validation. All secrets via environment variables only.

## Data isolation (CRITICAL — never violate)
- Every business document has an `organizationId`. CLIENT-role users are additionally scoped to a `clientId`.
- Feature code MUST NEVER call a Mongoose model directly. All access goes through the tenant-scoped data-access layer (to be built in Prompt 0.4), which injects organizationId (and clientId for client users) into every query, update, and delete.
- Deny by default: if scope cannot be resolved from the session, the query fails closed and returns nothing.
- Never trust an id from the client to belong to the user; always re-scope by the session's org/client.

## Security rules (apply to every route and mutation)
- Validate and parse EVERY input with a zod schema before it touches the database. Reject unknown fields.
- Prevent NoSQL injection: never spread request bodies into query operators; strip keys starting with `$` or containing `.`; never use `$where`, `mapReduce`, or `$function` with user input; keep Mongoose `strictQuery` on.
- Every API route and server action checks the session and the caller's role before doing anything. No public write endpoints.
- Rate-limit auth and mutation endpoints. Set secure HTTP headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy). Handle CORS strictly.
- Never expose stack traces or Mongo errors to the client. Log server-side, return a generic message.
- Passwords hashed with bcrypt/argon2. Sessions httpOnly + secure cookies.

## API conventions
- Prefer Server Components for reads and Server Actions for writes. Use Route Handlers only for webhooks, file, and AI endpoints.
- Standard response shape and typed errors. Always paginate list endpoints.

## Performance
- Add MongoDB compound indexes starting with organizationId for every common query. Use `.lean()` for reads, project only needed fields, and paginate.
- Use Server Components + streaming. next/image for all images. Dynamic-import heavy client components (charts, editors). Cache stable reads.

## SEO (public pages only)
- The authenticated app is noindex. Public marketing pages use the Next.js Metadata API, semantic HTML, Open Graph, JSON-LD, a sitemap, robots.txt, and hreflang for en/ar.

## UI / design
- Must NOT look like a generic AI-generated dashboard. Follow /docs/DESIGN.md (Prompt 0.2): custom palette, deliberate typography, real motion via Framer Motion, purposeful micro-interactions. Mobile-first and fully responsive with proper touch targets. Respect prefers-reduced-motion. Keyboard-accessible with visible focus.

## Workflow
- Keep changes small and typed. No `any`. Write a short test for every data-access rule and every validation schema.
