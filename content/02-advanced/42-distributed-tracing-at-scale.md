---
title: "Distributed Tracing at Scale"
slug: distributed-tracing-at-scale
level: advanced
module: operability-and-patterns
order: 42
reading_time_min: 14
concepts: [distributed-tracing, opentelemetry, context-propagation, sampling, trace-storage, span-attributes]
use_cases: []
prerequisites: [distributed-tracing, observability-fundamentals, high-cardinality-data]
status: published
---

# Distributed Tracing at Scale

## Hook — a motivating scenario

Tracing one request across services is straightforward (recall distributed tracing). Now do it for
**millions of requests per second across hundreds of services**: storing every span is prohibitively
expensive, propagating context across every protocol (HTTP, gRPC, queues, async jobs) is fiddly, and
finding the *one* slow trace among billions is its own problem. Production tracing is less about the
concept and more about **instrumentation standardization, context propagation everywhere, sampling, and
storage** at scale.

## Mental model — the same trace/span model, industrialized

The core model is unchanged (recall: a **trace** is a tree of timed **spans** joined by a propagated
**trace context**). At scale, the engineering challenges are operational:

```flow
{
  "title": "Production tracing pipeline",
  "nodes": [
    { "label": "Instrument (OpenTelemetry)", "detail": "Standardized SDKs/auto-instrumentation emit spans with attributes — one vendor-neutral standard across all services/languages." },
    { "label": "Propagate context everywhere", "detail": "Pass trace context across HTTP, gRPC, AND async boundaries (queues, jobs) — or the trace breaks." },
    { "label": "Collect (OTel Collector)", "detail": "Agents/collectors receive, batch, process, and SAMPLE spans before export." },
    { "label": "Store & query (backend)", "detail": "Jaeger/Tempo/Datadog — store sampled traces; search by service, latency, error, attributes." }
  ],
  "note": "Concept unchanged; the work is standardization, propagation across all boundaries, sampling, and affordable storage/query."
}
```

## Build it up — OpenTelemetry and propagation across all boundaries

- **OpenTelemetry (OTel)** is the **vendor-neutral standard** for instrumentation (traces + metrics +
  logs): one set of SDKs / auto-instrumentation and a wire format, so you instrument **once** and export
  to **any backend** — avoiding per-vendor lock-in and per-language reinvention (recall: a mesh can also
  auto-inject some of this).
- **Context propagation must cover *every* boundary** — not just synchronous HTTP/gRPC (via **W3C
  `traceparent`**, recall), but **asynchronous** ones too: message queues, event streams, background
  jobs, scheduled tasks. If a service publishes to Kafka and a consumer processes it, the **trace
  context must travel in the message metadata** or the trace **breaks** at the async hop (you get two
  disconnected traces).

```reveal
{
  "prompt": "Why is propagating trace context across asynchronous boundaries (queues, events, background jobs) harder than across synchronous HTTP calls, and what happens if you don't?",
  "answer": "Synchronous calls make propagation relatively easy: the caller is actively making a request and can inject the trace context into the HTTP/gRPC headers (W3C traceparent), and the callee extracts it immediately and continues the trace as a child span — request and response are tightly coupled in time and code. Asynchronous boundaries break that coupling, which makes propagation harder in several ways: (1) The producer and consumer are decoupled in time and code — the producer publishes a message/event and moves on; the consumer processes it later, possibly much later, on a different machine, so there's no live call to attach headers to. You must explicitly serialize the trace context INTO the message itself (its metadata/headers/payload envelope) and have the consumer deserialize and resume from it. (2) Messaging systems and their client libraries don't always have standard, automatic header propagation the way HTTP frameworks do, so it often requires manual or library-specific instrumentation to inject/extract context in producers and consumers. (3) Fan-out/batching complicates the span model — one message may be consumed by many consumers, or many messages batched into one processing step, so the parent/child relationships (and span links) need care. (4) The large time gap between produce and consume affects how you model spans (often using span links rather than a simple parent-child, since the consumer work isn't synchronously 'under' the producer). If you DON'T propagate across the async hop, the trace BREAKS at that boundary: the producer's spans form one trace and the consumer's spans form a separate, disconnected trace with no shared trace ID/parent linkage. You then lose end-to-end visibility precisely where it's often most valuable — you can't see that 'this slow background job belongs to that user request,' can't follow a request through a queue into downstream processing, and can't diagnose latency/failures that span the async boundary. So async propagation requires deliberately carrying the trace context in message metadata and instrumenting producers/consumers (OpenTelemetry provides conventions and instrumentation for common brokers), because unlike HTTP it isn't a natural side effect of the call — and skipping it fragments your traces exactly at the decoupled hops that distributed systems rely on."
}
```

## Build it up — sampling and storage economics

Storing **every** span at millions of req/s is **prohibitively expensive** (and most traces are boring
successes), so you **sample** (recall):
- **Head-based sampling:** decide at the trace's **start** (e.g. keep 1%) — cheap, but likely **misses
  rare errors/slow traces**.
- **Tail-based sampling:** **buffer spans and decide after** the trace completes — **keep all
  errored/slow traces**, sample the boring ones. Far better signal-per-stored-trace, at the cost of
  buffering machinery (next chapter goes deep).
- **Storage/economics:** sampled traces still need scalable, cost-tiered storage (hot recent, cold old —
  recall tiering); you index by **service, operation, latency, error, and span attributes** to find the
  needle. Beware **high-cardinality attributes** on spans (recall) inflating storage/index.

```reveal
{
  "prompt": "Why is sampling essential for production tracing, and how do you avoid 'sampling away' exactly the traces you need to debug?",
  "answer": "Sampling is essential because tracing every request at scale is prohibitively expensive on multiple axes: each span adds CPU/latency overhead in the service, and emitting, transporting, storing, and indexing billions of spans/day costs enormous money and infrastructure — and the vast majority of traces are unremarkable successes that no one will ever look at, so storing them all is mostly waste. So you keep a subset. The risk is that naive sampling discards the rare, interesting traces (errors, slow outliers) that are precisely what you need for debugging — and those are by definition uncommon (e.g. 1-in-1000), so simple head-based random sampling (decide at the start to keep ~1%) will very likely drop them. You avoid 'sampling away' the important traces mainly with tail-based sampling: buffer a trace's spans until it completes, then make the keep/drop decision based on the FULL trace — always keep traces that errored, exceeded a latency threshold, hit specific critical endpoints, or are otherwise notable, while sampling the boring fast-successes down to a small fraction. This biases retention toward the traces that matter, giving high diagnostic value per stored trace, at the cost of more machinery (you must buffer spans across services until the decision, which needs collectors with enough memory/coordination). Complementary tactics: keep 100% of error traces (or use higher sample rates for error/slow paths), use dynamic/adaptive sampling that raises rates during incidents, ensure a request's whole trace is sampled consistently (head-based decisions propagated so you don't keep partial traces), and always retain enough metrics/logs (which are cheaper to keep more fully) so you can detect problems and then pivot to whatever traces you did keep. So: sample to make tracing affordable, but use tail-based (and error/latency-biased) sampling so the decision favors the rare errored/slow traces — turning 'keep a random slice' into 'keep the slice worth keeping.' The next chapter details tail-based sampling specifically."
}
```

Sampling is a dial between cost and signal — slide from cheapest to richest:

```tradeoff
{ "title": "How should you sample traces at scale?", "axis": { "left": "Cheapest / coarsest", "right": "Richest signal / most machinery" }, "steps": [
  { "label": "Head-based, low rate", "detail": "Decide at the trace's start to keep a small fraction (e.g. 1%). Cheapest and simplest, but likely misses the rare errors and slow traces you most want to debug." },
  { "label": "Head-based, higher rate", "detail": "Keep a larger fraction up front. More likely to catch rare traces, but storage and indexing cost scales up and most kept traces are still boring successes." },
  { "label": "Tail-based sampling", "detail": "Buffer spans and decide after the trace completes: keep all errored/slow traces, sample the boring ones. Far better signal per stored trace, at the cost of buffering machinery." }
] }
```

## In the wild

- **OpenTelemetry** is the de-facto standard (SDKs, auto-instrumentation, the **OTel Collector** for
  receive/process/sample/export); backends: **Jaeger, Grafana Tempo, Zipkin, Datadog/Honeycomb APM**.
- **Service meshes** (recall) can auto-generate spans for service-to-service hops; combine with app-level
  instrumentation for full coverage.
- **Tail-based sampling** (next chapter) is implemented in the OTel Collector / vendors to retain
  error/slow traces.
- **Trace ↔ logs ↔ metrics correlation** via the shared **trace ID** (recall observability) lets you
  pivot metric alert → trace → logs at scale.

## Common misconception — "tracing is the same whether you have 3 services or 300 / just turn it on"

The concept is identical; **at scale it's an engineering effort** — standardize instrumentation,
propagate across all boundaries, sample, and budget storage.

```reveal
{
  "prompt": "Why does distributed tracing become a significant engineering effort at scale, even though the trace/span concept is unchanged?",
  "answer": "Because the concept being simple (a trace is a tree of timed spans joined by propagated context) doesn't make the production realities simple — at hundreds of services and millions of req/s, several hard engineering problems appear that don't exist at toy scale. (1) Instrumentation standardization: you must instrument every service, in every language, consistently, or you get gaps and incompatible data — which is why OpenTelemetry (vendor-neutral SDKs/auto-instrumentation + wire format) matters; rolling your own or mixing vendors per-language is unsustainable. (2) Context propagation EVERYWHERE: it's not just HTTP/gRPC (W3C traceparent); you must carry context across async boundaries — message queues, event streams, background jobs, scheduled tasks — by serializing it into message metadata and instrumenting producers/consumers, or traces fragment at every async hop. Covering all those boundaries across a large estate is real, ongoing work. (3) Sampling: storing every span is prohibitively expensive (per-span overhead + storing/indexing billions of spans), so you must implement sampling — ideally tail-based to retain errored/slow traces — which needs collectors that buffer and decide, plus policies. (4) Storage and query economics: even sampled, traces need scalable, cost-tiered storage and indexing by service/latency/error/attributes to find the one trace you need among billions, while avoiding high-cardinality attribute blowup. (5) Pipeline operations: running collectors/agents, handling backpressure, ensuring overhead stays low, and correlating traces with logs/metrics via shared IDs. None of this is needed when you have 3 services and low traffic ('just turn it on' works there). At scale, tracing is a system you build and operate — standardize (OTel), propagate across all boundaries, sample intelligently, and budget/tier storage — not a switch you flip. The misconception is treating the conceptual simplicity as operational simplicity; the value (end-to-end visibility across hundreds of services) is exactly what makes the engineering non-trivial."
}
```

At scale, the **trace/span concept is unchanged**, but production tracing is an **engineering effort**:
**standardize instrumentation (OpenTelemetry)**, **propagate context across *all* boundaries** (HTTP/
gRPC **and** queues/jobs — or traces break), **sample** (head- or **tail-based**) since storing every
span is too costly, and **store/query affordably** (tiering, attribute indexing, watch cardinality).

## Self-test

```quiz
{
  "question": "A common reason traces 'break' (fragment into disconnected pieces) at scale is:",
  "options": [
    "Too many spans per trace",
    "Failing to propagate trace context across asynchronous boundaries (queues, events, background jobs), not just HTTP/gRPC",
    "Using OpenTelemetry",
    "Sampling too little"
  ],
  "answer": 1,
  "explanation": "Context must travel in message metadata across async hops too; otherwise the producer and consumer spans form separate, disconnected traces."
}
```

```quiz
{
  "question": "OpenTelemetry's main value for production tracing is:",
  "options": [
    "It stores traces for free",
    "A vendor-neutral instrumentation standard (SDKs/auto-instrumentation + wire format) so you instrument once and export to any backend",
    "It eliminates the need for sampling",
    "It guarantees 100% trace retention"
  ],
  "answer": 1,
  "explanation": "OTel standardizes instrumentation across languages/services and decouples it from any one vendor's backend — instrument once, export anywhere."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Distributed tracing at scale — key terms", "cards": [
  { "front": "OpenTelemetry (OTel)", "back": "The vendor-neutral standard for instrumentation (traces, metrics, logs): one set of SDKs/auto-instrumentation and wire format, so you instrument once and export to any backend." },
  { "front": "Context propagation", "back": "Passing trace context across every boundary so spans join into one trace — HTTP/gRPC via W3C traceparent and async hops (queues, events, jobs) via message metadata, or the trace breaks." },
  { "front": "Head-based sampling", "back": "Deciding whether to keep a trace at its start (e.g. keep 1%). Cheap, but likely misses rare errors and slow traces." },
  { "front": "Tail-based sampling", "back": "Buffering spans and deciding after the trace completes — keep all errored/slow traces, sample the boring ones. Better signal per stored trace, at the cost of buffering machinery." },
  { "front": "OTel Collector", "back": "An agent/collector that receives, batches, processes, and samples spans before exporting them to a backend." },
  { "front": "Why traces 'break'", "back": "Failing to propagate trace context across an async boundary: producer and consumer spans form separate, disconnected traces with no shared linkage." }
] }
```

## Key takeaways

- The **trace/span model is unchanged** at scale; production tracing is an **engineering effort** —
  standardize, propagate, sample, store.
- **OpenTelemetry** is the **vendor-neutral standard** (instrument once, export anywhere); **service
  meshes** can auto-generate service-to-service spans.
- **Propagate context across *every* boundary** — HTTP/gRPC **and async** (queues/events/jobs) via
  message metadata — or traces **fragment** at the async hop.
- **Sample** (storing every span is too costly) — **tail-based** keeps error/slow traces; store with
  **tiering + attribute indexing**, watching **cardinality**.

## Up next

The sampling strategy that keeps the *useful* traces. Next: **Tail-Based Sampling**.
