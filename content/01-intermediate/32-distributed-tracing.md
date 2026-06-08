---
title: "Distributed Tracing"
slug: distributed-tracing
level: intermediate
module: observability
order: 32
reading_time_min: 14
concepts: [distributed-tracing, trace, span, context-propagation, opentelemetry, sampling]
use_cases: []
prerequisites: [observability-fundamentals, monoliths-vs-microservices]
status: published
---

# Distributed Tracing

## Hook — a motivating scenario

A checkout request is slow — sometimes. It passes through the gateway, the order service, payments,
inventory, a cache, and two databases. Metrics show p99 latency is up; logs in each service look fine
individually. But *which* hop is slow, and is it slow because of its *own* work or because it's waiting
on a downstream call? You can't tell by staring at six separate services. **Distributed tracing**
stitches one request's journey across all of them into a single timeline.

## Mental model — one request's timeline across services

A **trace** represents one request's end-to-end path; it's made of **spans** — each span is one unit
of work (a service handling the request, a DB query, an outbound call) with a **start/end time** and a
**parent**. Spans nest into a tree, so you see the whole call hierarchy and exactly where time goes.

```sequence
{
  "title": "One trace = nested spans across services",
  "actors": ["Gateway", "Order", "Payments", "DB"],
  "steps": [
    { "from": "Gateway", "to": "Order", "label": "span: handle checkout (trace_id=abc)" },
    { "from": "Order", "to": "Payments", "label": "child span: charge" },
    { "from": "Order", "to": "DB", "label": "child span: save order (slow! 900ms)" },
    { "from": "DB", "to": "Order", "label": "done" },
    { "from": "Order", "to": "Gateway", "label": "response — trace shows DB span dominated" }
  ]
}
```

## Build it up — context propagation is the magic

For spans across different services to join into one trace, each service must pass a **trace context**
(the **trace ID** + the current **span ID** as parent) to the next service — usually via HTTP headers
(W3C `traceparent`) or message metadata. Every service reads the incoming context, creates its child
span under the same trace ID, and forwards it onward. **Without propagation, you get disconnected
single-service spans, not a trace.**

This is the same **correlation/trace ID** from observability fundamentals — propagated so all spans
(and logs) for one request share it.

```reveal
{
  "prompt": "What single mechanism makes spans recorded in six different services assemble into one coherent trace, and what happens without it?",
  "answer": "Context propagation: the trace context (trace ID + parent span ID) is passed from each service to the next — typically injected into outbound HTTP headers (W3C traceparent) or message metadata, and extracted by the receiver, which starts its span as a child under the same trace ID. Because every span carries the shared trace ID and a parent pointer, the tracing backend can reassemble them into the correct nested tree spanning all services. Without propagation, each service still records spans, but they have no shared trace ID or parent linkage, so they're isolated per-service fragments — you can't tell which payments span belongs to which checkout request, and you lose the end-to-end timeline (the whole point). Propagation is what turns per-service spans into a distributed trace; it must be implemented consistently across every hop (and across protocol boundaries like HTTP→queue) or the trace breaks at the gap."
}
```

## Build it up — what tracing reveals, and sampling

A trace timeline immediately shows:
- **Which service/hop is slow** — the span that dominates the duration (the DB span above).
- **Self time vs waiting** — whether a service is slow doing its own work or blocked on a downstream
  call (parent span long, but mostly a child span).
- **The full dependency path** — including surprises (an N+1 of DB spans, an unexpected extra call).
- **Where it failed** — the span that errored, with its context.

**Sampling** keeps it affordable: tracing every request at scale is expensive (storage + overhead), so
you sample — **head-based** (decide at the start, e.g. 1%) or **tail-based** (decide after, keeping all
slow/errored traces — advanced course). You accept seeing a subset, biased toward the interesting ones.

```reveal
{
  "prompt": "Why can't you just trace 100% of requests in a high-traffic system, and how does tail-based sampling improve on naive 1% sampling?",
  "answer": "Tracing every request is costly: each adds per-span overhead (CPU/latency) in every service and generates huge volumes of trace data to ship, store, and index — at millions of req/s this is prohibitive. So you sample. Naive head-based sampling decides at the request's start to keep, say, 1% at random — cheap, but you'll likely miss the rare slow or errored requests you most want (they're 1-in-1000, and random 1% probably drops them). Tail-based sampling instead buffers spans and decides AFTER the request completes, keeping traces that are interesting — errors, high latency, specific endpoints — while sampling the boring fast-success ones down. So you get near-complete visibility into problems (the traces that matter for debugging) without storing everything. The trade is more machinery (you must buffer spans until the decision) and complexity, but far better signal per stored trace. (Tail-based sampling is detailed in the advanced course.)"
}
```

Sampling is a dial between cost and visibility — slide it from cheapest to most informative:

```tradeoff
{ "title": "How should you sample traces at scale?", "axis": { "left": "Lowest cost / overhead", "right": "Best signal per trace" }, "steps": [ { "label": "Trace 100%", "detail": "Capture every request — complete visibility, but per-span overhead in every service plus huge volumes to ship, store, and index make it prohibitive at millions of req/s." }, { "label": "Head-based 1%", "detail": "Decide at the request's start to keep ~1% at random. Cheap and simple, but you likely miss the rare slow or errored requests you most want to debug." }, { "label": "Tail-based", "detail": "Buffer spans and decide after the request completes, keeping interesting traces (errors, high latency) and dropping boring fast successes — near-complete visibility into problems, at the cost of more machinery." } ] }
```

## In the wild

- **OpenTelemetry (OTel)** is the vendor-neutral standard for instrumenting traces (and metrics/logs);
  backends include **Jaeger, Tempo, Zipkin, Datadog APM**.
- **W3C Trace Context** (`traceparent` header) standardizes propagation across services/vendors.
- Tracing is the pillar that makes **microservices debuggable** (recall observability fundamentals:
  metrics detect → traces localize → logs explain).
- Put the **trace ID in your logs** so you can jump from a trace to the exact logs for that request.

## Common misconception — "tracing is just logging with extra steps"

Tracing's value is the **connected, timed, cross-service structure** — which logs don't give you.

```reveal
{
  "prompt": "Why isn't distributed tracing just 'logging that the request entered/left each service'?",
  "answer": "Because tracing provides structure, timing, and automatic cross-service correlation that ad-hoc logs don't. A trace is a tree of timed spans with parent/child relationships and propagated context, so the backend reconstructs the exact end-to-end timeline and call hierarchy of ONE request — showing which hop dominated, self-time vs downstream waiting, and where it errored, visualized as a waterfall. Doing this with logs would require manually emitting consistent start/end timestamps and a propagated correlation ID in every service, then writing tooling to parse, join, order, and compute durations across all of them into a hierarchy — essentially rebuilding tracing by hand, fragilely. Logs are great for detailed point-in-time context within a service; tracing is purpose-built for the cross-service request timeline. They're complementary (and you link them via the shared trace ID), but tracing isn't just verbose logging — it's a different, structured model that answers 'where did the time go across services?' which scattered logs can't."
}
```

Distributed tracing reconstructs **one request's timed, nested path across all services** via
**context propagation** — localizing where time/failures occur. It's structurally different from (and
complementary to) logs, and **sampling** keeps it affordable.

## Self-test

```quiz
{
  "question": "A trace is composed of spans, where a span is:",
  "options": [
    "A log line",
    "One timed unit of work (a service handling the request, a DB call) with a parent, nested into the request's tree",
    "A metric counter",
    "A health check"
  ],
  "answer": 1,
  "explanation": "Spans are timed work units with parent/child links; nested, they form the trace = one request's end-to-end timeline."
}
```

```quiz
{
  "question": "Spans from different services join into one trace because of:",
  "options": [
    "Shared CPU",
    "Context propagation — the trace ID (+ parent span) is passed between services (e.g. via traceparent header)",
    "Running on the same machine",
    "Using the same database"
  ],
  "answer": 1,
  "explanation": "Each service propagates the trace context so its spans share the trace ID and link under the right parent; without it, spans are disconnected."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Distributed tracing — key terms", "cards": [ { "front": "Trace", "back": "The end-to-end path of one request across all services, made of nested spans assembled into a single timeline/tree." }, { "front": "Span", "back": "One timed unit of work (a service handling a request, a DB query, an outbound call) with a start/end time and a parent." }, { "front": "Context propagation", "back": "Passing the trace context (trace ID + parent span ID) from each service to the next — via HTTP headers or message metadata — so spans join into one trace." }, { "front": "W3C Trace Context (traceparent)", "back": "The standard header that carries trace context across services and vendors, making propagation interoperable." }, { "front": "Head-based vs tail-based sampling", "back": "Head-based decides at the request's start (e.g. keep 1% at random); tail-based decides after completion, keeping slow/errored traces while dropping boring ones." }, { "front": "OpenTelemetry (OTel)", "back": "The vendor-neutral standard for instrumenting traces (and metrics/logs); backends include Jaeger, Tempo, Zipkin, and Datadog APM." } ] }
```

## Key takeaways

- **Distributed tracing** stitches one request's path across services into a timeline of **spans**
  (timed, nested work units) — localizing where time/failures occur.
- **Context propagation** (passing the **trace ID + parent span**, e.g. via `traceparent`) is what
  joins per-service spans into one trace — without it you get disconnected fragments.
- Traces reveal **which hop is slow, self-time vs waiting, the full path, and where it failed** — the
  "localize" step of observability.
- **Sampling** (head- or tail-based) makes it affordable; **OpenTelemetry** standardizes
  instrumentation; put the **trace ID in logs**.

## Up next

That completes observability. Distributed systems also need deliberate testing to trust them. Next
module: **Testing Fundamentals for Systems**.
