---
title: "Edge Computing & Caching"
slug: edge-computing-and-caching
level: advanced
module: global-scale
order: 31
reading_time_min: 14
concepts: [edge-computing, edge-caching, cdn, edge-functions, latency, edge-state]
use_cases: []
prerequisites: [cdn, global-load-balancing, caching-patterns-overview]
status: published
---

# Edge Computing & Caching

## Hook — a motivating scenario

A CDN already serves your static assets from the edge, milliseconds from users. But your **dynamic**
logic — auth checks, redirects, personalization, A/B routing, simple API responses — still round-trips
all the way to a distant region, adding 100ms+. What if you could run *code* and keep *some data* at
those same edge locations, right next to users? That's **edge computing** — pushing computation (not
just cached files) to the network edge.

## Mental model — push compute and data to the edge, next to users

A **CDN** caches **content** at edge **points of presence (PoPs)** worldwide (recall). **Edge
computing** extends that idea from *storing files* to **running code and holding small state** at those
same edge locations — so requests are handled **as close to the user as possible**, often without ever
reaching your origin region. It's the far end of the proximity spectrum you've been building:

```layers
{
  "title": "Proximity spectrum: closer = lower latency (top = closest to user)",
  "layers": [
    { "label": "Edge (PoPs, 100s of locations)", "detail": "Edge functions + edge cache/KV: run logic & serve data milliseconds from the user.", "meta": "closest" },
    { "label": "Region (a few datacenters)", "detail": "Your full app + databases; reached when the edge can't handle it.", "meta": "near" },
    { "label": "Origin (1 home region)", "detail": "Source of truth / heavy compute; farthest, highest latency.", "meta": "farthest" }
  ]
}
```

## Build it up — what runs at the edge (and what doesn't)

**Great at the edge** (latency-sensitive, lightweight, little/no strong state):
- **Edge caching** of static *and* cacheable dynamic responses (recall CDN).
- **Edge functions** (Cloudflare Workers, Lambda@Edge, Fastly Compute): auth/token checks, redirects,
  request rewriting, A/B routing, personalization, header/geolocation logic, simple API responses,
  bot/WAF filtering — executed at the PoP.
- **Edge key-value / state** (e.g. Workers KV): small, mostly-read, **eventually-consistent** data
  (config, feature flags, sessions) replicated to the edge. (Some platforms also offer single-home
  **strongly-consistent** edge primitives — e.g. Cloudflare **Durable Objects** — where each object is
  pinned to one location for serialized, consistent access; that's a coordination point, not the
  eventually-consistent replicated model.)

**Not suited to the edge:** heavy computation, large datasets, and anything needing **strong
consistency / transactions** — edge state is distributed across hundreds of locations, so it's
**eventually consistent** (recall multi-region consistency: you can't cheaply coordinate hundreds of
PoPs). Those stay in the **region/origin**.

```reveal
{
  "prompt": "Why are edge functions ideal for things like auth checks, redirects, and A/B routing, but a bad place to run your transactional database?",
  "answer": "Edge functions run at hundreds of PoPs milliseconds from users, with short-lived, lightweight execution and access to small, eventually-consistent edge state. That's a perfect fit for latency-sensitive, lightweight, mostly-stateless decisions: validating a token/JWT, redirecting based on geo/device, rewriting requests, choosing an A/B bucket, adding security headers, blocking bots — these need to happen fast and early (before a costly origin round trip), depend on little or only read-mostly data (keys, flags, rules) that can be replicated to the edge, and don't require strong consistency. Doing them at the edge cuts ~100ms+ off every request and offloads the origin. A transactional database is the opposite on every axis: it's the source of truth that must enforce strong consistency, isolation, and ACID transactions, which require coordination among its replicas; spreading it across hundreds of edge locations would demand cross-PoP coordination on every write — physically expensive (speed-of-light round trips, like multi-region consistency but worse with hundreds of sites) and operationally infeasible — so edge state is deliberately eventually consistent and small. It also often holds large datasets and does heavier compute than edge runtimes (which are intentionally constrained for fast cold-starts and density) are meant for. So you keep strong-consistency, transactional, large, or compute-heavy work in a few regions/origin, and push to the edge only the fast, lightweight, read-mostly / eventually-consistent logic. The dividing line is consistency and weight: edge for latency-critical, lightweight, eventually-consistent decisions; region/origin for strongly-consistent, transactional, heavy, or large-data work."
}
```

## Build it up — edge state is eventually consistent

Edge data stores (Workers KV, etc.) replicate values to PoPs and are **eventually consistent**, often
**read-optimized** (fast reads everywhere, slower/asynchronous writes that propagate). This is the
**multi-region consistency** story (previous chapter) taken to the extreme — *hundreds* of locations,
so synchronous coordination is out of the question. You design edge state for **read-mostly,
staleness-tolerant** data (config, flags, cached responses), and route writes/strongly-consistent reads
back to the region.

```reveal
{
  "prompt": "How does the consistency trade-off for edge state relate to (and intensify) the multi-region consistency problem?",
  "answer": "It's the same physics-bound trade-off as multi-region consistency, but amplified by going from a handful of regions to hundreds of edge PoPs. Multi-region consistency already showed that strong consistency requires cross-location coordination bounded by the speed of light (~100ms intercontinental per write), so global systems lean on weaker models (bounded staleness, causal/session, eventual) to serve locally at low latency. Edge computing pushes state to far more locations, so coordinating them synchronously is even more expensive and impractical — you simply cannot do a consensus/synchronous quorum across hundreds of PoPs on each write without crippling latency and availability. Therefore edge stores are deliberately eventually consistent and typically read-optimized: a write is accepted and then propagates asynchronously to all PoPs, so reads everywhere are fast but may be briefly stale, and there's no strong global ordering. This makes edge state suitable only for read-mostly, staleness-tolerant data (config, feature flags, cached/derived responses, perhaps sessions), where serving a slightly old value is fine and updates can lag. Anything needing strong consistency, transactions, or read-your-writes correctness must be handled at the region/origin (or read strongly from a home region), accepting the higher latency for that specific data. So edge computing inherits multi-region consistency's lesson — choose a consistency level per data, and you can't get strong + low-latency globally — and intensifies it: with hundreds of locations, eventual consistency isn't just a pragmatic choice, it's effectively the only feasible one for edge-replicated state. Design accordingly: cache and replicate read-mostly data to the edge, keep the source of truth and strongly-consistent operations centralized."
}
```

Where a given piece of work should live is a dial along the proximity spectrum — pushing outward buys latency, pulling inward buys consistency and capacity:

```tradeoff
{ "title": "Where should this work run along the edge -> origin spectrum?", "axis": { "left": "Edge (latency)", "right": "Origin (consistency / capacity)" }, "steps": [
  { "label": "Edge function + cache", "detail": "Latency-sensitive, lightweight, mostly-stateless logic: auth/JWT checks, redirects, A/B routing, personalization, WAF, cached API responses — handled milliseconds from users, often without an origin round trip." },
  { "label": "Edge KV / eventually-consistent state", "detail": "Read-mostly, staleness-tolerant data (config, feature flags, sessions) replicated to hundreds of PoPs. Fast reads everywhere; writes propagate asynchronously, so values can be briefly stale." },
  { "label": "Region", "detail": "Your full app plus databases in a few datacenters, reached when the edge can't handle a request — closer than origin but with real coordination across replicas." },
  { "label": "Origin / source of truth", "detail": "Strong consistency, ACID transactions, large datasets, and heavy compute live here. Coordination is feasible in one home region but cannot scale to hundreds of edge sites." }
] }
```

## In the wild

- **Edge platforms:** Cloudflare Workers + KV/Durable Objects, AWS Lambda@Edge / CloudFront Functions,
  Fastly Compute@Edge, Vercel/Netlify Edge Functions, Deno Deploy.
- **Common edge workloads:** auth/JWT verification, geo-routing & personalization, A/B testing,
  redirects/rewrites, WAF/bot mitigation, API response caching, image optimization, SSR/streaming at the
  edge.
- It builds on **CDN** (static caching) + **global load balancing** (region selection) — the edge is the
  outermost layer; the **region/origin** handles strong-consistency/heavy work.
- **Edge state** is eventually consistent/read-optimized (recall multi-region consistency).

## Common misconception — "edge computing replaces your regional backend / move everything to the edge"

The edge is a **latency-optimizing front layer** for lightweight, eventually-consistent work — your
**origin still owns** strong consistency, heavy compute, and the source of truth.

```reveal
{
  "prompt": "Why can't you 'just move everything to the edge,' and what's the right division of labor between edge and origin?",
  "answer": "Because the edge is optimized for proximity and lightweight, eventually-consistent work, not for the things a backend fundamentally must do. Edge runtimes are intentionally constrained (fast cold-start, high density, limited CPU/memory/runtime and execution time), and edge state is spread across hundreds of locations so it's eventually consistent and small/read-optimized. That makes the edge great for latency-critical, lightweight, mostly-stateless or read-mostly tasks (auth checks, redirects, rewrites, A/B routing, personalization, caching, WAF, simple API responses) — but unsuitable for strong-consistency operations, ACID transactions, large datasets, and heavy computation, all of which need centralized coordination and resources you can't replicate sanely to hundreds of PoPs. If you tried to move your transactional database or heavy services to the edge, you'd face infeasible cross-PoP coordination (speed-of-light × hundreds of sites), incorrectness (no strong consistency / read-your-writes), and resource limits. So the right division of labor is layered: the edge is a front layer that handles fast, lightweight, eventually-consistent logic and caching as close to users as possible, short-circuiting requests it can answer and offloading the origin; the region/origin remains the source of truth and home for strongly-consistent, transactional, large-data, and compute-heavy work, reached only when the edge can't (or shouldn't) handle the request. Edge complements and accelerates the backend; it doesn't replace it. Design by pushing to the edge what is latency-sensitive and tolerant of staleness, and keeping at the origin what requires consistency, transactions, scale, or heavy compute — exactly the proximity/consistency trade-offs from CDNs and multi-region consistency, applied at the outermost layer."
}
```

**Edge computing** extends CDN caching from **files to code + small state** at hundreds of **PoPs** —
running **lightweight, latency-sensitive, eventually-consistent** logic (auth, redirects, A/B,
personalization, API caching) **next to users**. Edge state is **eventually consistent/read-optimized**
(hundreds of locations → no synchronous coordination). It's a **front layer**, not a replacement —
**strong consistency, transactions, heavy compute, and the source of truth stay at the region/origin**.

## Self-test

```quiz
{
  "question": "Edge computing extends the CDN idea by:",
  "options": [
    "Caching even more static files",
    "Running code and holding small (eventually-consistent) state at edge PoPs, handling requests close to users without reaching the origin",
    "Replacing the need for any backend",
    "Making the database strongly consistent globally"
  ],
  "answer": 1,
  "explanation": "Edge computing runs lightweight logic + small read-mostly state at the edge (auth, redirects, A/B, API caching) — compute at the edge, not just files."
}
```

```quiz
{
  "question": "Edge state (e.g. Workers KV) is best used for:",
  "options": [
    "Strongly-consistent financial transactions",
    "Read-mostly, staleness-tolerant data (config, feature flags, cached responses) — it's eventually consistent across hundreds of PoPs",
    "Large analytical datasets",
    "Anything needing read-your-writes correctness"
  ],
  "answer": 1,
  "explanation": "With hundreds of locations, synchronous coordination is infeasible, so edge state is eventually consistent/read-optimized — keep strong-consistency work at the origin."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Edge computing & caching — key terms", "cards": [
  { "front": "Edge computing", "back": "Pushing computation and small state (not just cached files) to network edge PoPs, so requests are handled as close to users as possible, often without reaching the origin region." },
  { "front": "Point of presence (PoP)", "back": "An edge location, one of hundreds worldwide, where a CDN caches content and edge platforms run functions and hold small state milliseconds from users." },
  { "front": "Edge functions", "back": "Lightweight code run at the PoP (Cloudflare Workers, Lambda@Edge, Fastly Compute) for auth/token checks, redirects, request rewriting, A/B routing, personalization, and bot/WAF filtering." },
  { "front": "Edge key-value / state", "back": "Small, mostly-read, eventually-consistent data (config, flags, sessions) replicated to the edge, e.g. Workers KV. Read-optimized; writes propagate asynchronously." },
  { "front": "Why edge state is eventually consistent", "back": "It spans hundreds of PoPs, so synchronous coordination is infeasible (speed-of-light limits). Use for read-mostly, staleness-tolerant data; route strong-consistency work to the region." },
  { "front": "Proximity spectrum", "back": "Edge (closest, lowest latency) -> region (your full app + databases) -> origin (farthest, source of truth / heavy compute). Push latency-sensitive work outward, keep consistency-heavy work inward." }
] }
```

## Key takeaways

- **Edge computing** pushes **code + small state** (not just cached files) to hundreds of **edge PoPs**,
  handling **latency-sensitive** requests **next to users** — the outermost proximity layer (edge →
  region → origin).
- Great at the edge: **caching, auth/JWT checks, redirects/rewrites, A/B routing, personalization,
  WAF/bot filtering, simple/ cached API responses**.
- **Edge state is eventually consistent / read-optimized** (hundreds of locations → no synchronous
  coordination) — use for **read-mostly, staleness-tolerant** data; route strong-consistency work to the
  region.
- It's a **front layer, not a replacement** — **strong consistency, transactions, heavy compute, and
  the source of truth stay at the region/origin**.

## Up next

Serving many customers from shared infrastructure raises its own architecture questions. Next:
**Multi-Tenancy**.
