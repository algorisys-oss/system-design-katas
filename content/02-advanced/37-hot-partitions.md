---
title: "Hot Partitions"
slug: hot-partitions
level: advanced
module: resilience
order: 37
reading_time_min: 14
concepts: [hot-partition, hotspot, skew, key-salting, write-sharding, celebrity-problem]
use_cases: []
prerequisites: [database-sharding, consistent-hashing, partitioning-strategies]
status: published
---

# Hot Partitions

## Hook — a motivating scenario

You sharded perfectly evenly — 100 partitions, ~1% of the *keys* each. Yet one partition is melting at
100% CPU while the rest idle. Why? Because **load isn't distributed like keys are**: one celebrity's
account, one viral product, one "current day" timestamp gets a wildly disproportionate share of
traffic. Even distribution of *data* doesn't guarantee even distribution of *access* — and a single
**hot partition** becomes a bottleneck (and a mini-SPOF) no matter how many partitions you have.

## Mental model — access skew, not data skew

A **hot partition (hotspot)** is a partition receiving **disproportionate load** relative to the
others. The subtle point: you can balance **how much data** each partition holds and still have terrible
**access** balance, because **real-world access is skewed** (power-law / Zipfian) — a few keys get most
of the traffic. Causes:
- **Skewed access (the celebrity problem):** one key is wildly popular (a celebrity user, a viral
  post/product) — all its traffic lands on one partition (recall the news-feed celebrity hotspot).
- **Sequential/monotonic keys:** keys like timestamps or auto-increment IDs send **all new writes** to
  the **same (latest) partition** (recall sharding: monotonic-key hotspots).
- **Low-cardinality partition key:** too few distinct values, so traffic clumps.

```flow
{
  "title": "Even data, uneven load → a hot partition",
  "nodes": [
    { "label": "Partitions hold ~equal DATA", "detail": "100 partitions, ~1% of keys each — looks balanced." },
    { "label": "But access is skewed", "detail": "One celebrity key (or 'today's' timestamp) gets a huge share of requests." },
    { "label": "Its partition is hot", "detail": "That one partition saturates (CPU/IO) while others idle — a bottleneck + mini-SPOF." },
    { "label": "Adding partitions doesn't help", "detail": "The hot KEY still maps to ONE partition — the skew, not the count, is the problem." }
  ],
  "note": "Balance data ≠ balance load. A single hot key overwhelms its partition regardless of partition count."
}
```

## Build it up — why more partitions doesn't fix one hot key

The crucial insight: if a **single key** is hot, **adding partitions doesn't help** — that key still
hashes to **one** partition, which still takes all of its traffic. The hotspot is about **one key's
concentration**, not the number of partitions. So the fixes target the **key**:
- **Salting / key splitting (write sharding):** append a small random/bucketed suffix to spread one hot
  key across **N sub-keys/partitions** (e.g. `post123#0`…`post123#9`). Writes/reads fan across N
  partitions; you **scatter-gather** on read to recombine. Trades read complexity for spreading a hot
  key.
- **Randomize/hash sequential keys:** for monotonic keys, **hash** the key or prefix it so new writes
  **spread** instead of all hitting the latest partition (recall partitioning strategies).
- **Cache the hot key:** a celebrity/viral key is read-heavy → put it in a **cache** so most reads never
  hit the partition at all (recall the feed capstone: one cached copy serves millions).
- **Dedicated handling:** give the hot key its own resources/partition, or replicate it widely for reads.

```reveal
{
  "prompt": "Why doesn't adding more partitions fix a hot partition caused by a single celebrity key, and what actually does?",
  "answer": "Because partitioning maps each key to a partition (by hash or range), so a single key — no matter how hot — always lands on exactly ONE partition. Adding more partitions just changes how the (cold) keys are spread; the one hot key still hashes to a single partition that must absorb all of its traffic, so that partition stays saturated while the new partitions sit idle. The bottleneck is the concentration of load on ONE key, not the number of partitions, so scaling partition count is the wrong lever. What actually helps targets the key itself: (1) Salting / key splitting (write sharding) — turn the single hot key into N sub-keys by appending a random or bucketed suffix (post123#0..post123#9), so its writes and reads spread across N partitions; on read you scatter-gather across the N sub-keys and recombine, trading extra read complexity for distributing the load. (2) Caching — a celebrity key is usually read-heavy, so put it in a cache (ideally a widely-replicated/edge cache); one cached copy then serves millions of reads and most traffic never reaches the partition at all (as in the news-feed celebrity solution). (3) Dedicated resources / wide read replication — give the hot key its own partition/node or replicate it across many read replicas so reads fan out. (4) For sequential/monotonic-key hotspots specifically, hash or prefix the key so new writes spread instead of all hitting the latest partition. For mixed read/write hotspots you combine these (cache the reads, salt the writes). The key realization: a single-key hotspot is a concentration problem solved by spreading or absorbing that key's load (salting, caching, replication), not by adding partitions — more partitions only helps when load is spread across many keys, not when it's concentrated on one."
}
```

## Build it up — detection and prevention

- **Detect:** monitor **per-partition** metrics (CPU, request rate, latency, throttling) — not just
  cluster averages, which hide a single hot partition. Many managed stores (DynamoDB) surface
  throttling / hot-partition signals. (Recall observability: averages hide tails; here, per-partition
  granularity.)
- **Prevent at design time:** choose a **high-cardinality, evenly-accessed partition key** (recall shard
  key choice); avoid monotonic keys; anticipate **known hot keys** (celebrities, "today") and plan
  salting/caching for them up front.
- **Adaptive:** some systems **split/move hot partitions automatically** (DynamoDB adaptive capacity,
  splitting); but you still design keys to avoid single-key hotspots, which auto-splitting can't fix.

```reveal
{
  "prompt": "Why do cluster-average metrics hide hot partitions, and what should you monitor instead?",
  "answer": "Because a single hot partition is an extreme outlier averaged against many idle ones, so aggregate/cluster-wide metrics look perfectly healthy while one partition is on fire. If 99 partitions are at 5% CPU and one is at 100%, the cluster average is ~6% — you'd conclude there's plenty of headroom, even though that one saturated partition is throttling/failing the requests for its (often most important) hot key, causing elevated latency and errors for those users. Averages (and even high percentiles computed across all partitions) smear the hotspot into the background; total throughput can also look fine because the cold partitions have spare capacity that the hot key can't use. To catch hot partitions you must monitor at PER-PARTITION granularity: per-partition request rate/QPS, CPU/IO utilization, latency, queue depth, and especially throttling/rejection metrics (a hot partition shows up as throttled requests or high latency on one partition while others are quiet). Look at the distribution/max across partitions, not the mean — e.g. max-partition utilization, or the spread between hottest and coldest. Managed stores often expose hot-partition or throttling signals directly (e.g. DynamoDB's throttling/hot-key metrics) precisely because averages hide them. This mirrors the broader observability lesson that averages hide tails: just as p99 latency reveals what mean latency hides, per-partition metrics reveal the skew that cluster averages hide. Once detected, you apply the key-level fixes (salting, caching, dedicated handling) and/or rely on adaptive splitting. The monitoring principle: measure the hottest unit, not the average, because resilience is limited by the worst partition, not the typical one."
}
```

## In the wild

- **DynamoDB** is famous for hot-partition throttling: a single physical partition is hard-capped at
  **~3,000 read capacity units and ~1,000 write capacity units per second**, so one hot key can't exceed
  that no matter how much table throughput you provision. Mitigations: high-cardinality partition keys,
  **write sharding (salting)**, caching (DAX), and **adaptive capacity / auto-split**.
- **Kafka:** a hot partition key (or too few partitions) concentrates load on one partition/consumer
  (recall Kafka partitioning/ordering); choose keys to spread load.
- **The celebrity/viral problem** (recall news-feed capstone) is the canonical hotspot — solved with
  caching + special-casing the hot key.
- **Sequential-key hotspots** (timestamps, auto-increment) are a classic write-hotspot — fix by hashing
  /prefixing keys (recall partitioning strategies).

## Common misconception — "even sharding guarantees even load"

Balanced **data** ≠ balanced **access**; skewed traffic creates hot partitions regardless of how evenly
keys are distributed.

```reveal
{
  "prompt": "Why does 'I sharded the data evenly, so load is balanced' fail in practice?",
  "answer": "Because sharding balances DATA distribution (how many keys/how much storage each partition holds), but load is about ACCESS distribution (how many requests hit each key), and real-world access is highly skewed rather than uniform. Traffic typically follows a power-law/Zipfian pattern: a small number of keys (a celebrity account, a viral post/product, the 'current day' timestamp, a trending item) receive a hugely disproportionate share of requests, while most keys are cold. Since each key maps to one partition, all of a hot key's traffic concentrates on that single partition, saturating it (CPU/IO/throttling) even though it holds only ~1% of the data and the cluster average looks idle. So you can have textbook-even data distribution and still have one partition melting — even sharding does nothing about a single key's popularity. Compounding causes: sequential/monotonic keys (timestamps, auto-increment IDs) send all new writes to the latest partition regardless of how evenly old data is spread, and low-cardinality partition keys clump traffic. The fixes target access/keys, not data balance: salting/write-sharding to spread a hot key across sub-partitions (with scatter-gather reads), caching hot read-heavy keys so most requests bypass the partition, hashing/prefixing sequential keys so writes spread, dedicated resources/replication for known hot keys, and per-partition monitoring to detect skew (cluster averages hide it). The core misconception is conflating data distribution with load distribution; balanced storage is necessary but not sufficient — you must also ensure no single key (or small set) concentrates the traffic, because the hottest key, not the average, determines whether a partition becomes a bottleneck."
}
```

A **hot partition** is access skew: a few keys (a celebrity, a viral item, a monotonic timestamp) take a
disproportionate share of traffic, saturating **one** partition even when **data** is evenly sharded.
**Adding partitions doesn't fix a single hot key** — you must **spread or absorb the key** (salting/
write-sharding with scatter-gather, **caching** hot reads, hashing sequential keys, dedicated handling)
and **monitor per-partition** to detect it (averages hide it).

## Self-test

```quiz
{
  "question": "Why can a perfectly even data sharding still produce a hot partition?",
  "options": [
    "Because the disks are different sizes",
    "Because access is skewed — a few keys (a celebrity, a viral item, 'today's' timestamp) get most of the traffic, concentrating load on one partition",
    "Because there are too many partitions",
    "Because of DNS caching"
  ],
  "answer": 1,
  "explanation": "Balanced DATA ≠ balanced ACCESS; real-world traffic is skewed (Zipfian), so one popular key overwhelms its single partition."
}
```

```quiz
{
  "question": "For a hotspot caused by a single celebrity key, the right fix is:",
  "options": [
    "Add more partitions",
    "Spread or absorb that key — salting/write-sharding (with scatter-gather reads) and/or caching the hot read-heavy key",
    "Use a slower disk",
    "Lower the replication factor"
  ],
  "answer": 1,
  "explanation": "A single hot key still maps to one partition no matter how many you add; you must split the key (salting) or cache it to spread/absorb its load."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Hot partitions — key terms", "cards": [ { "front": "Hot partition (hotspot)", "back": "A partition receiving disproportionate load relative to others — saturating CPU/IO and becoming a bottleneck and mini-SPOF, even when data is evenly sharded." }, { "front": "Access skew vs data skew", "back": "Data skew is uneven storage per partition; access skew is uneven traffic. Even data distribution doesn't guarantee even access — real-world traffic is power-law/Zipfian." }, { "front": "Celebrity problem", "back": "One wildly popular key (a celebrity user, viral post/product) sends all its traffic to one partition, saturating it regardless of partition count." }, { "front": "Salting / key splitting (write sharding)", "back": "Append a small random or bucketed suffix to spread one hot key across N sub-keys/partitions (post123#0..post123#9); reads scatter-gather to recombine." }, { "front": "Why more partitions doesn't help", "back": "A single hot key still hashes to one partition that absorbs all its traffic. The skew, not the partition count, is the problem — so you fix the key." }, { "front": "Detecting hot partitions", "back": "Monitor per-partition metrics (rate, CPU, latency, throttling), not cluster averages — averages smear one hot partition into many idle ones and hide it." } ] }
```

## Key takeaways

- A **hot partition** is **access skew** — a few keys (celebrity/viral/monotonic) take disproportionate
  traffic, saturating **one** partition even with **evenly-distributed data**.
- **Adding partitions doesn't fix a single hot key** (it still maps to one partition) — fix the **key**:
  **salting/write-sharding** (+ scatter-gather reads), **hash sequential keys**, **cache** hot reads,
  dedicated handling.
- **Detect** with **per-partition** metrics (rate/CPU/latency/throttling) — **cluster averages hide
  hotspots**.
- **Prevent at design time:** high-cardinality, evenly-accessed **partition keys**; anticipate known hot
  keys; adaptive splitting helps but can't fix a single-key hotspot.

## Up next

A different failure mode — when a partitioned cluster splits into two "halves" that both think they're
in charge. Next: **Split-Brain**.
