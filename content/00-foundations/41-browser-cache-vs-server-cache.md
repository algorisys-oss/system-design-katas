---
title: "Browser Cache vs Server Cache"
slug: browser-cache-vs-server-cache
level: foundations
module: caching-fundamentals
order: 41
reading_time_min: 13
concepts: [browser-cache, server-cache, private-vs-shared, cache-control, layers]
use_cases: []
prerequisites: [caching-fundamentals, cdn, http-fundamentals]
status: published
---

# Browser Cache vs Server Cache

## Hook — a motivating scenario

A request for your profile page can be answered without touching your servers at all (the browser had
it), or by a CDN edge, or by a Redis cache in your datacenter, or finally by the database. The same
data can be cached in **many places along the path** — and a single header field decides whether a
piece of data is safe to cache *publicly* or must stay *private to one user*. Get that wrong and you
leak one user's data to another; understand it and you cache aggressively and safely.

## Mental model — caches all along the road

Between a user and your database sits a chain of possible caches, each closer to the user than the
last:

```layers
{
  "title": "Where data gets cached (closest to user on top)",
  "layers": [
    { "label": "Browser cache (client)", "detail": "On the user's own device. A hit means NO network request at all — fastest possible. Private to that user.", "meta": "client" },
    { "label": "CDN / edge cache", "detail": "Shared cache near the user. Serves many users from one region. Public content only.", "meta": "edge" },
    { "label": "Server / app cache (Redis)", "detail": "In your datacenter, shared by your servers. Cuts database load. You control invalidation.", "meta": "server" },
    { "label": "Database buffer pool", "detail": "Hot pages kept in the DB's memory. The last cache before disk.", "meta": "db" }
  ]
}
```

The two big categories: **browser/client cache** (on the user's device, private to them) and
**server-side caches** (CDN edge + app cache, often shared across users). They solve different
problems and are controlled together via HTTP cache headers.

```compare
{
  "options": [
    { "label": "Browser (client) cache", "points": ["On the user's device", "A hit means zero network — fastest", "Private to one user", "Controlled via Cache-Control/ETag response headers"] },
    { "label": "Server-side cache (CDN/app)", "points": ["In edge or your datacenter", "Shared across many users", "Offloads origin/database", "You can invalidate it centrally"] }
  ]
}
```

## Build it up — private vs public, and the one dangerous mistake

The pivotal control is **who a cached copy may be shared with**, set by `Cache-Control`:

- **`private`** — only the end user's browser may cache it (personalized data: your account page).
  Shared caches (CDN/proxies) must **not** store it.
- **`public`** — any cache, including shared CDN/proxy caches, may store it (the same for everyone:
  the logo, a public article).
- **`no-store`** — don't cache anywhere (secrets, one-time data).
- **`max-age` / ETag** — how long to cache / how to revalidate (recall TTL and 304 Not Modified).

```reveal
{
  "prompt": "An API returns a user's private data with `Cache-Control: public, max-age=3600` and sits behind a CDN. What's the catastrophic bug?",
  "answer": "The CDN (a shared cache) stores user A's private response and then serves that same cached copy to user B who requests the same URL — leaking A's data to B. Personalized/sensitive responses must be `Cache-Control: private` (only the user's own browser caches) or `no-store`. Marking per-user data `public` at a shared cache is a classic, serious data-leak. The private/public distinction is a security boundary, not just a performance setting."
}
```

This is why shared caches (CDN/server) must only hold **public** data, while **private** per-user data
may still be cached in that user's own browser.

## In the wild

- **Static assets:** `Cache-Control: public, max-age=31536000, immutable` + content-hashed filenames —
  cache forever everywhere (recall cache busting).
- **Personalized API responses:** `private` (browser only) or `no-store` for sensitive data.
- **Revalidation:** `ETag` + `If-None-Match` lets a cache check "still fresh?" and get a cheap **304
  Not Modified** instead of re-downloading.
- **Layered hits:** a well-cached app answers most requests before they ever reach the database —
  browser → CDN → app cache → DB, in that order of preference.

## Common misconception — "caching is one thing you turn on in one place"

Caching is a coordinated chain, and each layer needs the right headers and invalidation story.

```reveal
{
  "prompt": "Why can't you reason about caching by thinking only about your Redis cache (or only about the CDN)?",
  "answer": "Because a request may be answered at any layer — the browser, a CDN edge, your app cache, or the DB buffer pool — and your HTTP headers control several of them at once. A change you make is only visible once *every* relevant cache along the path has updated or expired: invalidating Redis does nothing for a copy already cached in browsers or at the CDN. You must design caching holistically: what's cacheable, public vs private, TTLs/ETags, and how each layer is invalidated. Thinking about one layer in isolation leads to stale-data and data-leak surprises."
}
```

Caching is a **layered system**, not a single switch. Each layer (browser, CDN, app, DB) has its own
scope, control, and invalidation — and the `private`/`public` boundary is a security concern across
all of them.

## Self-test

```quiz
{
  "question": "Personalized, per-user data served through a shared CDN must be marked:",
  "options": [
    "Cache-Control: public",
    "Cache-Control: private (or no-store) — never public at a shared cache",
    "max-age=31536000",
    "immutable"
  ],
  "answer": 1,
  "explanation": "Public at a shared cache would let one user's data be served to another. Per-user data must be private/no-store."
}
```

```quiz
{
  "question": "A browser cache hit is special because it:",
  "options": [
    "Still contacts the CDN",
    "Requires no network request at all — served from the user's own device",
    "Is shared across all users",
    "Always returns stale data"
  ],
  "answer": 1,
  "explanation": "The browser cache is on the device, so a hit avoids the network entirely — the fastest possible response."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Browser cache vs server cache — key terms", "cards": [
  { "front": "Browser (client) cache", "back": "A cache on the user's own device, private to that user. A hit means no network request at all — the fastest possible response." },
  { "front": "Server-side cache", "back": "CDN edge plus app cache (e.g. Redis), shared across many users. Offloads the origin and database; you can invalidate it centrally." },
  { "front": "Cache-Control: private", "back": "Only the end user's own browser may cache the response. Shared caches (CDN/proxies) must not store it. Used for personalized data." },
  { "front": "Cache-Control: public", "back": "Any cache, including shared CDN/proxy caches, may store it. Used for content that is the same for everyone, like a logo or public article." },
  { "front": "The private/public security bug", "back": "Marking per-user data public lets a shared cache serve user A's response to user B — a data leak. The private/public split is a security boundary, not just performance." },
  { "front": "ETag / 304 Not Modified", "back": "A revalidation mechanism: a cache checks whether its copy is still fresh and receives a cheap 304 Not Modified instead of re-downloading the body." }
] }
```

## Key takeaways

- The same data can be cached at **many layers**: browser (private, on-device, zero-network) → CDN
  edge (shared) → app cache (shared, datacenter) → DB buffer pool.
- **`Cache-Control: private` vs `public`** is a **security boundary**: shared caches (CDN/app) may
  store only public data; per-user data is `private`/`no-store`.
- Control with **Cache-Control/max-age/ETag**; revalidate cheaply via **304 Not Modified**.
- Treat caching as a **coordinated chain** — each layer has its own scope and invalidation; reasoning
  about one in isolation causes staleness and leaks.

## Up next

That completes the foundations of compute, networking, storage, APIs, databases, and caching. The
final module assembles them into design thinking — starting with **HLD vs LLD**.
