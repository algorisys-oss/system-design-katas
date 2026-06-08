---
title: "Caching Patterns Overview"
slug: caching-patterns-overview
level: intermediate
module: caching-patterns
order: 13
reading_time_min: 14
concepts: [cache-aside, read-through, write-through, write-behind, write-around, consistency]
use_cases: []
prerequisites: [caching-fundamentals, cache-hits-vs-misses]
status: published
---

# Caching Patterns Overview

## Hook — a motivating scenario

You added a cache and reads got fast — then users started seeing **stale prices**, an outage **lost
writes** that were "saved," and after a deploy the cold cache **stampeded the database**. Each problem
traces to *which caching pattern* you (often accidentally) chose: how reads populate the cache, and
how writes keep it in sync with the database. There are a handful of named patterns, and picking the
right one per workload is what separates a cache that helps from one that bites.

## Mental model — two questions: who fills the cache, and how do writes stay in sync?

Every caching pattern answers two questions:
1. **On a read miss, who loads the data into the cache?** (the app, or the cache itself)
2. **On a write, how do the cache and database stay consistent?** (write both, write DB then drop
   cache, write cache first…)

The read patterns (**cache-aside** vs **read-through**) and write patterns (**write-through**,
**write-behind**, **write-around**) combine into the strategy you run.

```compare
{
  "options": [
    { "label": "Cache-aside (lazy)", "points": ["App checks cache; on miss, app loads DB + fills cache", "Most common; app controls caching", "Only requested data is cached", "Stale risk on writes → must invalidate"] },
    { "label": "Read-through", "points": ["App always asks the cache; cache loads DB on miss", "Caching logic lives in the cache layer", "Simpler app code", "Needs cache that supports it"] },
    { "label": "Write-through", "points": ["Write goes to cache AND db synchronously", "Cache always fresh; safe", "Slower writes (two hops)", "Caches data that may never be read"] },
    { "label": "Write-behind", "points": ["Write to cache; db updated async later", "Fast writes; absorbs bursts", "Risk of data loss if cache dies before flush", "Complex; eventual db consistency"] }
  ]
}
```

## Build it up — reads: cache-aside vs read-through

- **Cache-aside (lazy loading):** the *application* manages the cache — check cache; on miss, read the
  database, then put the result in the cache. Only data that's actually requested gets cached. It's
  the most common pattern (the basic flow from the caching-fundamentals chapter).
- **Read-through:** the application treats the *cache* as its data source; the cache itself loads from
  the database on a miss. Caching logic is centralized in the cache layer, simplifying app code.

Both populate on read; they differ in *who owns the loading logic* (app vs cache). The next two
chapters detail each.

## Build it up — writes: keeping cache and DB in sync

Writes are where staleness and data-loss bugs live:
- **Write-through** — write to cache and database **together (synchronously)**, so the cache is never
  stale. Cost: slower writes, and you cache data that might never be read.
- **Write-behind (write-back)** — write to the cache and acknowledge immediately, then flush to the
  database **asynchronously**. Fast and burst-absorbing, but if the cache dies before flushing, those
  writes are **lost** (recall durability).
- **Write-around** — write straight to the database and **don't** populate the cache (let it be cached
  later on a read). Avoids caching write-heavy data that won't be read soon.

```match
{
  "prompt": "Match the symptom to the likely caching-pattern cause.",
  "pairs": [
    { "left": "Users see stale prices after an update", "right": "Cache-aside without proper invalidation on write" },
    { "left": "Acknowledged writes lost after a cache crash", "right": "Write-behind flushed to DB too late" },
    { "left": "Writes feel slow (two synchronous hops)", "right": "Write-through" },
    { "left": "Cold cache after deploy stampedes the DB", "right": "Lazy (cache-aside) population + no warming" }
  ]
}
```

```reveal
{
  "prompt": "Cache-aside is the most popular pattern — so what's its built-in hazard, and how do you handle it?",
  "answer": "Staleness on writes. Because the app populates the cache on reads but writes go to the database, a write can leave an old value sitting in the cache until its TTL expires — users see stale data. You handle it by invalidating (or updating) the cache entry on every write: the common safe approach is 'write DB, then delete the cache key' so the next read re-loads fresh (updating the key in place risks races). Pair that with sensible TTLs as a backstop. Cache-aside gives you control and caches only what's used, but it makes cache/DB consistency *your* responsibility on the write path."
}
```

Slide the write path from fully synchronous to fully asynchronous to trade durability for speed:

```tradeoff
{ "title": "How should writes reach the database?", "axis": { "left": "Synchronous (write-through)", "right": "Asynchronous (write-behind)" }, "steps": [ { "label": "Write-through", "detail": "Write to cache and database together synchronously. The cache is never stale and writes are safe, but each write pays two hops and you may cache data that's never read." }, { "label": "Write-around", "detail": "Write straight to the database and skip the cache; it gets cached later on a read. Durable, and avoids caching write-heavy data, but reads right after a write miss." }, { "label": "Write-behind", "detail": "Write to the cache, acknowledge immediately, and flush to the DB asynchronously. Fast and burst-absorbing, but un-flushed writes are lost if the cache dies first." } ] }
```

## In the wild

- **Cache-aside is the default** for most app caches (Redis/Memcached in front of a DB), with explicit
  invalidation on writes.
- **Read-through/write-through** are offered by caching libraries/products that sit inline; nice when
  you want centralized cache logic.
- **Write-behind** powers high-write scenarios (counters, metrics, buffering) where some loss risk is
  acceptable for speed.
- Patterns **combine**: e.g. cache-aside reads + write-through (or write-invalidate) writes; choose per
  data based on read/write ratio and staleness tolerance (recall reads-vs-writes, CAP).

## Common misconception — "caching is just 'put a cache in front'; there's one way to do it"

The pattern you pick determines correctness, not just speed.

```reveal
{
  "prompt": "Why does the choice of caching pattern matter for correctness, not only performance?",
  "answer": "Because each pattern makes different promises about freshness and durability. Cache-aside without invalidation serves stale data (correctness bug for prices/inventory). Write-behind acknowledges writes that aren't yet durable, so a crash loses 'saved' data (durability bug). Write-through is correct/fresh but slower. Read-through vs cache-aside changes where the loading (and its failure handling) lives. So 'add a cache' silently picks a consistency/durability model — and the wrong one shows up as stale reads, lost writes, or stampedes, not just slower responses. You must choose the read and write pattern deliberately to match each dataset's staleness and durability needs."
}
```

Caching is a set of **deliberate patterns** (read: cache-aside/read-through; write: write-through/
behind/around), each with distinct **freshness and durability** trade-offs. "Put a cache in front"
without choosing is how you get stale reads and lost writes.

## Self-test

```quiz
{
  "question": "In cache-aside (lazy loading), on a cache miss:",
  "options": [
    "The cache loads from the database automatically",
    "The application reads the database and then populates the cache",
    "The write is sent to the database asynchronously",
    "The request fails"
  ],
  "answer": 1,
  "explanation": "Cache-aside puts the loading logic in the app: check cache → on miss, read DB → fill cache → return."
}
```

```quiz
{
  "question": "Write-behind (write-back) caching trades durability for speed because:",
  "options": [
    "It writes to the database first",
    "It acknowledges the write from the cache and flushes to the DB asynchronously, so a cache crash can lose writes",
    "It never writes to the database",
    "It encrypts writes"
  ],
  "answer": 1,
  "explanation": "Write-behind is fast (ack from cache, async DB flush) but un-flushed writes are lost if the cache dies first."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Caching patterns — key terms", "cards": [ { "front": "Cache-aside (lazy loading)", "back": "The app manages the cache: check cache, and on a miss read the DB then fill the cache. Only requested data is cached; you must invalidate on writes." }, { "front": "Read-through", "back": "The app treats the cache as its data source; the cache itself loads from the DB on a miss. Caching logic is centralized in the cache layer, simplifying app code." }, { "front": "Write-through", "back": "Writes go to cache and database together synchronously, so the cache is never stale. Cost: slower writes and caching data that may never be read." }, { "front": "Write-behind (write-back)", "back": "Write to cache and acknowledge immediately, then flush to the DB asynchronously. Fast and burst-absorbing, but un-flushed writes are lost if the cache dies first." }, { "front": "Write-around", "back": "Write straight to the database and don't populate the cache; let it be cached later on a read. Avoids caching write-heavy data that won't be read soon." }, { "front": "Cache-aside's built-in hazard", "back": "Staleness on writes: a write to the DB can leave an old value in the cache until TTL expires. Handle it by deleting the cache key after writing the DB." } ] }
```

## Key takeaways

- Caching patterns answer two questions: **who fills the cache on a read** (cache-aside vs
  read-through) and **how writes stay in sync** (write-through / write-behind / write-around).
- **Cache-aside** is the common default (app-managed, caches only what's used) — but you **must
  invalidate on writes** or serve stale data.
- **Write-through** = always fresh, slower; **write-behind** = fast, risks losing un-flushed writes;
  **write-around** = skip caching writes.
- The pattern determines **correctness (freshness/durability)**, not just speed — choose per dataset.

## Up next

Let's detail the most common read pattern. Next: **Cache-Aside (Lazy Loading)**.
