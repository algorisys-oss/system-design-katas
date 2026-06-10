---
title: "Lambda vs Kappa Architecture"
slug: lambda-vs-kappa-architecture
level: advanced
module: storage-internals
order: 27
reading_time_min: 14
concepts: [lambda-architecture, kappa-architecture, batch-layer, speed-layer, reprocessing, stream-first]
use_cases: []
prerequisites: [event-streaming-and-kafka, stream-processing-patterns, event-sourcing]
status: published
---

# Lambda vs Kappa Architecture

## Hook — a motivating scenario

You need analytics that are both **fresh** (real-time dashboards updating now) and **accurate**
(correct historical aggregates you can recompute when logic changes). Streaming gives you fresh but is
harder to get perfectly correct and reprocess; batch gives you accurate and reprocessable but is slow.
Two big-data architectures answer "how do I get both?" differently: **Lambda** runs batch *and* stream
in parallel; **Kappa** says "just do everything as a stream."

## Mental model — two data-processing architectures

These are **data-processing/analytics architectures** for combining real-time and historical
computation over large data:
- **Lambda architecture:** canonically **three layers** — a **batch layer** (processes all
  historical data accurately, recomputed periodically), a **serving layer** (indexes the batch layer's
  views so they can be queried with low latency), and a **speed layer** (processes the live stream for
  low-latency, approximate recent results). Queries **merge** the serving-layer (batch) view (accurate,
  up to the last batch) with the speed-layer view (recent). You get freshness *and* accuracy — but you
  run and maintain **multiple systems**.
- **Kappa architecture:** drop the batch layer — treat **everything as a stream**. A **single stream
  processing pipeline** handles both real-time and historical data; to "reprocess," you **replay the
  event log** (recall Kafka retention/replay, event sourcing) through a new version of the stream job.

```compare
{
  "options": [
    { "label": "Lambda", "points": ["Batch layer (accurate, all history) + speed layer (fast, recent)", "Query merges both views", "Freshness + accuracy, but TWO codebases/systems", "Reprocess = rerun the batch layer"] },
    { "label": "Kappa", "points": ["Single stream pipeline for everything", "Reprocess by REPLAYING the event log through new code", "One codebase — simpler to maintain", "Relies on a durable, replayable log (Kafka)"] }
  ]
}
```

## Build it up — the core trade-off

Lambda's strength (and weakness) is the **two layers**:
- **Strength:** the batch layer guarantees correct, complete historical results (and can use heavy
  batch tools), while the speed layer fills the real-time gap — robust and proven.
- **Weakness:** you implement the **same logic twice** (batch and streaming), in two systems, and must
  keep them consistent — duplicated code, double the ops, and subtle discrepancies between the two
  views. This maintenance burden is the main critique.

Kappa's bet: a **durable, replayable event log** + modern stream processors are good enough that you
**don't need a separate batch layer** — historical processing is just **replaying the log**. One
pipeline, one codebase. The trade: it depends on being able to **retain and replay** the full log
(storage/retention cost), and very large historical reprocessing as a stream can be slower/heavier
than an optimized batch job for some workloads.

```reveal
{
  "prompt": "Lambda gives you both real-time and accurate historical results — so why did Kappa emerge to replace it for many use cases?",
  "answer": "Because Lambda's two-layer design imposes a heavy, ongoing cost: you must implement the SAME business logic twice — once in the batch layer (e.g. Spark/Hadoop over all history) and once in the speed layer (a stream processor over live data) — in two different systems with two codebases. Keeping those two implementations semantically identical is hard and error-prone: they can drift, produce subtly different results, and every logic change must be made and tested in both places, doubling development and operational burden (two pipelines to deploy, monitor, debug, and reconcile). The query side also has to merge batch and speed views correctly. Kappa emerged from the observation (Jay Kreps) that with a durable, replayable event log (Kafka) and capable stream processors, you can eliminate the separate batch layer entirely: process everything as a stream with ONE codebase, and handle 'historical/reprocessing' by replaying the retained log through a new version of the same streaming job (often running the new version in parallel, writing to a new output, then switching over). That removes the duplicated-logic problem and halves the systems to maintain, which is why Kappa is attractive when your processing is naturally stream-shaped and you can retain/replay the log. The trade-offs: Kappa requires keeping (or being able to reconstruct) enough of the event log to reprocess (storage/retention cost), and for some very large or complex historical computations a purpose-built batch job can still be more efficient than replaying as a stream — so Lambda still fits cases needing heavy batch analytics or where full-log replay is impractical. Kappa didn't make Lambda obsolete; it removed Lambda's biggest pain (dual implementations) for the many workloads that fit a stream-first model."
}
```

## Build it up — choosing, and the modern context

- **Kappa** fits when your data is naturally a **stream of events**, you can **retain/replay** the log,
  and your real-time and historical logic are the same — simpler, one codebase (common in modern
  event-driven systems; pairs with **event sourcing**).
- **Lambda** still fits when you need **heavy batch analytics** (complex computations more efficient as
  batch), must integrate **existing batch systems/data warehouses**, or can't retain a full replayable
  log.
- **Modern reality:** better streaming engines (Flink, Kafka Streams, Spark Structured Streaming) and
  "unified" batch+stream APIs blur the line — many systems are effectively Kappa-leaning, and "the
  warehouse/lakehouse + streaming" patterns have evolved beyond the strict dichotomy. Know the concepts;
  don't treat them as the only two options.

```reveal
{
  "prompt": "What does Kappa fundamentally depend on, and when would Lambda still be the better choice?",
  "answer": "Kappa fundamentally depends on a durable, replayable event log as the source of truth — typically Kafka with sufficient retention (or the ability to reconstruct history from an event store). Its whole premise is that 'historical processing = replay the log through the stream job,' so if you can't retain or replay the full relevant history, Kappa's reprocessing story breaks. It also depends on stream processors capable of handling your logic (windowing, joins, exactly-once/idempotency — recall stream processing) for both live and replayed data with one codebase. Lambda is still the better choice when: (1) you need heavy, complex historical/batch analytics that are far more efficient as a dedicated batch job (large joins, ML training, full-dataset recomputation) than replaying as a stream; (2) you must integrate with existing batch infrastructure / data warehouses / data lakes that already do the historical computation; (3) retaining a fully replayable event log is impractical or too costly (huge volumes, regulatory deletion, or data that didn't originate as a clean event stream); or (4) you want the batch layer as an authoritative 'recompute from scratch' safety net independent of the streaming path. In those cases Lambda's separate accurate batch layer plus a speed layer for freshness is worth the dual-implementation cost. So the decision hinges on whether your workload is genuinely stream-shaped with a retainable log (favor Kappa for simplicity) or needs powerful batch processing / can't keep a replayable log (favor Lambda) — and note modern unified batch+stream engines increasingly let teams get Kappa-like simplicity while still doing batch-style work, softening the strict either/or."
}
```

Slide from a batch-heavy Lambda design toward a stream-first Kappa design and watch the trade shift:

```tradeoff
{ "title": "How stream-shaped is your workload?", "axis": { "left": "Lambda (batch + speed)", "right": "Kappa (stream-only)" }, "steps": [
  { "label": "Heavy batch, no replayable log", "detail": "Complex historical computations are far more efficient as a dedicated batch job, or you can't retain a full replayable log — keep Lambda's accurate batch layer plus a speed layer for freshness." },
  { "label": "Mixed, integrating existing batch", "detail": "Real-time and historical logic differ, or you must integrate existing batch systems and warehouses; Lambda still fits, paying the dual-implementation cost for robustness." },
  { "label": "Stream-shaped with retained log", "detail": "Data is naturally a stream of events, you can retain and replay the log, and live and historical logic match — lean Kappa for one codebase and replay-based reprocessing." },
  { "label": "Stream-native, event-sourced", "detail": "Fully event-driven on Kafka + Flink/Kafka Streams: drop the batch layer entirely, reprocess by replaying the durable log through a new pipeline version, then switch over." }
] }
```

## In the wild

- **Lambda** (Nathan Marz) was the original big-data pattern (Hadoop/Spark batch + Storm/Spark Streaming
  speed); still seen where heavy batch + real-time coexist.
- **Kappa** (Jay Kreps) is stream-first on **Kafka + Flink/Kafka Streams**, replaying the log to
  reprocess — common in modern event-driven/event-sourced systems.
- **Reprocessing** in Kappa uses the **retained, replayable log** (recall Kafka retention, event
  sourcing replay) — often run a new pipeline version in parallel then switch.
- **Unified engines** (Flink, Spark Structured Streaming, Beam) increasingly make the batch/stream split
  an implementation detail.

## Common misconception — "you must pick one, and Kappa is always simpler/better"

They're a spectrum, and the right choice depends on whether your workload is stream-shaped with a
replayable log.

```reveal
{
  "prompt": "Why is 'Kappa is strictly simpler and better than Lambda' an oversimplification?",
  "answer": "Because Kappa's simplicity (one codebase, no dual batch/speed layers) is real but conditional, and Lambda still wins for some workloads. Kappa is simpler ONLY when your data is genuinely stream-shaped and you can retain/replay the full event log: then historical processing is just replay, and you avoid implementing logic twice. But that simplicity assumes a durable, affordable, replayable log and stream processors capable of all your historical computations. When those assumptions fail, Kappa is NOT simpler or better: if you can't retain a full replayable log (volume/cost/regulatory deletion) or need heavy batch analytics (large joins, full-dataset recomputation, ML training) that are far more efficient and easier as a dedicated batch job, Lambda's separate batch layer is the pragmatic choice — and forcing a stream-only approach can be slower, costlier, or infeasible. There's also operational nuance: replaying enormous logs to reprocess can be heavy, and an authoritative recompute-from-scratch batch layer can be a valuable safety net. Moreover, it's not a strict binary: modern unified batch+stream engines (Flink, Spark Structured Streaming, Beam) and lakehouse patterns let teams get Kappa-like single-codebase simplicity while still doing batch-style work, so the real landscape is a spectrum, not 'Lambda vs Kappa, pick the better one.' The accurate framing: choose based on whether your workload is stream-native with a retainable log (lean Kappa for simplicity) or needs powerful batch / lacks a replayable log (lean Lambda), and recognize that tooling has blurred the distinction. 'Kappa always wins' ignores the assumptions Kappa's simplicity rests on."
}
```

**Lambda** = parallel **batch (accurate) + speed (fresh)** layers (freshness + accuracy, but duplicated
logic/two systems); **Kappa** = a **single stream pipeline**, reprocessing by **replaying the log**
(one codebase, needs a durable replayable log). Choose by whether your workload is **stream-shaped with
a retainable log** (Kappa) or needs **heavy batch / can't replay** (Lambda); modern unified engines
blur the line.

## Self-test

```quiz
{
  "question": "The defining difference between Lambda and Kappa architecture is:",
  "options": [
    "Lambda is for SQL, Kappa for NoSQL",
    "Lambda runs separate batch + speed layers (duplicated logic); Kappa uses one stream pipeline and reprocesses by replaying the log",
    "Kappa has no real-time processing",
    "Lambda can't process historical data"
  ],
  "answer": 1,
  "explanation": "Lambda = two parallel layers (batch accurate + speed fresh); Kappa = single stream pipeline, replaying the durable log to reprocess."
}
```

```quiz
{
  "question": "Kappa architecture fundamentally depends on:",
  "options": [
    "A relational database",
    "A durable, replayable event log (e.g. Kafka) so historical reprocessing = replaying the log",
    "Synchronized clocks",
    "Avoiding stream processing"
  ],
  "answer": 1,
  "explanation": "Kappa drops the batch layer and reprocesses by replaying the retained event log through new stream code — so it needs that log."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Lambda vs Kappa architecture — key terms", "cards": [
  { "front": "Lambda architecture", "back": "Two parallel paths: a batch layer (accurate over all history) plus a speed layer (fast, recent); queries merge both views — freshness and accuracy, but two systems." },
  { "front": "Kappa architecture", "back": "Drop the batch layer and treat everything as a stream: one stream pipeline for live and historical data, reprocessing by replaying the event log through new code." },
  { "front": "Batch layer", "back": "Lambda's path that processes all historical data accurately and is recomputed periodically; can use heavy batch tools but guarantees correct, complete results." },
  { "front": "Speed layer", "back": "Lambda's path that processes the live stream for low-latency, approximate recent results, filling the real-time gap until the next batch view." },
  { "front": "Reprocessing in Kappa", "back": "Replaying the retained, durable event log (Kafka) through a new version of the stream job — often running the new version in parallel, then switching over." },
  { "front": "When Lambda still fits", "back": "Heavy/complex batch analytics, integrating existing batch systems or warehouses, or when retaining a fully replayable event log is impractical or too costly." }
] }
```

## Key takeaways

- **Lambda** and **Kappa** are **big-data processing architectures** combining real-time and historical
  computation.
- **Lambda** = parallel **batch layer (accurate, all history)** + **speed layer (fresh, recent)**,
  merged at query time — robust but **duplicates logic across two systems**.
- **Kappa** = a **single stream pipeline** for everything; **reprocess by replaying the durable event
  log** — one codebase, but depends on **retaining/replaying** the log.
- Choose by workload: **stream-shaped + replayable log → Kappa**; **heavy batch / no replayable log →
  Lambda**; **unified engines** (Flink/Spark) increasingly blur the distinction.

## Up next

That completes storage internals & data architecture. Next module zooms out to running across the
globe. First: **Global Load Balancing**.
