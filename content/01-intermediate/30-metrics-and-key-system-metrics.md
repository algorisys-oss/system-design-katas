---
title: "Metrics & Key System Metrics"
slug: metrics-and-key-system-metrics
level: intermediate
module: observability
order: 30
reading_time_min: 14
concepts: [metrics, golden-signals, latency, traffic, errors, saturation, percentiles, alerting]
use_cases: []
prerequisites: [observability-fundamentals, latency-vs-throughput, availability-and-the-nines]
status: published
---

# Metrics & Key System Metrics

## Hook — a motivating scenario

Your dashboard has 200 graphs and you *still* find out about outages from angry users. Drowning in
metrics is as useless as having none — the problem is measuring the wrong things (CPU of every box)
instead of the few that signal user pain. A small set of **key metrics** — the "golden signals" —
tells you almost everything about a service's health and is what you should alert on.

## Mental model — numbers over time you can aggregate and alert on

A **metric** is a numeric measurement sampled over time (e.g. requests/sec, error %, p99 latency).
Unlike logs (per-event detail), metrics are **cheap, aggregated, and trend-friendly** — perfect for
dashboards and **alerts**. The skill isn't collecting more; it's choosing the few that reflect **user
experience and impending failure**.

## Build it up — the golden signals

Google's SRE "four golden signals" cover most of what matters for a request-serving service:

```match
{
  "prompt": "Match each golden signal to what it measures.",
  "pairs": [
    { "left": "Latency", "right": "How long requests take (watch p95/p99, and errors' latency separately)" },
    { "left": "Traffic", "right": "How much demand — requests/sec, throughput" },
    { "left": "Errors", "right": "Rate of failing requests (5xx, timeouts, wrong results)" },
    { "left": "Saturation", "right": "How 'full' the system is — CPU/memory/queue depth vs capacity" }
  ]
}
```

(The related **RED** method — Rate, Errors, Duration — is the request-centric subset; **USE** —
Utilization, Saturation, Errors — targets resources.)

```reveal
{
  "prompt": "Why measure latency as p95/p99 percentiles (and separate successful vs failed requests) rather than as an average?",
  "answer": "Averages hide the tail (recall latency-vs-throughput): a 50 ms average can mask a p99 of 3 s that a meaningful fraction of users actually feel — and at scale 1% is a lot of people. Percentiles (p95/p99/p999) expose those slow experiences that drive complaints and SLO breaches. You also separate successful from failed requests because failures often return very fast (instant 500) or hang (timeout), which skews a blended latency number — fast errors make latency look great while users are failing, and timeouts inflate it. Tracking success-latency percentiles plus the error rate gives an honest picture: how slow real (successful) requests are, and how many are failing. Averages of all requests can look fine during an incident."
}
```

## Build it up — metric types, alerting, and cardinality

- **Metric types:** **counters** (monotonic totals: requests, errors), **gauges** (point-in-time:
  memory, queue depth, active connections), and **histograms** (distributions → percentiles like p99).
- **Alert on symptoms, not causes.** Alert on user-facing signals (error rate, latency, availability
  vs your SLO — recall the nines), not every internal cause (one box's CPU). Cause-based alerts page
  you for non-problems and miss real ones.
- **Cardinality costs:** every unique label combination is a separate time series. High-cardinality
  labels (user_id, request_id) explode storage/cost — keep labels low-cardinality (endpoint, status,
  region); use logs/traces for per-request detail.

```reveal
{
  "prompt": "Why is alerting on 'CPU > 80% on any server' often a bad alert, and what should you alert on instead?",
  "answer": "Because CPU is a cause/resource signal, not a measure of user impact: a server can run hot at 85% CPU while serving every request perfectly (efficient use of capacity), so you get paged for a non-problem — and conversely, users can be suffering (high error rate, timeouts) while CPU looks fine, so the alert misses real outages. Cause-based alerts cause alert fatigue and false confidence. Instead, alert on symptoms tied to user experience and your SLOs: elevated error rate, p99 latency breaching its threshold, or availability dropping — the golden signals. Keep resource metrics like CPU/saturation on dashboards for diagnosis (and maybe as supporting/secondary alerts), but page humans on what users actually feel. 'Alert on symptoms, debug with causes' keeps alerts meaningful and on-call sane."
}
```

## In the wild

- **Prometheus + Grafana** (pull-based, histograms, PromQL) and **Datadog/CloudWatch** are standard;
  dashboards show the golden signals per service.
- **Alerting** ties to **SLOs/error budgets** (recall the nines): page when the error budget is
  burning, not on every blip.
- **Histograms** power p50/p95/p99 latency; **counters** give rates; **gauges** track saturation
  (queue depth, connections).
- Pairs with the other pillars: a metric **alert** → open the **trace** → read the **logs**.

## Common misconception — "more dashboards/metrics = better visibility"

Visibility comes from the *right* few signals, alerted on symptoms — not from graph sprawl.

```reveal
{
  "prompt": "A team has hundreds of dashboards but still misses outages. What's the fix?",
  "answer": "The fix isn't more graphs — it's focusing on a small set of user-impacting signals and alerting on symptoms. Hundreds of dashboards create noise: no one knows which graph matters, and outages slip through because nothing pages on actual user pain. Instead: track the golden signals (latency p95/p99, traffic, error rate, saturation) per service; define SLOs and alert when they're breached / the error budget burns; alert on symptoms (errors/latency/availability), not on every internal cause (per-box CPU), to avoid fatigue and gaps. Keep detailed dashboards for diagnosis after an alert fires, but the alerting layer should be a few meaningful, symptom-based rules tied to user experience. Quality and intent beat quantity — measure what reflects user pain and impending failure, and make those few signals page you."
}
```

Effective metrics = a **small set of golden signals** (latency/traffic/errors/saturation), measured as
**percentiles**, **alerted on symptoms** tied to SLOs — not a sprawl of cause-based graphs. Watch
**cardinality** (cost), and use logs/traces for per-request detail.

## Self-test

```quiz
{
  "question": "The four 'golden signals' to monitor for a service are:",
  "options": [
    "CPU, memory, disk, network",
    "Latency, traffic, errors, saturation",
    "Logs, metrics, traces, alerts",
    "Reads, writes, deletes, updates"
  ],
  "answer": 1,
  "explanation": "Latency, traffic, errors, and saturation capture user-facing health and impending failure for request-serving services."
}
```

```quiz
{
  "question": "You should generally alert on:",
  "options": [
    "Every server's CPU usage",
    "User-facing symptoms (error rate, p99 latency, availability vs SLO), not every internal cause",
    "The number of log lines",
    "Each deploy"
  ],
  "answer": 1,
  "explanation": "Symptom-based alerts on golden signals/SLOs catch real user impact; cause-based alerts (e.g. CPU) cause fatigue and miss outages."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Metrics & golden signals — key terms", "cards": [ { "front": "Metric", "back": "A numeric measurement sampled over time (e.g. requests/sec, error %, p99 latency). Cheap, aggregated, and trend-friendly — ideal for dashboards and alerts, unlike per-event logs." }, { "front": "The four golden signals", "back": "Latency, traffic, errors, and saturation. Google SRE's set covering most of what matters for a request-serving service's health and impending failure." }, { "front": "Saturation", "back": "How 'full' the system is — CPU/memory/queue depth versus capacity. The golden signal that warns of impending failure as resources run out." }, { "front": "Why p95/p99 over averages?", "back": "Averages hide the tail: a 50 ms average can mask a p99 of 3 s that many users feel. Percentiles expose slow experiences driving complaints and SLO breaches." }, { "front": "Alert on symptoms, not causes", "back": "Page on user-facing signals (error rate, latency, availability vs SLO), not internal causes (one box's CPU). Cause-based alerts cause fatigue and miss real outages." }, { "front": "Cardinality cost", "back": "Every unique label combination is a separate time series. High-cardinality labels (user_id, request_id) explode storage/cost — keep labels low-cardinality; use logs/traces for per-request detail." }, { "front": "Counters / gauges / histograms", "back": "Counters: monotonic totals (requests, errors). Gauges: point-in-time levels (memory, queue depth). Histograms: distributions yielding percentiles like p99." } ] }
```

## Key takeaways

- **Metrics** are cheap, aggregated **numbers over time** — for **trends, dashboards, and alerts** (vs
  logs for per-event detail).
- Focus on the **golden signals**: **latency** (as **p95/p99**, success vs error separated),
  **traffic**, **errors**, **saturation**.
- **Alert on symptoms** (user-facing signals tied to **SLOs/error budgets**), not on every internal
  cause; mind **cardinality** (cost).
- Types: **counters** (totals), **gauges** (levels), **histograms** (percentiles) — and pivot
  metric → trace → logs.

## Up next

A specific, vital metric/signal: is the service even alive and ready? Next: **Health Checks &
Heartbeats**.
