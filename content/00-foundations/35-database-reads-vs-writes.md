---
title: "Database Reads vs Writes"
slug: database-reads-vs-writes
level: foundations
module: database-fundamentals
order: 35
reading_time_min: 14
concepts: [read-write-ratio, read-replicas, write-bottleneck, caching, scaling]
use_cases: []
prerequisites: [database-indexing, sql-vs-nosql]
status: published
---

# Database Reads vs Writes

## Hook — a motivating scenario

Your app is slow under load. You add a second database server expecting to "double capacity" — but it
barely helps, because all writes still funnel to one machine while reads were never the problem... or
maybe reads *were* the problem and you fixed the wrong thing. Reads and writes scale **differently**,
and the first question for any database performance work is: **what's your read/write ratio, and which
one is the bottleneck?**

## Mental model — many readers, careful writers

Reads and writes have fundamentally different shapes:
- **Reads** can be **duplicated freely** — ten copies of the data can answer ten readers in parallel,
  and the same value can be cached anywhere. Easy to scale by *copying*.
- **Writes** must be **coordinated** — to stay consistent, there's ultimately one authoritative place
  that decides the order of changes. You can't just have ten machines independently accepting writes
  to the same row without a conflict problem.

This asymmetry drives almost every database scaling decision.

```compare
{
  "options": [
    { "label": "Reads", "points": ["Can be served from copies/caches", "Scale out with read replicas + caching", "Parallel-friendly", "Usually the larger share of traffic"] },
    { "label": "Writes", "points": ["Must be coordinated for consistency", "Harder to scale (one primary by default)", "Replication lag affects read freshness", "Often the real bottleneck at scale"] }
  ]
}
```

## Build it up — scaling reads: replicas and caching

Most apps are **read-heavy** (often 10:1, 100:1, or more reads to writes). Two standard tools:

- **Read replicas:** the **primary** handles writes and streams changes to one or more **replica**
  copies that serve reads. Add replicas → serve more reads. (Detailed in the intermediate course.)
- **Caching:** keep hot read results in memory (Redis) so they never hit the database at all (its own
  module, next).

The catch with replicas is **replication lag**: a replica is a slight moment behind the primary, so a
read right after a write might return stale data.

```reveal
{
  "prompt": "A user updates their profile, the write goes to the primary, then their next page reads from a replica and shows the OLD profile. What happened, and one way to fix it?",
  "answer": "Replication lag: the replica hadn't yet received the change from the primary, so it served stale data (this is 'read-your-writes' inconsistency from eventual consistency). Fixes include: route reads that immediately follow a write to the primary ('read-your-writes' routing), wait for the replica to catch up, or cache the just-written value client-side. It's a classic trade-off of scaling reads via replicas — you gain read capacity but must handle staleness."
}
```

## Build it up — scaling writes is the hard part

You can add replicas all day, but they don't help writes (every replica must still apply every
write). When the single primary can't keep up with write volume, the options get harder:
- **Vertical scaling** (a bigger primary) — simple, but has a ceiling.
- **Sharding/partitioning** — split the data across multiple primaries by key, so each handles a
  slice of writes. Powerful but complex (cross-shard queries, rebalancing) — an intermediate-course
  topic.
- **Reduce writes** — batch, debounce, or offload to async queues.

```reveal
{
  "prompt": "Why don't read replicas help when your bottleneck is write throughput?",
  "answer": "Every write still has to be processed by the primary and then applied by every replica — replicas duplicate the write work, they don't divide it. They add *read* capacity, not *write* capacity. To scale writes you must split the write load itself (sharding/partitioning across multiple primaries) or reduce/batch writes. Diagnosing read-bound vs write-bound first is essential, or you'll add replicas that don't fix a write bottleneck."
}
```

## In the wild

- **Read-heavy systems** (most web apps, social feeds) scale with caching + read replicas; this covers
  the majority of real workloads.
- **Write-heavy systems** (analytics ingestion, IoT/event streams, logging) need write-optimized
  stores (e.g. Cassandra, time-series DBs) and/or sharding.
- **CQRS** (separating read and write models) is an advanced pattern built on this very asymmetry.
- **Measure the ratio first:** dashboards showing reads/sec vs writes/sec tell you which path to
  optimize before you spend effort.

## Common misconception — "adding database servers scales everything equally"

Replicas scale reads, not writes — a frequent and expensive mistake.

```reveal
{
  "prompt": "A team adds 5 read replicas to fix slowness, but the system is write-bound and stays slow. What was the diagnostic error and the right move?",
  "answer": "They scaled the wrong dimension: replicas multiply read capacity, but the bottleneck was write throughput, which still all lands on the single primary. The diagnostic error was not measuring the read/write ratio and where time was actually spent. The right move is to confirm it's write-bound, then scale writes — vertically (bigger primary), by sharding the write load across primaries, or by reducing/batching writes — and use replicas only if reads are also a constraint."
}
```

Database scaling is **directional**: identify whether you're read-bound or write-bound first, because
the techniques differ completely. Replicas and caches scale reads; sharding/batching/bigger-primary
scale writes.

## Self-test

```quiz
{
  "question": "Read replicas primarily help you scale:",
  "options": [
    "Write throughput",
    "Read throughput (serving reads from copies)",
    "Storage durability only",
    "Transaction isolation"
  ],
  "answer": 1,
  "explanation": "Replicas serve reads from copies of the data; writes still go to the primary, so they don't scale write throughput."
}
```

```quiz
{
  "question": "A read immediately after a write returns stale data from a replica. This is caused by:",
  "options": [
    "A missing index",
    "Replication lag (the replica is slightly behind the primary)",
    "Integer overflow",
    "An expired TLS certificate"
  ],
  "answer": 1,
  "explanation": "Replicas trail the primary by a small delay; reading too soon after a write can see the old value."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Database reads vs writes — key terms", "cards": [ { "front": "Read/write ratio", "back": "How many reads occur per write. Most apps are read-heavy (10:1, 100:1+). Measuring it tells you which dimension to scale before spending effort." }, { "front": "Why reads scale easily", "back": "Reads can be duplicated freely — copies and caches answer many readers in parallel. Scale out by copying the data to more places." }, { "front": "Why writes are hard to scale", "back": "Writes must be coordinated for consistency: ultimately one authoritative place decides the order of changes, so you can't freely duplicate write acceptance." }, { "front": "Read replicas", "back": "The primary handles writes and streams changes to replica copies that serve reads. Add replicas to serve more reads; they don't add write capacity." }, { "front": "Replication lag", "back": "A replica trails the primary by a slight delay, so a read right after a write may return stale data (read-your-writes inconsistency)." }, { "front": "Scaling writes", "back": "Use a bigger primary (vertical, has a ceiling), shard/partition the write load across primaries, or reduce/batch/debounce writes. Replicas don't help." } ] }
```

## Key takeaways

- **Reads scale by copying** (replicas, caches); **writes must be coordinated**, so they're harder to
  scale — this asymmetry drives database scaling.
- Most apps are **read-heavy**: scale with **read replicas + caching**, accepting possible
  **replication lag** (stale reads).
- **Scaling writes** means **sharding/partitioning**, a bigger primary, or reducing/batching writes —
  replicas don't help.
- **Measure the read/write ratio and the actual bottleneck first** — optimize the right direction.

## Up next

Even durable data needs protection from disasters and mistakes. Next: **Database Backups**.
