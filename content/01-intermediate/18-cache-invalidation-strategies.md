---
title: "Cache Invalidation Strategies"
slug: cache-invalidation-strategies
level: intermediate
module: caching-patterns
order: 18
reading_time_min: 14
concepts: [invalidation, ttl, write-invalidate, versioning, event-driven-invalidation, stale-while-revalidate]
use_cases: []
prerequisites: [cache-aside, caching-patterns-overview]
status: published
---

# Cache Invalidation Strategies

## Hook — a motivating scenario

"There are only two hard things in Computer Science: cache invalidation and naming things." You've
met the joke; now meet the reality. A price changes, but three caches (browser, CDN, app) keep serving
the old one for hours; you fix that with aggressive invalidation, and now a thundering herd of misses
takes down the database. Invalidation is the art of deciding **when a cached copy is no longer valid**
— and every approach trades **freshness against load and complexity**.

## Mental model — the cached copy can go stale; how do you retire it?

A cache holds a *copy*; when the source changes, that copy is **stale**. Invalidation is how you
retire stale copies. The main strategies, from simplest to most precise:

```compare
{
  "options": [
    { "label": "TTL (expiry)", "points": ["Entry auto-expires after a set time", "Dead simple; self-healing", "Stale up to the TTL; tune freshness vs hit rate", "The baseline everyone uses"] },
    { "label": "Write-invalidate", "points": ["Delete the key when its data is written", "Fresh right after writes", "Must wire into every write path", "Cache-aside's standard companion"] },
    { "label": "Event-driven", "points": ["A change event invalidates affected keys", "Precise + timely across services", "Needs a pub/sub + event plumbing", "For multi-service / multi-cache"] }
  ]
}
```

## Build it up — TTL vs explicit invalidation

- **TTL** is the safety net: every entry expires after N seconds, so even un-invalidated data
  self-heals. Short TTL = fresher but lower hit rate (more misses); long TTL = higher hit rate but
  staler. You almost always set *some* TTL.
- **Write-invalidate** (delete-on-write, from cache-aside) makes data fresh immediately after a write,
  but you must invalidate from **every** path that mutates the data — including background jobs and
  *other services*, which is where it breaks down at scale.

```reveal
{
  "prompt": "Why is TTL alone insufficient for a price that must update immediately, and why is write-invalidate alone risky across many services?",
  "answer": "TTL alone means the price stays stale for up to the TTL window after a change — unacceptable if it must be correct now (you'd have to set TTL near-zero, destroying the hit rate). Write-invalidate fixes that by deleting the key on write — but only if *every* code path that changes the price remembers to invalidate. In a multi-service system, a price might be updated by an admin tool, a batch import, or another service; if any forgets to invalidate (or doesn't know about your cache), that path serves stale data indefinitely. So you combine them: explicit invalidation for timeliness + a TTL backstop so any missed invalidation self-heals — and for cross-service correctness, event-driven invalidation."
}
```

Drag the TTL dial to feel the freshness-vs-hit-rate trade:

```tradeoff
{ "title": "How long should a cache TTL be?", "axis": { "left": "Short TTL", "right": "Long TTL" }, "steps": [ { "label": "Near-zero TTL", "detail": "Almost always fresh, but entries expire constantly so most requests miss and hammer the source; synchronized expirations invite stampedes." }, { "label": "Short TTL", "detail": "Fresher data, lower staleness window, but a reduced hit rate means more load on the database." }, { "label": "Long TTL", "detail": "Higher hit rate and less source load, but data can stay stale for up to the TTL window after a change." }, { "label": "Very long / no expiry", "detail": "Maximum hit rate, but un-invalidated data stays stale indefinitely; you need explicit invalidation to retire copies." } ] }
```

## Build it up — precise and resilient strategies

- **Event-driven invalidation:** when data changes, publish a change event (via pub/sub — next
  module); caches/services subscribe and invalidate the affected keys. This keeps **many caches across
  many services** consistent without each write path knowing every cache — the scalable answer to the
  cross-service problem.
- **Versioned keys / key bumping:** include a version in the cache key (`product:7:v5`). To
  "invalidate," bump the version (`v6`) — old entries are simply never read again and expire on their
  own. Avoids races and mass deletes (this is the **cache-busting** idea from the CDN chapter).
- **Stale-while-revalidate:** serve the stale value *immediately* while asynchronously refreshing it
  in the background — great UX (no miss latency) with eventual freshness; also tames stampedes.

```reveal
{
  "prompt": "How does 'stale-while-revalidate' improve both latency and stampede behavior compared to plain TTL expiry?",
  "answer": "With plain TTL, the instant a popular key expires, requests miss and must wait for a fresh load — and many concurrent requests stampede the source at once (thundering herd). Stale-while-revalidate instead serves the slightly-stale cached value immediately (no miss latency for the user) and kicks off a single background refresh to update it. So readers never block on a reload, and only one refresh hits the source instead of thousands — combining low latency with stampede protection, at the cost of briefly serving stale data. It's ideal when a few seconds of staleness is acceptable but latency spikes and herds are not."
}
```

## In the wild

- **TTL + write-invalidate** is the everyday combo for app caches (cache-aside): delete on write,
  expire as backstop.
- **Event-driven invalidation** (via Kafka/pub-sub or DB change-data-capture) keeps distributed caches
  consistent across services.
- **Versioned keys / cache-busting** are standard for CDNs and immutable assets (content-hash
  filenames), and handy for app caches to avoid mass invalidation.
- **`stale-while-revalidate`** is a real HTTP `Cache-Control` directive and a common app pattern for
  hot, slightly-staleable data.

## Common misconception — "just lower the TTL to keep data fresh"

Cranking TTL down trades one failure (staleness) for another (load), and still isn't precise.

```reveal
{
  "prompt": "A team fixes staleness by dropping all TTLs to a few seconds. What new problems did they create, and what should they have done?",
  "answer": "They tanked the hit rate (entries expire constantly, so most requests now miss) and multiplied load on the database — and synchronized expirations cause stampedes/thundering herds when many hot keys expire together. They also still aren't truly fresh: there's always a several-second stale window. Better: keep reasonable TTLs as a backstop and add *explicit* invalidation where timeliness matters — write-invalidate for single-service data, event-driven invalidation across services, and/or versioned keys; use stale-while-revalidate + TTL jitter to avoid herds. Precision (invalidate exactly what changed, when it changes) beats blanket short TTLs, which just convert a freshness problem into a load/latency problem."
}
```

Invalidation is a **freshness-vs-load-vs-complexity** trade. The robust recipe is **explicit
invalidation (write or event-driven) for timeliness + a TTL backstop + stampede protection** — not
just a tiny TTL, which sacrifices hit rate and invites herds.

## Self-test

```quiz
{
  "question": "The most robust everyday approach to cache freshness is:",
  "options": [
    "A very long TTL only",
    "Explicit invalidation on write (or via events) combined with a TTL backstop",
    "Never expiring entries",
    "A few-second TTL on everything"
  ],
  "answer": 1,
  "explanation": "Explicit invalidation gives timeliness; the TTL backstop self-heals any missed invalidation. Tiny TTLs just hurt hit rate."
}
```

```quiz
{
  "question": "To keep caches across MANY services consistent when data changes, the scalable strategy is:",
  "options": [
    "Each write path manually deletes keys in every service",
    "Event-driven invalidation — publish a change event that interested caches subscribe to",
    "Longer TTLs",
    "Disable caching"
  ],
  "answer": 1,
  "explanation": "Pub/sub change events let many caches invalidate the right keys without every writer knowing every cache."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Cache invalidation strategies — key terms", "cards": [ { "front": "Stale copy", "back": "A cached copy whose source data has since changed; invalidation is how you retire stale copies so readers stop getting outdated values." }, { "front": "TTL (expiry)", "back": "An entry auto-expires after N seconds. Simple and self-healing; short TTL = fresher but lower hit rate, long TTL = higher hit rate but staler." }, { "front": "Write-invalidate (delete-on-write)", "back": "Delete the cache key whenever its data is written, making it fresh right after a write — but you must wire it into every write path." }, { "front": "Event-driven invalidation", "back": "On a data change, publish a change event via pub/sub; caches across services subscribe and invalidate affected keys. The scalable cross-service answer." }, { "front": "Versioned keys / key bumping", "back": "Embed a version in the key (product:7:v5). Bump it to v6 to invalidate; old entries are never read again and expire on their own, avoiding races and mass deletes." }, { "front": "Stale-while-revalidate", "back": "Serve the stale value immediately while asynchronously refreshing it in the background — low latency, eventual freshness, and stampede protection." } ] }
```

## Key takeaways

- Invalidation retires **stale copies**; the strategies trade **freshness vs load vs complexity**.
- **TTL** = simple self-healing backstop (tune freshness vs hit rate); **write-invalidate** = fresh on
  write but must cover every write path.
- **Event-driven invalidation** scales across services; **versioned keys** avoid races/mass deletes;
  **stale-while-revalidate** gives low latency + stampede protection.
- Best practice: **explicit invalidation + TTL backstop + stampede protection** — not just a tiny TTL.

## Up next

That completes caching patterns. The next module is async communication done right — starting with
**Message Queues**.
