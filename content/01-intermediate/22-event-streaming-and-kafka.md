---
title: "Event Streaming & Kafka"
slug: event-streaming-and-kafka
level: intermediate
module: messaging-and-streaming
order: 22
reading_time_min: 16
concepts: [event-streaming, kafka, log, partitions, offsets, consumer-groups, replay]
use_cases: []
prerequisites: [message-queues, publish-subscribe]
status: published
---

# Event Streaming & Kafka

## Hook — a motivating scenario

Your "order placed" events feed email, analytics, search, and fraud detection — and now data science
wants to **reprocess the last 30 days** to train a model, while a new service needs **every event from
the beginning of time**. A traditional queue can't do this: once a message is consumed, it's gone.
You need a system that keeps events as a **durable, replayable log** that many consumers read
independently and can rewind. That's **event streaming**, and **Kafka** is its archetype.

## Mental model — an append-only log, not a to-do list

A message queue is a to-do list: you take an item and it's removed. An **event stream** is an
**append-only log** (like a commit log or a ledger): events are **appended** and **retained**, and
consumers read by tracking their **position (offset)** in the log — they don't delete anything.
Multiple consumers read the same log independently, each at their own offset, and can **rewind** to
re-read.

```layers
{
  "title": "Kafka structure (topic → partitions → ordered, retained events)",
  "layers": [
    { "label": "Topic", "detail": "A named stream of events (e.g. 'orders'). Split into partitions for scale.", "meta": "stream" },
    { "label": "Partition (ordered log)", "detail": "An append-only, ordered sequence of events. Order is guaranteed WITHIN a partition.", "meta": "log" },
    { "label": "Offset", "detail": "Each consumer tracks its position per partition; advancing it = 'I've read up to here'.", "meta": "position" },
    { "label": "Retention", "detail": "Events kept for a time/size window (days, or forever) — so consumers can replay.", "meta": "durable" }
  ]
}
```

## Build it up — partitions, offsets, consumer groups

- **Partitions** give scale + ordering: a topic is split into partitions, each an ordered log. Events
  with the same **key** (e.g. user_id) go to the same partition, so **per-key order is preserved**;
  parallelism comes from many partitions.
- **Offsets** give independent, resumable reads: each consumer remembers how far it's read, so it can
  resume after a restart and **replay** by resetting its offset backward.
- **Consumer groups** give both fan-out and work-sharing: *different* groups each get *all* events
  (pub/sub fan-out — email group, analytics group), while *within* a group, partitions are divided
  among members (queue-like parallelism). One model does both.

```reveal
{
  "prompt": "How does Kafka let the email service and the analytics service BOTH get every event, while still parallelizing work within each service?",
  "answer": "Through consumer groups + partitions. Each service is its own consumer group with its own offsets, so every group independently reads ALL events in the topic — email group and analytics group each see every 'order.placed' (that's pub/sub fan-out across groups). Within a single group, the topic's partitions are distributed among the group's consumer instances — each partition is handled by one consumer in the group — so a service scales by adding instances up to the partition count, splitting the work (that's queue-like point-to-point within the group). So across groups = broadcast; within a group = work distribution. Offsets are per-group, which is also what lets one group replay (rewind its offsets) without affecting the others."
}
```

## Build it up — what retention + replay unlocks

Because events are **retained** and reads are **offset-based**, streaming enables things queues can't:
- **Replay / reprocessing** — rewind offsets to reprocess history (the data-science scenario; also
  recovering from a consumer bug by re-reading).
- **New consumers read the past** — add a service later and let it consume from the beginning.
- **Multiple independent consumers** at different speeds, all from one durable source of truth.
- **Event sourcing** — treat the log itself as the system of record (advanced course).

The trade: streaming systems are **heavier to run** (partitions, retention, offset management,
broker cluster) than a simple queue, and you must size retention and partitions deliberately.

```reveal
{
  "prompt": "When is a durable event log (Kafka) worth its extra complexity over a simple message queue?",
  "answer": "When you need one or more of: replay/reprocessing (rewind to re-read history — for new models, bug recovery, backfills), multiple independent consumers of the same stream each at their own pace (and new consumers that must read past events), very high sustained throughput with ordered, partitioned data, or the event log as a source of truth (event sourcing/CDC). If instead you just need to hand off tasks to workers and forget them once done — background jobs, send-this-email — a plain queue is simpler and sufficient (and you don't pay for partitions/retention/offset management). Choose streaming for durable, replayable, multi-consumer event pipelines; choose a queue for transient work distribution. Using Kafka for simple job queues is over-engineering; using a queue where you need replay/fan-out-with-history loses data you can't get back."
}
```

Retention is the dial you size deliberately — drag from short windows to keeping the log forever:

```tradeoff
{ "title": "How long should you retain the event log?", "axis": { "left": "Short retention (hours)", "right": "Retain forever" }, "steps": [
  { "label": "Hours", "detail": "Cheapest storage and lightest ops, but replay is limited to a short window — fine for transient hand-off, useless for reprocessing history or late-joining consumers." },
  { "label": "Days", "detail": "Enough to recover from a consumer bug or backfill recent data (e.g. the data-science 30-day reprocess), at moderate storage cost — a common default." },
  { "label": "Forever (with compaction)", "detail": "New services can consume from the beginning of time and the log can act as a source of truth; log compaction keeps the latest per key to bound size, but you pay the most storage and ops." }
] }
```

## In the wild

- **Apache Kafka** is the dominant event-streaming platform (also Pulsar, AWS Kinesis, Redpanda);
  topics/partitions/offsets/consumer-groups are the core concepts.
- Powers **real-time pipelines**: analytics, activity feeds, metrics, fraud detection, log
  aggregation, change-data-capture (DB → Kafka → consumers).
- Underpins **event-driven architectures at scale** and **stream processing** (next chapter) and
  **event sourcing** (advanced).
- Retention is configurable from hours to **forever** (log compaction keeps the latest per key).

## Common misconception — "Kafka is just a faster/bigger message queue"

The retained, replayable log is a different model, not a turbo queue.

```reveal
{
  "prompt": "Why is calling Kafka 'a better message queue' misleading, and where does that misunderstanding cause problems?",
  "answer": "Because the core difference isn't speed — it's that Kafka is a durable, ordered, replayable LOG where consumers track offsets and events are retained, whereas a queue is a transient to-do list where a consumed message is removed. That changes the capabilities (replay, multiple independent consumers reading history, per-partition ordering) and the operational model (partitions, retention, offsets, a broker cluster to run). Misunderstandings bite both ways: teams use Kafka as a simple job queue and drown in partition/offset/retention complexity for no benefit; or they expect queue semantics ('messages disappear when processed', 'just add consumers to go faster regardless of partitions') and get surprised by retention costs, ordering only within partitions, and consumer-group/partition limits on parallelism. It's a log, not a queue — model your usage around offsets, partitions, and retention, and pick it for replay/fan-out-with-history, not just throughput."
}
```

Kafka is a **durable, partitioned, replayable event log** — enabling replay, many independent
consumers, and history — not merely a high-throughput queue. Choose it for those capabilities and
accept its heavier operational model.

## Self-test

```quiz
{
  "question": "The fundamental difference between an event stream (Kafka) and a message queue is:",
  "options": [
    "Streams are encrypted",
    "A stream is a retained, append-only log read by offset (replayable, multi-consumer); a queue removes messages once consumed",
    "Queues are always faster",
    "Streams can't be partitioned"
  ],
  "answer": 1,
  "explanation": "Kafka retains events in an ordered log; consumers track offsets and can replay — unlike a queue where consumed messages are gone."
}
```

```quiz
{
  "question": "In Kafka, ordering is guaranteed:",
  "options": [
    "Across the entire topic",
    "Within a single partition (events with the same key go to the same partition)",
    "Only for one consumer total",
    "Never"
  ],
  "answer": 1,
  "explanation": "Each partition is an ordered log; keying events routes related events to one partition to preserve their order, while many partitions give parallelism."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Event Streaming & Kafka — key terms", "cards": [
  { "front": "Event stream (vs message queue)", "back": "A durable, append-only log: events are appended and retained, and consumers read by offset without deleting — unlike a queue, where a consumed message is removed." },
  { "front": "Partition", "back": "An append-only, ordered log that a topic is split into. Order is guaranteed within a partition; many partitions give parallelism." },
  { "front": "Offset", "back": "A consumer's position in a partition. Advancing it means 'read up to here'; resetting it backward lets the consumer replay history." },
  { "front": "Consumer group", "back": "A set of consumers with shared offsets. Different groups each get ALL events (fan-out); within one group, partitions are split among members (work-sharing)." },
  { "front": "Retention", "back": "How long events are kept (hours to forever). Because events are retained, consumers can replay and late-joining consumers can read the past." },
  { "front": "Replay / reprocessing", "back": "Rewinding offsets to re-read past events — for training new models, recovering from a consumer bug, or letting a new service consume from the beginning." }
] }
```

## Key takeaways

- **Event streaming** keeps events in a **durable, append-only log**; consumers read by **offset** and
  events are **retained** — enabling **replay** and many independent consumers.
- **Kafka**: **topics → partitions** (ordered logs; per-key ordering + parallelism), **offsets**
  (resumable/rewindable reads), **consumer groups** (fan-out across groups + work-sharing within).
- Retention + offsets unlock **reprocessing, late-joining consumers, event sourcing** — at the cost of
  heavier ops.
- It's a **log, not a turbo queue** — choose it for replay/history/fan-out, a queue for transient work.

## Up next

We've now seen both models side by side implicitly — let's make the choice explicit. Next: **Messaging
vs Streaming**.
