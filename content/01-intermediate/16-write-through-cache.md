---
title: "Write-Through Cache"
slug: write-through-cache
level: intermediate
module: caching-patterns
order: 16
reading_time_min: 12
concepts: [write-through, consistency, write-latency, freshness, durability, write-around, write-behind]
use_cases: []
prerequisites: [caching-patterns-overview, cache-aside]
status: published
---

# Write-Through Cache

## Hook — a motivating scenario

Your cache-aside setup keeps serving stale data right after writes, and you're tired of chasing
missed invalidations. You want the cache to **always** match the database. **Write-through** does
exactly that: every write goes to the cache *and* the database together, so a read can never see a
value older than the last write. The price is on the write path.

## Mental model — write to both, synchronously

Think of it like writing on a **carbon-copy form**: a single stroke of the pen fills both the
customer copy (the cache) and the filed original (the database) at once — and you only hand over the
receipt once *both* copies exist. There's no moment where one copy says something the other doesn't.

In **write-through**, a write is applied to the **cache and the database at the same time
(synchronously)** before it's acknowledged. The cache is always consistent with the database for any
key it holds — reads after a write always see the new value, with no invalidation to remember.

```sequence
{
  "title": "Write-through (write hits cache + DB together)",
  "actors": ["App", "Cache", "DB"],
  "steps": [
    { "from": "App", "to": "Cache", "label": "write key=value" },
    { "from": "Cache", "to": "DB", "label": "write through to database (sync)" },
    { "from": "DB", "to": "Cache", "label": "ok (written to DB before ack)" },
    { "from": "Cache", "to": "App", "label": "ack (cache + DB now consistent)" }
  ]
}
```

## Build it up — what you gain and what you pay

**Gain — consistency & freshness:** the cache stays **coherent with the DB for every write that goes
through this path** (for cached keys), so you avoid the cache-aside invalidation problem. Reads are
fast *and* see those writes. (The "always fresh" guarantee assumes **all** writes go through the
write-through layer and there's a single cache — out-of-band writes, bypasses, or multiple cache
replicas can still leave stale entries.) It's also more durable than write-behind: the write reaches
the database **before** the ack (so it's as durable as a normal DB write), rather than sitting only in
volatile cache awaiting a later flush.

**Pay — write latency & wasted caching:**
- Every write does **two synchronous hops** (cache + DB), so writes are **slower** than writing the DB
  alone.
- You **cache data on write that may never be read**, wasting cache space on cold keys (write-through
  often pairs with read-through so only read keys persist, or with a TTL).

```reveal
{
  "prompt": "Write-through guarantees the cache matches the DB — so why isn't it the obvious default over cache-aside?",
  "answer": "Two reasons. (1) Write latency: every write must synchronously update both the cache and the database before acking, so writes are slower than just hitting the DB — bad for write-heavy workloads. (2) Cache pollution: it caches everything you write, including data that's never read again, wasting cache memory on cold keys (you'd evict useful read-hot data to hold write-only data). Cache-aside, by contrast, only caches what's actually read and keeps writes cheap (write DB + delete key). Write-through shines when you need guaranteed freshness and reads dominate; for write-heavy or read-rarely data it adds latency and wastes cache. So it's a freshness-vs-write-cost trade, not a free upgrade."
}
```

## Build it up — write-through vs write-around vs cache-aside writes

For the write path you have three common choices:

```compare
{
  "options": [
    { "label": "Write-through", "points": ["Write cache + DB synchronously", "Cache always fresh; durable", "Slower writes; caches unread data", "Great when reads dominate + freshness matters"] },
    { "label": "Write-around", "points": ["Write only to DB; skip the cache", "Cache filled later on read (cache-aside style)", "Avoids caching write-only data", "Good for write-heavy, rarely-reread data"] },
    { "label": "Cache-aside write (invalidate)", "points": ["Write DB, then delete cache key", "Cheap writes; next read reloads fresh", "Brief miss after each write", "The common default"] }
  ]
}
```

```reveal
{
  "prompt": "You're writing lots of log-like data that's almost never read back. Which write strategy fits, and why not write-through?",
  "answer": "Write-around (write straight to the DB, skip the cache) — or just don't cache it. Write-through would be the worst choice: it'd synchronously populate the cache on every write with data that's almost never read, evicting genuinely hot read data to make room and adding write latency for no benefit. Write-around keeps writes cheap and lets the cache hold only data that actually gets read (populated lazily on the rare read). The rule: cache (and write-through) what you read often; for write-heavy, read-rarely data, write around the cache."
}
```

Slide along the write-strategy dial to see how you trade durability and freshness against write speed:

```tradeoff
{ "title": "How should writes hit the cache and DB?", "axis": { "left": "Fresh + durable, slower writes", "right": "Fast writes, deferred durability" }, "steps": [
  { "label": "Write-through", "detail": "Write cache + DB synchronously before acking. Cache always fresh, write as durable as a normal DB write — but two hops make writes slower, and it caches data that may never be read." },
  { "label": "Write-around", "detail": "Write only to the DB and skip the cache; it fills later on read. Avoids caching write-only data, keeping writes cheaper for write-heavy, rarely-reread data." },
  { "label": "Cache-aside invalidate", "detail": "Write DB then delete the cache key. Cheap writes; the next read reloads fresh, at the cost of a brief miss after each write. The common default." },
  { "label": "Write-behind", "detail": "Write the cache and ack immediately, flushing to the DB asynchronously. Fastest writes, but un-flushed writes are lost if the cache dies — durability is deferred and at risk." }
] }
```

## In the wild

- **Write-through is often paired with read-through** as a packaged "inline cache" — the cache layer
  keeps itself consistent on both reads and writes.
- Used where **freshness is critical and reads dominate** (config, reference data, user profiles read
  far more than written).
- **Write-around** is common for write-heavy/rarely-reread data (logs, events) to avoid polluting the
  cache.
- For most general app data, **cache-aside + invalidate-on-write** remains the default; write-through
  is chosen deliberately for its freshness guarantee.

## Common misconception — "write-through makes writes durable AND fast"

It makes them durable and *fresh*, but not fast — it adds a hop.

```reveal
{
  "prompt": "How does write-through differ from write-behind on durability and speed, and why does that matter?",
  "answer": "Write-through writes to the cache AND the database synchronously before acking — so it's fresh and durable (an ack means it's in the DB) but slower (two synchronous hops per write). Write-behind writes to the cache and acks immediately, flushing to the DB asynchronously later — so it's fast but risks losing un-flushed writes if the cache dies (not durable until flushed). They sit at opposite ends of the write trade-off: write-through buys consistency+durability with latency; write-behind buys speed by deferring (and risking) durability. Picking the wrong one means either slow writes where you needed throughput, or lost 'saved' data where you needed durability."
}
```

Write-through buys **freshness + durability at the cost of write latency** (and some cache pollution).
It's not "fast writes" — that's write-behind, which trades away durability. Choose by whether you need
guaranteed freshness or maximum write speed.

## Self-test

```quiz
{
  "question": "In write-through caching, a write is:",
  "options": [
    "Applied to the cache only",
    "Applied to the cache and database synchronously before acking",
    "Applied to the cache and flushed to the DB later asynchronously",
    "Sent only to the database, skipping the cache"
  ],
  "answer": 1,
  "explanation": "Write-through updates cache + DB together synchronously, so the cache is always consistent and the write is durable."
}
```

```quiz
{
  "question": "The main cost of write-through (vs cache-aside invalidate-on-write) is:",
  "options": [
    "Stale reads",
    "Slower writes (two synchronous hops) and caching data that may never be read",
    "Lost writes on cache crash",
    "It can't guarantee freshness"
  ],
  "answer": 1,
  "explanation": "Write-through is fresh and durable but adds write latency and can pollute the cache with unread, write-only data."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Write-through cache — key terms", "cards": [
  { "front": "Write-through cache", "back": "A write is applied to the cache and the database synchronously before it's acknowledged, so the cache always matches the DB for cached keys." },
  { "front": "Why is write-through fresh?", "back": "Every write updates the cache at the same time as the DB, so reads after a write always see the new value — no invalidation to remember." },
  { "front": "Main cost of write-through", "back": "Slower writes (two synchronous hops, cache + DB) and cache pollution: it caches data on write that may never be read." },
  { "front": "Write-around", "back": "Write only to the DB and skip the cache; the cache fills later on read. Good for write-heavy, rarely-reread data like logs and events." },
  { "front": "Write-through vs write-behind", "back": "Write-through writes to DB synchronously (fresh + durable but slower); write-behind acks immediately and flushes later (fast but can lose un-flushed writes)." },
  { "front": "Why pair write-through with read-through?", "back": "As an inline cache the layer stays consistent on reads and writes; read-through limits caching to keys actually read, easing write-through's cache pollution." }
] }
```

## Key takeaways

- **Write-through** writes to **cache + DB synchronously**, so the cache is **always fresh** (no
  invalidation needed) and the write is **durable**.
- Costs: **slower writes** (two hops) and **caching unread data** — often paired with read-through or
  a TTL.
- **Write-around** (write DB, skip cache) suits **write-heavy, rarely-reread** data; **cache-aside
  invalidate** is the cheap-write default.
- Write-through = **freshness + durability**, write-behind = **speed** — opposite ends of the write
  trade-off.

## Up next

The fast-write end of that trade-off. Next: **Write-Behind Cache**.
