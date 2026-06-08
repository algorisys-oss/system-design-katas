---
title: "Time-Series Databases"
slug: time-series-databases
level: advanced
module: storage-internals
order: 23
reading_time_min: 14
concepts: [time-series, append-only, downsampling, retention, columnar, compression]
use_cases: []
prerequisites: [lsm-trees-and-compaction, hot-warm-cold-data, database-sharding]
status: published
---

# Time-Series Databases

## Hook — a motivating scenario

You're storing metrics: every server emits CPU, memory, and 50 other gauges every 10 seconds. That's
billions of `(timestamp, metric, value)` points per day — almost entirely **appends**, queried as
**time ranges** ("p99 latency for service X over the last 6 hours"), and far less valuable as it ages.
A general-purpose database buckles: the write volume, the time-range scans, and the retention all fight
its design. A **time-series database (TSDB)** is built specifically for this shape.

## Mental model — a database optimized for timestamped, append-only data

A **time-series database** specializes in data that is **timestamped, mostly append-only, written in
time order, and queried by time range** — metrics, IoT sensors, logs, financial ticks, events. It
exploits the unique properties of that shape that a general DB can't assume:
- Writes are **appends in (roughly) increasing time order** — no random updates.
- Queries are **time-range scans + aggregations** (avg/percentiles/rate over windows), not point lookups
  by arbitrary key.
- Data **ages out**: recent data is hot; old data is rarely read and eventually deleted.

```compare
{
  "options": [
    { "label": "Time-series DB", "points": ["Append-only, time-ordered writes (huge ingest)", "Time-range scans + aggregations + downsampling", "Heavy compression (delta/delta-of-delta) on time+values", "Built-in retention/TTL + tiering"] },
    { "label": "General-purpose DB", "points": ["Random reads/writes/updates by key", "Point lookups + ad-hoc joins", "Less specialized compression", "Manual retention; struggles at metric ingest scale"] }
  ]
}
```

## Build it up — the optimizations that make it work

- **Write-optimized storage:** TSDBs are typically **LSM-based or columnar append logs** (recall LSM) —
  perfect for high-ingest, time-ordered appends.
- **Aggressive compression:** because timestamps are regular and adjacent values change little, TSDBs
  use **delta** and **delta-of-delta** encoding + compression to store points in **a few bits each**
  (e.g. Facebook's Gorilla) — orders of magnitude smaller than naive rows.
- **Downsampling (rollups):** keep raw data short-term, but **pre-aggregate** older data into coarser
  resolution (1s → 1m → 1h averages) so long-range queries stay fast and storage shrinks — a
  time-series-specific form of the hot/warm/cold tiering you've seen.
- **Retention policies / TTL:** old data **expires automatically** (e.g. raw after 7 days, rollups after
  1 year) — built in, not bolted on.

```reveal
{
  "prompt": "Why does a metrics workload (billions of points/day, queried by time range, decreasingly valuable as it ages) destroy a general-purpose database but suit a TSDB?",
  "answer": "A general-purpose (e.g. relational) DB assumes random reads/writes/updates by key, ad-hoc joins, and uniformly-valued long-lived rows — none of which match metrics. The ingest volume (billions of small appends/day) overwhelms a B-tree's in-place, index-maintaining writes; storing each point as a full row with repeated metadata wastes enormous space; time-range aggregation queries ('avg/p99 over 6h') become massive scans over unspecialized storage; and there's no built-in way to age data out, so the table grows without bound and queries slow over time. A TSDB is built for exactly this shape: append-only, time-ordered writes map onto LSM/columnar log storage that sustains huge ingest; regular timestamps and slowly-changing values enable delta/delta-of-delta compression that shrinks points to a few bits, so the same data takes a fraction of the space; data is laid out and indexed by time so range scans and aggregations are fast; downsampling pre-computes coarser rollups so long-range queries don't scan raw points; and retention/TTL automatically expires old raw data (keeping only rollups), bounding storage and matching the 'decreasingly valuable with age' property. So the TSDB exploits the workload's special structure (time-ordered appends, range/aggregate queries, aging data) that a general DB must treat as worst-case random access. Using a general DB means fighting its design on every axis (write throughput, storage size, query speed, retention); the TSDB aligns with the workload, which is why metrics/IoT/monitoring stacks use one."
}
```

## Build it up — cardinality: the TSDB's Achilles' heel

A series is identified by its metric name + **tags/labels** (e.g. `http_requests{service=api,
region=us, status=200}`). Each **unique combination of tag values is a separate time series**. The
number of distinct series is the **cardinality** — and **high cardinality is the #1 way to blow up a
TSDB**: adding a high-cardinality tag (like `user_id` or `request_id`) multiplies series into the
millions/billions, exploding memory and index size. (This is the subject of the next chapter.)

```reveal
{
  "prompt": "Why does adding a tag like `user_id` to your metrics often crater a time-series database?",
  "answer": "Because in a TSDB, every unique combination of metric name + tag values is a distinct time series with its own index entry and in-memory bookkeeping, and the total number of series (cardinality) is what the database's index/memory cost scales with — not the number of data points. Tags with small, bounded value sets (service, region, status code) create a manageable number of series. But a tag like user_id is unbounded/high-cardinality: if you have 10 million users, a single metric tagged by user_id becomes up to 10 million separate series — and if you combine it with other tags (endpoint, region), the series count multiplies combinatorially into the tens or hundreds of millions or more. Each series consumes index space and memory (the TSDB typically keeps the active series index in RAM for fast ingest/query), so cardinality explosion blows up memory, slows ingestion and queries, and can OOM or destabilize the database — often called a 'cardinality bomb.' It's the single most common way to take down a metrics system. The fix is to keep tag values low-cardinality: don't put unbounded identifiers (user_id, request_id, email, full URL with IDs, session id) in metric labels; aggregate over them instead (e.g. count by endpoint, not per user), and if you need per-entity detail, use logs/traces or a store designed for high cardinality rather than the metrics TSDB. Cardinality discipline is the central operational rule of running a TSDB — which is exactly why high-cardinality data gets its own chapter next."
}
```

## In the wild

- **TSDBs:** Prometheus, InfluxDB, TimescaleDB (Postgres extension), VictoriaMetrics, Graphite,
  OpenTSDB; columnar/Gorilla-style compression underpins many.
- **Use cases:** monitoring/metrics (recall observability), IoT sensor data, financial market data,
  real-time analytics, APM.
- **Downsampling + retention** are standard (raw short-term, rollups long-term) — the hot/warm/cold
  tiering pattern applied to time.
- **Cardinality management** is the key operational discipline (next chapter); avoid high-cardinality
  labels.

## Common misconception — "just use my regular database with a timestamp column"

A timestamp column doesn't give you ingest scale, compression, downsampling, or retention — the TSDB's
whole point.

```reveal
{
  "prompt": "Why isn't 'add a timestamp column and an index to my relational database' an adequate substitute for a time-series database at scale?",
  "answer": "Because a timestamp column gives you the data shape but none of the optimizations that make time-series workloads tractable at scale. A relational DB still treats each metric point as a general row: in-place, index-maintaining writes that can't sustain billions of small appends per day; full-width rows with repeated metadata instead of the delta/delta-of-delta compression that shrinks TSDB points to a few bits, so storage balloons; ordinary indexes/storage not laid out for the time-range scans and windowed aggregations (rate, percentiles) that dominate time-series queries, so those queries get slow; and no built-in downsampling (you'd hand-build rollup jobs) or retention/TTL (you'd manually delete or partition-prune, and the table grows unbounded, degrading everything). At small scale a timestamped table in Postgres is fine — and extensions like TimescaleDB add hypertables, compression, continuous aggregates, and retention to make Postgres a real TSDB. But a plain relational table with a timestamp column hits walls on ingest throughput, storage cost, query latency on ranges, and lifecycle management precisely when volume grows, which is exactly the regime where you needed a TSDB. So the timestamp column captures the schema, not the engineering: TSDBs win by exploiting append-only time-ordering, regular-interval compression, downsampling, and automatic retention — capabilities you'd otherwise have to reinvent poorly on top of a general DB. Use a purpose-built TSDB (or a TSDB extension) once metric volume/retention/range-query demands exceed what a vanilla timestamped table comfortably handles."
}
```

A **time-series database** is purpose-built for **timestamped, append-only, time-range-queried data**:
**write-optimized (LSM/columnar) ingest, delta compression, downsampling/rollups, and built-in
retention**. Its key risk is **high cardinality** (too many tag-value series). A plain timestamp column
on a general DB doesn't replicate these — it's a different engine for a specific data shape.

## Self-test

```quiz
{
  "question": "Time-series databases are optimized for data that is:",
  "options": [
    "Randomly updated by arbitrary key",
    "Timestamped, append-only, written in time order, and queried by time range/aggregation",
    "Highly relational with many joins",
    "Small and rarely changing"
  ],
  "answer": 1,
  "explanation": "TSDBs exploit append-only time-ordered writes + range/aggregate queries + aging data — enabling compression, downsampling, and retention."
}
```

```quiz
{
  "question": "The most common way to overwhelm a time-series database is:",
  "options": [
    "Querying old data",
    "High cardinality — adding unbounded tags (e.g. user_id) that explode the number of distinct series",
    "Using too few tags",
    "Compressing the data"
  ],
  "answer": 1,
  "explanation": "Each unique tag-value combination is a separate series; high-cardinality labels multiply series into millions, exploding memory/index."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Time-series databases — key terms", "cards": [
  { "front": "Time-series database (TSDB)", "back": "A database specialized for timestamped, mostly append-only data written in time order and queried by time range — metrics, IoT, logs, financial ticks, events." },
  { "front": "The data shape a TSDB exploits", "back": "Writes are appends in roughly increasing time order; queries are time-range scans and aggregations; data ages out (recent is hot, old is rarely read and eventually deleted)." },
  { "front": "Delta / delta-of-delta encoding", "back": "Compression that exploits regular timestamps and slowly-changing values to store each point in a few bits (e.g. Facebook's Gorilla) — far smaller than naive rows." },
  { "front": "Downsampling (rollups)", "back": "Pre-aggregating older data into coarser resolution (1s to 1m to 1h averages) so long-range queries stay fast and storage shrinks — time-based hot/warm/cold tiering." },
  { "front": "Retention policy / TTL", "back": "Built-in automatic expiry of old data (e.g. raw after 7 days, rollups after 1 year), bounding storage to match data that is less valuable as it ages." },
  { "front": "Cardinality (and the cardinality bomb)", "back": "The number of distinct series (metric name + unique tag-value combos). High-cardinality tags like user_id multiply series into the millions, exploding memory and index — the #1 way to blow up a TSDB." }
] }
```

## Key takeaways

- A **TSDB** is purpose-built for **timestamped, append-only, time-ordered, range-queried** data
  (metrics, IoT, ticks) — a shape general DBs handle poorly at scale.
- It exploits that shape: **write-optimized (LSM/columnar) ingest**, **delta/delta-of-delta
  compression**, **downsampling/rollups**, and **built-in retention/TTL** (time-based hot/warm/cold).
- Its key failure mode is **high cardinality** — unbounded tags (user_id/request_id) explode the number
  of series and blow up memory/index (next chapter).
- A **timestamp column on a general DB ≠ a TSDB** (no ingest scale, compression, downsampling, or
  retention); use a real TSDB (or extension) at scale.

## Up next

That cardinality problem deserves its own treatment, beyond metrics. Next: **High-Cardinality Data**.
