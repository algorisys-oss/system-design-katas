---
title: "Design a Metrics & Monitoring System (Prometheus-like)"
slug: metrics-monitoring-system
level: use-cases
module: real-time-and-data-intensive
order: 16
reading_time_min: 20
concepts: [time-series, high-cardinality, pull-vs-push, downsampling, query-engine, burn-rate-alerting]
use_cases: [metrics-monitoring-system]
prerequisites: [time-series-databases, high-cardinality-data, metrics-and-key-system-metrics, slis-slos-error-budgets]
status: published
---

# Design a Metrics & Monitoring System (Prometheus-like)

> **Use case:** a system that **collects** numeric measurements from thousands of services and
> machines, **stores** them as time series, lets engineers **query** them ("p99 latency of the
> checkout service over the last 24h, by region"), and **alerts** when something breaks an SLO.
> **Domain:** every production platform — Prometheus, Mimir, Thanos, VictoriaMetrics, InfluxDB,
> Datadog, Google's Monarch.
> **Scale:** millions of active time series, tens of millions of samples ingested per second,
> queries scanning months of history, alerts evaluated every few seconds — all on a budget where
> the monitoring system must cost a fraction of what it monitors.
> **Core challenges:** **high-cardinality** ingest, **pull vs push** collection, **cardinality
> control** via labels, **downsampling & retention tiers**, a **query engine** over time series,
> **alerting on SLOs / burn rate**, and a **TSDB** storage engine (delta-encoding, LSM/columnar).

A metrics system is the inverse of most designs in this course: writes massively dominate reads
(you ingest constantly, query occasionally), the data is **append-only numbers indexed by time**,
and the hardest enemy is not load but **cardinality** — the number of distinct series.

## 1 · Clarify requirements

**Functional**
- Ingest **(metric name + labels + value + timestamp)** samples from many targets.
- Store them as **time series**: one series per unique combination of metric name and label set.
- **Query** with aggregation over time and across labels (rate, sum, percentile, group-by).
- **Alert**: evaluate rules on a schedule; fire when a condition holds; route notifications.
- **Retention**: keep recent data at full resolution, older data downsampled, expire the rest.

**Non-functional**
- **Write-optimized**: ingest is the steady-state hot path; it must never block on queries.
- **Bounded cost per series**: cardinality, not request rate, is the scaling axis.
- **Query latency** in the low seconds for dashboards; alert evaluation in real time.
- **Available for writes** during partial failure — losing recent metrics is how you go blind in
  an incident. Some sample loss is tolerable; total ingest outage is not.

```reveal
{
  "prompt": "Why is 'cardinality' — the number of distinct time series — the dominant scaling concern, rather than raw samples per second?",
  "answer": "A time series is uniquely identified by its metric name plus the exact set of label key/value pairs, e.g. http_requests_total{service=\"checkout\", method=\"POST\", status=\"200\", region=\"us-east\"}. The samples within one series are cheap: they're just (timestamp, float64) points appended over time, and they compress to ~1-2 bytes each because consecutive timestamps and values barely change. What is expensive is each NEW series, because every series needs an entry in the inverted index (so queries can find it by label), an in-memory write buffer (the 'head' chunk currently being appended to), and metadata. Cardinality explodes multiplicatively: if you add a label with high-uniqueness values — user_id, request_id, full URL with IDs, container_id that rotates on every deploy — you create a fresh series per value, and the product of all label cardinalities can jump from thousands to tens of millions. That blows up index memory and RAM for head chunks, slows queries (more series to scan and merge), and can OOM the ingester. So the design's central discipline is keeping the number of distinct series bounded — high sample rate on few series is easy; modest sample rate on millions of series is what kills these systems."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Sample ingest rate",
  "inputs": [
    { "key": "series", "label": "Active time series", "default": 5000000 },
    { "key": "scrapeInterval", "label": "Scrape interval (seconds)", "default": 15 }
  ],
  "formula": "series / scrapeInterval",
  "resultLabel": "Samples ingested",
  "resultUnit": "samples/sec"
}
```

```calc
{
  "title": "Raw storage per day (compressed)",
  "inputs": [
    { "key": "samplesPerSec", "label": "Samples/sec", "default": 333000 },
    { "key": "bytesPerSample", "label": "Bytes per sample (after compression)", "default": 2 }
  ],
  "formula": "samplesPerSec * 86400 * bytesPerSample",
  "resultLabel": "Storage per day",
  "resultUnit": "bytes"
}
```

> Five million series scraped every 15s is ~333k samples/sec. At ~1.5-2 bytes/sample (delta + XOR
> compression), that's only ~50-60 GB/day — storage is cheap; the cost is **index memory and head
> chunks** for those 5M series, easily tens of GB of RAM. The lesson: **bytes are not the
> bottleneck, series count is.** Retention tiers keep history affordable; cardinality control keeps
> RAM affordable.

## 3 · Data model & API

A sample is `metric_name{label1="v1", label2="v2", ...} value @ timestamp`. The label set is the
identity; sort the labels and you get the **series key**.

**Ingest (Prometheus pull model):** the server scrapes an HTTP endpoint each target exposes:

```
GET http://target:9100/metrics
# returns plain text:
http_requests_total{method="POST",status="200"} 10472 1718000000000
process_cpu_seconds_total 8123.4 1718000000000
```

**Query (PromQL-style):**

```
rate(http_requests_total{service="checkout"}[5m])        # per-sec rate over 5m windows
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
sum by (region) (rate(http_requests_total{status=~"5.."}[5m]))   # 5xx rate per region
```

`rate()` over a **counter** (a monotonically increasing total) yields per-second throughput and
transparently corrects for counter resets (restarts). Percentiles come from **histogram buckets**,
not raw values — you can't average percentiles, so services pre-bucket latencies into `_bucket`
counters and the query interpolates the quantile.

## 4 · High-level architecture

```flow
{
  "title": "Pull-based metrics pipeline",
  "nodes": [
    { "label": "Targets (exporters)", "detail": "Each service/host exposes /metrics over HTTP. Stateless — they just report current counter/gauge values." },
    { "label": "Service discovery", "detail": "Kubernetes / Consul / file SD tells the scraper which targets exist right now, with their labels (job, instance)." },
    { "label": "Scraper / ingester", "detail": "Pulls every target on an interval, attaches labels, appends samples to the head block, writes a WAL." },
    { "label": "TSDB (local + object store)", "detail": "Head (in-memory + WAL) → compacted blocks on disk → shipped to S3/GCS for long-term, downsampled tiers." },
    { "label": "Query engine (PromQL)", "detail": "Resolves label matchers via the inverted index, fetches chunks, runs the rate/aggregation/quantile pipeline." },
    { "label": "Alert evaluator + dashboards", "detail": "Rules run PromQL on a timer; firing alerts go to a router (Alertmanager) for dedup/grouping/routing. Grafana reads queries." }
  ],
  "note": "Writes flow left→right and dominate; reads (query/alert) hit the same TSDB but on a separate path so a heavy query can't stall ingest."
}
```

**Storage model — the TSDB.** Prometheus's engine splits into two layers:

1. **Inverted index** (label → series): for each label pair like `service="checkout"` it stores a
   sorted list (postings) of the series IDs that have it. A query like `{service="checkout",
   region="us-east"}` intersects two postings lists — the same technique a search engine uses.
2. **Chunks** (the samples): each series' samples are stored in **chunks** of ~120 samples,
   compressed with **delta-of-delta** encoding for timestamps (scrape intervals are near-constant,
   so the second difference is usually zero) and **XOR** encoding for float values (consecutive
   values are similar, so most XOR bits are zero). This is what gets you to ~1.5 bytes/sample.

Recent data lives in the **head block** (in memory, backed by a write-ahead log for crash
recovery). Periodically the head is **compacted** into immutable on-disk blocks (a 2-hour block,
later merged into larger blocks) — an **LSM-tree-like** pattern: buffer writes, flush sorted
immutable blocks, compact in the background. Old blocks ship to object storage.

## 5 · Deep dive: collection, cardinality, storage, alerting

### 5.1 Pull vs push

```compare
{
  "options": [
    { "label": "Pull (Prometheus)", "points": ["Server scrapes targets on a schedule", "Server controls the load & interval", "Up/down is observable for free (scrape failed = target down)", "Needs service discovery + network reachability to every target", "Awkward for short-lived/batch jobs and across NAT/firewalls"] },
    { "label": "Push (StatsD, OTLP, Graphite)", "points": ["Clients send samples to the collector", "Natural for batch jobs, serverless, edge behind NAT", "Collector can be overwhelmed by a misbehaving client (no backpressure)", "Harder to tell 'down' from 'silent'", "Needs a push gateway to bridge to a pull system"] }
  ]
}
```

```reveal
{
  "prompt": "Pull is the default for Prometheus, yet push exists everywhere (OpenTelemetry, StatsD). When does push win, and how do pull systems handle the cases pull is bad at?",
  "answer": "Pull wins for long-lived services in a discoverable network: the server decides who and how often to scrape (so it controls its own ingest load and can't be flooded), and a failed scrape is itself a signal — target down or unreachable is detectable without the target cooperating, giving you the 'up' metric for free. Pull struggles with (a) short-lived jobs that finish before the next scrape (a cron/batch job that runs for 3 seconds is never scraped), (b) targets behind NAT/firewalls the server can't reach, and (c) serverless/edge where there's nothing stable to scrape. The pull world bridges these with a Pushgateway: the ephemeral job pushes its final metrics to a gateway that the server then scrapes — but you only use it for service-level batch results, never for per-instance metrics, because the gateway holds the last pushed value forever and turns into a cardinality and staleness trap. Push wins natively for those ephemeral/unreachable cases and is the OpenTelemetry default (OTLP push to a collector), at the cost of needing your own backpressure/rate-limiting at the collector since a buggy client can flood it, and needing a separate liveness signal because 'no data' is ambiguous between 'healthy and quiet' and 'dead'. Many modern stacks run a collector (push from apps) that then exposes a scrape endpoint (pull to the TSDB), getting both."
}
```

### 5.2 Cardinality control — the labels discipline

Cardinality is the product of each label's distinct value count. The fix is **what you allow as a
label**:

- **Bounded labels only.** `status="200"`, `method="POST"`, `region="us-east"` have small fixed
  domains — fine. `user_id`, `request_id`, `email`, raw `url` with embedded IDs, or a `pod` name
  that changes every deploy are **unbounded** — each value spawns a series. Keep those in **logs or
  traces**, not metric labels.
- **Aggregate at the source.** Don't emit one series per request; emit a counter that increments,
  pre-bucketed by the few dimensions you'll actually query.
- **Limits & guardrails.** Ingesters enforce per-tenant **active-series limits** and reject new
  series past a cap (better to drop a runaway metric than OOM and lose everything). A `topk`
  cardinality report surfaces the offending metric.
- **Relabeling.** Drop or rewrite high-cardinality labels at scrape time before they ever hit the
  index.

```reveal
{
  "prompt": "An engineer adds a `customer_id` label to `api_requests_total` so they can slice per customer. There are 200,000 customers and the metric already had method×status×region = 4×6×5 = 120 series. What happens?",
  "answer": "Series count is multiplicative across labels, so adding customer_id with 200,000 values multiplies the existing 120 series by 200,000 → up to 24 million series for a single metric, where there were 120. Each series needs index postings entries and an in-memory head chunk, so RAM for this one metric jumps from kilobytes to potentially tens of gigabytes, the inverted index bloats, every query touching this metric now scans and merges millions of postings, and the ingester may hit its active-series limit and start rejecting writes — possibly dropping unrelated metrics too. The deploy that 'just added a label' can take down the monitoring system. The correct approaches: don't put customer_id in a metric at all if customers are unbounded — use logs/traces for per-customer drill-down and an analytics store (a data warehouse) for per-customer aggregates; OR bucket customers into a bounded dimension like tier=\"free|pro|enterprise\" (3 values, 360 series total); OR if you truly need per-top-customer metrics, limit it to the top-N customers by traffic and bucket the long tail as 'other'. The rule: a metric label's value domain must be small and bounded — identity-like, unbounded values belong in logs/traces."
}
```

### 5.3 Storage internals — delta encoding, blocks, retention tiers

Drag the dial — keeping data longer at full resolution is precise but expensive; downsampling
trades resolution for cheap long history:

```tradeoff
{
  "title": "Retention vs resolution vs cost",
  "axis": { "left": "Cheap / coarse / long", "right": "Costly / precise / short" },
  "steps": [
    { "label": "Raw (15s) — keep 15 days", "detail": "Full resolution for live debugging and recent dashboards. Largest footprint per day; kept only as long as you need second-level detail." },
    { "label": "5m downsampled — keep 90 days", "detail": "Pre-aggregate raw into 5-minute rollups (min/max/sum/count per window). ~20× smaller; fine for weekly trends and capacity planning." },
    { "label": "1h downsampled — keep 1-2 years", "detail": "Hourly rollups for year-over-year and SLO history. Tiny footprint; you lose intra-hour spikes but keep the shape." },
    { "label": "Tiered storage to object store", "detail": "Old blocks ship to S3/GCS; query layer (Thanos/Mimir) fans out to them on demand. Storage cost ~free, query latency higher — acceptable for old data." }
  ]
}
```

The compression that makes this work:
- **Delta-of-delta timestamps:** scrapes land ~15s apart, so the gap between gaps is usually 0,
  stored in a single bit. Years of timestamps cost almost nothing.
- **XOR float compression (Gorilla-style):** XOR each value with the previous; similar values
  differ in only a few low bits, so leading/trailing zeros are run-length coded. A gauge that
  barely moves costs a bit or two per sample.
- **Downsampling** is a periodic background job that reads raw blocks and writes rollup blocks
  storing aggregates (count/sum/min/max) per window, so the query engine can answer `avg`/`max`
  over a year without scanning a year of raw points.

### 5.4 The query engine

A PromQL query runs as a pipeline: **resolve** the label matchers against the inverted index to a
set of series → **fetch** the relevant chunks for the time range → **decode** them into
(timestamp, value) points → apply range functions like `rate()` per series → **aggregate** across
series (`sum by (region)`) → return a vector of points. The index intersection is what makes
selective queries fast; the danger is a query with a loose matcher (`{job=~".+"}`) that selects
millions of series — so engines enforce **max-series-per-query** and time-range limits.

### 5.5 Alerting on SLOs and burn rate

Naively alerting "fire if error rate > 1%" is terrible: it pages on a 30-second blip and stays
silent through a slow week-long degradation. **SLO burn-rate alerting** fixes both. Your SLO gives
an **error budget** (e.g. 99.9% availability = 0.1% of requests may fail per 30 days). **Burn rate**
= how fast you're spending that budget relative to "exactly on budget." Burn rate 1 = you'll exactly
exhaust the budget in 30 days; burn rate 14.4 = you'd exhaust the whole 30-day budget in ~2 days.

```sequence
{
  "title": "Multi-window burn-rate alert evaluation",
  "actors": ["AlertEvaluator", "QueryEngine", "TSDB", "Alertmanager"],
  "steps": [
    { "from": "AlertEvaluator", "to": "QueryEngine", "label": "every 30s: error-ratio over 5m AND over 1h" },
    { "from": "QueryEngine", "to": "TSDB", "label": "fetch 5xx & total counters, compute rate()" },
    { "from": "TSDB", "to": "QueryEngine", "label": "samples → ratios" },
    { "from": "QueryEngine", "to": "AlertEvaluator", "label": "5m burn=20, 1h burn=18" },
    { "from": "AlertEvaluator", "to": "Alertmanager", "label": "both > 14.4 → fire FastBurn (page)" },
    { "from": "Alertmanager", "to": "Alertmanager", "label": "dedup + group + route → PagerDuty/Slack" }
  ]
}
```

Use **multiple windows together**: a fast-burn alert (e.g. 5m **and** 1h windows both above ~14×)
pages immediately for severe outages; a slow-burn alert (e.g. 6h **and** 1d windows above ~3×)
opens a ticket for a low-grade leak. Requiring a **short and a long window to agree** kills false
pages (the short window catches it fast; the long window confirms it's not a blip). Alerts route
through a deduper/grouper (Alertmanager) that collapses 500 firing instances into one notification,
silences during maintenance, and routes by severity.

## 6 · Trade-offs & failure modes

- **Cardinality blowup** is the #1 outage: a deploy adds an unbounded label and OOMs the ingester.
  Mitigate with active-series limits, relabel-drop, and cardinality dashboards.
- **Pull reachability:** the scraper must reach every target; service discovery churn (pods
  rotating) creates and tears down series constantly (**churn** is its own cardinality cost).
- **Query stampedes:** a Grafana dashboard with 50 panels, each a heavy range query, can starve
  ingest if they share resources — separate the read and write paths, cap query series/time-range,
  and cache rule/recording-rule results.
- **Single-node TSDB limits:** vanilla Prometheus is one machine (a deliberate **SPOF** trade for
  simplicity). HA is two identical Prometheis scraping the same targets (dedup at query time);
  global scale needs Thanos/Mimir/Cortex sharding ingest and querying horizontally.
- **Clock skew & late data:** samples are timestamped at scrape; out-of-order or future timestamps
  break assumptions — engines reject samples too far out of order.
- **Alert fatigue:** symptom-based SLO/burn-rate alerts over cause-based threshold alerts; page on
  user-visible impact, not on every CPU spike.

## 7 · Scaling & evolution

- **Horizontal ingest (sharding):** hash series by labels across many ingesters (Mimir/Cortex
  "distributor → ingester" with a hash ring — recall **consistent hashing**), each owning a slice
  of the series space; replicate each series to N ingesters for HA.
- **Object-storage long-term (Thanos/Mimir):** ingesters flush blocks to S3/GCS; a "store gateway"
  serves historical queries from object storage, a "compactor" does downsampling and merges blocks.
  Decouples retention from local disk.
- **Recording rules:** precompute expensive queries (the per-region 5xx rate) on a schedule and
  store the result as a new series, so dashboards and alerts read a cheap precomputed series.
- **Global view / federation:** a top-level instance scrapes aggregated metrics from many regional
  instances for a single pane of glass without centralizing every raw sample.
- **Exemplars & trace links:** attach a trace ID to specific samples so a latency spike on a graph
  links straight to an example trace — bridging metrics and distributed tracing.

## Self-test

```quiz
{
  "question": "Why is the number of distinct time series (cardinality), not samples-per-second, the main thing that limits a Prometheus-like system?",
  "options": [
    "Samples are uncompressed and huge",
    "Each new series needs an index entry and an in-memory head chunk, and cardinality multiplies across labels — it blows up RAM and index size",
    "Queries can only read one sample at a time",
    "Disk is more expensive than RAM"
  ],
  "answer": 1,
  "explanation": "Samples within a series compress to ~1-2 bytes (delta-of-delta + XOR). The cost is per-series: inverted-index postings + head chunk RAM, and label cardinalities multiply, so an unbounded label can explode series count and OOM the ingester."
}
```

```quiz
{
  "question": "What is the main advantage of the pull (scrape) model over push?",
  "options": [
    "It works perfectly for short-lived batch jobs",
    "Clients can never overwhelm the collector, and a failed scrape directly tells you the target is down/unreachable (the 'up' signal)",
    "It needs no service discovery",
    "It compresses data better"
  ],
  "answer": 1,
  "explanation": "Pull lets the server control ingest load (no client can flood it) and gives liveness for free — a failed scrape means target down. Push is better for ephemeral/NAT'd jobs, which pull bridges via a Pushgateway."
}
```

```quiz
{
  "question": "Why do good SLO alerts use multi-window burn rate (e.g. require a 5m AND a 1h window to both exceed a threshold) instead of a single 'error rate > 1%' threshold?",
  "options": [
    "To save CPU on the alert evaluator",
    "A single threshold pages on tiny blips and misses slow degradations; requiring a short window (fast detection) and a long window (confirmation) to agree pages fast on real outages while suppressing false alarms",
    "Because PromQL can't compute a single ratio",
    "To avoid storing histogram buckets"
  ],
  "answer": 1,
  "explanation": "Burn rate ties the alert to the SLO error budget; combining a fast and a slow window detects severe outages quickly, confirms them, and ignores momentary spikes — far fewer false pages than a static threshold."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Metrics & monitoring — key terms",
  "cards": [
    { "front": "Time series & series key", "back": "A stream of (timestamp, value) points identified by metric name + sorted label set. The label set IS the identity; one unique label combination = one series." },
    { "front": "Cardinality", "back": "The number of distinct time series, = product of each label's value count. The dominant scaling axis; unbounded labels (user_id, request_id) explode it." },
    { "front": "Pull vs push", "back": "Pull: server scrapes targets on a schedule (controls load, gets liveness free). Push: clients send samples (good for ephemeral/NAT'd jobs, no built-in backpressure)." },
    { "front": "Delta-of-delta + XOR compression", "back": "Timestamps stored as the difference of differences (≈0 for fixed intervals); float values XOR'd against the previous. Gets samples to ~1-2 bytes each." },
    { "front": "Downsampling / retention tiers", "back": "Background rollups (5m, 1h aggregates) of old raw data, kept longer at coarser resolution; old blocks ship to object storage. Cheap long history." },
    { "front": "Burn-rate alerting", "back": "Alert on how fast you're spending the SLO error budget; multi-window (short AND long) fires fast on real outages and suppresses blips." }
  ]
}
```

## Key takeaways

- A metrics system is **write-dominated, append-only, and indexed by time** — the enemy is
  **cardinality** (distinct series), not request rate. The whole design is disciplined around
  keeping series count bounded.
- **Pull** (scrape) gives load control and free liveness; **push** suits ephemeral/unreachable
  targets. Real stacks often combine them (collector pushes in, TSDB scrapes the collector).
- Storage is an **LSM/columnar TSDB**: an **inverted index** (label → series) plus
  **delta-of-delta + XOR-compressed chunks**, head-in-RAM-with-WAL, compacted to immutable blocks,
  with **downsampling + tiered retention** to object storage for cheap long history.
- The **query engine** resolves matchers via the index, fetches/decodes chunks, then runs
  rate/aggregate/quantile pipelines — guarded by max-series and time-range limits.
- Alert on **SLOs via multi-window burn rate**, not raw thresholds: page on user-visible impact,
  detect fast, confirm with a long window, and route through a deduper/grouper.

## Concepts exercised

This design applies, end to end: `time-series-databases` (the TSDB engine — inverted index,
delta/XOR-compressed chunks, head + WAL + compacted blocks, downsampling) · `high-cardinality-data`
(the central scaling constraint — bounded labels, active-series limits, churn) ·
`metrics-and-key-system-metrics` (counters/gauges/histograms, `rate()`, percentiles from buckets) ·
`slis-slos-error-budgets` (burn-rate alerting on the error budget). It also leans on
`consistent-hashing` (sharding ingest across a hash ring), `lsm-trees` / `columnar-storage` (the
storage layout), `single-point-of-failure` (single-node TSDB and HA replication), and
`backpressure-and-load-shedding` (rejecting runaway series, capping query fan-out).
