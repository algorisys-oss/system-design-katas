---
title: "Observability Fundamentals"
slug: observability-fundamentals
level: intermediate
module: observability
order: 28
reading_time_min: 14
concepts: [observability, monitoring, logs, metrics, traces, three-pillars]
use_cases: []
prerequisites: [monoliths-vs-microservices, latency-vs-throughput]
status: published
---

# Observability Fundamentals

## Hook — a motivating scenario

A user reports "the app is slow." In a monolith you'd check one log file. But your request now hops
through a gateway, three microservices, a cache, a queue, and two databases — *where* is it slow? Which
service? Which dependency? Without the right instrumentation you're blind, guessing, and restarting
things hoping it helps. **Observability** is the discipline of making a running system explain itself,
so you can answer "what's wrong and why" — fast.

## Mental model — can you ask new questions without shipping new code?

**Monitoring** tells you *whether* known things are healthy (predefined dashboards/alerts:
"CPU > 80%?"). **Observability** is broader: can you understand the system's internal state from its
outputs well enough to debug **problems you didn't anticipate** — to ask *new* questions after the
fact? You achieve it by emitting three complementary kinds of telemetry, the **"three pillars."**

```layers
{
  "title": "The three pillars of observability",
  "layers": [
    { "label": "Logs", "detail": "Discrete, timestamped event records ('order 123 failed: timeout'). Detail for a specific moment.", "meta": "events" },
    { "label": "Metrics", "detail": "Numeric measurements over time (request rate, error %, p99 latency, CPU). Aggregate trends + alerts.", "meta": "numbers" },
    { "label": "Traces", "detail": "The path of ONE request across services, with timing per hop. Finds WHERE the time/failure is.", "meta": "requests" }
  ]
}
```

## Build it up — what each pillar answers

- **Metrics** answer **"is something wrong, and what's the trend?"** — cheap, aggregated numbers over
  time (rates, percentiles) that power dashboards and alerts. They tell you *that* error rate spiked,
  but not *why*.
- **Traces** answer **"where in the request path is the problem?"** — they follow one request across
  every service/hop with per-span timing, pinpointing the slow or failing component (the slow-app
  scenario).
- **Logs** answer **"what exactly happened here?"** — detailed records for a specific event/moment,
  the fine-grained context once metrics/traces point you to the spot.

Used together: a **metric** alerts you, a **trace** localizes the offending service/hop, and **logs**
explain the specific failure. Each alone leaves a gap.

```reveal
{
  "prompt": "A request is slow across many microservices. Which pillar pinpoints WHERE the time goes, and why can't metrics or logs alone do it?",
  "answer": "Distributed tracing. A trace follows the single slow request end-to-end, recording a timed span for each service/hop, so you can see exactly which service (or DB/cache/queue call) consumed the time — e.g. 'gateway 5ms, service A 8ms, but service B's DB call took 900ms.' Metrics can tell you the system's p99 latency rose (that something is slow) but are aggregated, so they can't attribute one request's latency to a specific hop. Logs give detail at each service but are scattered and per-service, so correlating them into one request's path across services is painful without a shared trace/correlation ID. Tracing is purpose-built to reconstruct one request's journey and localize the bottleneck; metrics detect, traces localize, logs explain."
}
```

## Build it up — making telemetry useful

- **Correlation IDs** tie it together: stamp each request with an ID (a trace ID) propagated across all
  services, so you can jump from a metric alert → the trace → the relevant logs for *that* request.
- **Structured logs** (JSON key/values, not free text) are queryable/filterable at scale — far more
  useful than grepping prose.
- **Cardinality & cost** matter: high-cardinality labels (e.g. per-user metrics) and verbose logs get
  expensive; sample traces/logs and choose labels deliberately.
- **OpenTelemetry (OTel)** is the emerging standard for emitting all three pillars in a vendor-neutral
  way (deepened in the advanced course).

```reveal
{
  "prompt": "What's the difference between monitoring and observability, and why does the distinction matter for modern distributed systems?",
  "answer": "Monitoring is watching predefined signals to answer known questions — 'is CPU high? is the error rate above X? is the service up?' — via dashboards and alerts you set up in advance. Observability is the property that you can understand the system's internal state from its outputs (logs/metrics/traces) well enough to investigate problems you never anticipated — to ask new, ad-hoc questions after something weird happens. The distinction matters because distributed systems fail in unpredictable, emergent ways (a specific service slow only for one tenant, a cascading timeout, a rare interaction) that predefined dashboards won't have anticipated. Monitoring tells you something is wrong; observability lets you figure out the unknown 'why' by exploring rich, correlated telemetry. You need monitoring for alerting on the known, and observability to debug the unknown — modern systems require both."
}
```

## In the wild

- **Metrics:** Prometheus + Grafana, Datadog; track the "golden signals" (latency, traffic, errors,
  saturation — next chapter).
- **Logs:** structured logging → aggregation (ELK/OpenSearch, Loki, Splunk) for search across services.
- **Traces:** Jaeger, Tempo, Datadog APM; **OpenTelemetry** instruments all three.
- The workflow — **alert on a metric → open the trace → read correlated logs** — is how on-call
  engineers debug distributed systems; without it, microservices are undebuggable.

## Common misconception — "logging a lot = observability"

Volume isn't visibility; the three pillars together (correlated) are what make a system observable.

```reveal
{
  "prompt": "A team logs verbosely everywhere but still can't debug a cross-service slowdown. What's missing?",
  "answer": "Lots of logs ≠ observability. Their logs are per-service, unstructured, and uncorrelated, so reconstructing one request's path across services is nearly impossible — and logs alone can't show aggregate trends or per-hop timing. What's missing: metrics to detect and quantify the problem (p99 latency/error-rate trends, alerts) and distributed traces (with a propagated correlation/trace ID) to localize WHERE in the request path the time goes. They also likely need structured logs tied to that trace ID so they can pivot from a trace to the exact logs for that request. Observability comes from the three pillars working together — detect (metrics) → localize (traces) → explain (logs) — connected by correlation IDs, not from sheer log volume. More logging without metrics, tracing, and correlation just adds noise and cost."
}
```

Observability = **logs + metrics + traces, correlated** — enabling you to investigate *unanticipated*
problems. Logging volume alone gives noise, not answers; you need all three pillars tied together (by
trace/correlation IDs).

## Self-test

```quiz
{
  "question": "Match the question to the pillar: 'Where in the multi-service request path is the latency?' is best answered by:",
  "options": ["Logs", "Metrics", "Traces", "Backups"],
  "answer": 2,
  "explanation": "Distributed traces follow one request across services with per-hop timing, localizing the slow/failing component."
}
```

```quiz
{
  "question": "The difference between monitoring and observability is best stated as:",
  "options": [
    "They are the same thing",
    "Monitoring watches predefined signals (known questions); observability lets you investigate unanticipated problems by exploring correlated telemetry",
    "Observability only means logging",
    "Monitoring requires tracing"
  ],
  "answer": 1,
  "explanation": "Monitoring answers known questions via preset dashboards/alerts; observability is understanding internal state to ask new questions."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Observability fundamentals — key terms", "cards": [ { "front": "Observability", "back": "Understanding a system's internal state from its outputs well enough to debug problems you didn't anticipate — to ask new questions after the fact." }, { "front": "Monitoring vs observability", "back": "Monitoring watches predefined signals to answer known questions via preset dashboards/alerts; observability lets you investigate unanticipated problems by exploring correlated telemetry." }, { "front": "Metrics", "back": "Numeric measurements over time (request rate, error %, p99 latency, CPU). Cheap aggregates that power dashboards and alerts: detect that something is wrong and the trend." }, { "front": "Traces", "back": "The path of one request across services, with per-hop (span) timing. Localizes where in the request path the latency or failure is." }, { "front": "Logs", "back": "Discrete, timestamped event records. Detailed context for a specific moment — explain exactly what happened once metrics/traces point you to the spot." }, { "front": "Correlation / trace IDs", "back": "An ID stamped on each request and propagated across all services, so you can pivot from a metric alert to the trace to the relevant logs for that request." } ] }
```

## Key takeaways

- **Observability** = understanding a system's internal state from its outputs well enough to debug
  **unanticipated** problems (broader than **monitoring**, which watches known signals).
- The **three pillars**: **metrics** (detect/trend + alert), **traces** (localize where in the request
  path), **logs** (explain the specific event) — each fills a gap the others leave.
- **Correlation/trace IDs + structured logs** tie them together; the on-call workflow is **metric →
  trace → logs**.
- Distributed systems are **undebuggable without it** — and volume ≠ visibility; you need all three,
  correlated.

## Up next

Let's detail each pillar, starting with the most familiar. Next: **Logging**.
