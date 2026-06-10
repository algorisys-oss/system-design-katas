---
title: "Cache-Aside (Lazy Loading)"
slug: cache-aside
level: intermediate
module: caching-patterns
order: 14
reading_time_min: 13
concepts: [cache-aside, lazy-loading, invalidation, stale-cache, ttl]
use_cases: []
prerequisites: [caching-patterns-overview, cache-hits-vs-misses]
status: published
---

# Cache-Aside (Lazy Loading)

## Hook — a motivating scenario

Cache-aside is the caching pattern you'll use most — and the one most likely to silently serve stale
data. A user edits their display name; the write goes to the database; but the *old* name sits in the
cache for another hour, so the app keeps showing it. The pattern is simple to implement and simple to
get subtly wrong. Let's make it correct.

## Mental model — the app keeps the cache "on the side"

In **cache-aside**, the cache sits *beside* the database and the **application orchestrates** it: on a
read, look in the cache first; on a miss, load from the database and *lazily* populate the cache for
next time. The cache only ever holds data that's actually been requested ("lazy loading").

```sequence
{
  "title": "Cache-aside read (miss then hit)",
  "actors": ["App", "Cache", "DB"],
  "steps": [
    { "from": "App", "to": "Cache", "label": "GET key" },
    { "from": "Cache", "to": "App", "label": "miss" },
    { "from": "App", "to": "DB", "label": "read from database" },
    { "from": "DB", "to": "App", "label": "row / value" },
    { "from": "App", "to": "Cache", "label": "SET key (with TTL)" },
    { "from": "App", "to": "Cache", "label": "next GET key" },
    { "from": "Cache", "to": "App", "label": "hit (fast)" }
  ]
}
```

## Build it up — the write path is where it breaks

Reads are easy; the danger is keeping the cache in sync when data changes. The robust rule:

> **On write: update the database, then invalidate (delete) the cache key.** The next read misses and
> re-loads the fresh value.

Why *delete* rather than *update* the cache on write? Updating the cache in place invites a **race**:
two concurrent writers (or a write racing a slow read that's about to populate) can leave a stale
value in the cache. Deleting is simpler and safer — the next read repopulates from the source of
truth. Always set a **TTL** too, as a backstop so any missed invalidation self-heals eventually.

```reveal
{
  "prompt": "Why is 'write to DB, then delete the cache key' generally safer than 'write to DB, then write the new value into the cache'?",
  "answer": "Writing the new value into the cache opens a race: imagine read R misses and fetches the OLD value from the DB but hasn't written it to cache yet; meanwhile write W updates the DB to a NEW value and sets the cache to NEW; then R resumes and overwrites the cache with the stale OLD value it fetched earlier — now the cache is wrong until TTL. Deleting the key avoids storing a value computed from a possibly-stale read: after a write the key is simply absent, so the next read re-fetches the current DB value and caches that. Delete-on-write (a.k.a. invalidate) sidesteps most ordering races; updating-in-place needs more careful coordination (or versioning) to be safe."
}
```

## Build it up — strengths, and the stampede caveat

**Strengths:** simple, framework-agnostic (works with any cache + any DB), caches only what's used
(memory-efficient), and resilient — if the cache is down, the app can still read the database (just
slower). This resilience is a big reason it's the default.

**Caveats** (recall cache-hits-vs-misses):
- **Cold start / stampede:** after a restart or a popular key's expiry, many requests miss at once and
  hammer the DB — mitigate with cache warming, single-flight, and TTL jitter.
- **Every read path must include the cache logic** (check → miss → load → set), so it's duplicated
  unless wrapped in a helper.

```reveal
{
  "prompt": "If the cache server goes down, why does a cache-aside system degrade gracefully rather than fail?",
  "answer": "Because in cache-aside the database remains the source of truth and the app talks to it directly on a miss. If the cache is unreachable, every read simply 'misses' and falls back to reading the database (and the SET to repopulate just fails harmlessly). The site gets slower and the DB sees more load, but it keeps serving correct data — there's no hard dependency on the cache for correctness. (Contrast read-through/inline caches, where the cache is on the critical path.) You should still protect the DB from the sudden load spike, but cache-aside's separation of cache and DB is what makes it degrade rather than break."
}
```

## In the wild

- **Cache-aside + Redis/Memcached in front of a relational DB** is the single most common caching
  setup in web apps. The payoff is the latency gap: an in-memory Redis/Memcached `GET` typically
  returns in well under a millisecond (~0.1–1 ms), versus several to tens of milliseconds for a
  comparable relational-DB query — which is why even modest hit ratios pay off.
- Teams generally aim for a **high cache hit ratio on hot read-heavy keys** (often ~90–99%), so the
  expensive DB read only happens on the rare miss.
- The standard write rule is **"update DB, delete cache key"** (a.k.a. write-invalidate), with TTLs as
  a safety net.
- Combined with **stampede protections** (warming, single-flight, jitter) for hot keys.
- It pairs with any write pattern; many systems are *cache-aside reads + invalidate-on-write*.

## Common misconception — "cache-aside keeps the cache automatically in sync with the database"

Nothing keeps them in sync unless *you* invalidate on writes.

```reveal
{
  "prompt": "A team uses cache-aside and assumes the cache 'just stays current.' Where does that assumption fail?",
  "answer": "Cache-aside only populates on reads — it has no awareness of writes. If the app updates the database but doesn't invalidate/delete the corresponding cache key, the cache keeps serving the old value until its TTL expires (which could be a long time). So data silently goes stale after every un-invalidated write. The cache is current only because, and only if, the write path explicitly deletes the key. The assumption fails precisely on the write side: reads self-heal, writes do not — you must wire invalidation into every code path that mutates cached data (including bulk jobs and other services)."
}
```

Cache-aside is **lazy on reads and silent on writes** — it only stays correct if you **invalidate on
every write** (and use TTLs as a backstop). The sync is your responsibility, not the cache's.

## Self-test

```quiz
{
  "question": "In cache-aside, the recommended action on a write is to:",
  "options": [
    "Do nothing; the cache refreshes itself",
    "Update the database, then delete (invalidate) the cache key so the next read reloads it",
    "Write only to the cache",
    "Increase the TTL"
  ],
  "answer": 1,
  "explanation": "Write DB then invalidate the key (delete-on-write) avoids races and forces a fresh reload; TTL is a backstop."
}
```

```quiz
{
  "question": "A key resilience property of cache-aside is that:",
  "options": [
    "It never has stale data",
    "If the cache is down, reads fall back to the database (degraded but working)",
    "It scales writes",
    "It guarantees exactly-once delivery"
  ],
  "answer": 1,
  "explanation": "The DB stays the source of truth; a cache outage causes misses that read the DB directly — slower, not broken."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Cache-aside — key terms", "cards": [ { "front": "Cache-aside (lazy loading)", "back": "The app orchestrates the cache: read the cache first; on a miss, load from the DB and lazily populate the cache. Only requested data ever gets cached." }, { "front": "Write rule for cache-aside", "back": "Update the database, then delete (invalidate) the cache key. The next read misses and reloads the fresh value from the source of truth." }, { "front": "Why delete instead of update on write?", "back": "Updating the cache in place invites a race where a slow read overwrites the key with a stale value. Deleting forces the next read to re-fetch the current DB value." }, { "front": "TTL as a backstop", "back": "A time-to-live on cached keys so any missed invalidation self-heals eventually, capping how long stale data can linger." }, { "front": "Cold start / stampede", "back": "After a restart or a hot key's expiry, many requests miss at once and hammer the DB. Mitigate with cache warming, single-flight, and TTL jitter." }, { "front": "Graceful degradation", "back": "If the cache is down, reads simply miss and fall back to the database. The app is slower and the DB sees more load, but it keeps serving correct data." } ] }
```

## Key takeaways

- **Cache-aside** = the **app** checks the cache, and on a miss loads the DB and lazily fills the cache
  (only requested data is cached).
- **On write: update DB, then delete the cache key** (invalidate) — deleting avoids races that
  updating-in-place causes; add **TTLs** as a backstop.
- It's the **default** pattern: simple, cache-agnostic, memory-efficient, and **degrades gracefully**
  if the cache is down.
- It does **not** auto-sync — staleness is prevented only by invalidating on every write; guard hot
  keys against stampedes.

## Up next

Same population idea, but with the loading logic moved into the cache. Next: **Read-Through Cache**.
