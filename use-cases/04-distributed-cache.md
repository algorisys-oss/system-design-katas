---
title: "Design a Distributed Cache (Redis-like)"
slug: distributed-cache
level: use-cases
module: core-building-blocks
order: 4
reading_time_min: 20
concepts: [consistent-hashing, replication, cache-eviction, hot-keys, smart-clients, persistence]
use_cases: [distributed-cache]
prerequisites: [caching-fundamentals, cache-eviction-policies, consistent-hashing, hot-partitions, replication-strategies]
status: published
---

# Design a Distributed Cache (Redis-like)

> **Use case:** an in-memory key-value store that sits in front of slow backends (databases, APIs)
> to serve reads in **microseconds**, spread across many nodes so it can hold more than one machine's
> RAM and survive node loss.
> **Domain:** every product with a database — session stores, page/object caches, leaderboards,
> rate-limiter counters, feature flags.
> **Scale:** millions of GETs/sec, terabytes of cached data, p99 read latency **under a millisecond**.
> **Core challenges:** **placing keys** across nodes with minimal reshuffle when the cluster changes
> (**consistent hashing**), **replication** so a node dying doesn't lose data, **eviction** when RAM
> fills (LRU/LFU/TTL), **hot keys**, how clients **route** to the right node, optional **persistence**,
> and the **cache-coherence** gotcha of stale data.

A single Redis or Memcached node is a hash map with a network port — easy. The system-design problem
is everything that appears the moment one node isn't enough: how to split keys, how to not lose them,
and how to keep clients pointed at the right place while the cluster grows and shrinks.

## 1 · Clarify requirements

**Functional**
- `GET`, `SET key value [TTL]`, `DEL` over a flat key-value namespace.
- **TTL / expiry** per key (caches are mostly ephemeral).
- Scale **horizontally**: add nodes to add capacity and throughput.
- Survive **node loss** without losing the whole dataset.

**Non-functional**
- **Latency:** sub-millisecond reads; this is the entire reason the cache exists.
- **Availability:** a node dying degrades gracefully (lose its slice, or fail over to a replica) —
  never a full outage.
- **Elasticity:** adding/removing a node reshuffles **as few keys as possible**.
- **Consistency:** caches favor **availability and speed over strong consistency** — brief staleness
  is acceptable; the source of truth is the backing database.

```reveal
{
  "prompt": "A cache is allowed to lose data and return stale values — so why is it still a hard distributed-systems problem?",
  "answer": "Because 'just a fast hash map' stops being true the instant the data exceeds one machine's RAM or the request rate exceeds one machine's CPU/NIC — which is exactly when you reach for a cache. Now you must split the keyspace across N nodes, and the hard parts appear: (1) every client must independently agree on WHICH node owns a given key, with no central lookup on the hot path, or you lose the latency win; (2) when you add or remove a node, a naive hash (key % N) remaps almost every key, causing a cache stampede that hammers the database — consistent hashing exists specifically to bound that to ~1/N of keys; (3) a node dying takes its slice with it, so you need replication and failover, which reintroduces replication lag and split-brain risk; (4) RAM is finite, so under memory pressure you must evict the right keys (LRU/LFU/TTL) without scanning everything; (5) one viral key can saturate a single node (hot key) no matter how evenly you hash. So the cache being lossy and eventually-consistent simplifies the CORRECTNESS bar, but the placement, routing, replication, eviction, and hot-key problems are all still real."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Nodes needed for the working set",
  "inputs": [
    { "key": "datasetGB", "label": "Hot dataset to cache (GB)", "default": 2000 },
    { "key": "ramPerNodeGB", "label": "Usable RAM per node (GB)", "default": 64 },
    { "key": "replicas", "label": "Copies per key (1 primary + N)", "default": 2 }
  ],
  "formula": "Math.ceil((datasetGB * replicas) / ramPerNodeGB)",
  "resultLabel": "Cache nodes required",
  "resultUnit": "nodes"
}
```

```calc
{
  "title": "Throughput vs per-node ceiling",
  "inputs": [
    { "key": "rps", "label": "Peak cache ops/sec", "default": 5000000 },
    { "key": "perNode", "label": "Ops/sec one node sustains", "default": 150000 }
  ],
  "formula": "Math.ceil(rps / perNode)",
  "resultLabel": "Nodes to carry the load",
  "resultUnit": "nodes"
}
```

> A 2 TB hot set at 2 copies on 64 GB nodes needs ~63 nodes for capacity; 5M ops/sec at ~150K/node
> needs ~34 for throughput — so **capacity, not CPU, sizes this cluster**, and we plan for **dozens of
> nodes**. That scale is exactly what forces consistent hashing, replication, and hot-key handling.

## 3 · API & where it sits

The cache is a **look-aside** store the application calls directly, before (and after) the database:

```
GET key            -> value | MISS
SET key value TTL  -> OK
DEL key            -> OK
```

The application owns the **cache-aside pattern**: on read, try the cache; on miss, read the database
and `SET` it back with a TTL. On write, update the database and **invalidate** (or update) the cached
key. The cache never talks to the database itself — it's a dumb, fast key-value box; the smarts live
in the client.

## 4 · High-level architecture

Keys are partitioned across nodes by **consistent hashing**; each partition has a primary plus one or
more replicas. A **smart client** holds the cluster map and routes each op directly to the owning node.

```flow
{
  "title": "Look-aside cache cluster",
  "nodes": [
    { "label": "App + smart client", "detail": "Hashes the key, looks up the owning node in its cached cluster map, sends GET/SET directly — no proxy hop." },
    { "label": "Hash ring", "detail": "Keyspace as a circle; each node owns the arc up to the next node. Adding/removing a node remaps only ~1/N of keys." },
    { "label": "Primary node (shard)", "detail": "Holds its key range in RAM; serves reads/writes; evicts under memory pressure (LRU/LFU/TTL)." },
    { "label": "Replica node(s)", "detail": "Async copy of the primary's data; promoted on primary failure so the slice survives." },
    { "label": "Backing database", "detail": "Source of truth. Hit only on cache miss; result is written back to the cache with a TTL." }
  ],
  "note": "The client routes directly to the owning node, so a GET is one network round trip and stays sub-millisecond."
}
```

**Data model:** a flat namespace of opaque keys to values (strings, or richer types like hashes/sorted
sets in Redis). No joins, no secondary indexes — that simplicity is what keeps it fast and shardable.
**Where partitions live:** each node owns a set of **hash slots** (Redis Cluster uses 16,384 fixed
slots; a key's slot is `CRC16(key) % 16384`). Slots — not individual keys — are the unit of placement
and movement, which makes rebalancing bookkeeping cheap.

## 5 · Deep dive: placing keys (the hash ring)

The naive scheme `node = hash(key) % N` is fatal for a cache: change `N` (add or lose one node) and
**almost every key** remaps to a different node, so the whole cache misses at once and the stampede
floods the database. **Consistent hashing** fixes this by mapping both nodes and keys onto the same
circular hash space; a key belongs to the **first node clockwise**. Adding or removing a node only
reassigns the keys in **one arc** — about `1/N` of the data — instead of all of it.

```ring
{
  "title": "Consistent-hashing ring — add a node, watch ~1/N keys move",
  "servers": [
    { "label": "A", "angle": 20 },
    { "label": "B", "angle": 150 },
    { "label": "C", "angle": 270 }
  ],
  "keys": [
    { "label": "k1", "angle": 35 },
    { "label": "k2", "angle": 95 },
    { "label": "k3", "angle": 140 },
    { "label": "k4", "angle": 200 },
    { "label": "k5", "angle": 250 },
    { "label": "k6", "angle": 320 }
  ],
  "addServer": { "label": "D", "angle": 110 }
}
```

Each key belongs to the first server clockwise. In practice each physical node is placed at **many**
points on the ring (**virtual nodes / vnodes**) so its arcs are small and scattered — that evens out
load and means losing one node spreads its keys across all survivors, not onto a single neighbor.

```reveal
{
  "prompt": "Why add 'virtual nodes' (vnodes) instead of placing each physical node at one point on the ring?",
  "answer": "With one point per node, the ring's arcs are uneven: by chance one node may own a 40% arc and another a 5% arc, so load is lopsided. Worse, when a node dies its ENTIRE arc transfers to the single next node clockwise, instantly doubling that neighbor's load and often toppling it (cascading failure). Virtual nodes fix both: each physical node is hashed to many positions (e.g. 100–256 points), so its responsibility is split into many small arcs scattered around the ring. The law of large numbers then makes every physical node own roughly an equal share, and when a node fails its many small arcs are inherited by many DIFFERENT successors — its load is spread across all surviving nodes rather than dumped on one. Vnodes also make heterogeneous hardware easy: give a bigger node more vnodes to own proportionally more keys. Redis Cluster achieves the same goal differently, with 16,384 fixed hash slots distributed across nodes, but the principle is identical — many small, movable units of placement instead of one big arc per node."
}
```

### Replication for availability

Each partition has a **primary** that serves writes and one or more **replicas** that copy it
asynchronously. If the primary dies, a replica is **promoted** (failover) and the slice stays alive.
Async replication keeps writes fast but means a just-acknowledged write can be lost if the primary
dies before it propagates — acceptable for a cache (the database is the source of truth), unacceptable
for a primary database. This is the same primary-replica model from the replication chapter, tuned for
speed over durability.

### Eviction under memory pressure

RAM is finite; when the cache fills, it must drop keys to make room. The policy decides **which**:

```compare
{
  "options": [
    { "label": "TTL / expiry", "points": ["Each key dies at its set deadline", "Memory self-cleans; bounds staleness", "Doesn't help if many keys are live at once", "Always combine with another policy"] },
    { "label": "LRU (least recently used)", "points": ["Evict the key untouched longest", "Great when recent = popular (temporal locality)", "Approximated by sampling, not exact, to stay O(1)", "Redis/Memcached default-ish choice"] },
    { "label": "LFU (least frequently used)", "points": ["Evict the key accessed fewest times", "Keeps steadily-popular keys over one-off scans", "Needs a counter per key (with decay)", "Better against scan/flush traffic"] },
    { "label": "Random", "points": ["Evict any key", "O(1), zero bookkeeping", "Ignores popularity — lower hit rate", "Fallback when metadata cost matters"] }
  ]
}
```

Real systems **approximate** LRU/LFU: tracking exact recency for millions of keys is too costly, so
Redis samples a handful of random keys and evicts the worst among them — near-LRU/LFU accuracy at O(1)
cost. Pick by access pattern: **LRU** for temporal locality, **LFU** when you must survive a big scan
(a batch job) that would otherwise flush your hot keys.

```tradeoff
{
  "title": "How much eviction bookkeeping is worth it?",
  "axis": { "left": "Cheap / approximate", "right": "Accurate / costly" },
  "steps": [
    { "label": "Random eviction", "detail": "No per-key metadata, O(1). Lowest hit rate — use only when memory for metadata is the constraint." },
    { "label": "Sampled (approx) LRU", "detail": "Sample K random keys, evict the least-recently-used among them. ~Exact-LRU hit rate at O(1). The common default." },
    { "label": "Sampled (approx) LFU with decay", "detail": "Per-key frequency counter that decays over time; resists scan/flush traffic better than LRU. More metadata, more CPU." },
    { "label": "Exact LRU/LFU", "detail": "True ordering (linked list / heap) over all keys. Best accuracy, but the bookkeeping cost rarely pays off at cache scale." }
  ]
}
```

### Hot keys and smart-client routing

Consistent hashing balances **the keyspace**, not **the traffic**: one viral key (a celebrity profile,
a flash-sale SKU) lands on a single node and can saturate it no matter how evenly keys are spread —
the **hot-partition** problem. Mitigations: **replicate the hot key** and read from any replica; add a
tiny **client-side / near-cache** layer for the hottest keys so most reads never leave the app; or
**split the key** into `key#1..key#N` shards behind one logical name. None of these come from the ring;
hot keys are about traffic skew, which hashing can't see.

**Routing** is the client's job. A **smart client** caches the cluster map (which node owns which
slots) and sends each op straight to the owner — one round trip, no proxy. When the topology changes,
the node replies with a redirect (Redis Cluster's `MOVED`/`ASK`), and the client refreshes its map.
The alternative is a **proxy** (e.g. a Twemproxy/Envoy-style layer) that hides routing behind one
endpoint at the cost of an extra hop. Smart clients win on latency; proxies win on client simplicity.

### Optional persistence

Pure caches can be empty after a restart (and just refill from the database), but persistence avoids a
cold-start stampede. Two mechanisms, mirroring Redis:

```compare
{
  "options": [
    { "label": "Snapshot (RDB)", "points": ["Periodic point-in-time dump of the whole dataset to disk", "Compact file, fast restart", "Loses writes since the last snapshot", "Cheap; coarse durability"] },
    { "label": "Append-only file (AOF)", "points": ["Log every write op as it happens", "Loses at most ~1 second of writes (fsync every second)", "File grows; needs periodic rewrite/compaction", "Better durability, more I/O"] }
  ]
}
```

### Cache coherence: the staleness trap

The cache is a **second copy** of data, so it can disagree with the database. The fixes:
**TTL** (bound how long a value can be stale), **write-time invalidation** (delete the key when the
database changes so the next read repopulates), or **write-through** (write database and cache
together). The famous pitfall is **dual-write races**: under concurrency, "update DB then delete
cache" can interleave so a stale read repopulates the cache after the delete — leaving it permanently
wrong until the TTL. A short TTL is the cheap backstop; ordered invalidation or change-data-capture
(reading the database's write log to invalidate) is the robust one.

```reveal
{
  "prompt": "You update the database and then delete the cached key to invalidate it. How can the cache still end up holding a stale value forever?",
  "answer": "It's a race between a concurrent read and your write. Timeline: reader R does GET key, misses, and reads the OLD value V0 from the database — but R is briefly paused before it writes V0 back. Meanwhile writer W updates the database to V1 and then deletes the cached key (which is already empty, so the delete is a no-op). Now paused R resumes and does SET key = V0, repopulating the cache with the stale value. The cache now serves V0 even though the database holds V1, and nothing will correct it until the key's TTL expires — if there's no TTL, it's wrong indefinitely. This is why invalidation order and TTLs matter: a short TTL caps the damage to a few seconds; the 'delete after a small delay' trick (delete, wait, delete again) closes the window; and the most robust fix is to drive invalidation from the database's commit log (change-data-capture) so the cache is updated strictly after — and only after — the committed write, eliminating the interleave entirely. The deeper lesson: a cache is a replica, and any two replicas updated by separate writes can race, so you need either a single ordering point or a TTL safety net."
}
```

## 6 · Trade-offs & failure modes

- **Availability over consistency.** Async replication and look-aside caching mean reads can be
  briefly stale and a freshly-acked write can be lost on failover — the deliberate trade for speed.
  Strong consistency would reintroduce the latency the cache exists to remove.
- **Thundering herd / stampede.** When a hot key expires, thousands of concurrent misses hit the
  database at once. Mitigate with **request coalescing** (one miss fetches; others wait), **early
  recomputation** (refresh just before expiry), or jittered TTLs so keys don't all expire together.
- **Hot key saturates one node.** Hashing balances keys, not traffic — replicate or split the hot key.
- **Failover gap.** Detecting a dead primary and promoting a replica takes seconds; during that gap its
  slice errors or serves stale-from-replica. Tune detection vs false-positive failovers.
- **Memory pressure → wrong evictions.** A poorly chosen policy (or a scan job) can flush the hot set,
  collapsing the hit rate and overloading the database — pick LRU vs LFU for your access pattern.

```tradeoff
{
  "title": "How do clients reach the right node?",
  "axis": { "left": "Smart client (latency)", "right": "Proxy (simplicity)" },
  "steps": [
    { "label": "Smart client", "detail": "Client caches the cluster map and routes directly to the owner — one round trip, lowest latency. Cost: complex client logic and map refresh on topology change." },
    { "label": "Client + light proxy", "detail": "A thin sidecar/proxy near the app handles routing; the app stays dumb but pays one extra local hop. A common middle ground." },
    { "label": "Central proxy", "detail": "All clients hit one proxy endpoint that fans out to nodes. Simplest clients, but the proxy is an extra network hop and a potential bottleneck/SPOF." }
  ]
}
```

## 7 · Scaling & evolution

- **Resharding online:** move hash slots between nodes while serving, migrating keys slot-by-slot with
  redirects so no big-bang remap and no downtime (Redis Cluster slot migration).
- **Tiered caching:** a small per-app **near-cache** (L1, in-process) in front of the cluster (L2)
  absorbs the hottest keys and shaves the network hop entirely.
- **Read replicas for scale, not just failover:** serve GETs from replicas to multiply read throughput
  (accepting replica-lag staleness).
- **Multi-region:** an independent cluster per region (low local latency) with the database as the
  cross-region source of truth; invalidations propagate via the database's change log.
- **Auto-tiering to SSD:** keep hot keys in RAM and spill cold ones to fast SSD to grow capacity per
  node without buying more RAM.

## Self-test

```quiz
{
  "question": "Why is consistent hashing preferred over `node = hash(key) % N` for a distributed cache?",
  "options": [
    "It makes lookups faster on a single node",
    "Adding or removing a node remaps only ~1/N of keys instead of nearly all of them, avoiding a cluster-wide cache miss and DB stampede",
    "It guarantees strong consistency across replicas",
    "It removes the need for replication"
  ],
  "answer": 1,
  "explanation": "With modulo hashing, changing N reshuffles almost every key at once, so the whole cache misses and floods the database. Consistent hashing bounds the remap to one arc (~1/N of keys)."
}
```

```quiz
{
  "question": "Consistent hashing spreads the KEYSPACE evenly, yet one node is overloaded. What is the most likely cause?",
  "options": [
    "Too many replicas",
    "A hot key — one key gets a huge share of the TRAFFIC, and hashing balances keys, not request volume",
    "The TTL is too long",
    "The hash function is broken"
  ],
  "answer": 1,
  "explanation": "Hashing balances where keys live, not how often each is hit. A single viral key lands on one node and saturates it. Fix by replicating or splitting the hot key, or fronting it with a near-cache."
}
```

```quiz
{
  "question": "Under memory pressure, which eviction policy best survives a large batch job that scans millions of rarely-reused keys?",
  "options": [
    "LRU — evict least recently used",
    "Random eviction",
    "LFU — evict least frequently used, so steadily-popular keys survive the one-off scan",
    "Disable eviction and reject writes"
  ],
  "answer": 2,
  "explanation": "A scan touches many keys once, making them all 'recently used' and tricking LRU into evicting the truly-hot set. LFU keeps keys that are accessed frequently over time, so the steadily-popular hot set survives and the scan's one-hit keys are dropped instead."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Distributed cache — key terms",
  "cards": [
    { "front": "Consistent hashing", "back": "Map nodes and keys onto one circle; a key belongs to the next node clockwise. Adding/removing a node remaps only ~1/N of keys, not all of them." },
    { "front": "Virtual nodes (vnodes)", "back": "Place each physical node at many ring points so arcs are small and even, and a failed node's load spreads across all survivors instead of one neighbor." },
    { "front": "Primary–replica replication", "back": "A primary serves writes; replicas copy it (usually async) and are promoted on failover. Fast, but a just-acked write can be lost — fine for a cache." },
    { "front": "Approximate LRU/LFU", "back": "Sample a few random keys and evict the worst (least recently / least frequently used) — near-exact hit rate at O(1) cost, no global ordering structure." },
    { "front": "Hot key", "back": "One key taking a huge share of traffic, saturating its single node. Hashing can't fix it; replicate the key, split it, or front it with a near-cache." },
    { "front": "Cache stampede / thundering herd", "back": "Many concurrent misses (e.g. a hot key expires) hit the DB at once. Mitigate with request coalescing, early refresh, and jittered TTLs." }
  ]
}
```

## Key takeaways

- A distributed cache is easy as one node; the design problems all come from **splitting the keyspace**:
  placement, routing, replication, eviction, and hot keys.
- **Consistent hashing (with vnodes)** is the placement backbone — it keeps load even and bounds the
  reshuffle to **~1/N of keys** when the cluster changes, avoiding a full-cache stampede.
- **Replication** buys availability (promote a replica on failure); caches use **async** replication and
  accept losing a recently-acked write because the database is the source of truth.
- **Eviction (sampled LRU/LFU + TTL)** keeps the hot set in finite RAM; pick the policy by access
  pattern, and watch out for **hot keys** (traffic skew hashing can't fix) and **cache coherence**
  (staleness, dual-write races — bounded by TTL and ordered invalidation).
- **Smart clients** route directly to the owning node for sub-millisecond reads; **persistence
  (snapshot/AOF)** is optional and mainly prevents a cold-start stampede.

## Concepts exercised

This design applies, end to end: `caching-fundamentals` (look-aside, cache-aside, TTL, hit/miss) ·
`cache-eviction-policies` (LRU/LFU/TTL and their sampled approximations under memory pressure) ·
`consistent-hashing` (the ring + virtual nodes for placement and minimal reshuffle) ·
`hot-partitions` (hot keys that hashing can't balance, and how to split/replicate them) ·
`replication-strategies` (primary–replica, async copies, failover and its consistency trade-offs). It
also touches `single-point-of-failure` (proxy vs smart client) and `backpressure-and-load-shedding`
(stampede control via coalescing and jittered TTLs).
