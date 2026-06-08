---
title: "Database Sharding"
slug: database-sharding
level: intermediate
module: replication-and-partitioning
order: 9
reading_time_min: 16
concepts: [sharding, partitioning, shard-key, cross-shard-queries, hotspots, scaling-writes]
use_cases: []
prerequisites: [database-replication, database-reads-vs-writes]
status: published
---

# Database Sharding

## Hook — a motivating scenario

Replicas fixed your reads, but writes are now the wall: a single primary can't ingest the write
volume, and the dataset no longer fits on one machine's disk. You can't "add a replica" to fix
writes — every replica must apply every write. The only way past a single machine's write/storage
ceiling is to **split the data itself across multiple databases**: **sharding**.

## Mental model — split one big table across many databases

Replication makes **copies of all the data**; sharding makes **slices of different data**. Each
**shard** is an independent database holding a *subset* of the rows, with its own primary (and its own
replicas). Users 1–1M live on shard A, 1M–2M on shard B, etc. Now each shard handles only its slice
of writes and storage — so total write capacity and storage scale with the number of shards.

```flow
{
  "title": "Sharding by shard key",
  "nodes": [
    { "label": "Write / query", "detail": "Comes in with some key (e.g. user_id)." },
    { "label": "Router", "detail": "Maps the shard key → which shard holds that data." },
    { "label": "Shard A", "detail": "Rows for one key range/bucket. Own primary + replicas." },
    { "label": "Shard B", "detail": "A different slice of the data — independent writes & storage." }
  ],
  "note": "Each shard is a full database for its slice. More shards → more total write + storage capacity."
}
```

## Build it up — the shard key is everything

A **shard key** decides which shard a row lives on. Choosing it well is the entire game, because it
determines whether load spreads evenly and whether common queries stay on one shard.

- **Even distribution** — the key should spread data/traffic uniformly. A bad key creates
  **hotspots** (one shard overloaded while others idle).
- **Query locality** — queries that filter by the shard key hit one shard (fast); queries that don't
  must hit **every** shard (a "scatter-gather", slow and hard to scale).

```reveal
{
  "prompt": "Why is sharding social-media data by 'user_id' usually good, but sharding by 'creation timestamp' often terrible?",
  "answer": "user_id spreads writes/reads evenly (users are independent and roughly uniform) and keeps a user's own data on one shard, so 'load my profile/posts' is a single-shard query. Sharding by timestamp creates a hotspot: all *new* writes target the shard holding the current time range, so one shard takes the entire write load while older shards sit idle (a 'hot shard'). Time-based keys also make 'recent data' queries hammer one shard. The shard key must distribute load and match access patterns; monotonically increasing keys (timestamps, auto-increment IDs) concentrate writes and are a classic mistake."
}
```

## Build it up — the costs sharding forces on you

Sharding scales writes, but you pay for it:
- **Cross-shard queries are hard.** Joins and aggregations spanning shards require scatter-gather
  across all shards and merging results — slow and complex. You design the schema so common queries
  stay within one shard.
- **Cross-shard transactions are hard.** ACID across shards needs distributed transactions (2PC) or
  sagas (advanced course) — you lose easy single-node transactions.
- **Rebalancing is painful.** Adding/removing shards means moving data; naive key→shard mapping (like
  modulo) reshuffles almost everything (the exact problem **consistent hashing** solves — next
  chapter).
- **Hotspots** from a skewed key or a "celebrity" row can overload one shard despite many shards.

```reveal
{
  "prompt": "Why do teams treat sharding as a 'last resort' after replicas, caching, and a bigger primary?",
  "answer": "Because it permanently complicates the data layer: you lose easy cross-shard joins/transactions, must pick a shard key you can't easily change later, take on rebalancing and hotspot risks, and add a routing layer. Replication (read scaling/HA), caching (offload reads), and vertical scaling (a bigger primary) are far simpler and handle most workloads — so you exhaust them first. Sharding is reserved for when writes/storage genuinely exceed one machine, because once sharded, every query and transaction must respect shard boundaries forever. Powerful and sometimes necessary, but a big, mostly one-way step up in complexity."
}
```

## In the wild

- Sharding (a.k.a. **horizontal partitioning across machines**) powers the largest systems
  (social graphs, messaging, time-series) where writes exceed one node.
- **Sharding + replication combine:** each shard is itself replicated (primary + replicas) for
  HA/read-scaling — slices for write scale, copies for availability.
- **Shard key choice is near-irreversible** — changing it later means re-sharding everything, so it's
  designed up front around access patterns.
- Many systems get far on **replicas + caching + a big primary** before sharding; some databases
  (Cassandra, MongoDB, Vitess, Citus) shard more transparently.

## Common misconception — "sharding is just adding more database servers to go faster"

It's a structural change with real, lasting constraints — not a transparent speed-up.

```reveal
{
  "prompt": "Adding read replicas was transparent to the app. Why isn't sharding similarly transparent?",
  "answer": "Replicas hold the *same* data, so the app keeps querying as before (just routing reads to copies) — no schema or query changes. Sharding splits *different* data across machines, so the app must know (or a router must compute) which shard holds a given row via the shard key. Queries that don't include the shard key must fan out to all shards and merge; cross-shard joins/transactions may not work at all; and the shard key constrains your schema and access patterns from then on. So sharding changes how you model data and query it — it scales writes/storage but isn't a drop-in 'more servers = faster'. That non-transparency is why it's adopted late and deliberately."
}
```

Sharding scales **writes and storage past one machine**, but it imposes shard-key design, breaks easy
cross-shard joins/transactions, and adds rebalancing/hotspot concerns. It's a deliberate last resort,
not a transparent upgrade.

## Self-test

```quiz
{
  "question": "Sharding differs from replication in that it:",
  "options": [
    "Keeps full copies of all data on each node",
    "Splits different subsets of the data across independent databases (scaling writes + storage)",
    "Only helps reads",
    "Removes the need for a shard key"
  ],
  "answer": 1,
  "explanation": "Replication copies all data (read scaling/HA); sharding partitions different data across nodes (write/storage scaling)."
}
```

```quiz
{
  "question": "A poorly chosen shard key (e.g. current timestamp) most directly causes:",
  "options": [
    "Better consistency",
    "A hotspot — one shard takes most of the load while others idle",
    "Automatic rebalancing",
    "Smaller storage"
  ],
  "answer": 1,
  "explanation": "Monotonic/skewed keys concentrate writes on one shard (hotspot); a good key spreads load and keeps common queries single-shard."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Database sharding — key terms", "cards": [ { "front": "Sharding", "back": "Splitting the data itself across multiple independent databases (shards), each holding a subset of rows. Scales total write capacity and storage past one machine." }, { "front": "Sharding vs replication", "back": "Replication makes copies of all data (read scaling/HA); sharding makes slices of different data (write/storage scaling). They combine: each shard is itself replicated." }, { "front": "Shard key", "back": "The key that decides which shard a row lives on. Must distribute load evenly and keep common queries on one shard; choosing it well is the entire game." }, { "front": "Hotspot", "back": "One shard overloaded while others idle, caused by a skewed key, a 'celebrity' row, or a monotonic key (timestamp, auto-increment) that concentrates all new writes." }, { "front": "Scatter-gather", "back": "A query that doesn't filter by the shard key must hit every shard and merge results — slow and hard to scale, unlike a single-shard query." }, { "front": "Rebalancing", "back": "Adding/removing shards means moving data; a naive key→shard mapping like modulo reshuffles almost everything — the problem consistent hashing solves." } ] }
```

## Key takeaways

- **Sharding** splits different data across independent databases to scale **writes and storage** past
  a single machine (vs replication, which copies all data for reads/HA).
- The **shard key** is everything: it must **distribute load evenly** and keep **common queries on one
  shard**; monotonic/skewed keys cause **hotspots**.
- Costs: hard **cross-shard joins/transactions**, painful **rebalancing**, and a near-irreversible key
  choice — so it's a **last resort** after replicas/caching/bigger primary.
- Sharding and replication **combine** — each shard is replicated for HA.

## Up next

Rebalancing shards naively reshuffles everything. The elegant fix you've heard about. Next:
**Consistent Hashing**.
