---
title: "Design a Distributed Message Queue (Kafka-like)"
slug: distributed-message-queue
level: use-cases
module: core-building-blocks
order: 5
reading_time_min: 20
concepts: [append-only-log, partitioning, consumer-groups, replication, retention-and-compaction, producer-acks]
use_cases: [distributed-message-queue]
prerequisites: [event-streaming-and-kafka, partitioning-strategies, replication-strategies, lsm-trees-and-compaction, dead-letter-queues]
status: published
---

# Design a Distributed Message Queue (Kafka-like)

> **Use case:** a durable, high-throughput **pub/sub** system: producers append messages to named
> **topics**; many independent consumers read them, at their own pace, possibly long after they were
> written — without losing data or coordinating with each other.
> **Domain:** event streaming, log aggregation, change-data-capture, async work fan-out, metrics
> pipelines — the backbone between services in almost every large system.
> **Scale:** millions of messages/sec, terabytes/day, retained for days, fanned out to dozens of
> consumer groups, with **no message loss** when a broker dies.
> **Core challenges:** the **append-only partitioned log** + offsets; **ordering only within a
> partition**; **consumer groups & rebalancing**; **replication / in-sync replicas** for durability;
> **retention & compaction**; **producer acks**; and **at-least-once vs exactly-once** delivery.

A message queue looks like "a list you push to and pop from." The hard part is making that list
**durable, ordered, replayable, and horizontally scalable** at the same time — and those goals pull
against each other. The Kafka-style answer is surprisingly austere: store everything as an
**append-only log**, and push almost all the cleverness onto the **consumer**.

## 1 · Clarify requirements

**Functional**
- **Produce:** append a message (key + value) to a **topic**; get back a durable position.
- **Consume:** read messages from a topic in order, starting from any **offset**, and replay old
  ones (consumers are not destroyed by reading).
- **Fan-out:** many independent **consumer groups** each read the full stream at their own pace.
- **Scale a group:** within a group, split the work across multiple consumers automatically.

**Non-functional**
- **High throughput:** millions of msgs/sec, sequential disk I/O, large batches.
- **Durability:** an acknowledged message survives broker crashes (replicate before acking).
- **Ordering:** strict order **per partition** (global ordering is explicitly *not* offered).
- **Retention:** keep data for a configured time/size so slow or new consumers can catch up.
- **Availability:** a broker failure must not lose data or stop the topic.

```reveal
{
  "prompt": "Why is 'ordering only within a partition, not across the whole topic' a deliberate design choice rather than a limitation?",
  "answer": "Global ordering across an entire topic would require a single point that serializes every write — one leader, one log, one disk — which caps throughput at what that one machine can do (and makes it a SPOF). The whole reason a message queue scales horizontally is that a topic is split into many partitions, each an independent append-only log living on (potentially) different brokers; writes to different partitions happen fully in parallel. Ordering can only be guaranteed where there is a single serialization point, and that point is the individual partition. So the system offers a strong, cheap guarantee — total order within a partition — and refuses the expensive one — total order across the topic. The application gets the ordering it actually needs by choosing a partition KEY: all events for the same entity (e.g. the same user_id or order_id) hash to the same partition, so they are strictly ordered relative to each other, while unrelated entities spread across partitions and scale out. You trade a guarantee you rarely need (global order) for the one you usually do (per-entity order) plus near-linear scalability."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Write throughput and raw daily volume",
  "inputs": [
    { "key": "msgsPerSec", "label": "Peak messages/sec", "default": 2000000 },
    { "key": "avgBytes", "label": "Avg message size (bytes)", "default": 500 }
  ],
  "formula": "msgsPerSec * avgBytes",
  "resultLabel": "Ingest throughput",
  "resultUnit": "bytes/s"
}
```

```calc
{
  "title": "Stored bytes after retention + replication",
  "inputs": [
    { "key": "bytesPerDay", "label": "Ingest bytes/day (post-batch)", "default": 86000000000000 },
    { "key": "retentionDays", "label": "Retention (days)", "default": 7 },
    { "key": "replication", "label": "Replication factor", "default": 3 }
  ],
  "formula": "bytesPerDay * retentionDays * replication",
  "resultLabel": "Total on-disk storage",
  "resultUnit": "bytes"
}
```

> ~1 GB/sec ingest, ~86 TB/day raw; with 7-day retention at replication factor 3 that's well over a
> **petabyte of disk**. Two consequences fall out immediately: this lives on **disk, not memory**
> (so the storage engine must make sequential disk I/O fast), and one broker can't hold it — we must
> **partition** across many brokers and **replicate** each partition for durability.

## 3 · API & where it sits

The queue sits **between services**: producers write, the cluster stores, consumer groups read.
Three small operations carry almost everything:

```
produce(topic, key, value)        -> { partition, offset }   // append; offset is the position in that partition's log
poll(group, topics, maxBytes)     -> [ { partition, offset, key, value } ... ]   // read next batch from assigned partitions
commit(group, partition, offset)  -> ok                       // persist "this group has consumed up to here"
```

The **offset** is the whole trick: a monotonically increasing integer = a message's position in its
partition's log. The broker is **dumb about consumers** — it never tracks who read what. Each
consumer group stores **its own committed offset** per partition (Kafka keeps these in an internal
compacted topic). That's why many groups can read the same data independently and why any group can
**rewind** by simply committing an earlier offset and re-reading. Reading does not consume.

## 4 · High-level architecture

```flow
{
  "title": "Topic → partitions → replicated logs across brokers",
  "nodes": [
    { "label": "Producer", "detail": "Picks a partition by hash(key) (or round-robin if key is null); batches records; chooses an acks level." },
    { "label": "Partitioner", "detail": "partition = hash(key) % numPartitions → same key always lands on the same partition (ordering anchor)." },
    { "label": "Partition leader (broker)", "detail": "The one replica that accepts writes for this partition; appends to its on-disk log, assigns the next offset." },
    { "label": "Follower replicas (other brokers)", "detail": "Pull from the leader and append the same records; the leader + caught-up followers form the ISR (in-sync replica set)." },
    { "label": "Consumer group", "detail": "Members split the partitions among themselves; each partition is read by exactly one member; the group commits offsets." }
  ],
  "note": "A topic is a logical name; the physical unit is the partition, each an independent append-only log replicated to N brokers. Throughput scales with partition count; ordering is per partition."
}
```

**Storage engine — the append-only log.** Each partition is a directory of **segment files**.
Writes only ever **append** to the active segment; there are no in-place updates, so the disk head
moves sequentially — the reason commodity disks sustain ~hundreds of MB/sec here. A sparse **index**
maps offset → byte position so a consumer can seek to "offset 4,210,008" in O(log n). Old segments
are deleted or compacted whole (cheap), never edited. Reads are sequential too, so the OS page cache
serves recent data straight from RAM, and the broker can `sendfile()` bytes from disk to socket
without copying through user space — that **zero-copy** path is a big part of the throughput story.

This is the same insight as an **LSM-tree** (a prerequisite): make writes append-only and sequential,
then reclaim space with background compaction — except here the log itself *is* the user-facing data
structure, not just an internal write buffer.

## 5 · Deep dives

### 5a · Partitioning and ordering

A producer routes each record by `partition = hash(key) % numPartitions`. A null key spreads
records round-robin (max throughput, no per-key order). The choice of **key** is the application's
ordering contract: `key = order_id` means every event for that order is strictly ordered; events for
different orders parallelize across partitions.

```reveal
{
  "prompt": "If you add partitions to a busy topic to scale it, what silently breaks, and how do real systems avoid it?",
  "answer": "Partition assignment is `hash(key) % numPartitions`. Change numPartitions and the modulus changes, so an existing key that used to map to partition 2 may now map to partition 5. New events for that key go to a different partition than its history — and since ordering is only guaranteed within a partition, the per-key total order is broken across the resize boundary: a consumer could read the new partition's events before draining the old one. Kafka therefore treats adding partitions as a real schema decision: it never moves existing data, and you accept that key→partition stability is lost going forward. Teams avoid the pain by (a) over-provisioning partitions up front (it's cheap to have more partitions than brokers), (b) using consistent-hashing-style schemes when stable mapping under resize is essential, or (c) for compacted/keyed topics, never repartitioning at all. The deeper lesson — straight from the partitioning-strategies chapter — is that the partition count is part of your data model, not a knob you turn freely, precisely because the hash function bakes the count into where every key lives."
}
```

### 5b · Consumer groups & rebalancing

A **consumer group** is a set of consumers that **share** a subscription: each partition is assigned
to **exactly one** member, so the group collectively reads the whole topic once, with the work split
for throughput. Two different groups are independent — each gets the full stream. The unit of
parallelism is the partition, so **a group can't have more useful consumers than partitions** (extras
sit idle).

```sequence
{
  "title": "Consumer joins → group rebalances → reads & commits",
  "actors": ["Consumer", "GroupCoordinator", "PartitionLeader"],
  "steps": [
    { "from": "Consumer", "to": "GroupCoordinator", "label": "JoinGroup(group=g, topics=[t])" },
    { "from": "GroupCoordinator", "to": "Consumer", "label": "assignment: you own partitions {0,3}" },
    { "from": "Consumer", "to": "PartitionLeader", "label": "fetch from committed offset (e.g. 51200)" },
    { "from": "PartitionLeader", "to": "Consumer", "label": "batch of records [51200..51999]" },
    { "from": "Consumer", "to": "GroupCoordinator", "label": "commit offset 52000 for {0,3}" }
  ]
}
```

When a member joins, leaves, or dies (its heartbeat stops), the coordinator triggers a
**rebalance**: partitions are reassigned among the surviving members. The naive "stop-the-world"
rebalance pauses *all* consumption while reassigning — a real cost on big groups — so modern
schemes use **cooperative/incremental rebalancing** that only moves the partitions that need to
move, and **static membership** so a brief restart doesn't trigger a reshuffle at all. Because the
new owner resumes from the committed offset, in-flight-but-uncommitted messages get **redelivered** —
which is exactly why delivery is at-least-once by default (see 5d).

### 5c · Replication & in-sync replicas (durability)

Each partition has a **leader** and N−1 **followers** on other brokers. Producers and consumers talk
only to the leader; followers continuously **pull** new records and append them. The set of replicas
that are fully caught up (leader + followers within a lag bound) is the **ISR — in-sync replica set**.
If the leader dies, the controller elects a **new leader from the ISR**, so no acknowledged data is
lost. A follower that falls behind drops out of the ISR until it catches up.

```reveal
{
  "prompt": "What is the relationship between acks=all, min.insync.replicas, and the guarantee 'no acknowledged message is ever lost'?",
  "answer": "These two settings together define durability. acks=all tells the producer to wait until the leader has replicated the record to ALL members of the current ISR before acknowledging. min.insync.replicas (say, 2) is a floor: the leader refuses to accept a write at all if the ISR has shrunk below that number (it returns an error instead of acking). Put together with replication.factor=3 and min.insync.replicas=2: a write is only acked once at least 2 replicas hold it, and a new leader is only elected from the ISR. So losing any single broker can't lose acknowledged data — at least one surviving ISR member still has every acked record, and it becomes the new leader. The subtlety is the failure mode you DON'T want: if you set acks=all but min.insync.replicas=1, then when all followers have fallen out of the ISR the leader alone is 'all' the ISR — it acks writes that exist on exactly one disk, and if that broker then dies, acknowledged data is gone. That's the famous availability-vs-durability dial: a higher min.insync.replicas refuses more writes during failures (less available) but guarantees more copies before acking (more durable). The default safe combo for important data is RF=3, min.insync.replicas=2, acks=all — survive one failure, keep accepting writes, never lose an acked record."
}
```

```compare
{
  "options": [
    { "label": "acks=0 (fire-and-forget)", "points": ["Producer never waits", "Highest throughput, lowest latency", "Message can be lost if the leader dies before persisting", "Use for lossy metrics/telemetry"] },
    { "label": "acks=1 (leader only)", "points": ["Wait for leader's local write only", "Good throughput", "Lost if leader dies before a follower replicates", "A middle ground, but a real loss window"] },
    { "label": "acks=all + min.insync=2", "points": ["Wait until the ISR has the record (≥2 copies)", "Lower throughput / higher latency", "No acknowledged loss on a single-broker failure", "The durable default for important data"] }
  ]
}
```

Drag the dial — stronger durability costs latency and rejects more writes during failures:

```tradeoff
{
  "title": "How durable must an acknowledged write be?",
  "axis": { "left": "Fast / lossy", "right": "Durable / strict" },
  "steps": [
    { "label": "acks=0", "detail": "Producer doesn't wait for any ack. Maximum throughput; a crash loses in-flight records. Fine for high-volume, disposable data like metrics." },
    { "label": "acks=1", "detail": "Wait for the leader's local append only. Fast, but if the leader dies before a follower copies the record, it's lost. A pragmatic middle." },
    { "label": "acks=all, min.insync=2", "detail": "Ack only after the record is on ≥2 ISR replicas; survive one broker loss with no acknowledged-data loss. The standard durable config." },
    { "label": "acks=all, min.insync=3 (RF=3)", "detail": "Every replica must confirm before ack. Strongest durability, but ANY broker being down on that partition halts writes — least available." }
  ]
}
```

### 5d · Retention, compaction & delivery semantics

The broker keeps data for a **retention** window, independent of whether anyone read it:
- **Time/size retention:** delete whole segments older than e.g. 7 days, or beyond e.g. 1 TB.
  Consumers within the window can replay; a consumer that falls further behind than retention
  **loses** those messages (it skips ahead).
- **Log compaction:** for *keyed* topics where you want the **latest value per key** to survive
  forever (e.g. "current state of each user"), a background process rewrites segments keeping only
  the most recent record per key, dropping superseded ones. This is the same merge-and-discard idea
  as **LSM-tree compaction** (prerequisite), applied to the log: it turns an unbounded event stream
  into a bounded **changelog/snapshot** you can rebuild state from.

**Delivery semantics** flow from where the offset is committed relative to processing:
- **At-most-once:** commit the offset *before* processing → a crash mid-processing loses the message
  (never redelivered). Rare; only for lossy data.
- **At-least-once (the default):** process, *then* commit → a crash after processing but before
  commit causes **redelivery** on rebalance. The consumer must therefore be **idempotent** (e.g.
  dedupe by message key / upsert), because it *will* occasionally see duplicates.
- **Exactly-once:** the producer gets an **idempotent** id + sequence number (the broker dedupes
  retries on a partition), and reads-process-writes are wrapped in a **transaction** so the output
  records and the consumed offsets commit atomically. It's real but costs throughput and only spans
  the Kafka boundary — an external side effect (e.g. a third-party API call) is still at-least-once
  unless that system also dedupes.

A message that repeatedly fails processing shouldn't block its partition forever; route it to a
**dead-letter queue** (prerequisite) after K retries so the partition keeps flowing and the poison
record can be inspected out of band.

```reveal
{
  "prompt": "People say Kafka has 'exactly-once,' but the consumer's own code can still see duplicates. Reconcile that.",
  "answer": "Exactly-once in Kafka is scoped to the Kafka-to-Kafka path and depends on two mechanisms. First, the idempotent producer: each producer gets a producer id and attaches a monotonic sequence number per partition, so if a producer retries a send after a network blip, the broker recognizes the duplicate sequence and writes it only once — this removes producer-side duplicates. Second, transactions: a stream processor that reads from topic A, computes, and writes to topic B can commit the output records AND the input offsets in one atomic transaction, so either both happen or neither — there's no window where output is written but the offset isn't (which is what causes at-least-once redelivery). Consumers reading transactional topics with read_committed isolation only see committed records. So 'exactly-once' holds for the closed loop of Kafka topics processed by Kafka transactions. What it does NOT cover is an arbitrary side effect inside your consumer — sending an email, charging a card, calling a non-transactional REST API. Those aren't part of the Kafka transaction, so if the consumer crashes after the side effect but before committing, the side effect repeats on redelivery. That's why the durable real-world pattern is still at-least-once delivery + idempotent processing (dedupe by message id, upsert by key): exactly-once is a powerful guarantee within the system's own boundary, not a magic property that makes every downstream effect happen once."
}
```

## 6 · Trade-offs & failure modes

- **Broker (leader) failure.** The controller elects a new leader from the ISR; producers/consumers
  reconnect to it. No acked data lost *if* `acks=all` + `min.insync.replicas≥2`. With `acks=1` there's
  a real loss window.
- **Slow consumer / consumer lag.** A consumer reading slower than the producer writes accumulates
  **lag** (offset gap). Within retention it can catch up; beyond retention it permanently skips
  data. Lag is the key health metric to alarm on.
- **Hot partition.** A skewed key (one huge customer) sends most traffic to one partition → one
  leader and one consumer member do all the work (recall hot partitions). Mitigate with a better key,
  a composite key, or salting.
- **Rebalance storms.** Frequent joins/leaves (e.g. consumers OOM-restarting) trigger repeated
  stop-the-world rebalances that pause the group. Mitigate with cooperative rebalancing, static
  membership, and right-sized session timeouts.
- **Poison messages** block their partition under at-least-once if retried forever → route to a DLQ.
- **Disk pressure.** Retention + replication is your true storage cost; misconfigured retention
  silently fills disks and brokers fall over.

## 7 · Scaling & evolution

- **Scale throughput by partitions** (the parallelism unit), not by adding consumers to an
  already-saturated group; provision partition count generously up front since repartitioning breaks
  key→partition stability (5a).
- **Tiered storage:** offload old, cold segments to object storage (S3-class) while keeping the
  recent tail on local disk — cheap long retention without huge local SSDs.
- **Replace the external coordinator:** older designs used a separate ZooKeeper ensemble for
  metadata/leader election; modern Kafka folds this into an internal Raft-based controller quorum
  (KRaft), removing a moving part.
- **Schema governance:** a schema registry enforces compatible message formats so producers and
  consumers can evolve independently.
- **Geo-replication:** mirror topics across regions for disaster recovery and locality, accepting
  async cross-region lag.

## Self-test

```quiz
{
  "question": "A consumer group has 12 members subscribed to a topic with 8 partitions. How many members actively consume?",
  "options": ["12 — all share each partition", "8 — one member per partition; the other 4 sit idle", "1 — only the leader consumes", "8, and the extra 4 read replicas"],
  "answer": 1,
  "explanation": "Within a group each partition is assigned to exactly one member, so the partition count caps useful parallelism. With 8 partitions only 8 members can be assigned; the remaining 4 are idle standbys."
}
```

```quiz
{
  "question": "With replication.factor=3, acks=all, and min.insync.replicas=2, what's true when one broker hosting a partition fails?",
  "options": [
    "Acknowledged data may be lost",
    "No acknowledged data is lost and writes continue (ISR still ≥2)",
    "The topic stops accepting writes permanently",
    "All three replicas must be online to read"
  ],
  "answer": 1,
  "explanation": "Acks only return once ≥2 ISR replicas hold the record, and a new leader is elected from the ISR. Losing one of three replicas leaves ≥2 in-sync, so no acked data is lost and writes keep flowing."
}
```

```quiz
{
  "question": "Kafka's default delivery semantic is at-least-once. What must consumer code do as a result?",
  "options": [
    "Nothing — duplicates are impossible",
    "Be idempotent, because redelivery after a crash/rebalance can show the same message twice",
    "Commit the offset before processing",
    "Disable replication"
  ],
  "answer": 1,
  "explanation": "Processing then committing means a crash before commit causes redelivery on rebalance. So a consumer will occasionally see duplicates and must dedupe / upsert to stay correct."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Distributed message queue — key terms",
  "cards": [
    { "front": "Partition (append-only log)", "back": "The physical unit of a topic: an ordered, append-only sequence of records on disk, replicated across brokers. The unit of parallelism and the only place ordering is guaranteed." },
    { "front": "Offset", "back": "A record's monotonically increasing position within its partition's log. Consumers track their own committed offset, so they can replay or skip; the broker doesn't track who read what." },
    { "front": "Consumer group", "back": "A set of consumers sharing a subscription; each partition goes to exactly one member. Different groups read the same stream independently." },
    { "front": "ISR (in-sync replica set)", "back": "Leader + followers caught up within a lag bound. New leaders are elected only from the ISR; acks=all waits for the ISR, so acked data survives a broker loss." },
    { "front": "Log compaction", "back": "Background rewrite that keeps only the latest record per key, turning an unbounded keyed stream into a bounded changelog/snapshot. Same idea as LSM-tree compaction." },
    { "front": "At-least-once vs exactly-once", "back": "Default is at-least-once (process then commit → possible redelivery → need idempotent consumers). Exactly-once uses idempotent producers + transactions, scoped to the Kafka boundary." }
  ]
}
```

## Key takeaways

- The core data structure is an **append-only, partitioned log**: sequential disk I/O + an
  offset index + zero-copy reads give high throughput, and a **dumb broker / smart consumer** split
  (consumers own their offsets) enables replay and independent fan-out.
- **Partitions are everything:** they are the unit of parallelism and the only scope of ordering, so
  the **partition key** is your ordering contract — and partition count is a data-model decision,
  because resizing breaks key→partition stability.
- **Durability** comes from **replication + the ISR**: `acks=all` with `min.insync.replicas≥2` means
  no acknowledged message is lost on a single-broker failure — a deliberate **durability-vs-latency-
  vs-availability** dial.
- **Consumer groups + rebalancing** distribute work and tolerate failures, but redelivery makes the
  default **at-least-once** — so build **idempotent consumers**, use a **DLQ** for poison messages,
  and reach for transactional **exactly-once** only within the Kafka boundary.
- **Retention and compaction** decide how long replay is possible and how cold data is reclaimed;
  consumer **lag** is the metric that tells you whether the system is keeping up.

## Concepts exercised

This design applies, end to end: `event-streaming-and-kafka` (the whole append-only-log, topic, and
broker model) · `partitioning-strategies` (hash-by-key routing, ordering scope, and why partition
count is part of the data model) · `replication-strategies` (leader/follower, the ISR, and
leader election for durability and availability) · `lsm-trees-and-compaction` (the append-only
sequential-write insight reused as log compaction) · `dead-letter-queues` (handling poison messages
without blocking a partition). It also touches `hot-partitions` (key skew), `single-point-of-failure`
(why global ordering is rejected), and `database-transactions` (the atomic offset+output commit
behind exactly-once).
