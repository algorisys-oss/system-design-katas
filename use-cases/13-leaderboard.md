---
title: "Design a Real-Time Leaderboard"
slug: leaderboard
level: use-cases
module: real-time-and-data-intensive
order: 13
reading_time_min: 19
concepts: [sorted-set, rank-queries, score-sharding, hot-keys, approximate-rank, time-windowed-aggregation]
use_cases: [leaderboard]
prerequisites: [caching-fundamentals, caching-patterns-overview, database-sharding, hot-partitions]
status: published
---

# Design a Real-Time Leaderboard

> **Use case:** maintain a live ranking of players by score — show the **top N**, and tell any
> single player **"you are rank #842,109 of 40 million"** — updating within milliseconds as scores
> change.
> **Domain:** mobile games, esports, fitness apps (steps/distance), trading competitions, Stack
> Overflow-style reputation, "most active this week" feeds.
> **Scale:** tens of millions of players, tens of thousands of score updates/sec at peak, top-N
> reads on every screen open.
> **Core challenges:** an efficient **sorted structure** for rank/top-k; **rank queries at scale**;
> **sharding** by score range or partial boards; the **hot key** of a single global board;
> **approximate ranks** for huge N; **frequent score updates**; and **time-windowed** boards
> (daily / weekly / all-time).

A leaderboard sounds like one `ORDER BY score DESC LIMIT 10`. The twist is the second query — *"what
is **my** rank?"* — which a plain index can't answer cheaply, and the fact that scores change
constantly under heavy concurrency. That combination is what makes this a real design.

## 1 · Clarify requirements

**Functional**
- **Submit/update a score** for a player (set absolute, or increment, e.g. `+50 points`).
- **Top N** of the board (typically N = 10–100), with score and player.
- **Rank of a specific player** ("you're #842,109") and a **window around them** (the 5 players
  above and below me).
- **Multiple boards:** global + per-region/per-friends-list, and **time windows** (daily, weekly,
  all-time, or a fixed tournament window).

**Non-functional**
- **Near-real-time:** an update is reflected in rank within ~1 second.
- **Low-latency reads:** top-N and my-rank in single-digit milliseconds (they're on the hot path of
  every game screen).
- **Scale:** tens of millions of members per board; tens of thousands of updates/sec.
- **Correct ties & determinism:** equal scores need a stable tiebreak (e.g. who reached it first).
- **Cost-aware:** an exact global rank for 40M players is expensive — approximate is often fine.

```reveal
{
  "prompt": "Why is 'what is my rank?' fundamentally harder than 'show the top 10?', even though both are about the same sorted data?",
  "answer": "Top-N is cheap because you only need the first few elements of a sorted order — any index on score gives you that in O(N) where N is tiny (10). 'My rank' is a COUNT: rank = (number of players with a strictly higher score) + 1. To answer it from a plain B-tree index you'd have to count all the rows above you, which is O(number-of-players-above) — potentially tens of millions of index entries scanned for a low-ranked player, on every request. SQL has no O(log n) 'how many rows are above this value' operator on an ordinary index; window functions like RANK() compute it by scanning. What you actually need is an order-statistics structure: a balanced tree (or skip list) that stores subtree sizes, so it can return both the element AND its position in O(log n). That is exactly what a Redis sorted set provides, which is why almost every real leaderboard is built on one rather than on a SQL ORDER BY."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Score-update throughput",
  "inputs": [
    { "key": "players", "label": "Active players", "default": 40000000 },
    { "key": "updatesPerPlayerPerHrPeak", "label": "Updates per active player / hour (peak)", "default": 6 },
    { "key": "peakConcurrencyPct", "label": "% of players active at peak", "default": 10 }
  ],
  "formula": "Math.round(players * (peakConcurrencyPct/100) * updatesPerPlayerPerHrPeak / 3600)",
  "resultLabel": "Score writes/sec at peak",
  "resultUnit": "writes/s"
}
```

```calc
{
  "title": "Memory for one sorted set (Redis ZSET)",
  "inputs": [
    { "key": "members", "label": "Members in the board", "default": 40000000 },
    { "key": "bytesPerMember", "label": "Bytes per member (member id + score + skiplist/hash overhead)", "default": 80 }
  ],
  "formula": "members * bytesPerMember",
  "resultLabel": "ZSET memory",
  "resultUnit": "bytes"
}
```

> A 40M-player board at ~10% peak concurrency is on the order of **~6–7k writes/sec** and a single
> ZSET of roughly **~3 GB** in RAM. That fits on one beefy Redis node — but one node also means a
> **single hot key** taking every write and every top-N read, which §5 attacks. Per-window boards
> (daily/weekly) multiply the memory but each is smaller and **expires**, so memory self-cleans.

## 3 · Data model & API

The board is a **sorted set**: members are player IDs, the sort key is the score. Conceptually:

```
boardKey = "lb:{game}:{window}"   e.g. lb:race:weekly:2026-W23

ADD/UPDATE :  ZADD   boardKey  <score>  <playerId>        // set absolute
INCREMENT  :  ZINCRBY boardKey <delta>  <playerId>        // atomic +delta
TOP N      :  ZREVRANGE boardKey 0 N-1 WITHSCORES         // highest first
MY RANK    :  ZREVRANK boardKey <playerId>                // 0-based, descending
MY SCORE   :  ZSCORE   boardKey <playerId>
NEIGHBORS  :  ZREVRANGE boardKey (rank-2) (rank+2) WITHSCORES
```

`ZADD`/`ZINCRBY` are **O(log n)**; `ZREVRANK` and `ZREVRANGE` are **O(log n + k)**. That single fact
— rank in **O(log n)**, not O(n) — is why a sorted set, not a SQL table, is the heart of the design.

**Tiebreaks.** Equal raw scores need a deterministic order. The trick is to **encode the tiebreak
into the float score** itself: `composite = points * 1e13 - (timestampMillis)` so that, among equal
points, the *earlier* achiever sorts higher. Redis scores are IEEE-754 doubles (~15–16 significant
digits), so you get one number that's both score and tiebreak.

## 4 · High-level architecture

```flow
{
  "title": "Write path and read path of a leaderboard",
  "nodes": [
    { "label": "Game client", "detail": "Submits a score event after a match / action." },
    { "label": "Score service", "detail": "Validates & anti-cheats the event, then writes." },
    { "label": "System of record (SQL/NoSQL)", "detail": "Durable per-player score history — the source of truth, can rebuild the board." },
    { "label": "Redis sorted set (the board)", "detail": "ZINCRBY/ZADD on write; ZREVRANGE/ZREVRANK on read. The live ranking engine." },
    { "label": "Read API / cache", "detail": "Top-N cached for a few seconds; my-rank served live from the ZSET." }
  ],
  "note": "Redis is the live index, NOT the source of truth. Durable scores live in a database so the board can be rebuilt after a Redis loss."
}
```

The key architectural decision: **Redis is a derived, rebuildable index, not the system of record.**
The durable store (a sharded SQL/NoSQL table of `player_id, score, updated_at`) is authoritative; the
ZSET is a fast view. On a Redis failure you replay scores from the database to repopulate the board —
so a cache loss is a latency event, not data loss (recall caching: derived state must be rebuildable).

```sequence
{
  "title": "A score update propagating to ranks",
  "actors": ["Client", "ScoreSvc", "DB", "RedisZSET", "Reader"],
  "steps": [
    { "from": "Client", "to": "ScoreSvc", "label": "submit score +50 (player P)" },
    { "from": "ScoreSvc", "to": "DB", "label": "persist score event (durable)" },
    { "from": "ScoreSvc", "to": "RedisZSET", "label": "ZINCRBY lb:weekly 50 P (atomic, O(log n))" },
    { "from": "Reader", "to": "RedisZSET", "label": "ZREVRANK lb:weekly P -> rank 842108" },
    { "from": "Reader", "to": "RedisZSET", "label": "ZREVRANGE lb:weekly 0 9 -> top 10" }
  ]
}
```

## 5 · Deep dives

### 5.1 The hot key: one global board

A single global ZSET means **one Redis key** absorbs every write and every top-N read. Redis is
single-threaded per shard, so this key is a serialization point — and you can't split a sorted set
across nodes the way you'd shard rows, because rank requires *all* members in one ordered structure
(recall hot partitions: a key that can't be split is the worst kind of hot spot).

Mitigations, roughly in order of how much they cost you:

```compare
{
  "options": [
    { "label": "Cache the top-N", "points": ["Top 10–100 changes slowly relative to reads", "Serve it from a short-TTL cache (1–5s) or a Redis replica", "Kills the read hot spot for the most common query", "My-rank still hits the primary"] },
    { "label": "Read replicas", "points": ["Replicate the ZSET; route all reads to replicas", "Writes still funnel to the primary (single key)", "Scales reads, not writes", "Slight replication lag on rank"] },
    { "label": "Score-range sharding", "points": ["Split members into N shards by score band (e.g. 0-1k, 1k-10k, ...)", "Global rank = my rank in my shard + sizes of all higher shards", "Spreads writes; rank needs a sum across shards", "Re-sharding when bands fill unevenly is painful"] },
    { "label": "Partial / bucketed boards", "points": ["Per-region, per-friends, per-tier boards — many smaller ZSETs", "No single global board to be hot", "Global rank becomes approximate or a separate rollup", "Most user-facing screens only need the partial board anyway"] }
  ]
}
```

```reveal
{
  "prompt": "How does score-range sharding answer a global rank query, and what is the catch?",
  "answer": "You partition members into ordered score bands, each its own sorted set on a different node — say shard A holds scores 0–999, shard B 1,000–9,999, shard C 10,000+. Writes spread across the three nodes by which band a player falls in, relieving the single-key write bottleneck. To compute a player's GLOBAL rank you (1) find their rank within their own shard with ZREVRANK (cheap, O(log n)), then (2) add the TOTAL member count of every shard whose scores are all higher than this player's band. If you keep a live cardinality (ZCARD) per shard, that's just summing a few integers. The catches: bands fill unevenly — a game where everyone clusters at low scores makes shard A enormous and the others empty, recreating the hot key, so you periodically re-balance band boundaries (a painful, online migration). Crossing a band boundary on a score update means moving the member between shards (delete + re-add), which must stay atomic and consistent. And the count-of-higher-shards must be a consistent snapshot or the rank wobbles. It works, but you've traded a simple O(log n) ZREVRANK for a distributed coordination problem — which is why many teams prefer approximate ranks (5.3) over true range sharding."
}
```

### 5.2 Frequent score updates & atomicity

Scores change under heavy concurrency — the same player can submit overlapping events, and an
"increment" must not lose updates. `ZINCRBY` is **atomic** (a single read-modify-write inside
Redis's single-threaded execution), so concurrent `+50` and `+30` reliably net `+80` — no lost
update, the same hazard a database transaction guards against. For multi-step logic (e.g. "set score
only if higher than current," for a high-water-mark board) wrap it in a **Lua script** so the
read-compare-write executes as one atomic unit.

To keep Redis and the durable store consistent without paying two synchronous writes on the hot
path, write the **durable record first**, then update the ZSET; if the ZSET write fails, a background
reconciler replays it from the DB. Some teams invert this with a **write-behind** queue: update the
ZSET synchronously (it's the user-visible thing), enqueue the durable write asynchronously.

### 5.3 Approximate ranks for huge N

For 40 million players, the *exact* rank of player #15,402,001 is rarely worth its cost — nobody
distinguishes "15,402,001st" from "≈15.4 millionth." You can serve **approximate ranks** far more
cheaply:

- **Histogram / percentile buckets:** maintain a bucketed count of how many players fall in each
  score band (e.g. 1,000 buckets). A player's approximate rank = sum of counts in all higher
  buckets + an interpolation within their own bucket. This is O(buckets), updates are a single
  counter increment, and it's trivially shardable. You tell the player "top 3%" or "≈rank 1.2M."
- **Exact near the top, approximate in the tail:** keep a precise ZSET for the top few thousand
  (where rank #4 vs #5 actually matters and where the prizes are), and serve everyone below with the
  histogram. This is the common production split: precision where it's seen, approximation where it
  isn't.

```tradeoff
{
  "title": "How exact does a player's rank need to be?",
  "axis": { "left": "Approximate / cheap", "right": "Exact / costly" },
  "steps": [
    { "label": "Percentile bucket", "detail": "Histogram of counts per score band. 'You're top 3%.' O(buckets) memory, single-increment updates, shards trivially. Wrong by thousands of positions — invisible to a mid-pack player." },
    { "label": "Exact top + approximate tail", "detail": "Precise ZSET ranks for the top few thousand; histogram for everyone else. The usual production sweet spot — precision exactly where players and prizes are." },
    { "label": "Full ZSET, replicas", "detail": "Exact O(log n) rank for everyone via ZREVRANK, reads off replicas. Correct but the single board is a hot key and replicas lag slightly." },
    { "label": "Sharded exact rank", "detail": "Score-range shards + cross-shard count sum for a true global rank under heavy write load. Most accurate at scale, but a distributed coordination/re-balancing burden." }
  ]
}
```

### 5.4 Time-windowed boards

"Top this week" needs a board that **resets** on a window boundary. The clean pattern is **one ZSET
per window**, keyed by the window: `lb:weekly:2026-W23`, `lb:daily:2026-06-08`. Writes hit the
current window's key; reads pick the key for the requested window; and each key gets a **TTL** a bit
past the window's end, so old boards expire and reclaim memory automatically (recall caching TTL —
no cleanup job needed). A score event typically fans out to several keys at once: `ZINCRBY` to the
daily, the weekly, and the all-time board in one pipeline.

For **rolling** windows ("last 24 hours," not "today"), per-window buckets don't suffice — you'd
maintain many fine-grained buckets (e.g. hourly ZSETs) and union the trailing 24 with `ZUNIONSTORE`,
or accept the simpler tumbling "calendar day" window, which is what most products actually ship.

## 6 · Trade-offs & failure modes

- **Redis loss.** The board is in memory; a node loss drops the live index. Because Redis is a
  *derived* index, you rebuild it from the durable store — but rebuilding a 40M-member ZSET takes
  time, during which ranks are stale or unavailable. Mitigate with replicas + AOF/snapshot
  persistence so failover is fast.
- **The single global key is a hot partition.** Top-N reads and all writes serialize on it. Caching
  top-N and using replicas helps reads; only sharding or partial boards helps writes.
- **Replication lag vs consistency.** Reading rank off a replica can show a slightly stale position
  right after your own update — jarring ("I scored but my rank didn't move"). Read *your own* rank
  from the primary (read-your-writes) while serving top-N from replicas.
- **Cheating / bad writes.** A leaderboard is an abuse magnet; validate and anti-cheat in the score
  service *before* the ZSET write, and keep the durable log so you can recompute after banning a
  cheater.
- **Tie handling.** Without a deterministic tiebreak, equal scores reorder randomly between reads;
  encode the tiebreak into the score float.

## 7 · Scaling & evolution

- **Replicas for read fan-out** first — cheapest win for the read-heavy top-N.
- **Per-window + per-region partial boards** to avoid ever having one global hot board; compute a
  true "global" rank only as an occasional rollup, or serve it approximately.
- **Approximate-rank histogram** as a parallel structure once N passes a few million — it shards
  cleanly and removes most exact-rank traffic from the ZSET.
- **Write-behind durability** to keep the hot path to a single Redis op, with async persistence and
  a reconciler.
- **Cluster the ZSET by board, not by member:** put different boards (games/windows/regions) on
  different Redis shards via the key — that spreads load across boards even though any single board
  stays on one shard.

## Self-test

```quiz
{
  "question": "Why is a Redis sorted set (ZSET) preferred over a SQL table with an index on score for a leaderboard?",
  "options": [
    "SQL can't store scores",
    "ZSET returns both the top-N AND a member's exact rank in O(log n), whereas counting rank from a B-tree index is O(rows-above)",
    "ZSET is durable and SQL is not",
    "SQL can't sort numbers"
  ],
  "answer": 1,
  "explanation": "The hard query is 'my rank' = count of players above me. A sorted set stores subtree sizes (order statistics) so rank is O(log n); a plain index would scan all entries above you to count them."
}
```

```quiz
{
  "question": "A single global ZSET for 40M players becomes a hot key. Which mitigation actually relieves WRITE pressure (not just reads)?",
  "options": [
    "Caching the top-N for a few seconds",
    "Adding read replicas",
    "Score-range sharding or partial (per-region/per-window) boards",
    "Returning the top-N with WITHSCORES"
  ],
  "answer": 2,
  "explanation": "Top-N caching and replicas scale reads but all writes still funnel to the single primary key. Only splitting the board (range shards or partial boards) spreads writes across nodes."
}
```

```quiz
{
  "question": "For 40M players, why serve approximate ranks (percentile buckets) for most players?",
  "options": [
    "Because Redis cannot compute exact ranks",
    "Because nobody distinguishes rank 15,402,001 from ≈15.4M, and a bucketed histogram gives that for O(buckets) memory and single-increment updates that shard trivially",
    "Because approximate ranks are always required by law",
    "Because exact ranks are impossible above 1M members"
  ],
  "answer": 1,
  "explanation": "Exact mid-pack rank is costly and meaningless to the user. A histogram of per-band counts answers 'top 3%' cheaply and shardably; keep exact ranks only for the top few thousand where they matter."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Leaderboard — key terms",
  "cards": [
    { "front": "Sorted set (ZSET)", "back": "Redis structure mapping members to scores, kept in sorted order via a skip list + hash. Gives top-N and a member's rank in O(log n)." },
    { "front": "ZREVRANK / ZREVRANGE", "back": "Rank of a member (descending) and a slice of the ordered board. The two core read ops; both O(log n)(+k)." },
    { "front": "Order-statistics structure", "back": "A sorted structure that also tracks subtree sizes, so it can return an element's POSITION (rank), not just the element — what makes 'my rank' cheap." },
    { "front": "Score-range sharding", "back": "Partition members into ordered score bands across nodes; global rank = rank-in-my-shard + counts of all higher shards. Spreads writes; needs re-balancing." },
    { "front": "Approximate rank", "back": "Percentile/histogram buckets giving 'top 3%' instead of an exact position — cheap, shardable, good enough for huge mid-pack N." },
    { "front": "Time-windowed board", "back": "One ZSET per window (daily/weekly), keyed by window with a TTL so old boards expire automatically; a write fans out to several windows." }
  ]
}
```

## Key takeaways

- The defining query is **"my rank,"** a COUNT-of-above that a plain index answers in O(rows); a
  **sorted set** answers it in **O(log n)** because it tracks order statistics — that's why ZSETs,
  not SQL `ORDER BY`, power real leaderboards.
- Treat Redis as a **derived, rebuildable index**; keep durable scores in a system of record so a
  cache loss is a latency event, not data loss.
- A single global board is an **unsplittable hot key**: cache top-N and use replicas for reads, but
  only **range sharding or partial/per-window boards** relieve write pressure.
- For huge N, serve **approximate ranks** (percentile buckets) for the mid-pack and keep **exact
  ranks only for the top few thousand**, where they're actually seen.
- Make updates **atomic** (`ZINCRBY` / Lua), encode **tiebreaks into the score float**, and use
  **per-window keys with TTLs** so time-bounded boards reset and self-clean.

## Concepts exercised

This design applies, end to end: `caching-fundamentals` and `caching-patterns-overview` (Redis as a
derived, rebuildable index; cache-aside top-N; TTL-based expiry of window boards) ·
`database-sharding` (score-range sharding and per-board/per-window partitioning of the sorted sets) ·
`hot-partitions` (the single global board as an unsplittable hot key, and the mitigations) · plus
`database-transactions` / atomicity (atomic `ZINCRBY` and Lua high-water-mark updates) and
`replication` (read replicas with read-your-writes for fresh self-rank).
