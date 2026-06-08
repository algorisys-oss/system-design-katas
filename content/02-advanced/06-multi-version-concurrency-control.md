---
title: "Multi-Version Concurrency Control (MVCC)"
slug: multi-version-concurrency-control
level: advanced
module: correctness-and-consensus
order: 6
reading_time_min: 15
concepts: [mvcc, snapshots, versions, readers-writers, vacuum, isolation]
use_cases: []
prerequisites: [acid-properties, database-transactions, optimistic-vs-pessimistic-locking]
status: published
---

# Multi-Version Concurrency Control (MVCC)

## Hook — a motivating scenario

A long analytics query scans a huge table for 30 seconds. Meanwhile thousands of transactions are
updating those same rows. With naive locking, either the readers block all those writers (throughput
dies) or the writers block the long reader (it never finishes). Yet PostgreSQL handles this smoothly:
the long query sees a stable snapshot while writes proceed untouched. The trick is **MVCC** — keep
**multiple versions** of each row so **readers never block writers and writers never block readers**.

## Mental model — keep old versions so readers see a snapshot

Naive concurrency control uses a single copy per row + locks: a writer must exclude readers (and vice
versa). **MVCC** instead keeps **multiple timestamped/versioned copies** of a row. A write creates a
**new version** rather than overwriting; each transaction reads the version that was current **as of
its snapshot** (when it started). So:
- **Readers** see a consistent **snapshot** of the database as of their start — they don't see
  half-finished concurrent writes, and they don't block.
- **Writers** create new versions without disturbing the versions readers are using.

```sequence
{
  "title": "MVCC: reader sees a snapshot while a writer creates a new version",
  "actors": ["Reader", "Row", "Writer"],
  "steps": [
    { "from": "Reader", "to": "Row", "label": "BEGIN — snapshot @ t=10; reads version v1" },
    { "from": "Writer", "to": "Row", "label": "UPDATE — creates v2 (t=12), v1 still exists" },
    { "from": "Reader", "to": "Row", "label": "still reads v1 (its snapshot) — no block, no dirty read" },
    { "from": "Writer", "to": "Row", "label": "COMMIT v2 — new transactions now see v2" }
  ]
}
```

## Build it up — snapshots, isolation, and the readers/writers win

MVCC is how most databases implement **snapshot isolation** and related isolation levels (recall ACID
isolation): a transaction operates on a consistent snapshot, so it never sees dirty or partial data,
**without read locks**. The headline benefit: **readers don't block writers and writers don't block
readers** — only writer↔writer conflicts on the *same* row need coordination. This is a massive
throughput win for mixed read/write workloads (the long-analytics-query scenario).

Each row version is tagged with the transaction (timestamp) that created it (and the one that deleted/
superseded it); a transaction's snapshot determines which version is **visible** to it.

```reveal
{
  "prompt": "How does MVCC let a 30-second analytics read run correctly alongside thousands of concurrent writes, without blocking either?",
  "answer": "When the analytics transaction begins, it takes a snapshot — effectively 'the database as of time T.' Every row it reads, it reads the version that was committed as of T, ignoring any newer versions created after T. Concurrent writers don't overwrite those rows; they create new versions (tagged with later timestamps) that the analytics query simply doesn't consider visible. So the long reader sees a stable, consistent point-in-time view for its entire 30 seconds even as the underlying data churns — no dirty reads, no need to lock the rows it's scanning. And because the reader holds no read locks on current data, writers proceed freely creating new versions. The only coordination needed is between writers updating the *same* row (write-write conflicts). MVCC turns the reader-vs-writer contention of single-copy locking into 'readers use old versions, writers make new ones,' which is exactly why analytics and OLTP can coexist on an MVCC database without grinding to a halt."
}
```

## Build it up — the cost: old versions must be cleaned up

Keeping multiple versions isn't free:
- **Storage bloat:** superseded/deleted versions accumulate; the database must reclaim space for
  versions no longer visible to *any* live transaction. PostgreSQL calls this **VACUUM**; others use
  background compaction/undo logs.
- **Long-running transactions are dangerous:** an old transaction (or an idle one holding a snapshot)
  forces the database to **retain every version newer than its snapshot** — so a forgotten long
  transaction causes unbounded bloat and degrades performance for everyone.
- **Write amplification:** updates write new versions (and later cleanup), more than an in-place
  overwrite would.

```reveal
{
  "prompt": "Why is a forgotten long-running (or idle-in-transaction) query a serious problem in an MVCC database?",
  "answer": "Because MVCC can only reclaim a row version once it's no longer visible to ANY active transaction. A long-running or idle-but-open transaction holds an old snapshot, so the database must retain every row version that existed as of that snapshot — even versions that have since been superseded or deleted — in case the old transaction reads them. As writes continue, dead versions pile up and can't be vacuumed/compacted away, causing table and index bloat: storage grows, scans get slower (more dead tuples to skip), and overall performance degrades for all users, not just the offender. In PostgreSQL this shows up as VACUUM being unable to remove tuples and the dreaded 'idle in transaction' holding back cleanup; the transaction ID horizon can't advance. The fix is operational: keep transactions short, never leave them idle-open, set timeouts (statement/idle-in-transaction), and isolate long analytics on replicas. The deeper point: MVCC trades in-place overwrites for versioning, and that trade only stays cheap if old snapshots are released promptly so cleanup can keep up."
}
```

## In the wild

- **PostgreSQL, MySQL/InnoDB, Oracle, SQL Server (snapshot/RCSI), CockroachDB, and many NoSQL stores**
  use MVCC for snapshot isolation and non-blocking reads.
- It pairs with **optimistic concurrency** (next chapter): MVCC detects write conflicts at commit
  rather than locking up front.
- **VACUUM/compaction tuning** and avoiding long/idle transactions are real operational concerns on
  MVCC databases.
- It's the reason "readers don't block writers" is true for most modern SQL databases — a key
  assumption when designing for mixed OLTP/analytics workloads (recall reads-vs-writes).

## Common misconception — "MVCC means no locks / no conflicts at all"

It removes read locks, not write-write conflicts — and it has real cleanup costs.

```reveal
{
  "prompt": "Why is it wrong to think MVCC eliminates locking and conflicts entirely?",
  "answer": "MVCC eliminates the reader-vs-writer blocking that single-copy locking causes — readers use a consistent snapshot of old versions while writers create new ones, so neither side waits on the other for reads. But it does not eliminate write-write conflicts: when two transactions try to update the SAME row concurrently, the database still must serialize them — typically the second writer blocks on a row lock until the first commits/aborts, or (under snapshot isolation with conflict detection) one transaction is aborted with a serialization error to retry. So locks/serialization still exist for concurrent writers to the same data. MVCC also doesn't by itself prevent all anomalies: plain snapshot isolation permits write skew, which is why stronger guarantees need serializable isolation (e.g. Serializable Snapshot Isolation) on top. And it carries costs the 'no locks!' framing ignores: storage bloat from retained versions, background VACUUM/compaction, write amplification, and sensitivity to long/idle transactions. So the accurate statement is: MVCC removes read-write blocking and gives consistent snapshots cheaply, but write conflicts still need coordination, certain anomalies still need stronger isolation, and old versions must be cleaned up. It's a powerful optimization, not a magic 'lock-free, conflict-free' database."
}
```

MVCC keeps **multiple row versions** so **readers (snapshots) don't block writers and vice versa** —
the basis of snapshot isolation. But **write-write conflicts still need coordination**, snapshot
isolation can still allow **write skew**, and old versions must be **cleaned up** (VACUUM/compaction) —
so keep transactions short.

## Self-test

```quiz
{
  "question": "The core benefit of MVCC is:",
  "options": [
    "It removes the need for a database",
    "Readers see a consistent snapshot and don't block writers (and writers don't block readers), by keeping multiple row versions",
    "It guarantees exactly-once delivery",
    "It eliminates write-write conflicts"
  ],
  "answer": 1,
  "explanation": "MVCC keeps versioned rows so reads use a snapshot while writes create new versions — non-blocking reads/writes (write-write conflicts still need coordination)."
}
```

```quiz
{
  "question": "A major operational cost of MVCC is:",
  "options": [
    "It can't do snapshots",
    "Old/superseded versions accumulate and must be cleaned up (VACUUM/compaction); long/idle transactions block cleanup and cause bloat",
    "Readers always block writers",
    "It requires synchronized clocks"
  ],
  "answer": 1,
  "explanation": "Versioning bloats storage; cleanup can't remove versions still visible to old snapshots, so long/idle transactions cause serious bloat."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "MVCC — key terms", "cards": [ { "front": "MVCC (Multi-Version Concurrency Control)", "back": "Keeps multiple timestamped versions of each row; a write creates a new version instead of overwriting, so readers don't block writers and writers don't block readers." }, { "front": "Snapshot", "back": "A transaction's consistent point-in-time view of the database as of when it began; it reads the row versions committed as of that time and ignores newer ones." }, { "front": "Why readers don't block writers", "back": "Readers use old committed versions via their snapshot while writers create new versions, so neither side waits on the other for reads — only writer-writer conflicts on the same row need coordination." }, { "front": "VACUUM / compaction", "back": "Background cleanup that reclaims superseded or deleted row versions no longer visible to any live transaction; PostgreSQL calls it VACUUM, others use compaction or undo logs." }, { "front": "Why long/idle transactions are dangerous", "back": "An old open snapshot forces the database to retain every version newer than it, so cleanup can't run — dead versions pile up, causing storage and index bloat and slower scans." }, { "front": "Write skew", "back": "An anomaly that plain snapshot isolation still permits; MVCC alone doesn't prevent it, so stronger guarantees need serializable isolation (e.g. Serializable Snapshot Isolation)." } ] }
```

## Key takeaways

- **MVCC** keeps **multiple versions** of each row so transactions read a consistent **snapshot** —
  **readers don't block writers and writers don't block readers** (basis of snapshot isolation).
- Only **write-write conflicts on the same row** need coordination; reads are non-blocking — a big win
  for mixed OLTP/analytics workloads.
- Costs: **storage bloat + cleanup** (VACUUM/compaction) and **write amplification**; **long/idle
  transactions retain old versions** and cause bloat — keep transactions short.
- It doesn't remove all locks/anomalies (write-write conflicts remain; snapshot isolation still allows
  **write skew** → need serializable for that).

## Up next

MVCC underlies the optimistic approach to concurrency. Let's compare the two strategies head-on. Next:
**Optimistic vs Pessimistic Locking**.
