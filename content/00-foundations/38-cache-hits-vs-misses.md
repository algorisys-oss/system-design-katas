---
title: "Cache Hits vs Misses"
slug: cache-hits-vs-misses
level: foundations
module: caching-fundamentals
order: 38
reading_time_min: 13
concepts: [cache-hit, cache-miss, hit-rate, cold-cache, thundering-herd, miss-penalty]
use_cases: []
prerequisites: [caching-fundamentals]
status: published
---

# Cache Hits vs Misses

## Hook — a motivating scenario

Your cached API averages 3 ms responses — until you deploy and restart, and for the next two minutes
it's at 800 ms and the database is on fire. Nothing changed in the code path; the **cache was empty**.
Every request "missed," stampeding the database all at once. Understanding hits, misses, and what
happens *on a miss* is the difference between a cache that helps and one that occasionally takes you
down.

## Mental model — found it, or go fetch it

- **Cache hit:** the data is in the cache → return it immediately (fast, cheap).
- **Cache miss:** the data isn't there → fetch from the slow source, **store it in the cache**, then
  return it (slow this time; fast next time).

```stepper
{
  "title": "What happens on a cache miss",
  "steps": [
    { "title": "1 · Look in cache", "body": "App asks the cache for key 'product:7'." },
    { "title": "2 · Miss", "body": "Not present (never cached, or expired). The cache returns 'nothing'." },
    { "title": "3 · Fetch from source", "body": "App queries the database — the slow path (ms)." },
    { "title": "4 · Populate cache", "body": "Store the result under 'product:7' (with a TTL) so the next request hits." },
    { "title": "5 · Return", "body": "Return the value. This request paid the miss penalty; future ones won't." }
  ]
}
```

## Build it up — the math of hit rate and miss penalty

Average latency ≈ `hit_rate × hit_time + miss_rate × miss_time`. Because `miss_time` (DB query) is
huge compared to `hit_time` (memory), **misses dominate the average** — so a small change in hit rate
swings performance a lot.

```reveal
{
  "prompt": "Cache hit = 1 ms, miss = 100 ms. Compare average latency at 90% vs 99% hit rate.",
  "answer": "At 90%: 0.9×1 + 0.1×100 = 0.9 + 10 = ~10.9 ms. At 99%: 0.99×1 + 0.01×100 = 0.99 + 1 = ~2 ms. Going from 90% to 99% hit rate cut average latency ~5×, because the rare 100 ms misses dominate the average. This is why squeezing the hit rate up (and keeping misses cheap) matters far more than it intuitively seems."
}
```

**Kinds of misses** to know:
- **Cold miss** — the entry was never cached yet (first request, or after a restart wipes the cache).
- **Capacity miss** — it was evicted to make room (next chapter, eviction).
- **Expiration miss** — its TTL elapsed.

## Build it up — the dangerous failure modes

Misses aren't just "a bit slower" — at scale they cause two classic incidents:

- **Cold cache (cache stampede on startup):** after a restart/deploy the cache is empty, so a flood of
  requests all miss and hit the database simultaneously — the 800 ms incident above. Mitigate by
  **warming** the cache (pre-loading hot keys) or ramping traffic.
- **Thundering herd:** a single very-popular key expires, and thousands of concurrent requests all
  miss it at the same instant and stampede the database to recompute the same value. Mitigate by
  having only one request recompute (a **lock / single-flight**) while others wait or serve stale.

```reveal
{
  "prompt": "A hugely popular cached value (its TTL just expired) causes a sudden database spike from thousands of simultaneous requests. What is this called, and how do you prevent it?",
  "answer": "Thundering herd (cache stampede). When the key expires, every concurrent request misses at once and all try to regenerate the same value, hammering the DB. Prevention: use a lock/'single-flight' so only the first request recomputes while the rest wait for it (or serve the slightly-stale old value briefly); add small random jitter to TTLs so many keys don't expire simultaneously; or refresh hot keys proactively before expiry. The goal is to collapse N duplicate misses into one recompute."
}
```

## In the wild

- **Monitor hit/miss rate** as a primary cache metric; a dropping hit rate is an early warning of
  trouble (or a too-short TTL).
- **Cache warming** is standard before high-traffic events and after deploys to avoid cold-cache
  stampedes.
- **Single-flight / request coalescing** (e.g. Go's `singleflight`, or a short lock) is the common
  thundering-herd fix.
- **TTL jitter** (randomize expiry slightly) prevents synchronized mass expiration.

## Common misconception — "a miss just means one slow request, no big deal"

Misses are correlated and can cascade — that's what makes them dangerous.

```reveal
{
  "prompt": "Why is a burst of simultaneous misses far more dangerous than the same number of misses spread over time?",
  "answer": "Spread out, each miss is one extra DB query — easily absorbed. Simultaneously (cold cache, or a hot key expiring), thousands of misses hit the database in the same instant, spiking load far beyond normal, exhausting connections, and slowing every query — which makes requests pile up and can topple the DB (a cascading failure). The danger isn't the per-miss cost; it's the *correlation* — many misses at once. Mitigations (warming, single-flight, TTL jitter) all work by de-correlating or collapsing those simultaneous misses."
}
```

A single miss is cheap; **many correlated misses at once** (cold start, herd) can overwhelm the
source. Cache design must account for miss *patterns*, not just average hit rate.

## Self-test

```quiz
{
  "question": "On a cache miss, the correct sequence is:",
  "options": [
    "Return empty and stop",
    "Fetch from the source, store the result in the cache, then return it",
    "Delete the cache",
    "Return the source without caching it"
  ],
  "answer": 1,
  "explanation": "A miss fetches from the slow source, populates the cache (so next time hits), then returns the value."
}
```

```quiz
{
  "question": "Thousands of requests stampede the DB the instant one hot key expires. The standard fix is:",
  "options": [
    "Remove the cache entirely",
    "Use single-flight/locking so only one request regenerates the value (plus TTL jitter)",
    "Increase the database size only",
    "Disable TTLs so nothing ever expires"
  ],
  "answer": 1,
  "explanation": "Single-flight collapses the duplicate misses into one recompute; TTL jitter de-synchronizes expirations."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Cache hits vs misses — key terms", "cards": [ { "front": "Cache hit", "back": "The requested data is already in the cache, so it is returned immediately — the fast, cheap path." }, { "front": "Cache miss", "back": "The data isn't in the cache, so the app fetches it from the slow source, stores it in the cache, then returns it — slow this time, fast next." }, { "front": "Hit rate / miss penalty", "back": "Average latency ≈ hit_rate×hit_time + miss_rate×miss_time. Because miss_time ≫ hit_time, misses dominate the average and small hit-rate gains pay off a lot." }, { "front": "Cold miss vs capacity miss vs expiration miss", "back": "Cold: never cached yet (first request or after restart). Capacity: evicted to make room. Expiration: its TTL elapsed." }, { "front": "Cold cache (stampede on startup)", "back": "After a restart/deploy the cache is empty, so a flood of requests all miss and hit the database at once. Mitigate by warming hot keys or ramping traffic." }, { "front": "Thundering herd", "back": "One very popular key expires and thousands of concurrent requests all miss it at the same instant, stampeding the DB to recompute the same value." }, { "front": "Single-flight / TTL jitter", "back": "Single-flight (a lock) lets only one request recompute while others wait or serve stale; TTL jitter randomizes expiry so keys don't all expire together." } ] }
```

## Key takeaways

- **Hit** = served from cache (fast); **miss** = fetch from source, populate cache, return (slow once).
- Because **miss penalty ≫ hit time**, average latency is dominated by misses — pushing hit rate up
  pays off disproportionately.
- Know the miss types (**cold, capacity, expiration**) and the dangerous **correlated** failures:
  **cold-cache stampede** and **thundering herd**.
- Mitigate with **cache warming, single-flight/locking, and TTL jitter** — design for miss *patterns*,
  not just average hit rate.

## Up next

Caches are finite, so something must be removed to make room. Next: **Cache Eviction Policies**.
