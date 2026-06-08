---
title: "High-Cardinality Data"
slug: high-cardinality-data
level: advanced
module: storage-internals
order: 24
reading_time_min: 13
concepts: [cardinality, dimensions, metrics-vs-logs, wide-events, sampling, observability]
use_cases: []
prerequisites: [time-series-databases, metrics-and-key-system-metrics, distributed-tracing]
status: published
---

# High-Cardinality Data

## Hook — a motivating scenario

You add `user_id` as a label to your latency metric so you can debug per-user problems. Within hours
the metrics system is out of memory and on fire. The intent was reasonable — "I want to slice by
user" — but **metrics can't carry high-cardinality dimensions**. Understanding *cardinality* tells you
which tool can answer "per-user / per-request" questions and which one you'll take down by trying.

## Mental model — cardinality = number of distinct values

**Cardinality** is the number of **distinct values** a field (dimension) can take. `status_code`
(~dozens) and `region` (a handful) are **low cardinality**. `user_id`, `request_id`, `email`, `full
URL`, `session_id` are **high cardinality** — potentially millions or unbounded. The trouble isn't one
high-cardinality field; it's that systems like **metrics TSDBs index by the combination of all
dimensions**, so cardinality **multiplies**: `endpoint × region × user_id` can be billions of distinct
series.

```reveal
{
  "prompt": "Why does cardinality multiply, and why is that combinatorial explosion the real danger rather than any single dimension?",
  "answer": "Because a metric (or any dimensionally-indexed dataset) creates a distinct series/group for every unique COMBINATION of its dimension values, not for each dimension independently. If a metric has tags endpoint (say 50 values), region (10), and status (5), that's up to 50×10×5 = 2,500 series — manageable. Add a high-cardinality tag like user_id (10 million), and the series count becomes 50×10×5×10,000,000 = 25 billion potential series, because each existing combination now splits across every user. So it's the cross-product that explodes: even one unbounded dimension multiplied against the others detonates the total. That matters because the cost of metrics systems scales with the number of series (each needs index entries and in-memory tracking), so the combinatorial total — not the size of any single dimension in isolation — is what determines memory/index blowup. This is why 'just one more tag' can be catastrophic: it doesn't add values, it multiplies them against everything else. The discipline is to keep the cross-product bounded by only using low-cardinality dimensions in metrics, and to recognize that adding any high-cardinality dimension effectively makes the whole metric high-cardinality. Cardinality is about the combination, so you reason about the product of all dimensions' value-counts, not each one alone."
}
```

## Build it up — match the data shape to the right tool

The core insight: **different observability tools tolerate cardinality very differently**, so route
high-cardinality questions to the right one:
- **Metrics (TSDB):** aggregate counters/gauges, indexed by tag combinations → **low cardinality
  only**. Great for "p99 latency by endpoint/region," terrible for "by user_id." (Recall TSDB
  cardinality bomb.)
- **Logs:** individual events with arbitrary fields → handle **high cardinality** fine (you store and
  search events, not pre-index every combination). Good for "find request_id abc123."
- **Traces:** per-request, inherently high-cardinality (each trace is unique) → for "where did *this*
  request spend time" (recall distributed tracing).
- **Wide structured events / columnar analytics:** the modern approach (observability 2.0,
  Honeycomb-style) — emit one **wide event per request** with many high-cardinality fields, stored
  columnar so you can **slice by any dimension at query time** (including user_id) without pre-defining
  series.

```reveal
{
  "prompt": "You need to debug latency for a specific user_id. Why is the answer NOT 'add user_id as a metric label,' and what should you use instead?",
  "answer": "Because user_id is high-cardinality, and metrics (TSDBs) index by the combination of all label values, so adding user_id multiplies your series count by the number of users — exploding memory/index and likely crashing the metrics system (a cardinality bomb), as in the opening scenario. Metrics are designed for low-cardinality aggregates ('p99 by endpoint/region'), not per-entity slicing. To answer per-user (or per-request) questions, use tools built for high cardinality: (1) Logs — store structured log events that include user_id as a field; you can search/filter by user_id without pre-indexing every value, ideal for 'show me this user's requests/errors.' (2) Distributed traces — each request's trace is inherently high-cardinality and lets you see exactly where that user's specific request spent time across services. (3) Wide structured events / columnar analytics (observability 2.0, e.g. Honeycomb) — emit one rich event per request carrying many high-cardinality fields (user_id, request_id, build, etc.) into a columnar store, then slice/group by any field at query time, including user_id, without defining series in advance. So the rule is to keep high-cardinality identifiers OUT of metric labels and put them in logs/traces/wide-events instead: metrics tell you something is wrong in aggregate (and are cheap to keep), and you pivot to logs/traces/events to drill into the specific user or request. Choosing the tool by the cardinality of the question is the key skill; forcing high-cardinality dimensions into metrics is the classic, costly mistake."
}
```

## Build it up — managing it

- **Keep metric labels low-cardinality.** Never put user_id/request_id/email/raw URLs (with IDs) in
  metric tags; aggregate over them (count by endpoint, not per user). Watch series count; some TSDBs
  enforce cardinality limits.
- **Push high-cardinality detail to logs/traces/wide events**, where it belongs — and pivot from a
  metric alert to those for specifics (recall observability: metric → trace → logs).
- **Sampling** for high-volume high-cardinality data (especially traces) keeps cost bounded — keep all
  errors/slow ones, sample the rest (recall tail-based sampling, coming up).
- **Columnar stores** (handle high cardinality well) for wide-event analytics; **approximate
  algorithms** (HyperLogLog) estimate cardinality cheaply when you just need a *count of distinct*.

```reveal
{
  "prompt": "If you only need to know HOW MANY distinct values there are (e.g. unique visitors) — not to slice by them — what cheap technique avoids the cardinality cost?",
  "answer": "Use a probabilistic cardinality estimator, the classic being HyperLogLog (HLL). Counting distinct values exactly requires remembering every value you've seen (a set), which costs memory proportional to the cardinality — exactly the explosion you're trying to avoid for something like 'unique visitors' across millions/billions of ids. HyperLogLog instead estimates the count of distinct elements using a tiny, fixed amount of memory (kilobytes) regardless of how many distinct values there are, by hashing each value and tracking statistical properties (the maximum number of leading zeros in hashed values across buckets) that correlate with cardinality. It gives an approximate distinct count with a small, known error (typically ~1–2%), which is fine for metrics like unique visitors, distinct users, or unique IPs where you need the magnitude, not the exact set. Crucially, HLL sketches are mergeable: you can compute per-shard/per-time-window sketches and union them to get the overall distinct count, making it great for distributed and time-series aggregation. So when the question is 'how many unique X' rather than 'show me each X' or 'slice by X,' HyperLogLog (and similar sketches) sidesteps the cardinality-storage problem entirely — you store a small sketch, not the high-cardinality set. Redis, Presto/Trino, BigQuery, and many analytics systems provide HLL for exactly this. If instead you truly need to filter/slice by the individual high-cardinality values, you fall back to logs/traces/wide-events; HLL is specifically for the count-distinct case."
}
```

## In the wild

- **The metrics-vs-logs-vs-traces choice** hinges on cardinality (recall observability fundamentals):
  metrics = low-cardinality aggregates; logs/traces/wide-events = high-cardinality detail.
- **Observability 2.0 / wide events** (Honeycomb, columnar) is the modern way to keep high-cardinality
  context queryable; **HyperLogLog** for distinct counts (Redis, Presto, BigQuery).
- **TSDB cardinality limits** and label hygiene are standard ops practice (recall TSDB cardinality
  bomb); **sampling** (tail-based) bounds trace cost.
- It's why "I'll just add a label" is a famous footgun in metrics systems.

## Common misconception — "more dimensions/labels on my metrics = better observability"

High-cardinality labels in metrics don't add insight — they blow up the system; put them where they
belong.

```reveal
{
  "prompt": "Why does piling more (high-cardinality) labels onto metrics degrade rather than improve observability?",
  "answer": "Because metrics get their efficiency and scalability precisely from being low-cardinality aggregates, and high-cardinality labels destroy that without delivering the detail you actually want. Each added label value multiplies the number of series (the cross-product), so high-cardinality labels like user_id/request_id explode series counts into the millions/billions, ballooning index/memory, slowing or crashing ingestion and queries, and driving up cost — often taking the metrics system down (cardinality bomb). And even if it didn't fall over, metrics still wouldn't give you what high-cardinality questions need: metrics are pre-aggregated counters/gauges, not individual events, so 'this specific user's slow request' isn't really answerable from a metric — you need the per-event/per-request detail that lives in logs, traces, or wide events. So adding high-cardinality labels both harms the metrics system AND fails to provide real per-entity insight; it's the worst of both. Good observability instead uses each tool for its strength: low-cardinality metrics for cheap, always-on aggregate signals and alerting (p99 by endpoint/region), and high-cardinality logs/traces/wide-events for drilling into specific users/requests — pivoting metric → trace → logs. 'More labels = better' confuses 'more dimensions on a cheap aggregate' (which breaks it) with 'richer per-event context' (which belongs in events, not metrics). The skill is matching the question's cardinality to the right store, keeping metric labels bounded, and pushing high-cardinality context to event-based tools."
}
```

**Cardinality** = number of distinct values; it **multiplies across dimensions**, so high-cardinality
fields (user_id, request_id) blow up **metrics/TSDBs**. Route by cardinality: **metrics for
low-cardinality aggregates**, **logs/traces/wide-events for high-cardinality detail**, **HyperLogLog
for distinct counts**, **sampling** to bound cost — never stuff high-cardinality labels into metrics.

## Self-test

```quiz
{
  "question": "'High cardinality' refers to a field that:",
  "options": [
    "Has very few distinct values",
    "Has many/unbounded distinct values (e.g. user_id, request_id), which multiplies series/combinations",
    "Is always numeric",
    "Changes slowly"
  ],
  "answer": 1,
  "explanation": "Cardinality = count of distinct values; high-cardinality fields explode the number of dimension combinations a system must track."
}
```

```quiz
{
  "question": "To debug a specific user_id's requests, you should use:",
  "options": [
    "A metric label for user_id",
    "Logs / traces / wide structured events (which handle high cardinality), not metric labels",
    "A read replica",
    "A Bloom filter"
  ],
  "answer": 1,
  "explanation": "Metrics can't carry high-cardinality labels without blowing up; per-user/per-request detail belongs in logs, traces, or wide events."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "High-cardinality data — key terms", "cards": [ { "front": "Cardinality", "back": "The number of distinct values a field (dimension) can take. status_code and region are low; user_id, request_id, email, and session_id are high — potentially millions or unbounded." }, { "front": "Why cardinality multiplies", "back": "Metrics TSDBs index by the combination of all dimensions, so endpoint × region × user_id is a cross-product. Even one unbounded dimension detonates the total series count." }, { "front": "Cardinality bomb", "back": "Adding a high-cardinality label (like user_id) to a metric explodes series count into millions or billions, blowing up index/memory and often crashing the metrics system." }, { "front": "Where high-cardinality detail belongs", "back": "Logs (search events by request_id), traces (per-request, inherently unique), and wide structured events / columnar analytics — not metric labels, which must stay low-cardinality." }, { "front": "Wide structured events (observability 2.0)", "back": "Emit one rich event per request with many high-cardinality fields, stored columnar, so you can slice by any dimension (including user_id) at query time without pre-defining series. Honeycomb-style." }, { "front": "HyperLogLog (HLL)", "back": "A probabilistic estimator that counts distinct values (e.g. unique visitors) in fixed kilobytes of memory with ~1–2% error. For count-distinct only, not slicing by individual values." } ] }
```

## Key takeaways

- **Cardinality** = number of **distinct values**; it **multiplies across dimensions**, so even one
  unbounded field (user_id/request_id) detonates the total.
- **Metrics/TSDBs tolerate only low cardinality** (the "cardinality bomb"); **logs, traces, and wide
  structured events** are built for high-cardinality detail.
- **Route by the question's cardinality:** low-cardinality aggregates → metrics; per-user/per-request
  detail → logs/traces/wide-events; **distinct counts → HyperLogLog**; bound cost with **sampling**.
- "Just add a label" is a classic footgun — **keep metric labels bounded**, push high-cardinality
  context to event-based tools.

## Up next

Different data shapes want different stores — leading to using several. Next: **Polyglot Persistence**.
