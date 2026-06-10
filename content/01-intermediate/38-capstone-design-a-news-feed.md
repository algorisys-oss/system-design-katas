---
title: "Capstone — Design a News Feed"
slug: capstone-design-a-news-feed
level: intermediate
module: intermediate-capstones
order: 38
reading_time_min: 20
concepts: [news-feed, fan-out, fan-out-on-write, fan-out-on-read, caching, sharding, hot-key]
use_cases: []
prerequisites: [database-sharding, caching-patterns-overview, publish-subscribe, database-reads-vs-writes]
status: published
---

# Capstone — Design a News Feed

## The payoff

Time to compose the intermediate toolkit into one design: a **news feed** (like Twitter/Instagram's
home timeline). It pulls together sharding, replication, caching patterns, pub/sub fan-out, and the
read-vs-write asymmetry — and forces the single most famous trade-off in feed design: **fan-out on
write vs read**. Follow the method (requirements → estimate → design → trade-offs → failure modes).

**Mental model:** think of two ways to run a newspaper. **Push** = pre-printing a personalized
paper for every subscriber the moment news breaks, so when they wake up the paper is already on the
doorstep (fast to read, but a lot of printing). **Pull** = the reader walks to the newsstand and the
clerk assembles a custom paper from today's stories on demand (cheap to publish, slow at the
counter). The whole chapter is about when to print ahead vs assemble on demand.

## 1 · Clarify requirements

**Functional:** users **post**; users **follow** others; a user's **home feed** shows recent posts
from people they follow, newest first.

**Non-functional:**
- **Massively read-heavy** — people scroll feeds far more than they post (recall reads-vs-writes).
- **Feed load must be fast** (low latency) and **highly available**.
- **Near-real-time** is fine (a post can appear a few seconds late) — eventual consistency acceptable.
- Scale: hundreds of millions of users; some accounts have **tens of millions of followers**
  (celebrities) — remember this; it breaks the naive design.

```reveal
{
  "prompt": "Why is establishing 'read-heavy + some accounts have tens of millions of followers' the most important requirement before designing a feed?",
  "answer": "Both facts drive the core architecture. Read-heavy means we should make the read (feed load) cheap even if it costs more work on write — pointing toward precomputing feeds (fan-out on write) and heavy caching. But the 'celebrity with tens of millions of followers' fact is what breaks that naive precompute approach: fanning every celebrity post out to 50M follower feeds is a massive, spiky write amplification (a hot-key/hotspot problem). So the requirements immediately tell us we'll need a hybrid (precompute for normal users, fetch-on-read for celebrities) rather than a single strategy. Missing either requirement leads to a design that's either too slow on reads or melts down on celebrity posts. Requirements first — they dictate the whole feed architecture."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Read vs write load",
  "inputs": [
    { "key": "dau", "label": "Daily active users", "default": 100000000 },
    { "key": "feedViewsPerUser", "label": "Feed loads per user/day", "default": 20 },
    { "key": "secondsPerDay", "label": "Seconds/day", "default": 86400 }
  ],
  "formula": "(dau * feedViewsPerUser) / secondsPerDay",
  "resultLabel": "Average feed-read QPS",
  "resultUnit": "QPS"
}
```

```calc
{
  "title": "Fan-out write amplification for a celebrity post",
  "inputs": [
    { "key": "followers", "label": "Followers", "default": 50000000 },
    { "key": "posts", "label": "Posts in the event", "default": 1 }
  ],
  "formula": "followers * posts",
  "resultLabel": "Feed inserts from ONE post",
  "resultUnit": "writes"
}
```

> ~23,000 feed reads/sec average (far more at peak) → the **read path** must be cheap. But **one**
> celebrity post = **50 million** feed inserts → naive precompute is catastrophic for big accounts.
> Estimation already exposes the central tension.

## 3 · The core decision: fan-out on write vs read

```compare
{
  "options": [
    { "label": "Fan-out on write (push)", "points": ["On post, insert into every follower's precomputed feed", "Feed read = read your ready-made list (fast!)", "Huge write amplification for big accounts", "Great for normal users; terrible for celebrities"] },
    { "label": "Fan-out on read (pull)", "points": ["On read, fetch + merge recent posts from everyone you follow", "Cheap writes (just store the post once)", "Expensive reads (gather + merge many timelines)", "Great for celebrities; slow for normal feeds"] }
  ]
}
```

The famous answer is a **hybrid**:
- **Normal accounts → fan-out on write:** when they post, push the post ID into each follower's cached
  feed (via async pub/sub workers — recall fan-out). Reads are then a fast lookup of a precomputed,
  cached list.
- **Celebrity accounts → fan-out on read:** do **not** push their posts to millions of feeds. Instead,
  at read time, **merge** the (small number of) celebrity posts the user follows into their precomputed
  feed. This avoids the 50M-insert storm.

```reveal
{
  "prompt": "Walk through why the pure push model and pure pull model each fail, and how the hybrid fixes both.",
  "answer": "Pure fan-out on write (push) makes reads great (your feed is precomputed) but writes catastrophic for high-follower accounts: one celebrity post triggers tens of millions of feed inserts — a massive, bursty write amplification and hot-spot that overloads the system and delays everyone. Pure fan-out on read (pull) makes writes trivial (store the post once) but reads expensive and slow at scale: every feed load must query and merge recent posts across everyone you follow (possibly thousands), repeated for ~23k+ reads/sec — too slow and costly for a read-heavy product. The hybrid takes the cheap path on each side: precompute (push) feeds for the vast majority (normal accounts) so typical reads are fast, but switch celebrities to pull (merge their few posts at read time) so you never fan a post out to 50M feeds. So normal users get fast precomputed reads, celebrities avoid write explosions, and a read does 'fetch my precomputed feed + merge in the handful of celebrity accounts I follow.' It optimizes the common case (push) while special-casing the pathological one (pull)."
}
```

Slide between the two poles to see how feed work shifts from the read path to the write path:

```tradeoff
{ "title": "Where does the feed work happen — write time or read time?", "axis": { "left": "Fan-out on write (push)", "right": "Fan-out on read (pull)" }, "steps": [
  { "label": "Pure push", "detail": "On post, insert the post ID into every follower's feed. Reads are a fast lookup of a precomputed list, but one celebrity post causes tens of millions of feed inserts." },
  { "label": "Hybrid (push-leaning)", "detail": "Push for normal accounts so typical reads stay fast; skip pushing celebrity posts. The common case is cheap on reads." },
  { "label": "Hybrid (pull-leaning)", "detail": "At read time, merge in the handful of celebrity posts a user follows from one cached copy, avoiding the 50M-insert storm." },
  { "label": "Pure pull", "detail": "On read, fetch and merge recent posts from everyone you follow. Writes are trivial (store once), but reads are expensive and slow for a read-heavy product." }
] }
```

## 4 · High-level design

```flow
{
  "title": "News feed architecture",
  "nodes": [
    { "label": "Post API", "detail": "User posts → store the post once (sharded posts DB) → emit 'new post' event." },
    { "label": "Fan-out workers", "detail": "Consume the event (pub/sub). Normal user → push post ID into followers' feed caches. Celebrity → skip (pull at read)." },
    { "label": "Feed cache (Redis)", "detail": "Per-user precomputed feed = list of recent post IDs. The hot read path." },
    { "label": "Feed API (read)", "detail": "Read user's cached feed IDs + merge celebrity posts; hydrate post details (cache/DB)." },
    { "label": "Posts DB (sharded)", "detail": "Source of truth for posts, sharded by post/user id; replicated for reads." }
  ],
  "note": "Write path fans out async (push) for normal users; read path merges in celebrity posts (pull). Everything hot is cached."
}
```

The read path, step by step:

```sequence
{
  "title": "Loading a home feed",
  "actors": ["Client", "FeedAPI", "Cache", "PostsDB"],
  "steps": [
    { "from": "Client", "to": "FeedAPI", "label": "GET /feed" },
    { "from": "FeedAPI", "to": "Cache", "label": "read precomputed feed (post IDs) — fast" },
    { "from": "FeedAPI", "to": "Cache", "label": "merge in celebrity posts the user follows (pull)" },
    { "from": "FeedAPI", "to": "PostsDB", "label": "hydrate any post details not in cache (cache-aside)" },
    { "from": "FeedAPI", "to": "Client", "label": "merged newest-first, paginated feed" }
  ]
}
```

## 5 · Apply the trade-offs you've learned

- **Caching everywhere:** precomputed feeds and hot posts live in Redis (cache-aside); a feed read
  mostly hits memory (recall caching patterns, hit rate).
- **Async fan-out:** posting publishes an event; **workers** push to follower feeds off the request
  path (recall pub/sub + async) — the poster gets a fast response; feeds populate eventually
  (acceptable eventual consistency).
- **Sharding + replication:** posts and feeds are **sharded** (by user/post id) to scale writes/storage
  and **replicated** for read scale/HA (recall those chapters).
- **Pagination:** feeds use **cursor pagination** (recall foundations) — infinite scroll over a
  changing list.
- **Hot key / celebrity = the hotspot** problem (recall sharding/consistent-hashing): solved by the
  pull special-case, plus caching celebrity posts once and reusing across all readers.

```reveal
{
  "prompt": "A celebrity posts and it must appear in 50M feeds quickly, but you've chosen pull (merge at read) for celebrities. How does the post still show up fast for everyone without 50M writes?",
  "answer": "You don't write it into 50M feeds at all. The post is stored once (in the sharded posts store) and cached once (a single hot cache entry). Because celebrities are handled by fan-out on read, every follower's feed load already does 'fetch my precomputed feed + merge in the recent posts of the celebrity accounts I follow.' So the new celebrity post is picked up at read time by merging — each reader's feed query finds it via the celebrity's (cached) recent-posts list and blends it in by timestamp. One cached copy serves all 50M readers (massive cache reuse on a hot key), instead of 50M individual feed inserts. Each follower picks it up on their next feed load (the merge is cheap), while writes stayed O(1). That's exactly why the hybrid special-cases high-follower accounts to pull: it converts a 50M-write storm into one cached post read many times."
}
```

## 6 · Failure modes & method recap

- **Fan-out worker backlog:** a surge of posts queues fan-out work — the queue absorbs it (load
  leveling), feeds populate slightly later. Idempotent workers handle retries (recall queues/DLQ).
- **Cache cold/stampede:** rebuild feeds lazily + warm hot users; single-flight on hot posts (recall
  cache misses/stampede).
- **Celebrity hotspot:** the pull special-case + one cached copy per hot post.
- **The method again:** requirements → estimate (which exposed the read-heavy + celebrity tension) →
  HLD (push/pull hybrid + cache + shard) → trade-offs → failures. Reusable for any feed/timeline/
  fan-out system.

## Show it in the wild

This isn't a toy design — it's essentially how the big timelines work.

- **Twitter's home timeline** is the canonical example. Twitter fans out on write for ordinary
  accounts (a tweet is pushed into each follower's precomputed timeline, historically held in a
  Redis-backed service) but **excludes high-follower accounts** from fan-out and merges their
  tweets in at read time — exactly the hybrid above. At its scale this read path served on the
  order of **hundreds of thousands of timeline reads per second**, vastly more than the write rate,
  which is why precomputing reads pays off.
- **Instagram** runs a similar precompute-and-merge feed and is famously built on a
  **sharded PostgreSQL + Cassandra + memcached/Redis** stack, with feeds assembled from cached
  lists of recent media IDs rather than a live join on every load.

The lesson the real systems confirm: store the post **once**, precompute the common case, and
special-case the few accounts whose follower count would otherwise blow up the write path.

## Common Misconception

**The myth:** "A feed is just a database query — on each page load you `SELECT` the recent posts
from everyone the user follows, `ORDER BY` time, and return them. And anyway, fan-out on write is
strictly the better design, so a real system just always pushes."

Both halves are wrong. Running a live join across a user's (possibly thousands of) follows on
**every** feed load is the pure **pull** model, and it does not survive a read-heavy product:
~23k+ reads/sec each fanning out into many timeline lookups is far too slow and expensive. That's
why feeds are **precomputed and cached**, not computed live.

But the opposite over-correction — "just always fan out on write" — is equally wrong. Pushing every
post into every follower's feed turns one celebrity post into **tens of millions** of writes, a
bursty hotspot that overloads the system. Neither pure strategy works; the hybrid exists precisely
because each extreme fails on the case the other handles well. Push is not "always better" — it's
better **for the common case**, and the design deliberately switches to pull for the pathological
one.

## Self-test

```quiz
{
  "question": "Why does a pure 'fan-out on write' feed break for celebrity accounts?",
  "options": [
    "Reads become too slow",
    "One post triggers tens of millions of feed inserts — massive, bursty write amplification (a hotspot)",
    "It can't store the post",
    "It violates ACID"
  ],
  "answer": 1,
  "explanation": "Pushing a celebrity's post into every follower's feed means millions of writes per post — the hybrid pulls celebrity posts at read time instead."
}
```

```quiz
{
  "question": "The standard hybrid feed design uses:",
  "options": [
    "Fan-out on read for everyone",
    "Fan-out on write (push) for normal users + fan-out on read (pull/merge) for celebrities",
    "No caching",
    "A single database with no sharding"
  ],
  "answer": 1,
  "explanation": "Precompute feeds for normal users (fast reads) but merge high-follower accounts' posts at read time to avoid write explosions."
}
```

```quiz
{
  "question": "Because feeds are read-heavy and near-real-time is acceptable, the design leans on:",
  "options": [
    "Strong consistency and synchronous fan-out",
    "Heavy caching + async fan-out (eventual consistency) to make reads fast and writes off the critical path",
    "Avoiding caches",
    "Writing feeds synchronously on the post request"
  ],
  "answer": 1,
  "explanation": "Caching makes reads cheap; async fan-out keeps posting fast and tolerates the feed appearing a few seconds later."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "News feed design — key terms", "cards": [
  { "front": "Fan-out on write (push)", "back": "On post, insert the post ID into every follower's precomputed feed. Reads are fast (read a ready-made list), but write amplification is huge for high-follower accounts." },
  { "front": "Fan-out on read (pull)", "back": "On read, fetch and merge recent posts from everyone you follow. Writes are cheap (store the post once), but reads are expensive at scale." },
  { "front": "Hybrid feed design", "back": "Push (precompute) feeds for normal users so reads are fast; pull/merge celebrity posts at read time to avoid fanning one post out to tens of millions of feeds." },
  { "front": "Celebrity / hot-key problem", "back": "An account with tens of millions of followers; one post under pure push triggers ~50M feed inserts — a bursty hotspot. Solved by pull plus caching the post once." },
  { "front": "Precomputed feed cache", "back": "Per-user list of recent post IDs kept in Redis (cache-aside) — the hot read path; a feed read mostly hits memory then hydrates post details." },
  { "front": "Async fan-out", "back": "Posting publishes a 'new post' event; pub/sub workers push to follower feeds off the request path, so the poster gets a fast response and feeds populate eventually." }
] }
```

## Key takeaways

- A news feed composes the whole module: **sharding + replication**, **caching patterns**, **pub/sub
  fan-out**, **cursor pagination**, and the **read-heavy** asymmetry.
- The central decision is **fan-out on write (push)** vs **read (pull)** — and the answer is a
  **hybrid**: push for normal users (fast reads), pull/merge for **celebrities** (avoid write storms).
- **Cache aggressively** (precomputed feeds + hot posts), **fan out asynchronously** (eventual
  consistency), and special-case the **hot key / celebrity hotspot**.
- The **method** (requirements → estimate → HLD → trade-offs → failures) generalizes to any
  feed/timeline/fan-out system.

## Up next

One more end-to-end design, focused on real-time delivery. Next: **Capstone — Design a Chat System**.
