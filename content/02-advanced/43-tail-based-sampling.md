---
title: "Tail-Based Sampling"
slug: tail-based-sampling
level: advanced
module: operability-and-patterns
order: 43
reading_time_min: 13
concepts: [tail-based-sampling, head-based-sampling, trace-buffering, decision-after-completion, signal-per-trace]
use_cases: []
prerequisites: [distributed-tracing-at-scale, distributed-tracing]
status: published
---

# Tail-Based Sampling

## Hook — a motivating scenario

You sample 1% of traces to keep costs sane. Then a customer reports intermittent 3-second checkouts —
and you search your traces and… the slow ones aren't there. Of course: random 1% sampling decided
*before* the request finished, so it kept boring fast traces and threw away the rare slow/errored ones
you actually need. **Tail-based sampling** fixes exactly this: decide what to keep **after** the trace
completes, so you keep the **interesting** traces — not a random slice.

## Mental model — decide after you've seen the whole trace

Think of a security camera system. **Head-based** sampling is like throwing away 99% of the footage *at
the moment it's recorded* — so the one clip that shows the break-in is almost certainly gone. **Tail-based**
sampling keeps everything briefly, then *after* the event reviews the recording and decides to archive the
clips that show something interesting (the break-in, the alarm) and discards the boring empty-hallway ones.
You only know which footage is worth keeping once you've seen what happened.

The sampling decision can happen at two times:
- **Head-based:** decide **at the start** of the trace (e.g. random 1%), before you know anything about
  it. Cheap and simple, but **blind** — it can't preferentially keep errors/slow traces because they
  haven't happened yet.
- **Tail-based:** **buffer all the spans** of a trace, wait until it **completes**, then **decide based
  on the whole trace** — keep it if it **errored, was slow, hit a critical endpoint**, or is otherwise
  interesting; sample the boring fast-successes down to a small fraction.

```compare
{
  "options": [
    { "label": "Head-based sampling", "points": ["Decide at trace START (e.g. random 1%)", "Cheap, stateless, low overhead", "BLIND — likely drops rare errors/slow traces", "Good for cost control when any sample suffices"] },
    { "label": "Tail-based sampling", "points": ["Buffer spans, decide AFTER trace completes", "Keep errored/slow/critical traces; sample boring ones", "Far higher signal-per-stored-trace", "Costs buffering memory + coordination"] }
  ]
}
```

## Build it up — why it's harder (and worth it)

Tail-based sampling's value is obvious — keep the traces worth keeping — but it's **harder to
implement**, because you must **hold a trace's spans until it finishes** before deciding:
- **Buffering:** spans for in-flight traces are **buffered in memory** (in the collector) until the trace
  completes or times out — costing memory and adding complexity.
- **Distributed assembly:** a trace's spans come from **many services** and arrive at **different
  collectors** at different times; tail sampling needs all of a trace's spans to reach the **same place**
  to decide on the whole trace (e.g. route spans by trace ID to a consistent collector). This
  coordination is the hard part at scale.
- **Decision latency / timeout:** you must wait "long enough" for the trace to finish (bounded by a
  timeout) before deciding — adding delay and the risk of incomplete traces.

The payoff: **dramatically better signal per stored trace** — you keep ~100% of errors and slow
outliers (the ones you debug with) while storing only a fraction of the boring traffic.

```reveal
{
  "prompt": "Why is tail-based sampling significantly harder to implement than head-based, despite being more useful?",
  "answer": "Because the keep/drop decision depends on the COMPLETED trace, you have to hold and assemble the whole trace before deciding — which introduces buffering, distributed coordination, and timing problems that head-based sampling entirely avoids. Head-based decides at the start with a stateless coin flip (keep this trace ID or not) and propagates that decision, so each service independently knows whether to record spans — no buffering, no coordination, negligible overhead. Tail-based can't decide up front (the request hasn't errored or gone slow yet), so: (1) Buffering — you must retain all spans of every in-flight trace in memory until the trace completes (or a timeout fires), which consumes substantial memory at high throughput and requires eviction/timeout handling for traces that never cleanly finish. (2) Distributed assembly — a single trace's spans are produced by many services and arrive at different collector instances at different times; to decide based on the WHOLE trace, all of its spans must be brought together in one place. That typically means routing spans consistently by trace ID (e.g. hashing trace ID to a specific collector) so every span of a trace lands on the same decider — a non-trivial sharding/coordination layer, and one that must handle rebalancing, collector failures, and load. (3) Decision latency and incomplete traces — you must wait 'long enough' for the trace to finish before deciding, bounded by a timeout; set it too short and you decide on incomplete traces (possibly missing the error span that occurs late), too long and you buffer more and delay export. (4) Resource scaling — buffering + assembly must scale with traffic and trace duration, making the collector tier stateful and heavier than the stateless head-based path. So tail-based trades simple, cheap, stateless sampling for a stateful pipeline that buffers, shards-by-trace-ID, and times out — the cost of being able to look at the finished trace and keep the interesting ones. It's worth it because the signal-per-stored-trace is vastly higher (you retain the errors/slow outliers you actually debug with instead of a random slice), but that benefit is precisely why it's harder: useful decisions require complete information, and gathering complete information across a distributed system before deciding is the hard part."
}
```

Tuning the decision timeout is itself a dial between completeness and cost:

```tradeoff
{ "title": "How long should tail sampling wait before deciding?", "axis": { "left": "Short timeout", "right": "Long timeout" }, "steps": [
  { "label": "Very short", "detail": "Decide quickly to free buffer memory and export fast, but you risk deciding on incomplete traces — possibly missing a late error span or under-counting latency." },
  { "label": "Moderate", "detail": "Wait long enough for most traces to finish before deciding, balancing buffer memory and decision latency against the chance of an incomplete trace." },
  { "label": "Long", "detail": "Wait until traces are almost certainly complete, so decisions see the whole trace — but you buffer more spans in memory and add delay before export." }
] }
```

## Build it up — using both, and policies

In practice you often **combine** strategies and define **policies**:
- **Hybrid:** a cheap **head-based** pre-filter to cut raw volume, then **tail-based** on what remains to
  keep the interesting ones — balancing cost and signal.
- **Tail policies:** keep **100% of errors**, **100% above a latency threshold**, a **% of each endpoint**
  (so every operation is represented), more from **critical services**, and a small **random baseline**
  of successes (for "what does normal look like?"). 
- **Always retain enough cheaper signals:** **metrics** (cheap to keep fully) detect problems and
  **logs** add detail, so even when a specific trace was sampled out, you can still alert and pivot
  (recall the three pillars).

```reveal
{
  "prompt": "What policies make tail-based sampling effective, and why still keep a small random sample of 'boring' successful traces?",
  "answer": "Effective tail-based policies bias retention toward diagnostic value while staying affordable: (1) Keep 100% of error traces — failures are rare and are exactly what you debug, so never sample them away. (2) Keep 100% (or a high fraction) of traces above a latency threshold / slow outliers — the p99 tail is where performance problems live and where head-based sampling fails you. (3) Keep a representative percentage of EACH endpoint/operation and more from CRITICAL services, so no important code path is invisible just because it's low-volume. (4) Optionally raise rates dynamically during incidents. (5) Keep only a small fraction of the boring fast-success traffic. The reason to STILL keep a small random sample of normal, successful traces is that you need a baseline of 'what healthy looks like' to make the interesting traces interpretable and to support comparison and analysis: without normal traces you can't tell whether a slow trace is unusually slow (no baseline distribution to compare against), you can't characterize typical latency/structure, you can't spot gradual regressions or do statistical analysis across all traffic, and you lose representative examples for capacity planning, dependency mapping, and understanding common paths. Errors and outliers tell you about problems; the random baseline tells you about normal behavior, and you need both to reason well (e.g. 'this checkout took 3s, but the baseline p50 is 200ms' requires having baseline traces). The small random sample is cheap (a tiny fraction of the dominant successful traffic) yet provides essential context, so good policies always reserve some budget for it. Combined, these policies maximize signal-per-stored-trace (near-complete coverage of errors/slow/critical, full endpoint representation, plus a normal baseline) at a fraction of full-retention cost — and you back it with fully-retained metrics and logs so detection and pivoting still work even for traces that were sampled out."
}
```

## In the wild

- **OpenTelemetry Collector** has a **tail-sampling processor** (policies: latency, status_code,
  string-attribute, probabilistic, rate-limiting); vendors (Datadog, Honeycomb's "Refinery", Grafana)
  implement tail sampling.
- **Routing spans by trace ID** to a consistent collector (so a whole trace is decided together) is the
  standard scaling technique.
- It's the production answer to "I sampled and lost my slow traces" (recall distributed tracing at
  scale); pairs with **fully-retained metrics/logs** for detection.
- **Honeycomb/observability-2.0** approaches lean on **wide events + tail sampling** to keep
  high-cardinality, high-value data affordable (recall high-cardinality data).

## Common misconception — "any sampling loses the traces you need / head-based 1% is good enough"

Tail-based sampling specifically **keeps** the rare error/slow traces — the whole point is to *not* lose
them.

```reveal
{
  "prompt": "Rebut both 'sampling means I'll lose the traces I need' and 'head-based 1% is fine.'",
  "answer": "'Sampling means I'll lose the traces I need' is only true of NAIVE (head-based, random) sampling; tail-based sampling exists precisely to avoid it. Because tail-based decides AFTER the trace completes, it can look at the finished trace and deliberately KEEP the ones you need — errors, slow outliers, critical-endpoint traces — while sampling away the boring fast-successes. So with proper policies you retain ~100% of errors and slow traces (the ones you debug with) and still cut overall volume dramatically; you lose boring traffic, not signal. Sampling done well increases signal-per-stored-trace rather than destroying it. 'Head-based 1% is fine' is the specific failure this fixes: head-based decides at the START with a blind random coin flip, before the request has errored or gone slow, so it keeps a random 1% — which, for a 1-in-1000 slow/error trace, will almost always drop exactly the trace you go looking for (as in the 'customer reports 3s checkouts but the slow traces aren't in my sample' scenario). Random 1% is fine ONLY when any representative sample suffices (e.g. broad performance baselining) and you don't need guaranteed capture of rare events. When you need to debug specific errors/slow requests — the usual reason you reach for a trace — head-based 1% is precisely NOT good enough, because it has no way to preferentially keep rarities. The correct mental model: sampling is necessary for cost at scale, but WHICH sampling matters enormously — use tail-based (or a head pre-filter + tail) with policies that retain errors/slow/critical traces plus a small normal baseline, backed by fully-retained metrics/logs for detection. So neither 'all sampling is lossy of important data' nor 'random 1% is enough' holds: tail-based sampling lets you sample heavily AND keep the traces that matter."
}
```

**Tail-based sampling** decides **after the trace completes**, so it **keeps the interesting traces**
(errors, slow, critical) and samples the boring ones — far better **signal per stored trace** than blind
**head-based** (decide-at-start) sampling. The cost is **buffering spans + assembling each trace in one
place (route by trace ID) + a decision timeout**. Use **policies** (100% errors/slow, per-endpoint
coverage, a small normal baseline) and back it with fully-retained **metrics/logs**.

## Self-test

```quiz
{
  "question": "Tail-based sampling differs from head-based sampling in that it:",
  "options": [
    "Decides at the trace's start with a random coin flip",
    "Buffers the trace's spans and decides AFTER it completes, so it can keep errored/slow/critical traces",
    "Never stores any traces",
    "Only works on a single service"
  ],
  "answer": 1,
  "explanation": "Deciding after completion lets tail sampling preferentially keep the interesting traces (errors/slow), which blind head-based sampling can't."
}
```

```quiz
{
  "question": "The main implementation cost of tail-based sampling is:",
  "options": [
    "It requires synchronized clocks",
    "Buffering in-flight spans and routing all of a trace's spans to one place (by trace ID) to decide on the whole trace, plus a decision timeout",
    "It can't keep error traces",
    "It needs a relational database"
  ],
  "answer": 1,
  "explanation": "You must hold spans until the trace finishes and assemble them together (consistent routing by trace ID), which adds memory, coordination, and latency."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Tail-based sampling — key terms", "cards": [
  { "front": "Head-based sampling", "back": "Decide whether to keep a trace at its START (e.g. random 1%), before anything is known about it. Cheap and stateless, but blind — can't preferentially keep errors or slow traces." },
  { "front": "Tail-based sampling", "back": "Buffer a trace's spans, wait until it completes, then decide based on the whole trace — keeping errored, slow, or critical traces and sampling boring fast-successes down." },
  { "front": "Why is tail-based harder?", "back": "The decision needs the completed trace, so you must buffer in-flight spans, assemble them in one place, and wait for completion — adding memory, coordination, and latency that head-based avoids." },
  { "front": "Routing spans by trace ID", "back": "The standard scaling technique: route all of a trace's spans to a consistent collector (e.g. hash trace ID) so the whole trace is assembled and decided together." },
  { "front": "Decision timeout", "back": "How long tail sampling waits for a trace to finish before deciding. Too short risks deciding on incomplete traces; too long buffers more and delays export." },
  { "front": "Tail policies", "back": "Retention rules: keep 100% of errors, 100% above a latency threshold, a % of each endpoint, more from critical services, and a small random baseline of normal successes." }
] }
```

## Key takeaways

- **Tail-based sampling** decides **after the trace completes**, so it **keeps the interesting traces**
  (errors, slow, critical) instead of a blind random slice — far higher **signal per stored trace**.
- **Head-based** (decide at start) is cheap/stateless but **blind** — it likely drops the rare error/slow
  traces you need.
- Tail sampling costs **buffering spans + assembling each trace in one place (route by trace ID) + a
  decision timeout** — the hard part at scale; often combined with a head pre-filter.
- Use **policies** (100% errors/slow, per-endpoint coverage, small normal baseline) and keep
  fully-retained **metrics/logs** for detection — sampling done right **keeps** what matters.

## Up next

Building observability in from the start, as a design practice. Next: **Observability-Driven
Development**.
