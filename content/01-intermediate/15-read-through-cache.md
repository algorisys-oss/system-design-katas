---
title: "Read-Through Cache"
slug: read-through-cache
level: intermediate
module: caching-patterns
order: 15
reading_time_min: 12
concepts: [read-through, cache-as-data-source, centralized-caching, cache-aside-contrast]
use_cases: []
prerequisites: [cache-aside, caching-patterns-overview]
status: published
---

# Read-Through Cache

## Hook — a motivating scenario

In cache-aside, every place that reads data repeats the same dance: check cache → on miss, query DB →
populate cache → return. Across a large codebase, that logic gets copy-pasted, and one service forgets
a step and caches inconsistently. **Read-through** moves that dance *into the cache layer* so the app
just asks for data and never thinks about misses.

## Mental model — the cache IS the data source

In **read-through**, the application treats the **cache as its data source** — it always reads from
the cache. On a miss, the **cache itself** loads from the database, stores the value, and returns it.
The loading logic lives **once**, inside the cache layer (a library or caching product), not scattered
across the app.

```sequence
{
  "title": "Read-through (cache loads the DB on miss)",
  "actors": ["App", "Cache", "DB"],
  "steps": [
    { "from": "App", "to": "Cache", "label": "GET key (app always asks the cache)" },
    { "from": "Cache", "to": "DB", "label": "(on miss) cache loads from DB itself" },
    { "from": "DB", "to": "Cache", "label": "value" },
    { "from": "Cache", "to": "App", "label": "value (cached for next time)" }
  ]
}
```

## Build it up — read-through vs cache-aside

They populate the cache the same way (on read miss); the difference is **who owns the loading logic**:

```compare
{
  "options": [
    { "label": "Cache-aside", "points": ["App orchestrates: check → load DB → fill cache", "Loading logic in app (can be duplicated)", "Cache-agnostic; degrades gracefully if cache down", "Most common, most flexible"] },
    { "label": "Read-through", "points": ["App asks cache; cache loads DB on miss", "Loading logic centralized in cache layer", "Simpler app code; needs a cache that supports it", "Cache on the critical path"] }
  ]
}
```

The benefit of read-through is **simpler, consistent app code** (one caching implementation, reused).
The trade: you need a cache layer that supports read-through (a provider, or a library wrapping the
DB), and the cache is now **on the critical read path** — if the cache layer is unavailable, the read fails (unlike
cache-aside, which falls back to the DB).

```reveal
{
  "prompt": "Both cache-aside and read-through populate the cache on a miss. So what actually changes by using read-through?",
  "answer": "Where the 'on miss, load from the database' logic lives. In cache-aside the application contains that logic at every read site (check cache, query DB, set cache) — flexible but repetitive and easy to get inconsistent. In read-through, the cache layer itself contains the loader, so the app just calls the cache and is oblivious to misses; the caching behavior is defined once and reused everywhere. Functionally similar population, but read-through centralizes the logic (cleaner app, consistent behavior) at the cost of needing cache support and putting the cache on the critical path. It's an ownership/architecture difference more than a behavioral one."
}
```

## Build it up — writes still need a strategy

Read-through only governs *reads*. You still pair it with a **write strategy** (write-through,
write-behind, or write-around — next chapters) to keep the cache consistent on updates. A common
combo is **read-through + write-through**, often provided together by the same caching layer, giving
both centralized loading and always-fresh writes.

```reveal
{
  "prompt": "Why might read-through be a worse choice than cache-aside for resilience, despite cleaner code?",
  "answer": "Because read-through puts the cache on the critical read path: the app reads *through* the cache, so if the cache layer is unavailable or can't load, reads fail (or you need explicit fallback logic in the cache layer). Cache-aside keeps the database as a directly-reachable source of truth, so a cache outage just causes misses that read the DB — degraded but working. Read-through trades that graceful degradation for centralized, simpler code and consistent caching behavior. If cache availability is a concern, cache-aside's looser coupling is safer; if you value clean, uniform caching logic and your cache layer is robust, read-through wins."
}
```

## In the wild

- **Read-through is provided by caching products/libraries** (e.g. some Redis client wrappers,
  in-process caches like Caffeine, CDN origin-fetch) — you configure a loader function.
- A **CDN is essentially read-through** at the edge: you request a URL from the edge; on a miss it
  fetches from origin, caches, and returns (recall the CDN chapter).
- Often paired with **write-through** as a packaged "inline cache" strategy.
- Choose read-through when you want **uniform, centralized caching**; choose cache-aside when you want
  **control and graceful degradation**.

## Common misconception — "read-through is just cache-aside with extra steps / strictly better"

It's a different ownership model with its own trade-offs, not an upgrade.

```reveal
{
  "prompt": "Is read-through simply 'better cache-aside'? Why or why not?",
  "answer": "No — it's a trade. Read-through centralizes the load-on-miss logic in the cache layer, giving cleaner, consistent app code, which is genuinely nice. But it requires a cache that supports the pattern, and it couples reads to the cache (cache on the critical path → less graceful degradation than cache-aside, which can always fall back to the DB). Cache-aside is more flexible and cache-agnostic but spreads loading logic through the app. Neither dominates: read-through optimizes for clean centralized code; cache-aside optimizes for control and resilience. Calling one strictly better ignores the availability/flexibility vs simplicity/consistency trade-off between them."
}
```

Read-through and cache-aside populate identically but differ in **who owns the loading logic** and
**how they fail**. Read-through = centralized + clean (cache on critical path); cache-aside = flexible
+ resilient (DB fallback). Pick by which you value.

## Self-test

```quiz
{
  "question": "In read-through caching, on a cache miss the data is loaded by:",
  "options": [
    "The application, which then fills the cache",
    "The cache layer itself, which loads from the DB and returns the value",
    "The database pushing to the cache",
    "Nobody; the read fails"
  ],
  "answer": 1,
  "explanation": "Read-through centralizes loading in the cache: the app asks the cache, and the cache loads from the DB on a miss."
}
```

```quiz
{
  "question": "Compared to cache-aside, a downside of read-through is:",
  "options": [
    "It can't cache anything",
    "The cache is on the critical read path, so it degrades less gracefully if the cache is unavailable",
    "It duplicates loading logic across the app",
    "It only works for writes"
  ],
  "answer": 1,
  "explanation": "Reading 'through' the cache couples reads to it; cache-aside instead falls back to the DB on a cache outage."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Read-through cache — key terms", "cards": [ { "front": "Read-through cache", "back": "The app treats the cache as its data source: it always reads from the cache, and on a miss the cache itself loads from the DB, stores it, and returns it." }, { "front": "Who owns the loading logic?", "back": "In read-through, the load-on-miss logic lives once inside the cache layer (library or caching product), not scattered across app read sites as in cache-aside." }, { "front": "Cache-aside vs read-through population", "back": "Both populate the cache on a read miss. The difference is ownership: cache-aside puts the load logic in the app; read-through centralizes it in the cache layer." }, { "front": "Critical path trade-off", "back": "Read-through puts the cache on the critical read path: if the cache is unavailable the read fails. Cache-aside falls back to the DB, degrading gracefully." }, { "front": "Read-through governs which operations?", "back": "Reads only. It must be paired with a write strategy (write-through, write-behind, or write-around); a common combo is read-through + write-through." }, { "front": "When to choose read-through", "back": "When you want uniform, centralized, consistent caching with simpler app code and have a robust cache that supports it. Choose cache-aside for control and graceful degradation." } ] }
```

## Key takeaways

- **Read-through** = the app treats the **cache as its data source**; the **cache loads the DB on a
  miss**, centralizing loading logic.
- Vs **cache-aside**: same population, but loading logic lives in the **cache layer** (cleaner app)
  rather than the app — and the cache is on the **critical path** (less graceful degradation).
- It governs **reads only** — pair it with a write strategy (commonly **write-through**).
- Choose read-through for **uniform/centralized** caching; cache-aside for **control + resilience**.

## Up next

Now the write side. Next: **Write-Through Cache**.
