---
title: "Stream Processing Patterns"
slug: stream-processing-patterns
level: intermediate
module: messaging-and-streaming
order: 24
reading_time_min: 15
concepts: [stream-processing, windowing, stateful-processing, event-time, watermarks, batch-vs-stream]
use_cases: []
prerequisites: [event-streaming-and-kafka, messaging-vs-streaming]
status: published
---

# Stream Processing Patterns

## Hook — a motivating scenario

Your event stream carries every click, order, and sensor reading in real time. Product wants a live
dashboard: "orders per minute," "trending products in the last 5 minutes," "alert if error rate spikes
over a 30-second window." You can't answer these by storing everything and querying later — they're
**continuous computations over an unbounded stream**. **Stream processing** is how you compute results
*as events arrive*, and a few patterns cover most of it.

## Mental model — standing queries over a never-ending stream

Batch processing runs a query over a **finite, stored dataset** and finishes. Stream processing runs a
**continuous (standing) query** over an **unbounded** stream — it never "finishes," it keeps emitting
updated results as new events flow in. The key challenge: a stream has no end, so "compute the average"
needs a boundary — which is what **windows** provide.

## Build it up — the core patterns

```compare
{
  "options": [
    { "label": "Stateless (per-event)", "points": ["Transform/filter/route each event independently", "No memory between events", "Map, filter, enrich, reformat", "Trivial to scale"] },
    { "label": "Stateful (aggregations)", "points": ["Maintains state across events (counts, sums, joins)", "Needs windows to bound 'over what?'", "Running totals, dedup, joins between streams", "State must be managed + fault-tolerant"] }
  ]
}
```

**Windowing** turns an infinite stream into finite chunks to aggregate over:
- **Tumbling** — fixed, non-overlapping intervals ("orders per each 1-minute block").
- **Sliding** — fixed size that slides ("trending in the last 5 minutes, updated every 10s" → overlaps).
- **Session** — grouped by activity with a gap timeout (a user's browsing "session").

```reveal
{
  "prompt": "Why can't you just 'compute the average' over a stream the way you would over a database table?",
  "answer": "Because a stream is unbounded — it never ends, so 'the average of all events' would never produce a final answer and would require infinite memory. Stream processing instead computes over windows: bounded slices of the stream (e.g. each 1-minute tumbling window, or a sliding 5-minute window). The window gives a finite scope to aggregate, and the processor emits a result per window as time advances. So instead of one final average, you get a continuous series of windowed averages. Choosing the window type/size (tumbling vs sliding vs session) is how you define 'over what?' for an aggregation on infinite data."
}
```

## Build it up — event time, lateness, and exactly-once

Two realities make stateful streaming hard:

- **Event time vs processing time.** Events carry the time they *happened* (event time), but arrive at
  the processor later and out of order (processing time). For correct windows ("orders in the 10:00
  minute") you bucket by **event time**, and use **watermarks** to decide "we've probably seen all
  events up to time T, emit the window" — while handling **late** events that arrive after.
- **Fault tolerance + exactly-once.** Stateful processors must checkpoint their state so they can
  recover after a crash without double-counting. Modern frameworks offer **exactly-once** processing
  via checkpoints + offset coordination (recall idempotency/at-least-once — exactly-once is engineered,
  not free).

```reveal
{
  "prompt": "A sensor's reading for 10:00:59 arrives at 10:01:30 due to network delay. Why does this break naive windowing, and what handles it?",
  "answer": "If you window by processing time (when the event arrives), that 10:00:59 reading lands in the 10:01 window — wrong bucket — corrupting both minutes' aggregates. Correct results require windowing by event time (the 10:00:59 timestamp the event carries), so it counts toward the 10:00 window regardless of when it arrives. But then 'when is the 10:00 window done?' is unclear, since stragglers may still come. Watermarks solve this: the system tracks a watermark ('we believe all events up to time T have arrived') and closes/emits a window when the watermark passes its end, with a policy for late events (drop, or update the result). So event-time windowing + watermarks (+ late-data handling) is what keeps aggregates correct despite out-of-order, delayed events."
}
```

How aggressively you advance the watermark is a tunable dial between emitting fast and catching stragglers:

```tradeoff
{ "title": "How long should a window wait before the watermark closes it?", "axis": { "left": "Emit early (low latency)", "right": "Wait long (more complete)" }, "steps": [
  { "label": "Close immediately at window end", "detail": "Lowest latency, freshest dashboard results, but out-of-order and late events miss their window — aggregates are wrong for delayed data like the 10:00:59 reading arriving at 10:01:30." },
  { "label": "Allow a small lateness grace", "detail": "Hold the watermark slightly behind real time so common stragglers still land in the right event-time window, trading a little freshness for noticeably more correct aggregates." },
  { "label": "Wait long with late-data handling", "detail": "Watermark lags well behind so few events are ever late; remaining stragglers can update emitted results. Highest correctness but slower, with state held open longer." }
] }
```

## In the wild

- **Stream processors:** Kafka Streams, Apache Flink, Spark Structured Streaming, ksqlDB — they
  provide windowing, stateful aggregation, joins, event-time + watermarks, and exactly-once. Flink
  is built to scale to millions of events per second with sub-second processing latency; Spark
  Structured Streaming defaults to micro-batching (a new batch triggered as fast as the previous one
  finishes), with an optional fixed trigger interval. Watermark/allowed-lateness grace in production
  is typically set on the order of seconds to a few minutes, depending on how out-of-order the source is.
- **Use cases:** real-time dashboards/metrics, fraud/anomaly detection, alerting on windows,
  enrichment/ETL, recommendations, IoT sensor aggregation.
- **Stream–stream and stream–table joins** combine streams with reference data in real time.
- Builds directly on the event log (Kafka) from the previous chapters; many pipelines are
  Kafka → stream processor → sink (DB/cache/dashboard).

## Common misconception — "stream processing is just running batch jobs more often"

Micro-batching narrows the gap, but unbounded, out-of-order, stateful semantics are genuinely
different.

```reveal
{
  "prompt": "Why isn't stream processing simply 'batch, but on small frequent chunks'?",
  "answer": "Running batch every few seconds (micro-batching) approximates streaming and is a real technique, but true stream processing must handle problems batch doesn't: the data is unbounded (no final dataset to query), events arrive out of order and late (so correctness needs event-time windowing + watermarks, not just 'process what's here now'), state must be maintained continuously and recovered exactly-once across failures, and results are continuously updated rather than computed once. A naive 'batch more often' approach buckets by arrival time (wrong for late events), recomputes from scratch instead of maintaining incremental state, and struggles with windows that span batch boundaries. So while micro-batch and streaming converge, the streaming model is defined by continuous, stateful, event-time-correct computation over infinite data — not just smaller batches."
}
```

Stream processing = **continuous, stateful computation over an unbounded, out-of-order stream**, using
**windows**, **event time + watermarks**, and **fault-tolerant state** — not merely frequent batch
jobs.

## Self-test

```quiz
{
  "question": "Windowing in stream processing exists to:",
  "options": [
    "Encrypt the stream",
    "Bound an unbounded stream into finite chunks so aggregations (counts/averages) can be computed",
    "Delete old events",
    "Replace consumer groups"
  ],
  "answer": 1,
  "explanation": "A stream never ends, so aggregations need windows (tumbling/sliding/session) to define 'over what?' to compute."
}
```

```quiz
{
  "question": "To correctly aggregate events that arrive out of order/late, you should window by:",
  "options": [
    "Processing time (when the event arrived)",
    "Event time (when the event happened), using watermarks to handle lateness",
    "Random assignment",
    "Consumer count"
  ],
  "answer": 1,
  "explanation": "Event-time windowing buckets events by their real timestamp; watermarks decide when a window is complete and handle late data."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Stream processing — key terms", "cards": [
  { "front": "Stream processing", "back": "Continuous (standing) queries over an unbounded stream, emitting updated results as events arrive — unlike batch, which runs once over a finite, stored dataset and finishes." },
  { "front": "Stateless vs stateful processing", "back": "Stateless transforms each event independently (map/filter/enrich), trivial to scale. Stateful maintains state across events (counts, sums, joins), needs windows and fault-tolerant state management." },
  { "front": "Windowing (tumbling / sliding / session)", "back": "Bounds an infinite stream into finite chunks to aggregate over. Tumbling: fixed non-overlapping intervals. Sliding: fixed size that slides (overlaps). Session: grouped by activity with a gap timeout." },
  { "front": "Event time vs processing time", "back": "Event time is when an event happened (its carried timestamp); processing time is when it reaches the processor, later and out of order. Correct windows bucket by event time." },
  { "front": "Watermark", "back": "A signal that the system believes all events up to time T have arrived, used to decide when to close/emit an event-time window, with a policy for handling late events that arrive after." },
  { "front": "Exactly-once processing", "back": "Stateful processors checkpoint state to recover after a crash without double-counting. Exactly-once is engineered via checkpoints plus offset coordination — not free." }
] }
```

## Key takeaways

- **Stream processing** runs **continuous queries over an unbounded stream**, emitting updated results
  as events arrive (vs finite, one-shot batch).
- Patterns: **stateless** (per-event map/filter/enrich) and **stateful** (aggregations/joins) — the
  latter needs **windows** (tumbling/sliding/session).
- Correctness requires **event-time** windowing + **watermarks** (for out-of-order/late events) and
  **fault-tolerant state** (checkpointing, engineered exactly-once).
- It's not "frequent batch" — unbounded, out-of-order, stateful semantics make it a distinct model.

## Up next

We've leaned on brokers throughout; let's compare the two you'll meet most. Next: **RabbitMQ vs
Kafka**.
