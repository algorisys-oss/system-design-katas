---
title: "Design an Ad Click Aggregator"
slug: ad-click-aggregator
level: use-cases
module: real-time-and-data-intensive
order: 14
reading_time_min: 19
concepts: [stream-processing, windowed-aggregation, idempotency, deduplication, watermarks, lambda-architecture]
use_cases: [ad-click-aggregator]
prerequisites: [stream-processing-patterns, lambda-vs-kappa-architecture, event-streaming-and-kafka, time-series-databases]
status: published
---

# Design an Ad Click Aggregator

> **Use case:** ingest a firehose of **ad click events** and produce **aggregated click counts**
> per ad (and per advertiser, campaign, region…) sliced by time — e.g. "clicks on ad #1234 per
> minute, per hour, today." Advertisers watch near-real-time dashboards; billing needs the numbers
> to eventually be **exactly right**.
> **Domain:** ad networks (Google Ads, Meta, Amazon, TikTok), analytics pipelines, any
> count-events-by-key-over-time system (views, impressions, plays, reactions).
> **Scale:** **millions of clicks/sec** at peak, fanned out across the globe; dashboards want
> freshness in **seconds**, billing wants **penny-accurate** totals reconciled over **days/years**.
> **Core challenges:** high-throughput ingest; **windowed aggregation**; **idempotent counting**
> under at-least-once delivery; **deduplication**; **late / out-of-order** events and
> **watermarks**; **fraud filtering**; and **time-series storage** for fast reads.

This is the canonical *streaming aggregation* design. A one-line ask — "count the clicks" — forces
you to confront throughput, the tension between **fast-but-approximate** and **slow-but-exact**,
and the brutal fact that events arrive late, duplicated, and out of order while money rides on the
final number.

## 1 · Clarify requirements

**Functional**
- Ingest a click event: `{ click_id, ad_id, user_id, timestamp, ip, ... }`.
- Produce **aggregate counts per ad** (and per campaign/advertiser) over time windows: **per-minute,
  per-hour, per-day**.
- Serve **near-real-time** queries: "clicks on ad #1234 in the last 5 minutes / today."
- Support **filtering of invalid clicks** (bots, duplicates, click fraud) so billed counts are clean.

**Non-functional**
- **High throughput:** millions of events/sec, durably buffered, no data loss.
- **Two freshness/accuracy tiers:** dashboards tolerate **seconds-fresh, approximate** numbers;
  **billing** must be **exact** (deduplicated, fraud-filtered), even if it lags by minutes/hours.
- **Correct counting:** delivery is **at-least-once**, so the pipeline must be **idempotent** —
  retries and reprocessing must **not** inflate counts.
- **Handle late/out-of-order events** without either dropping them or holding windows open forever.
- **Scalable & fault-tolerant:** a crashed worker must resume without double-counting.

```reveal
{
  "prompt": "Why is 'just keep a counter per ad and increment it' the wrong mental model here, even though counting clicks sounds trivial?",
  "answer": "A single incrementing counter assumes three things that are all false at scale. (1) Exactly-once delivery: in reality the network and the message broker give you AT-LEAST-once — the same click can be delivered twice (a producer retried, a consumer crashed after processing but before committing its offset), so a naive INCR double-counts. (2) In-order, on-time arrival: clicks are generated on millions of devices worldwide; a phone goes through a tunnel and uploads its click 40 seconds late, mobile SDKs batch events, and clocks are skewed — so events for the 12:00 minute keep dribbling in at 12:01, 12:05, even hours later, and a plain counter has no notion of WHICH minute a late event belongs to. (3) One number is enough: you actually need counts sliced by ad AND by campaign AND by region AND by minute/hour/day, and you need them both fast (dashboards) and exact (billing) — two contradictory requirements. So the real problem is windowed, idempotent, fraud-filtered aggregation over a late/out-of-order at-least-once stream, served at two accuracy tiers — not an increment."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Ingest throughput & buffer (peak clicks/sec)",
  "inputs": [
    { "key": "clicksPerSec", "label": "Peak clicks/sec", "default": 1000000 },
    { "key": "bytesPerEvent", "label": "Bytes per click event", "default": 400 }
  ],
  "formula": "clicksPerSec * bytesPerEvent",
  "resultLabel": "Ingest write bandwidth",
  "resultUnit": "bytes/s"
}
```

```calc
{
  "title": "Raw retention for batch reprocessing",
  "inputs": [
    { "key": "clicksPerDay", "label": "Clicks/day (avg)", "default": 30000000000 },
    { "key": "bytesPerEvent", "label": "Bytes per event", "default": 400 },
    { "key": "retentionDays", "label": "Days of raw events to keep", "default": 30 }
  ],
  "formula": "clicksPerDay * bytesPerEvent * retentionDays",
  "resultLabel": "Raw event lake size",
  "resultUnit": "bytes"
}
```

> ~400 MB/s of writes at 1M clicks/sec, and the raw event lake runs to **hundreds of TB/month**.
> The *aggregates*, by contrast, are tiny — a per-minute count per ad for millions of ads is GB-scale,
> not PB-scale. That asymmetry is the whole game: **buffer the firehose durably, but store and serve
> small rollups.** Reads (dashboards) are far lower volume than writes — this is **write-heavy,
> append-mostly**, which points straight at a log + stream processor + time-series store.

## 3 · API & data model

Two interfaces: an **ingest** path (write) and a **query** path (read).

```
// Ingest (fire-and-forget from the ad server / client SDK)
POST /v1/clicks   { click_id, ad_id, campaign_id, user_id, ts, ip, geo, ... }
                  -> 202 Accepted   (just appended to the log; not yet aggregated)

// Query (dashboards / billing)
GET /v1/aggregates?ad_id=1234&granularity=minute&from=...&to=...
                  -> [ { window_start, count }, ... ]
```

The aggregate store is keyed by **(dimension, granularity, window_start)** → `count`, e.g.
`(ad=1234, minute, 2026-06-08T12:00) → 980`. The same rollup repeats per granularity (minute / hour
/ day) and per dimension (ad / campaign / advertiser / region) — classic **time-series** layout.

## 4 · High-level architecture

The backbone is a **durable log → stream processor → time-series store**, with a parallel **batch
recompute** path (this is **lambda architecture**: a fast approximate "speed layer" plus a slow
exact "batch layer").

```flow
{
  "title": "Ad click aggregation pipeline (lambda style)",
  "nodes": [
    { "label": "Click SDK / Ad server", "detail": "Emits click events with a unique click_id and event-time timestamp." },
    { "label": "Ingest API / gateway", "detail": "Validates shape, attaches receive-time, appends to the log. Returns 202 immediately." },
    { "label": "Kafka (partitioned log)", "detail": "Durable, replayable buffer. Partitioned by ad_id so all of an ad's clicks land in one partition (ordered)." },
    { "label": "Stream processor (speed layer)", "detail": "Flink/Kafka Streams: dedup, fraud-filter, tumbling-window aggregate, emit on watermark." },
    { "label": "Time-series / OLAP store", "detail": "Druid / ClickHouse / Cassandra: per-minute/hour/day rollups, fast range reads for dashboards." },
    { "label": "Batch layer (lake + Spark)", "detail": "Raw events in S3; nightly Spark job recomputes EXACT, fraud-scrubbed totals that overwrite the speed-layer numbers." },
    { "label": "Query API + dashboards", "detail": "Reads rollups; serves near-real-time (speed) and reconciled (batch) views." }
  ],
  "note": "Speed layer = seconds-fresh, approximate. Batch layer = hours-late, exact. Reads merge them."
}
```

**Why Kafka (a partitioned, replayable log)?** It absorbs the firehose, decouples ingest rate from
processing rate (back-pressure for free), and — critically — lets the batch layer **replay history**
to recompute exact numbers. **Partition by `ad_id`** so every click for an ad is ordered within one
partition and a single processor instance owns that ad's windowed state (no cross-shard coordination
to count one ad). **Why a time-series/OLAP store** (Druid, ClickHouse, Cassandra) rather than a row
store? Aggregates are written append-mostly and queried as **time-range scans grouped by dimension**;
columnar/time-partitioned engines do that orders of magnitude faster than a general-purpose DB.

## 5 · Deep dive A — windowed aggregation, watermarks & late events

The processor groups clicks into **tumbling windows** (fixed, non-overlapping — e.g. each
clock-minute) keyed by `ad_id`, and emits the count when the window "closes." The hard question:
**when is a window done**, given events arrive late?

**Event time vs processing time.** We must aggregate by **event time** (when the click happened),
not **processing time** (when we saw it) — otherwise a 40-second-late click lands in the wrong
minute and billing is wrong. A **watermark** is the processor's running assertion: *"I believe I've
now seen all events with timestamp ≤ T."* When the watermark passes a window's end, the window is
**closed and emitted**.

```sequence
{
  "title": "A late click and the watermark",
  "actors": ["ClickSDK", "Kafka", "Processor", "TSStore"],
  "steps": [
    { "from": "ClickSDK", "to": "Kafka", "label": "click @ event-time 12:00:58 (arrives 12:01:30)" },
    { "from": "Kafka", "to": "Processor", "label": "consume; place in window [12:00,12:01)" },
    { "from": "Processor", "to": "Processor", "label": "watermark = 12:01:00 - allowedLateness(60s) = 12:00:00 → window still open" },
    { "from": "Processor", "to": "Processor", "label": "later: watermark crosses 12:01:00 → close window [12:00,12:01)" },
    { "from": "Processor", "to": "TSStore", "label": "emit count for ad over [12:00,12:01)" },
    { "from": "ClickSDK", "to": "Kafka", "label": "VERY late click @ 12:00:30 (arrives 12:10)" },
    { "from": "Processor", "to": "TSStore", "label": "past allowed lateness → side-output / fixed by batch layer" }
  ]
}
```

```reveal
{
  "prompt": "What is a watermark, why not just wait a fixed wall-clock delay before closing each window, and what happens to events later than the watermark?",
  "answer": "A watermark is a marker the stream processor injects into the data flow saying 'all events with event-time ≤ T have (probably) arrived.' It's derived from the event-time timestamps the processor is observing — e.g. 'max event-time seen so far minus an allowed-lateness bound of 60s' — NOT from the wall clock. That distinction matters: if you just waited, say, 2 minutes of wall-clock time, a stalled partition or a clock-skewed producer would silently corrupt results, and during a backlog (processor catching up after an outage) you'd close windows far too early. A watermark is data-driven, so it correctly slows down when input is late and speeds up when the processor is replaying. When the watermark passes a window's end, the processor closes the window and emits the count. Events that arrive AFTER the watermark has already passed their window are 'late beyond allowed lateness': you can't keep every window open forever (unbounded state), so the typical strategy is (1) bound it — allow N seconds/minutes of lateness, keeping windows open that long; (2) for stragglers past that bound, either drop them, route them to a side-output for inspection, OR — the lambda answer — let them be absorbed by the nightly batch recompute over the complete raw log, which has every event and produces the exact total. So watermarks give you fast, mostly-right closing in the speed layer, and the batch layer mops up the long tail."
}
```

## Deep dive B — idempotent counting: at-least-once vs exactly-once

Kafka and most pipelines guarantee **at-least-once**: an event may be delivered/processed more than
once (producer retry, consumer crash before committing its offset). A naive `count += 1` therefore
**over-counts**. Three ways to make counting safe:

```compare
{
  "options": [
    { "label": "At-least-once + idempotent dedup", "points": ["Tag every click with a unique click_id at the source", "Processor keeps a set/window of seen click_ids and ignores repeats", "Simple, broker-agnostic; needs a dedup store sized to a time window", "The pragmatic production default"] },
    { "label": "Exactly-once (transactional)", "points": ["Processor + sink commit offsets AND state in one atomic transaction (Flink checkpoints / Kafka EOS)", "No duplicates even across crashes — within the pipeline", "Higher latency & coordination cost; doesn't cover producer-side dupes", "Use when the sink supports it and correctness is paramount"] },
    { "label": "At-most-once", "points": ["Commit offset before processing", "Never double-counts", "DROPS events on crash → under-counts", "Unacceptable for billing"] }
  ]
}
```

**Idempotency is the key idea.** If each operation is *idempotent* — applying it twice has the same
effect as once — at-least-once delivery becomes safe. The standard trick: a **unique `click_id`
minted at the source**, plus a **dedup window** in the processor (e.g. a rolling set of click_ids
seen in the last few minutes, often a Bloom filter or a keyed state store). A repeated click_id is
recognized and dropped before it hits the counter. "Exactly-once" within a stream processor (Flink's
checkpointed state, Kafka's transactional offsets) is real but only covers duplicates *introduced by
the pipeline itself* — it can't catch a duplicate the **client SDK** sent, so you still want
source-side IDs + dedup regardless.

```tradeoff
{
  "title": "How hard do you fight duplicates / how exact must counting be?",
  "axis": { "left": "Cheap / approximate", "right": "Exact / costly" },
  "steps": [
    { "label": "At-least-once, no dedup", "detail": "Just count; accept some over-count. Fine ONLY for coarse, non-billed dashboard trends." },
    { "label": "At-least-once + dedup window", "detail": "Unique click_id + rolling seen-set/Bloom filter. Catches the vast majority of dupes cheaply. The common default." },
    { "label": "Exactly-once stream (checkpointed)", "detail": "Transactional state+offset commits (Flink/Kafka EOS): no pipeline-induced dupes, at the cost of latency and coordination." },
    { "label": "Batch recompute over full log", "detail": "Spark over the complete raw events with global dedup: the authoritative, penny-accurate total used for billing." }
  ]
}
```

## Deep dive C — lambda vs kappa, fraud, and storage

**Lambda architecture** runs **two** paths: a **speed layer** (the Flink job above — seconds-fresh,
approximate, may miss very-late events) and a **batch layer** (Spark over the complete raw log —
hours-late but **exact**, with full dedup and fraud scrubbing). The query layer serves the fast
numbers, then **overwrites** them with the batch-corrected numbers once they're ready. The
trade-off: two codebases that must compute the *same* aggregation and can drift.

**Kappa architecture** is the alternative: **one** streaming codebase, no separate batch layer. To
"recompute history" you **replay the Kafka log** through the same stream job. Simpler to maintain
(one code path), but it leans hard on the log retaining enough history and on the stream job being
correct; reprocessing petabytes through a stream engine can be slower/costlier than a batch engine.
Many ad systems land in between: kappa for most things, a batch reconciliation specifically for
billing.

**Fraud filtering.** Before a click is billed it must be vetted: drop **bots** (data-center IPs,
known crawler signatures), **click spam** (the same user hammering an ad), and **invalid traffic**.
Cheap synchronous filters (IP reputation, rate-per-user) run inline in the speed layer; heavier
**ML-based invalid-traffic models** run in the batch layer, which can look at the full picture and
retroactively void fraudulent clicks. This is *another* reason the batch number is the source of
truth for money.

**Time-series storage.** Pre-aggregated rollups live in a columnar/time-series OLAP store (Druid,
ClickHouse) keyed by `(dimension, granularity, window_start)`. Reads are time-range scans grouped by
ad/campaign — fast in a columnar engine. Old fine-grained data is **rolled up and expired**
(per-minute kept for days, per-hour for months, per-day for years) via TTL, exactly like time-series
DBs do downsampling — so the serving store stays small even as history grows.

```reveal
{
  "prompt": "Lambda has two code paths that can drift; kappa has one but replays everything through a stream engine. When would you still choose lambda for an ad click aggregator?",
  "answer": "Choose lambda when the EXACT number genuinely needs a fundamentally different computation than the fast number, not just a replay. Billing for ad clicks is the textbook case: the authoritative total requires global deduplication across the entire history, retroactive fraud/invalid-traffic scrubbing using ML models that need a wide view of behavior, and joins against the full event lake — work that is naturally a large batch job over columnar files in object storage, and that's awkward and expensive to express as a continuous stream. A nightly Spark job over the complete day's raw events can dedup and fraud-filter the whole population at once and produce penny-accurate, advertiser-billable numbers, while the streaming speed layer gives advertisers a seconds-fresh approximate dashboard. Kappa shines when the streaming computation IS the correct computation and you just need to re-run it on more data (e.g. a metrics/trend pipeline with no separate billing-grade correctness bar) — then maintaining a second batch codebase is pure overhead. The deciding question is: 'Is my exact result just my fast result replayed, or is it a different, batch-shaped computation?' If different (billing, fraud), lambda earns its keep despite the drift risk; if the same, prefer kappa's single code path."
}
```

## 6 · Trade-offs & failure modes

- **Watermark too aggressive → drop real clicks; too lax → stale dashboards & unbounded state.**
  Tune allowed-lateness against the late-arrival distribution; let the batch layer catch the long tail.
- **At-least-once is the default → must dedup.** Forgetting source-side `click_id` + a dedup window
  is the #1 over-counting bug. Exactly-once in the engine still won't catch client-sent dupes.
- **Hot partition / hot key.** A viral ad concentrates all its clicks on one Kafka partition and one
  processor instance (recall hot partitions). Mitigate: pre-aggregate per-instance and combine, or
  add a salt to the key for that ad and merge sub-counts downstream.
- **Speed/batch drift.** Lambda's two code paths can disagree; keep the aggregation logic in a
  shared library, and reconcile/alert when speed vs batch numbers diverge beyond a threshold.
- **Back-pressure under a spike.** If the processor falls behind, Kafka's durable buffer holds the
  backlog (it grows, doesn't drop) and watermarks correctly slow — but monitor consumer lag.
- **Crash recovery.** A processor must resume from the last committed checkpoint/offset and rebuild
  window + dedup state without double-counting — i.e. checkpointed state + idempotent sink writes.

## 7 · Scaling & evolution

- **Scale the log & processor horizontally:** more Kafka partitions → more parallel processor
  instances. Keep partitioning by `ad_id` so per-ad window state stays local (no shuffle to count).
- **Approximate sketches for cardinality:** "unique users who clicked" needs **HyperLogLog** (a
  probabilistic distinct-count sketch — tiny memory, ~1-2% error) rather than storing every user_id;
  it's also **mergeable** across partitions and windows.
- **Multi-region:** aggregate locally per region, ship rollups (not the raw firehose) to a global
  store, and merge — counts are commutative/associative, so cross-region merge is just addition.
- **Tiered retention & downsampling:** keep raw events in the lake for the billing/dispute window,
  expire fine-grained rollups fast, keep coarse rollups long (TTL-driven, recall time-series DBs).
- **Move toward kappa where possible:** if the speed-layer logic is the correct logic, collapse to a
  single replayable stream job and drop the batch codebase, reserving batch only for billing/fraud.

## Self-test

```quiz
{
  "question": "Clicks arrive late and out of order. To assign each click to the correct minute and decide when a minute's window is 'done,' the stream processor relies on:",
  "options": [
    "Processing time (wall clock when the event was consumed)",
    "Event time plus a watermark (an assertion that all events up to time T have arrived)",
    "The Kafka partition number",
    "The order events happen to be consumed in"
  ],
  "answer": 1,
  "explanation": "Aggregate by event time (when the click happened); a watermark — derived from observed event-times minus an allowed-lateness bound — tells the processor when to close and emit a window. Processing time would put late clicks in the wrong minute."
}
```

```quiz
{
  "question": "Kafka gives at-least-once delivery, so the same click can be processed twice. What keeps the counts from inflating?",
  "options": [
    "Nothing — at-least-once means counts are always exact",
    "A unique click_id minted at the source plus a dedup window so repeats are recognized and dropped (idempotent counting)",
    "Switching to at-most-once delivery",
    "Counting in processing-time windows instead of event-time windows"
  ],
  "answer": 1,
  "explanation": "Idempotency is the fix: a source-side unique click_id plus a rolling seen-set/Bloom filter lets the processor drop duplicates. At-most-once would instead DROP events and under-count; in-engine exactly-once still can't catch client-sent dupes."
}
```

```quiz
{
  "question": "Why does an ad click aggregator commonly run a separate batch (lambda) layer in addition to the real-time stream?",
  "options": [
    "Because streams cannot count at all",
    "To produce exact, globally-deduplicated, fraud-scrubbed totals for billing, which can correct the fast-but-approximate streaming numbers",
    "To make dashboards slower on purpose",
    "Because Kafka cannot store data durably"
  ],
  "answer": 1,
  "explanation": "The speed layer is seconds-fresh but approximate (may miss very-late events, lighter fraud filtering). The batch layer recomputes exact, fully-deduplicated, fraud-filtered totals over the complete raw log — the billing source of truth — and overwrites the speed-layer numbers."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Ad click aggregator — key terms",
  "cards": [
    { "front": "Tumbling window", "back": "Fixed, non-overlapping time buckets (e.g. each clock-minute) keyed by ad_id; the unit of aggregation. Emitted when its window closes." },
    { "front": "Event time vs processing time", "back": "When the click HAPPENED vs when we processed it. Aggregate by event time so late events land in the right window; processing time would misplace them." },
    { "front": "Watermark", "back": "A data-driven assertion 'all events with timestamp ≤ T have arrived.' When it passes a window's end, the window closes and emits. Bounds how long to wait for late events." },
    { "front": "Idempotent counting", "back": "Making 'count this click' safe to apply twice: unique source-side click_id + a dedup window, so at-least-once delivery doesn't inflate counts." },
    { "front": "Lambda vs kappa", "back": "Lambda = speed layer (fast, approximate) + batch layer (slow, exact) — two code paths. Kappa = one streaming code path; recompute by replaying the log." },
    { "front": "HyperLogLog", "back": "A probabilistic sketch for distinct counts (unique clickers) using tiny memory with ~1-2% error; mergeable across partitions/windows." }
  ]
}
```

## Key takeaways

- "Count the clicks" is really **windowed, idempotent, fraud-filtered aggregation over a late,
  out-of-order, at-least-once stream** — served at two tiers (fast/approximate, slow/exact).
- The backbone is **durable partitioned log (Kafka) → stream processor → time-series/OLAP store**;
  partition by `ad_id` to keep each ad's window state local and ordered. Buffer the firehose, store
  small rollups.
- Aggregate by **event time** and close windows with **watermarks** (+ bounded allowed-lateness);
  let very-late stragglers be absorbed by the batch recompute.
- At-least-once delivery demands **idempotent counting** — a **unique click_id + dedup window**;
  in-engine exactly-once helps but can't catch client-sent duplicates.
- Use **lambda** when the exact, billable number is a different (batch-shaped, globally-deduped,
  fraud-scrubbed) computation than the fast one; prefer **kappa** when the streaming logic *is* the
  correct logic and you can just replay.

## Concepts exercised

This design applies, end to end: `stream-processing-patterns` (tumbling windows, event time,
watermarks, late events) · `lambda-vs-kappa-architecture` (speed vs batch layers, replay-to-recompute)
· `event-streaming-and-kafka` (partitioned durable log as the ingest buffer and replay source,
partition-by-key) · `time-series-databases` (rollups keyed by window, downsampling, TTL retention) ·
plus `idempotency` and `deduplication` (safe counting under at-least-once), `hot-partitions` (a viral
ad's skewed key), and `backpressure-and-load-shedding` (the log absorbing spikes).
