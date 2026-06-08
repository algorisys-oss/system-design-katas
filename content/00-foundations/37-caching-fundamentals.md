---
title: "Caching Fundamentals"
slug: caching-fundamentals
level: foundations
module: caching-fundamentals
order: 37
reading_time_min: 15
concepts: [caching, latency, locality, ttl, staleness, invalidation]
use_cases: []
prerequisites: [memory-hierarchy, database-reads-vs-writes, latency-numbers]
status: published
---

# Caching Fundamentals

## Hook — a motivating scenario

Your homepage runs the same expensive query — "top 10 trending products" — for every one of a million
daily visitors, even though the answer barely changes minute to minute. The database melts under
identical work. Compute it **once**, keep the answer handy, and serve the next million visitors from
that copy in microseconds. That's caching — arguably the highest-impact performance technique in all
of system design.

## Mental model — keep the answer where it's cheap to reach

A cache is a small, fast store that holds **copies of frequently-used data** close to where it's
needed, so you avoid recomputing or re-fetching it from a slow source. It works for the same reason
the memory hierarchy does: **locality** — the same data tends to be requested again soon (temporal)
and is far cheaper to serve from memory than from disk/DB/network (recall the latency ladder: RAM
~100 ns vs DB query ~ms).

```flow
{
  "title": "A read with a cache in front of the database",
  "nodes": [
    { "label": "Request", "detail": "App needs some data (e.g. product #7)." },
    { "label": "Cache", "detail": "Check here first. HIT → return in microseconds, done." },
    { "label": "Database", "detail": "Only on a MISS: query the slow source (ms)." },
    { "label": "Store + return", "detail": "Put the result in the cache (for next time), then return it." }
  ],
  "note": "The fastest query is the one you never send to the database. A high hit rate is the whole game."
}
```

## Build it up — hit rate, TTL, and the hard part

- **Hit rate** is the metric that matters: the fraction of requests served from cache. A 95% hit rate
  means the database sees only 5% of the traffic. Small hit-rate gains = big load reductions.
- **TTL (time to live):** cached entries expire after a set time, so data isn't served forever.
  Short TTL → fresher but lower hit rate; long TTL → faster but staler. (Recall DNS TTL — same idea.)
- **The catch — staleness:** a cache holds a *copy*, so when the source changes, the cache can be
  **out of date** until it expires or is invalidated. Managing that is the genuinely hard part:

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil
> Karlton

```reveal
{
  "prompt": "You cache a product's price with a 1-hour TTL. The price changes — what does a customer see, and how do you control it?",
  "answer": "Until the entry expires (up to an hour) or is explicitly invalidated, customers see the old cached price — a staleness window equal to the TTL. You control it by trading freshness vs load: lower the TTL (fresher, more DB hits), or actively invalidate/update the cache entry when the price changes (fresh immediately, but you must wire the write path to touch the cache). The right choice depends on how costly stale data is — a price needs tighter control than a 'trending products' list."
}
```

Picture TTL as a dial between always-fresh and maximally-fast — drag it and watch the trade flip:

```tradeoff
{
  "title": "How long should a cached entry live (TTL)?",
  "axis": { "left": "Short TTL (freshness)", "right": "Long TTL (load reduction)" },
  "steps": [
    { "label": "Very short TTL", "detail": "Entries expire fast, so customers almost never see stale data — but the hit rate drops and the database absorbs more traffic." },
    { "label": "Moderate TTL", "detail": "A balance: most reads hit the cache while the staleness window stays bounded to a tolerable few minutes." },
    { "label": "Long TTL", "detail": "High hit rate and microsecond serves shield the database, but the cached copy can stay out of date for a long time." },
    { "label": "Long TTL + active invalidation", "detail": "Keep the long TTL's load wins, but wire the write path to invalidate/update on change so freshness no longer waits for expiry." }
  ]
}
```

## Build it up — caches are everywhere

Caching isn't one box; it's a principle applied at every layer (each its own chapter ahead):
- **Client/browser cache** — store responses on the device (no network at all).
- **CDN** — cache content at edge servers near users.
- **Application cache** — in-memory (Redis/Memcached) for query results, sessions, computed values.
- **Database cache** — the buffer pool keeps hot pages in memory.

```reveal
{
  "prompt": "Why is a higher cache hit rate so disproportionately valuable for protecting a database?",
  "answer": "Every cache hit is a request the database never sees. Going from 90% → 95% hit rate doesn't sound huge, but it halves the database's load (misses drop from 10% to 5% of traffic). At 99% the DB sees 1% of requests. Because the source is the scarce, expensive resource, each percentage point of hit rate removes a large absolute amount of work from it — which is why caching is the first lever for read scaling."
}
```

## In the wild

- **Read-heavy systems** (most apps) put a cache in front of the database to cut load and latency —
  the standard companion to read replicas.
- **Redis/Memcached** are the workhorse application caches; **CDNs** cache at the edge; **browsers**
  cache via HTTP headers.
- **Hit rate, latency, and eviction stats** are key cache metrics to monitor.
- **The danger:** stale data and cache-related bugs (thundering herd on expiry, inconsistency) — which
  the next chapters (hits/misses, eviction, patterns) address.

## Common misconception — "just add a cache and everything gets faster, for free"

Caching introduces a second copy of the truth — and copies drift.

```reveal
{
  "prompt": "What's the hidden cost a team signs up for the moment they add a cache?",
  "answer": "They now have two sources of the same data that can disagree — so they own a consistency problem: deciding TTLs, invalidating on writes, and handling the staleness window. Add the failure modes: a cold cache after restart (sudden DB load), thundering herd when a popular key expires and everyone hits the DB at once, and bugs from serving stale data. Caching is a powerful optimization, but it's a trade of complexity and potential staleness for speed — not free magic. You must design invalidation and failure behavior, not just 'turn it on'."
}
```

A cache is a deliberate trade: huge speed and load wins in exchange for managing **staleness,
invalidation, and cache-specific failure modes**. Done well it's transformative; done carelessly it
serves wrong data.

## Self-test

```quiz
{
  "question": "The single most important metric for a cache's effectiveness is:",
  "options": ["Total size in GB", "Hit rate (fraction of requests served from cache)", "Number of keys", "CPU usage"],
  "answer": 1,
  "explanation": "Hit rate determines how much load/latency the cache removes from the slow source; higher hit rate ≈ far less DB work."
}
```

```quiz
{
  "question": "The fundamental trade-off introduced by caching is:",
  "options": [
    "More storage for less compute",
    "Speed/load reduction in exchange for managing staleness and invalidation (a second copy can drift)",
    "Stronger consistency for slower reads",
    "Durability for availability"
  ],
  "answer": 1,
  "explanation": "A cache is a copy that can go stale; you trade freshness/consistency management for big speed and load wins."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Caching fundamentals — key terms",
  "cards": [
    { "front": "Cache", "back": "A copy of hot data kept in a faster store to avoid slow recompute/refetch — built on locality." },
    { "front": "Cache hit / miss", "back": "Hit: the data was in the cache (fast). Miss: it wasn't, so you fall back to the source and (usually) populate the cache." },
    { "front": "Hit ratio", "back": "Fraction of reads served from cache. The lever that decides whether a cache actually helps — a low hit ratio adds overhead for little gain." },
    { "front": "TTL (time-to-live)", "back": "How long a cached entry stays valid before it expires — the simplest way to bound staleness." },
    { "front": "Staleness", "back": "A cached copy drifting from the source of truth. The core cost of caching: you trade freshness for speed and must manage invalidation." }
  ]
}
```

## Key takeaways

- A **cache** keeps copies of hot data in a fast store to avoid slow recompute/refetch — built on
  **locality**, paying off via the latency gap (RAM vs DB).
- **Hit rate** is the key metric; small increases hugely reduce load on the slow source.
- **TTL** trades freshness vs hit rate; the hard problem is **staleness/invalidation** — a cache is a
  second copy that can drift.
- Caching exists at **every layer** (browser, CDN, app, DB) and is a deliberate **speed-vs-complexity
  trade**, not free.

## Up next

Let's quantify the cache's behavior precisely. Next: **Cache Hits vs Misses**.
