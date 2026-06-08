---
title: "Partitioning Strategies"
slug: partitioning-strategies
level: intermediate
module: replication-and-partitioning
order: 11
reading_time_min: 14
concepts: [range-partitioning, hash-partitioning, directory-partitioning, vertical-partitioning, hotspots]
use_cases: []
prerequisites: [database-sharding, consistent-hashing]
status: published
---

# Partitioning Strategies

## Hook — a motivating scenario

You've decided to shard — but *how* do you decide which rows go where? Split by ID range and your
newest data (and all current writes) pile onto the last partition. Split by a hash and that hotspot
vanishes — but "give me all orders from last week" now has to ask every partition. There's no free
lunch: each **partitioning strategy** trades range-query convenience against even load. Knowing the
handful of strategies lets you pick deliberately.

## Mental model — how do you decide which partition a row lives on?

Partitioning (a.k.a. how you assign rows to shards) comes in a few canonical schemes:

```compare
{
  "options": [
    { "label": "Range", "points": ["Contiguous key ranges per partition (A–F, G–M…)", "Range queries are efficient (one partition)", "Hotspots if writes cluster (e.g. by time)", "Used by HBase, Bigtable"] },
    { "label": "Hash", "points": ["partition = hash(key) → bucket", "Even distribution, no hotspots", "Range queries must hit ALL partitions", "Consistent hashing avoids resize churn"] },
    { "label": "Directory / lookup", "points": ["A lookup service maps key → partition", "Flexible: rebalance by editing the map", "The directory is a dependency + possible SPOF", "Used when you need full control"] }
  ]
}
```

## Build it up — the central trade: range vs hash

This is the trade you'll make most:

- **Range partitioning** keeps keys *in order*, so **range scans** (`created BETWEEN x AND y`,
  `names A–C`) hit one or few partitions — efficient. The danger: if the key is **monotonic** (a
  timestamp, an auto-increment ID), all new writes land on the *last* range — a hotspot (the same
  trap from the sharding chapter).
- **Hash partitioning** scatters keys evenly, **killing hotspots** — but it destroys ordering, so a
  range query must **scatter-gather across every partition** and merge results.

```reveal
{
  "prompt": "You shard a time-series 'events' table. Range-by-time gives terrible write balance; hash-by-id gives terrible 'last 24h' queries. How do teams resolve this tension?",
  "answer": "By combining strategies / choosing a composite key to fit the dominant access pattern. Common moves: (1) Compound key — hash/bucket by a high-cardinality dimension (e.g. device_id or a shard prefix) AND range by time within each bucket: writes spread across buckets (no single hot partition) while 'recent events for device X' stays efficient. (2) Time-bucketing with a salt/prefix so each time window is split across N partitions, spreading write load while keeping coarse time locality. (3) If you truly need global time-range scans and even writes, accept scatter-gather or use a purpose-built time-series DB. The point: pure range or pure hash each fail this workload; you engineer the key around the queries that matter most."
}
```

Think of partition-key design as a dial between two competing goals — locality and balance:

```tradeoff
{
  "title": "Range vs hash: how should you assign rows to partitions?",
  "axis": { "left": "Range (locality)", "right": "Hash (even load)" },
  "steps": [
    { "label": "Pure range", "detail": "Contiguous key ranges per partition. Range scans hit one or few partitions — efficient. But a monotonic key (timestamp, auto-increment) piles all new writes onto the last range — a hotspot." },
    { "label": "Compound / salted key", "detail": "Hash or bucket by a high-cardinality dimension AND range by time within each bucket. Writes spread across buckets, while 'recent events for device X' stays efficient — both balance and locality." },
    { "label": "Pure hash", "detail": "partition = hash(key) scatters keys evenly, killing hotspots. But ordering is destroyed, so any range/scan query must scatter-gather across every partition and merge results." }
  ]
}
```

## Build it up — directory partitioning and a different axis

**Directory (lookup-based) partitioning** keeps an explicit map of key → partition in a lookup
service. It's the most flexible — you can rebalance by editing the map and place specific keys
deliberately — but the directory becomes a **dependency on every request** and a potential SPOF/
bottleneck (so it's made highly available and cached).

A different axis entirely is **vertical partitioning** — splitting a table by *columns* (e.g. hot,
frequently-accessed columns in one store; large blobs/rarely-used columns in another), versus
**horizontal partitioning** (sharding) which splits by *rows*. They solve different problems and can
be combined.

```reveal
{
  "prompt": "What's the difference between horizontal and vertical partitioning, and when would you use vertical?",
  "answer": "Horizontal partitioning (sharding) splits a table by rows — different rows on different nodes (scales writes/storage). Vertical partitioning splits by columns — different columns on different stores. You use vertical partitioning to separate concerns by access pattern: e.g. keep a user's hot, small, frequently-queried columns (name, status) in a fast store, and move large or rarely-read columns (a big bio blob, an avatar) to cheaper/separate storage, so common queries read less and caches hold more useful rows. It's also how you isolate a heavily-written column from the rest. They're orthogonal — a system can shard rows horizontally and also split columns vertically."
}
```

## In the wild

- **Hash partitioning + consistent hashing** is the default for even distribution at scale (Cassandra,
  DynamoDB) — recall the previous chapter.
- **Range partitioning** suits ordered/range-query workloads (HBase, Bigtable, time-series) — with
  care to avoid time-based write hotspots (compound/salted keys).
- **Directory partitioning** appears where you need explicit control or heterogeneous placement (some
  large systems run a partition-map service).
- **Vertical partitioning** shows up as "split the wide table," moving cold/large columns out — and
  blurs into the polyglot-persistence idea (advanced course).

## Common misconception — "just hash everything; it's always the most even"

Hash partitioning kills hotspots but quietly kills range queries — which is sometimes the whole job.

```reveal
{
  "prompt": "Why isn't hash partitioning simply the best default, given it distributes load so evenly?",
  "answer": "Because it destroys key ordering, so any range/scan query ('orders from last week', 'names A–C', 'top N by time') can no longer target a few partitions — it must fan out to ALL partitions and merge, which is slow and scales poorly. If your workload is range/scan-heavy (analytics, time-series, leaderboards), range partitioning (with a carefully chosen key to avoid write hotspots) is far better despite the balancing care it needs. Hash is the right default when access is mostly point lookups by key and you want even load; it's the wrong default when ordered scans dominate. Match the partitioning scheme to the queries, not just to load-balancing."
}
```

The strategies trade **range-query efficiency (range) vs even load (hash) vs flexibility (directory)**.
Pick by your dominant access pattern; real systems often combine them (compound/salted keys).

## Self-test

```quiz
{
  "question": "Hash partitioning's main downside compared to range partitioning is:",
  "options": [
    "It creates hotspots",
    "Range/scan queries must hit all partitions (it destroys key ordering)",
    "It can't distribute load",
    "It requires a directory service"
  ],
  "answer": 1,
  "explanation": "Hashing scatters keys evenly (no hotspots) but loses ordering, so range queries become scatter-gather across all partitions."
}
```

```quiz
{
  "question": "Vertical partitioning splits a table by ___, while horizontal partitioning (sharding) splits by ___.",
  "options": [
    "rows / columns",
    "columns / rows",
    "time / hash",
    "reads / writes"
  ],
  "answer": 1,
  "explanation": "Vertical = by columns (separate concerns/access patterns); horizontal/sharding = by rows (scale writes/storage)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Partitioning strategies — key terms", "cards": [
  { "front": "Range partitioning", "back": "Assigns contiguous key ranges per partition. Range scans hit one or few partitions (efficient), but monotonic keys pile all new writes onto the last range — a hotspot." },
  { "front": "Hash partitioning", "back": "partition = hash(key) -> bucket. Scatters keys evenly to kill hotspots, but destroys ordering so range queries must scatter-gather across all partitions." },
  { "front": "Directory (lookup) partitioning", "back": "An explicit lookup service maps key -> partition. Most flexible (rebalance by editing the map), but the directory is a per-request dependency and potential SPOF/bottleneck." },
  { "front": "Vertical partitioning", "back": "Splits a table by columns — hot/small columns in one store, large or rarely-read columns in another — to separate concerns by access pattern." },
  { "front": "Horizontal partitioning (sharding)", "back": "Splits a table by rows, placing different rows on different nodes to scale writes and storage. Orthogonal to vertical partitioning and combinable with it." },
  { "front": "Compound / salted key", "back": "A key-design move that hashes/buckets by a high-cardinality dimension and ranges by time within each bucket, spreading write load while keeping query locality." }
] }
```

## Key takeaways

- Core trade: **range** partitioning (efficient range scans, but hotspot-prone on monotonic keys) vs
  **hash** partitioning (even load, but range queries scatter-gather).
- **Directory** partitioning maps key→partition explicitly (flexible, but a dependency/SPOF);
  **consistent hashing** is the resize-friendly hash variant.
- **Vertical** partitioning splits by columns (by access pattern); **horizontal** (sharding) splits by
  rows — orthogonal and combinable.
- Choose by **dominant access pattern**; real systems combine schemes (compound/salted keys) to get
  both balance and locality.

## Up next

Replication + partitioning together produce systems spread across many machines. Let's name what that
implies. Next: **Distributed Databases**.
