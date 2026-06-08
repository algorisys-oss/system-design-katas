---
title: "Database Replication"
slug: database-replication
level: intermediate
module: replication-and-partitioning
order: 7
reading_time_min: 16
concepts: [replication, primary-replica, replication-lag, failover, read-scaling, durability]
use_cases: []
prerequisites: [database-reads-vs-writes, single-point-of-failure, cap-theorem]
status: published
---

# Database Replication

## Hook — a motivating scenario

Your single database is the heart of the system — and its single point of failure. The night it dies,
the whole product is down until someone restores a backup (hours). Separately, reads are swamping it.
**Replication** — keeping live copies of the data on multiple machines — solves both: a copy can take
over if the primary dies (availability), and copies can serve reads (scale). It also introduces the
defining headache of distributed data: **replication lag**.

## Mental model — synchronized copies, one writer

Replication keeps **multiple synchronized copies** of the same data on different machines. The most
common shape is **primary–replica** (a.k.a. leader–follower, formerly master–slave): one **primary**
accepts writes and streams its changes to one or more **replicas** that apply them and serve reads.

This builds directly on reads-vs-writes: **reads scale by copying; writes must be coordinated**, so a
single primary orders all writes while replicas fan out the reads.

```flow
{
  "title": "Primary–replica replication",
  "nodes": [
    { "label": "Writes", "detail": "All writes go to the single primary (one authority orders them)." },
    { "label": "Primary", "detail": "Applies writes, then streams the change log to replicas." },
    { "label": "Replica 1", "detail": "Applies the stream; serves reads. Can be promoted if primary dies." },
    { "label": "Replica 2", "detail": "Another read copy, ideally in a different availability zone." }
  ],
  "note": "Reads fan out across replicas; the primary is the single writer. Add replicas → more read capacity."
}
```

## Build it up — what replication buys (and the lag tax)

Two big wins:
- **High availability / failover** — if the primary dies, a replica is **promoted** to primary (recall
  SPOF). Spreading replicas across availability zones survives a datacenter loss.
- **Read scaling** — route read queries to replicas; add replicas to serve more reads.

The cost is **replication lag**: a replica is always a little behind the primary (it applies the
stream after the fact). So a read from a replica right after a write may return **stale** data — the
"read-your-writes" problem from the foundations course, now in full.

```reveal
{
  "prompt": "A user updates their profile (write → primary), then immediately reloads (read → replica) and sees the OLD profile. What happened and how do you fix it?",
  "answer": "Replication lag: the replica hadn't yet applied the change streamed from the primary, so it served stale data. Fixes: route reads that immediately follow a write to the primary ('read-your-writes' consistency); or pin a user to the primary for a short window after they write; or wait for the replica to catch up to the write's position; or read the just-written value from a cache. It's the classic trade-off of read-scaling via replicas — you gain read capacity but must handle the staleness window for read-after-write."
}
```

## Build it up — synchronous vs asynchronous replication

How the primary streams to replicas is itself a CAP-flavored trade (recall CAP, sync-vs-async):

- **Asynchronous** (default) — the primary acknowledges the write *before* replicas confirm. Fast and
  available, but a replica can lag, and if the primary dies before a recent write replicated, that
  write can be **lost** on failover.
- **Synchronous** — the primary waits for (at least one) replica to confirm before acknowledging. No
  data loss on failover and replicas are current, but **higher write latency**, and writes stall if a
  synchronous replica is down.
- Many systems use **semi-synchronous** (wait for one replica, others async) to balance the two.

```reveal
{
  "prompt": "With asynchronous replication, how can a confirmed write be lost — and why might you accept that risk anyway?",
  "answer": "The primary acknowledges the write as soon as it's durable locally, before replicas have copied it. If the primary crashes in that window and a replica is promoted, the un-replicated recent writes are gone — acknowledged but lost. You accept this because async replication keeps write latency low and the system available even when replicas lag or fail; for many workloads a tiny window of potential loss on a rare primary crash is an acceptable trade for speed. When it isn't (e.g. payments), you use synchronous/semi-synchronous replication, paying extra write latency for durability. It's the availability-vs-consistency dial from CAP, at the storage layer."
}
```

Slide from fast-but-lossy to durable-but-slow to feel how the replication mode trades availability against durability:

```tradeoff
{ "title": "How should the primary replicate writes?", "axis": { "left": "Asynchronous (fast, available)", "right": "Synchronous (durable, current)" }, "steps": [
  { "label": "Asynchronous", "detail": "Primary acks before replicas confirm. Lowest write latency, stays available even if replicas lag, but a primary crash can lose recent un-replicated writes on failover." },
  { "label": "Semi-synchronous", "detail": "Wait for one replica to confirm, others async. Balances the poles: bounded loss window and decent latency without stalling on every replica." },
  { "label": "Synchronous", "detail": "Primary waits for (at least one) replica to confirm before acking. No data loss on failover and replicas stay current, but higher write latency and writes stall if a sync replica is down." }
] }
```

## In the wild

- **Read-heavy systems** (most apps) put reads on replicas + caching; **managed databases** (RDS,
  Cloud SQL) offer one-click replicas with automatic failover.
- **Multi-AZ deployments** place the primary and a synchronous standby in different zones for HA;
  additional async read replicas scale reads.
- **Replication ≠ backup** (recall the backups chapter): replicas copy mistakes instantly; you still
  need point-in-time backups.
- **Single-leader** (one primary) is the common default; **multi-leader** and **leaderless** variants
  (which accept writes in multiple places) trade more write availability for conflict-resolution
  complexity — covered next chapter and in the advanced course.

## Common misconception — "add replicas to scale everything / replication = no data loss"

Replicas scale reads, not writes, and async replication can lose recent writes.

```reveal
{
  "prompt": "Why don't read replicas help a write-bottlenecked system, and why isn't replication a guarantee against data loss?",
  "answer": "Replicas don't divide write work — every write still goes through the single primary and is then replayed on every replica, so adding replicas multiplies read capacity but does nothing for write throughput (to scale writes you shard/partition — next chapters). And replication isn't a loss guarantee: with asynchronous replication a primary crash can lose writes that hadn't replicated yet, and replicas faithfully copy logical mistakes/corruption too (so they don't replace backups). Replication gives you read scaling and failover/HA; durability against loss requires synchronous replication and/or real backups. Conflating 'more replicas' with 'scales writes' or 'can't lose data' is the classic trap."
}
```

Replication delivers **read scaling and high availability**, not write scaling, and (when async) not
absolute durability. Pair it with sharding for writes and backups for loss protection.

## Self-test

```quiz
{
  "question": "In primary–replica replication, replicas primarily provide:",
  "options": [
    "Higher write throughput",
    "Read scaling and failover/high availability (with possible replication lag)",
    "Backups against accidental deletes",
    "Stronger transactions"
  ],
  "answer": 1,
  "explanation": "One primary handles writes; replicas serve reads and can be promoted on failover — but they lag, so reads can be stale."
}
```

```quiz
{
  "question": "Asynchronous replication's main risk on a primary crash is:",
  "options": [
    "Writes become slower",
    "Recently-acknowledged writes that hadn't replicated yet can be lost",
    "Reads stop working",
    "The schema changes"
  ],
  "answer": 1,
  "explanation": "Async acks before replicas confirm, so a crash can lose the un-replicated window — synchronous replication avoids this at a latency cost."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Database replication — key terms", "cards": [
  { "front": "Replication", "back": "Keeping multiple synchronized copies of the same data on different machines, for availability (failover) and read scaling." },
  { "front": "Primary–replica", "back": "Leader–follower shape: one primary accepts all writes and streams changes to replicas that apply them and serve reads." },
  { "front": "Replication lag", "back": "A replica is always slightly behind the primary because it applies the change stream after the fact, so replica reads can be stale." },
  { "front": "Failover / promotion", "back": "If the primary dies, a replica is promoted to primary; spreading replicas across availability zones survives a datacenter loss." },
  { "front": "Asynchronous replication", "back": "Primary acknowledges a write before replicas confirm: fast and available, but recent un-replicated writes can be lost on a primary crash." },
  { "front": "Synchronous replication", "back": "Primary waits for a replica to confirm before acknowledging: no data loss on failover and current replicas, but higher write latency." }
] }
```

## Key takeaways

- **Replication** keeps synchronized copies; the common shape is **one primary (writes) + replicas
  (reads + failover)** — read scaling and HA.
- **Replication lag** makes replica reads potentially **stale** (read-after-write); fix with primary
  routing / waiting / caching.
- **Async vs sync** replication is an availability-vs-durability dial: async is fast but can lose
  recent writes on failover; sync is durable but slower.
- Replicas **don't scale writes** (shard for that) and **aren't backups** (they copy mistakes).

## Up next

We touched on how the primary streams changes and single- vs multi-leader. Let's go deeper. Next:
**Replication Strategies**.
