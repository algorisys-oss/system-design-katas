---
title: "LSM Trees & Compaction"
slug: lsm-trees-and-compaction
level: advanced
module: storage-internals
order: 21
reading_time_min: 16
concepts: [lsm-tree, memtable, sstable, compaction, write-amplification, b-tree, write-optimized]
use_cases: []
prerequisites: [database-indexing, memory-vs-disk]
status: published
---

# LSM Trees & Compaction

## Hook — a motivating scenario

A B-tree database updates data **in place**: every write seeks to the right spot on disk and modifies
it — fine for moderate write rates, painful for a firehose (metrics, logs, events) because random
in-place writes are slow. Write-heavy stores like Cassandra, RocksDB, and LevelDB instead turn writes
into **sequential appends** and sort things out later. The structure that makes this work — and the
background "sort things out" process — is the **LSM tree** and **compaction**.

## Mental model — buffer in memory, append sorted files, merge later

A **Log-Structured Merge (LSM) tree** optimizes for writes by **never updating in place**:
1. Writes go to an in-memory sorted structure, the **memtable** (and an append-only **write-ahead log**
   for durability — recall WAL/durability).
2. When the memtable fills, it's flushed to disk as an immutable, sorted file: an **SSTable**
   (Sorted String Table). Flushes are **sequential writes** (fast).
3. Over time many SSTables accumulate; **compaction** runs in the background to **merge** them, drop
   superseded/deleted entries, and keep read performance from degrading.

So writes are cheap sequential appends; the cost is paid later by compaction and by reads (which may
check several files).

```flow
{
  "title": "LSM write path: memtable → SSTables → compaction",
  "nodes": [
    { "label": "Write", "detail": "Append to WAL (durability) + insert into in-memory memtable (sorted)." },
    { "label": "Flush", "detail": "Full memtable → immutable sorted SSTable on disk (sequential write)." },
    { "label": "Many SSTables", "detail": "Accumulate over time; a key may exist in several (newest wins)." },
    { "label": "Compaction", "detail": "Background merge of SSTables: dedup, drop deletes (tombstones), keep reads fast." }
  ],
  "note": "Writes = fast sequential appends; compaction reorganizes in the background."
}
```

## Build it up — reads, deletes, and the role of Bloom filters

- **Reads** are harder than in a B-tree: a key might be in the memtable or any SSTable, so a read may
  **check multiple files** (newest to oldest). To avoid touching every SSTable, each has a **Bloom
  filter** (next chapter) that quickly says "definitely not here," skipping files that can't contain the
  key — turning a potential many-file scan into usually one. SSTables are sorted + indexed for fast
  in-file lookup.
- **Deletes** don't remove data in place (the data may be in old immutable SSTables) — instead a
  **tombstone** marker is written; compaction later physically drops the key and its tombstone.

```reveal
{
  "prompt": "In an LSM tree, why can a read be more expensive than a write, and how do Bloom filters and compaction keep reads fast?",
  "answer": "Writes are cheap because they just append to the in-memory memtable (and WAL) — no searching, no in-place disk update. Reads are harder because a key's latest value could be in the memtable or in any of the many immutable SSTables on disk (since nothing is updated in place; newer versions and tombstones live in newer files). Naively, a read might have to check the memtable and then every SSTable from newest to oldest until it finds the key — potentially many disk accesses, getting worse as SSTables accumulate (read amplification). Two mechanisms keep this fast: (1) Bloom filters — each SSTable has a compact probabilistic filter that answers 'is this key possibly here?' with no false negatives, so the read skips the (usually most) SSTables that definitely don't contain the key, typically narrowing to one file plus the memtable. (2) Compaction — the background merge reduces the number of SSTables by combining them, discarding superseded values and tombstoned deletes, so there are fewer, larger, non-overlapping files to consult and old versions don't pile up. Together, Bloom filters cut the files examined per read and compaction limits how many files exist and keeps them tidy/sorted, so reads stay close to one lookup despite the append-only, never-update-in-place write model. The trade is that compaction consumes background I/O/CPU (write amplification), which is the price LSM pays to make writes fast and reads acceptable."
}
```

## Build it up — compaction and write amplification

**Compaction** is essential but costly: rewriting/merging SSTables consumes background **I/O and CPU**,
and rewrites data multiple times over its life — **write amplification** (the bytes physically written
to disk exceed the logical bytes you wrote). Different **compaction strategies** trade these off:
- **Size-tiered** (merge similarly-sized SSTables): write-efficient, but more space + read amplification
  (more overlapping files).
- **Leveled** (organize SSTables into non-overlapping levels): read- and space-efficient, but higher
  write amplification (more merging).
- Tuning compaction is a real operational lever (Cassandra/RocksDB expose it) balancing **write, read,
  and space amplification** (you can't minimize all three).

```reveal
{
  "prompt": "What is the fundamental trade-off LSM trees make versus B-trees, and when does each win?",
  "answer": "LSM trees optimize for write throughput by converting random in-place updates into sequential appends (memtable flush → immutable SSTables) and deferring reorganization to background compaction; B-trees optimize for reads and in-place updates by maintaining a balanced, in-place structure that supports fast point and range lookups directly. The core trade is write performance + write pattern vs read simplicity: LSM gives high write throughput (sequential writes, great for write-heavy/ingest workloads like metrics, logs, time-series, event data) and good compression/space, at the cost of read amplification (a key may span memtable + multiple SSTables, mitigated by Bloom filters and sorted indexes) and write amplification + background CPU/IO from compaction. B-trees give predictable, low read amplification and excellent reads (especially range scans) and straightforward updates, but writes are random in-place modifications that are slower under heavy write loads and cause their own write amplification via page splits/journaling. So LSM wins for write-heavy, high-ingest, append-style workloads and where compression matters (Cassandra, RocksDB, LevelDB, ScyllaDB, many NoSQL/time-series engines); B-trees win for read-heavy or balanced OLTP workloads needing strong read/range performance and in-place updates (most traditional relational databases: PostgreSQL, MySQL/InnoDB). Neither is universally better — it's a write-optimized (LSM) vs read/update-optimized (B-tree) choice, and modern engines sometimes blend ideas. Pick LSM when your bottleneck is write throughput/ingest; pick B-tree when reads/range queries and in-place updates dominate."
}
```

Compaction strategy is a tunable dial — slide from write-cheap toward read/space-cheap:

```tradeoff
{
  "title": "Which compaction strategy should an LSM store use?",
  "axis": { "left": "Size-tiered (write-optimized)", "right": "Leveled (read/space-optimized)" },
  "steps": [
    { "label": "Size-tiered", "detail": "Merge similarly-sized SSTables. Write-efficient with low write amplification, but more overlapping files means higher read amplification and more space used." },
    { "label": "Lean size-tiered", "detail": "Compact a bit more aggressively to cut overlapping files; trims read/space amplification slightly while keeping writes cheap." },
    { "label": "Lean leveled", "detail": "Begin organizing SSTables into non-overlapping levels; reads consult fewer files and space tightens, at the cost of more merging work." },
    { "label": "Leveled", "detail": "Non-overlapping levels make reads and space efficient (fewer files per lookup), but merging rewrites data more often — the highest write amplification." }
  ]
}
```

## In the wild

- **LSM-based engines:** RocksDB, LevelDB, Cassandra, ScyllaDB, HBase, and many time-series/NoSQL
  stores — all write-optimized via memtable + SSTables + compaction.
- **B-tree engines:** PostgreSQL, MySQL/InnoDB (read/OLTP-optimized, in-place updates) — recall
  indexing.
- **Bloom filters per SSTable** are standard to cut read amplification (next chapter); **WAL** provides
  durability for the in-memory memtable.
- **Compaction strategy** (size-tiered vs leveled) and tuning are key operational concerns for
  LSM stores.

## Common misconception — "LSM trees are strictly better/faster than B-trees"

LSM is **write-optimized** with its own costs (read/space/write amplification, compaction) — not a
universal upgrade.

```reveal
{
  "prompt": "Why is 'LSM is faster than B-tree' an oversimplification?",
  "answer": "Because 'faster' depends entirely on the workload and which amplification you care about. LSM is faster for writes/ingest: it turns random updates into sequential appends, sustaining very high write throughput, which is why write-heavy stores use it. But it is not uniformly faster — it pays in read amplification (a lookup may consult the memtable plus several SSTables; mitigated, not eliminated, by Bloom filters and indexes), in write amplification and background CPU/IO from compaction (data is rewritten multiple times over its life), and it needs careful compaction tuning to balance read/write/space costs (you can't minimize all three at once). B-trees, by contrast, give excellent and predictable read performance — especially range scans — and straightforward in-place updates, which is why traditional OLTP relational databases use them; their weakness is random in-place writes under heavy write loads. So for read-heavy or balanced transactional workloads, a B-tree can easily outperform an LSM tree, while for write-heavy ingestion an LSM tree shines. There are also operational differences (compaction can cause periodic IO spikes/latency in LSM; B-trees can fragment). The accurate framing is a trade-off: LSM = write-optimized (sequential writes, good compression, deferred reorganization) with read/compaction costs; B-tree = read/update-optimized with slower heavy writes. 'Faster' isn't a property of the structure but of matching the structure to whether writes or reads/ranges dominate."
}
```

An **LSM tree** makes writes **fast sequential appends** (memtable → immutable **SSTables**) and defers
work to **background compaction**; **Bloom filters** keep reads fast and **tombstones** handle deletes.
It's **write-optimized** — trading **read/space/write amplification + compaction cost** — not a
universal upgrade over **B-trees** (which win for reads/ranges/OLTP).

## Self-test

```quiz
{
  "question": "An LSM tree achieves high write throughput by:",
  "options": [
    "Updating data in place on disk",
    "Buffering writes in an in-memory memtable and flushing them as immutable sorted SSTables (sequential writes), merging later via compaction",
    "Avoiding disk entirely",
    "Using a single large B-tree"
  ],
  "answer": 1,
  "explanation": "LSM never updates in place: memtable → immutable SSTables (fast sequential flushes); compaction merges them in the background."
}
```

```quiz
{
  "question": "Compaction in an LSM tree is needed to:",
  "options": [
    "Encrypt SSTables",
    "Merge accumulated SSTables — dropping superseded values and tombstoned deletes — to keep reads and space in check (at the cost of write amplification)",
    "Make writes durable",
    "Replace Bloom filters"
  ],
  "answer": 1,
  "explanation": "Without compaction, SSTables and old/deleted versions pile up, hurting reads/space; compaction merges them, paying background I/O (write amplification)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "LSM trees & compaction — key terms", "cards": [
  { "front": "LSM tree", "back": "A write-optimized structure that never updates in place: writes append to an in-memory memtable, flush to immutable sorted SSTables, and are merged later by background compaction." },
  { "front": "Memtable", "back": "An in-memory sorted structure that buffers incoming writes (backed by a WAL for durability); when full it flushes to disk as an immutable SSTable via a fast sequential write." },
  { "front": "SSTable", "back": "Sorted String Table: an immutable, sorted, indexed on-disk file produced by flushing a memtable. A key may live in several SSTables, with the newest version winning." },
  { "front": "Compaction", "back": "Background merging of accumulated SSTables that dedups, drops superseded values and tombstoned deletes, and keeps reads/space in check — at the cost of write amplification and I/O." },
  { "front": "Write amplification", "back": "The bytes physically written to disk exceeding the logical bytes written, because compaction rewrites/merges data multiple times over its life." },
  { "front": "Tombstone", "back": "A delete marker written instead of removing data in place (old data sits in immutable SSTables); compaction later physically drops the key and its tombstone." }
] }
```

## Key takeaways

- An **LSM tree** is **write-optimized**: writes append to an in-memory **memtable** (+ WAL), flush to
  immutable sorted **SSTables**, and are merged later by **compaction** — turning random writes into
  **sequential** ones.
- **Reads** may check multiple SSTables → use **Bloom filters** (skip files) + sorted indexes; **deletes**
  use **tombstones** (removed during compaction).
- **Compaction** keeps reads/space in check but causes **write amplification** + background I/O;
  **size-tiered vs leveled** strategies trade write/read/space amplification.
- It's **not universally better than B-trees** — LSM wins write-heavy/ingest; **B-trees** win
  read/range/OLTP.

## Up next

The probabilistic filter that makes LSM reads (and much else) efficient. Next: **Bloom Filters**.
