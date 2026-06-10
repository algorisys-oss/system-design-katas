---
title: "Latency vs Throughput"
slug: latency-vs-throughput
level: foundations
module: foundations-of-system-design
order: 49
reading_time_min: 13
concepts: [latency, throughput, percentiles, tail-latency, batching, bottleneck]
use_cases: []
prerequisites: [latency-numbers, back-of-the-envelope-estimation]
status: published
---

# Latency vs Throughput

## Hook — a motivating scenario

Your dashboard says "average response time: 50 ms" and the team celebrates. Meanwhile, support is
flooded with complaints that the app is unusably slow. Both are true: the *average* is fine, but 1 in
20 requests takes 3 seconds — and those are the ones users notice and remember. Confusing latency with
throughput, and average with tail, hides the problems that actually hurt users.

## Mental model — speed of one vs volume of many

- **Latency** = how long **one** request takes (e.g. 50 ms). The user's experience of "fast."
- **Throughput** = how many requests you handle **per unit time** (e.g. 10,000 req/s). The system's
  capacity.

They're related but independent — a highway analogy: **latency** is how long *your* car takes to cross
the bridge; **throughput** is how many cars cross per minute. You can raise throughput (more lanes)
without making any single trip faster, and a single fast car (low latency) doesn't mean the bridge has
high capacity.

```compare
{
  "options": [
    { "label": "Latency", "points": ["Time for ONE request", "User-perceived 'speed'", "Measured in ms (and percentiles!)", "Improved by: caching, fewer hops, closer data"] },
    { "label": "Throughput", "points": ["Requests per unit time (capacity)", "System-wide scale", "Measured in req/s, QPS", "Improved by: more servers, parallelism, batching"] }
  ]
}
```

## Build it up — averages lie; use percentiles

The opening bug is about **percentiles**. The *average* hides the worst cases; what users feel is the
**tail**:
- **p50 (median)** — half of requests are faster than this. The "typical" experience.
- **p95 / p99** — 95% / 99% are faster than this; the slow 5% / 1%. **Tail latency.**

A great p50 with a terrible p99 means a meaningful fraction of users have a bad time — and at scale,
"1%" is huge (1% of 10M requests = 100,000 slow experiences). Worse, a single page often makes many
requests, so the chance of hitting *at least one* slow one compounds.

```reveal
{
  "prompt": "A page makes 10 backend calls in parallel, each with a 1% chance of being slow (p99). What's the chance the page feels slow?",
  "answer": "About 1 − 0.99^10 ≈ 9.6% — nearly 1 in 10 page loads hits at least one slow call, even though each call is 'only' 1% slow. Tail latency compounds with fan-out: the more calls a request depends on, the more likely it waits on the slowest one. This is why p99 (and p999) matter far more than averages at scale, and why reducing fan-out and tail latency is a big deal. Optimizing the median while ignoring the tail leaves most complex pages feeling slow."
}
```

## Build it up — they can trade off

Optimizing one can hurt the other, so know which you're targeting:

- **Batching** raises throughput but adds latency (you wait to fill a batch). Great for background
  jobs, bad for interactive requests.
- **More parallelism / servers** raises throughput, but a single request's latency is unchanged (or
  worsens under contention).
- **Caching / closer data / fewer hops** lowers latency directly.
- **Little's Law** says concurrency = throughput × latency — an exact identity, not a prediction that
  latency blows up. The blow-up comes from **queueing theory:** as utilization (ρ) approaches 1, wait
  time scales like 1/(1−ρ), so pushing throughput to the limit makes queues form and latency explode.
  Running near 100% utilization makes tail latency spike.

```reveal
{
  "prompt": "Why does latency get dramatically worse as a system approaches 100% utilization, even before it 'fails'?",
  "answer": "Queueing. Below capacity, requests are served promptly; as utilization nears 100%, requests start waiting behind others in queues, and queue length (and thus wait time) grows non-linearly — small load increases cause large latency spikes. That's why systems are run with headroom (e.g. target ~60–70% utilization): the last bit of throughput is bought with exploding tail latency. Maximizing throughput and minimizing latency are in tension near saturation."
}
```

Drag the dial to see how tuning a system toward raw throughput trades against per-request latency:

```tradeoff
{ "title": "Tune for throughput or for latency?", "axis": { "left": "Latency-optimized", "right": "Throughput-optimized" }, "steps": [ { "label": "Cache / fewer hops", "detail": "Caching, closer data, and fewer hops lower a single request's latency directly. Best for interactive, user-facing requests where the tail (p95/p99) is what users feel." }, { "label": "Add servers / parallelism", "detail": "More servers and parallelism raise capacity, but one request's latency is unchanged (or worse under contention). Throughput climbs without making any single trip faster." }, { "label": "Batch work", "detail": "Batching raises throughput by waiting to fill a batch, which adds latency. Great for background/batch jobs, bad for interactive requests." }, { "label": "Push to ~100% utilization", "detail": "Maximizing throughput near saturation makes queues form: by Little's Law more in-flight requests means each waits longer, so tail latency explodes. Run with headroom (~60-70%) instead." } ] }
```

## In the wild

- **Always report percentiles (p50/p95/p99), not just averages** — dashboards and SLOs are defined on
  tail latency for good reason.
- **User-facing systems optimize latency** (especially the tail); **data pipelines/batch systems
  optimize throughput**.
- **Tail-tolerant techniques:** timeouts, retries (idempotent!), hedged requests, and reducing fan-out
  — keeping the slow 1% from dominating. Google's Dean & Barroso, *The Tail at Scale* (CACM 2013),
  give the canonical example: if a server is slow (>1 s) on just 1% of requests, a single user request
  that fans out to 100 such servers will wait on at least one slow server **63%** of the time
  (1 − 0.99¹⁰⁰ ≈ 0.63) — tail latency dominates at fan-out, which is why hedged requests pay off.
- **Run with headroom:** don't size systems for ~100% utilization; queues (and tail latency) blow up
  near saturation.

## Common misconception — "low average latency means the system is fast"

Averages hide the tail, and latency ≠ throughput.

```reveal
{
  "prompt": "Average latency is 50 ms and the team thinks performance is great, yet users complain. What are they missing, and what should they look at?",
  "answer": "The average is dominated by the many fast requests and hides the slow tail — p95/p99 might be seconds. Users remember the slow requests (and at scale, 1% is a huge number of people), and pages that fan out to many calls are likely to hit at least one slow one. They should look at percentile latency (p95, p99, even p999), broken down by endpoint, and target the tail — plus check utilization (queueing) and fan-out. 'Average is fine' is one of the most common ways real performance problems stay hidden."
}
```

A low average can coexist with a terrible experience. Measure and optimize the **tail (p95/p99)**, and
keep **latency vs throughput** distinct — they're different goals improved by different techniques.

## Self-test

```quiz
{
  "question": "Throughput and latency are best described as:",
  "options": [
    "The same metric",
    "Latency = time for one request; throughput = requests handled per unit time",
    "Latency = capacity; throughput = speed of one request",
    "Both measured only in req/s"
  ],
  "answer": 1,
  "explanation": "Latency is per-request time (user-perceived speed); throughput is volume/capacity (req/s). Related but independent."
}
```

```quiz
{
  "question": "Why prefer p99 latency over average latency for user-facing systems?",
  "options": [
    "It's easier to compute",
    "The average hides the slow tail; p99 reveals the bad experiences users actually notice (and at scale, 1% is many people)",
    "p99 is always lower",
    "Averages aren't measurable"
  ],
  "answer": 1,
  "explanation": "Averages mask outliers; tail percentiles (p95/p99) capture the slow requests users feel — especially with fan-out at scale."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Latency vs throughput — key terms", "cards": [ { "front": "Latency", "back": "How long one request takes (e.g. 50 ms). The user's experience of 'fast' — per-request time, measured in ms." }, { "front": "Throughput", "back": "How many requests you handle per unit time (e.g. 10,000 req/s). The system's capacity, measured in req/s or QPS." }, { "front": "p50 (median)", "back": "The latency half of requests are faster than — the 'typical' experience. Hides the slow tail that users actually notice." }, { "front": "Tail latency (p95/p99)", "back": "The latency the slow 5% / 1% of requests exceed. What users feel; at scale 1% is huge and it compounds with fan-out." }, { "front": "Little's Law (intuition)", "back": "At capacity, more in-flight requests means each waits longer. Pushing throughput toward 100% utilization forms queues and makes tail latency explode." }, { "front": "Batching trade-off", "back": "Waiting to fill a batch raises throughput but adds latency. Great for background jobs, bad for interactive requests." } ] }
```

## Key takeaways

- **Latency** = time for one request (user-perceived speed); **throughput** = requests/sec (capacity)
  — related but independent.
- **Use percentiles, not averages:** p95/p99 **tail latency** is what users feel, and it **compounds
  with fan-out** at scale.
- The two can **trade off**: batching/parallelism raise throughput but can raise latency; caching/
  fewer hops lower latency.
- **Run with headroom** — near 100% utilization, queueing makes tail latency explode.

## Up next

The last core concept ties consistency, availability, and partitions together. Next: **CAP Theorem**.
