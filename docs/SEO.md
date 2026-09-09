# Public site and SEO

SEO applies to the **public** surface only. The authenticated app is `noindex`
and behind a session, so there is nothing there for a crawler to index and
nothing about it we want published. This document records what the public pages
do, why, and the measured result.

## The surface

Four prerendered pages, in two languages, at `/{locale}`, `/{locale}/pricing`,
`/{locale}/contact` and `/{locale}/scenarios`. They live in the `(public)` route
group, which adds no path segment and exists to carry one thing the rest of the
tree must not have: `robots: { index: true }`.

A fifth public page, `/{locale}/signup`, is indexable but **not** prerendered —
it reads the sign-up switch and posts a form, so it renders per request. That is
why it lives in `DYNAMIC_PUBLIC_ROUTES` rather than `PUBLIC_ROUTES`: the latter
also decides which paths get the nonce-free static CSP, and handing that policy
to a page with a form would break the form. The two lists are asserted disjoint
in `src/lib/seo/__tests__/site.test.ts`.

`/{locale}/invite/[token]` is public in the sense that anyone holding the link
can open it, and is deliberately in neither list: its URL *contains* the secret,
so it is `noindex, nofollow, noarchive` and never appears in the sitemap.

That override is deliberately narrow, and there are two statements in opposite
directions so a mistake in either place is caught by the other:

| Segment | Robots |
|---|---|
| `[locale]/layout.tsx` | `index: false` — the default for the whole tree |
| `[locale]/(public)/layout.tsx` | `index: true` — the marketing pages only |
| `[locale]/app/layout.tsx` | `index: false, nocache, noarchive` — re-asserted |

## Static rendering

All six public pages are prerendered at build time. `export const dynamic =
"force-static"` is what makes that possible: the locale layout above reads the
theme cookie so `data-theme` is in the first byte of HTML, and a `cookies()`
call makes every page under it dynamic. Under `force-static` that call returns
empty at build time instead of throwing, so the page prerenders and the theme
falls back to the visitor's OS preference — which the CSS already honours
through `prefers-color-scheme`.

The cost, stated so it is not rediscovered as a bug: a visitor who has
explicitly overridden the theme sees one frame of their OS preference before the
client-side provider applies their choice. On a page somebody reads once, that
is worth a static render. Inside the app it would not be, and the app stays
dynamic.

## Content-Security-Policy on a static page

A nonce is minted per request; a prerendered page's HTML is written once at
build time. The two cannot meet — so a nonce policy on a static page blocks
Next's own hydration bootstrap and ships HTML that never comes alive. Lighthouse
finds this immediately, as a wall of CSP violations in the console, and that is
exactly how it was found here.

So `buildStaticContentSecurityPolicy()` drops the nonce and `strict-dynamic` and
accepts `'unsafe-inline'` for scripts, and the middleware applies it to the three
marketing paths and nowhere else. Everything else in the policy is unchanged:
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
`frame-ancestors 'none'`, and scripts may still only be **loaded** from our own
origin. The pages carry no session, no user data and no form that writes
anything.

## What each page declares

- **Canonical** — this page, this language, absolute. Without it the two locales
  are treated as duplicates of each other and one is dropped.
- **hreflang** — `en`, `ar` and `x-default` (English). Without `x-default` a
  crawler picks a default itself, and which one it picks for a Gulf audience is
  not predictable.
- **Open Graph and Twitter** — title, description, URL, locale and
  `alternateLocale`.
- **JSON-LD** — `Organization` and `SoftwareApplication` with an `offers` block,
  on the landing page **only**. A crawler needs the entity described once per
  site; three copies is three chances for them to disagree. The price in the
  offer is derived from `PLANS`, the same constant the pricing table renders, so
  the structured data cannot drift from the page under it.

`sitemap.xml` lists exactly `PUBLIC_ROUTES` × locales with per-entry hreflang.
`robots.txt` disallows `/app`, `/api` and `/style-guide`, derived from
`PROTECTED_PREFIX` rather than restated. `src/lib/seo/__tests__/site.test.ts`
asserts that no private path can reach either file.

## Measured

Lighthouse 12, desktop preset, headless Chromium, against `next start` on a
production build.

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/en` | 99 | 100 | 100 | 100 |
| `/en/pricing` | 99 | 100 | 100 | 100 |
| `/en/contact` | 99 | 100 | 100 | 100 |
| `/en/scenarios` | 99 | 100 | 100 | 100 |
| `/en/signup` | 100 | 100 | 100 | 100 |
| `/ar` | 99 | 100 | 100 | 100 |

The target in CLAUDE.md is ≥ 95 on the public pages; all four categories clear
it on all three. The two 99s are Largest Contentful Paint at 0.99 of the
threshold — a hero heading in a self-hosted variable font, and not worth a
preload hint that would cost a request on every other page in the product.

An earlier run, before the static-CSP fix above, scored **92 on best practices**
with the console full of CSP violations. That is what the fix bought, and it is
recorded here because the score is the only place the bug was visible.

### How to re-run it

```bash
pnpm build
pnpm start -p 3000 &
npx lighthouse http://127.0.0.1:3000/en \
  --only-categories=performance,accessibility,best-practices,seo \
  --preset=desktop --chrome-flags="--headless=new --no-sandbox"
```

## Deliberately absent

**A contact form.** CLAUDE.md's security rules say "no public write endpoints",
and a contact form is exactly that: an unauthenticated POST that writes
somewhere and sends mail. Doing it properly needs a spam defence, a rate limit on
an anonymous axis, an outbound mail provider and somewhere to put the message.
Until then the contact page publishes `mailto:` and `tel:` links a phone can act
on directly.
