---
title: "Load & Stress Testing"
slug: load-and-stress-testing
level: intermediate
module: reliability-and-testing
order: 36
reading_time_min: 13
concepts: [load-testing, stress-testing, soak-testing, spike-testing, capacity, breaking-point]
use_cases: []
prerequisites: [latency-vs-throughput, back-of-the-envelope-estimation, metrics-and-key-system-metrics]
status: published
---

# Load & Stress Testing

## Hook — a motivating scenario

Your service is correct and fast — with 10 users. Marketing launches a campaign, 50,000 users arrive
at once, and it falls over: latency spikes, the database connection pool exhausts, and requests time
out. You found your breaking point in production, with customers watching. **Performance testing**
finds it *first*, in a controlled environment, so you can fix capacity before real traffic does.

## Mental model — does it hold up under load, and where does it break?

Functional tests ask "is it correct?"; performance tests ask "does it hold up under **load**, and
**where/how does it break**?" The family of performance tests differ by the *load shape* they apply:

```compare
{
  "options": [
    { "label": "Load test", "points": ["Apply EXPECTED peak load", "Verifies it meets latency/throughput SLOs at normal scale", "Answers 'can we handle launch day?'", "The baseline performance test"] },
    { "label": "Stress test", "points": ["Push BEYOND capacity until it breaks", "Finds the breaking point + failure mode", "Answers 'where's the limit and does it fail gracefully?'", "Reveals the weakest component"] },
    { "label": "Spike test", "points": ["Sudden sharp surge then drop", "Tests autoscaling + recovery from bursts", "Answers 'can we survive a flash crowd?'", "Flash sales, viral events"] },
    { "label": "Soak test", "points": ["Moderate load over a LONG time", "Finds leaks, slow degradation, resource exhaustion", "Answers 'is it stable for days?'", "Memory leaks, connection leaks"] }
  ]
}
```

## Build it up — what each reveals

- **Load testing** validates you meet your **SLOs at expected peak** (recall percentiles + the nines):
  drive realistic traffic and watch p95/p99 latency, error rate, and saturation hold. It answers "are
  we provisioned for launch?"
- **Stress testing** deliberately exceeds capacity to find the **breaking point** and — crucially —
  *how* it breaks: does it **degrade gracefully** (shed load, return errors fast) or **collapse**
  (cascading failures, recall SPOF)? It exposes the **bottleneck** component (often the database/
  connection pool).
- **Spike testing** checks behavior under a sudden surge — does **autoscaling** react in time, and does
  the system **recover** when the spike passes? (Flash sales, going viral.)
- **Soak (endurance) testing** runs moderate load for hours/days to catch slow problems invisible in
  short runs: **memory/connection leaks**, disk filling, gradual latency creep.

```reveal
{
  "prompt": "Why isn't a passing load test (meets SLOs at expected peak) enough — what do stress and soak tests add?",
  "answer": "A load test only proves you're okay at the expected peak you tested; it tells you nothing about the margin above that or about long-term behavior. Stress testing adds the breaking point and failure mode: real traffic often exceeds estimates (a campaign overperforms, a spike hits), so you need to know how much headroom you have and, vitally, whether exceeding it degrades gracefully (shed load, fast errors, stay partially up) or collapses catastrophically (cascading failures, total outage) — that shapes resilience work. Soak testing adds time: many failures only appear after hours/days — memory leaks, connection-pool/file-descriptor leaks, slow disk fill, gradual latency creep — which a short load test never surfaces but which cause 3 a.m. outages in production. Together: load = 'can we handle expected peak?', stress = 'where/how do we break beyond it?', soak = 'are we stable over time?'. You need all three views of performance, not just the happy-path peak."
}
```

## Build it up — doing it well

- **Use realistic load** — model real user mixes/think-time and realistic data volumes; hammering one
  trivial endpoint or an empty database gives misleading results.
- **Test in a production-like environment** — same shapes/sizes; results from a tiny staging box don't
  predict prod.
- **Measure the right things** — p95/p99 latency, throughput, error rate, and **saturation** (CPU,
  memory, connection pools, queue depth) so you can find *which* resource is the bottleneck.
- **Establish a baseline + watch for regressions** — run performance tests regularly so a deploy that
  doubles latency is caught before launch.

```reveal
{
  "prompt": "A team load-tests by hammering the /health endpoint against an empty database and concludes the system handles 100k req/s. Why is that result worthless?",
  "answer": "Because it doesn't exercise anything that actually breaks under real load. /health typically does no real work (no DB queries, no business logic), so it measures the web server's raw request handling, not the system — real endpoints hit the database, caches, and downstream services, which are the true bottlenecks. An empty database also lies: queries that scan/where/join behave completely differently against millions of rows (no hot indexes, no contention, tiny working set) than against an empty table, so latency and saturation are unrealistically rosy. And a single endpoint ignores the real traffic mix (reads/writes, expensive vs cheap calls) and think-time. The result gives false confidence — the system will fall over in production at a fraction of that number. Valid load testing uses realistic endpoints, a realistic data volume, a realistic user/traffic mix, and a production-like environment, and watches p99 + saturation to find the real limiting resource."
}
```

## In the wild

- **Tools:** k6, Gatling, JMeter, Locust generate load; pair with your **metrics/observability** to
  watch latency/saturation during the test.
- **Capacity planning** uses load/stress results + estimation (recall back-of-the-envelope) to
  provision and set **autoscaling** thresholds.
- **Pre-launch ritual:** load + spike test before big events; **soak test** before long-running
  deployments; run perf tests in CI/staging to catch regressions.
- Findings feed resilience: rate limiting, load shedding, circuit breakers, bigger pools, caching
  (much of this course).

## Common misconception — "if it's fast in dev/with a few users, it'll scale"

Performance at small scale says nothing about behavior under real load — bottlenecks are non-linear.

```reveal
{
  "prompt": "Why doesn't 'fast with 10 users in dev' predict performance with 50,000 users in production?",
  "answer": "Because systems behave non-linearly under load: things that are invisible at small scale dominate at large scale. Shared resources saturate (connection pools, threads, CPU, memory, DB locks) and once near capacity, queueing makes latency explode (recall latency-vs-throughput) rather than rising gently. Caches that hide DB cost in dev may thrash or stampede under real traffic; an N+1 query that's fine on 10 rows melts the DB on millions; contention and lock waits appear only with concurrency; and a tiny dev dataset has different query plans than production volumes. Dev also lacks production's network hops, data size, traffic mix, and concurrency. So 'fast with a few users' measures the easy case; the failure modes (saturation, queueing, contention, hot spots, leaks) only emerge under realistic concurrent load — which is exactly why you load/stress/soak test in a production-like setup instead of trusting dev performance."
}
```

Performance/capacity is found by **deliberately applying realistic load** (load), **pushing past it**
(stress), **surging** (spike), and **sustaining** it (soak) — in a production-like environment, watching
p99 + saturation. Small-scale speed doesn't predict large-scale behavior.

## Self-test

```quiz
{
  "question": "The difference between a load test and a stress test is:",
  "options": [
    "They're the same",
    "Load test applies expected peak (verify SLOs); stress test pushes beyond capacity to find the breaking point and failure mode",
    "Load test breaks the system; stress test doesn't",
    "Stress tests only run in production"
  ],
  "answer": 1,
  "explanation": "Load = handle expected peak within SLOs; stress = exceed capacity to find where/how it breaks (graceful vs collapse)."
}
```

```quiz
{
  "question": "A soak (endurance) test is uniquely good at catching:",
  "options": [
    "Sudden traffic spikes",
    "Slow problems over time — memory/connection leaks, gradual degradation, resource exhaustion",
    "SQL syntax errors",
    "UI layout bugs"
  ],
  "answer": 1,
  "explanation": "Running moderate load for a long time surfaces leaks and gradual degradation that short tests miss."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Load & stress testing — key terms", "cards": [
  { "front": "Load test", "back": "Apply EXPECTED peak load to verify the system meets its latency/throughput SLOs at normal scale — the baseline performance test answering 'can we handle launch day?'" },
  { "front": "Stress test", "back": "Push BEYOND capacity until it breaks to find the breaking point and failure mode — does it degrade gracefully (shed load, fast errors) or collapse? Reveals the weakest component." },
  { "front": "Spike test", "back": "Apply a sudden sharp surge then drop to test whether autoscaling reacts in time and the system recovers once the spike passes. For flash sales and viral events." },
  { "front": "Soak (endurance) test", "back": "Run moderate load over a long time (hours/days) to catch slow problems short runs miss: memory/connection leaks, disk filling, gradual latency creep." },
  { "front": "What to measure", "back": "p95/p99 latency, throughput, error rate, and saturation (CPU, memory, connection pools, queue depth) so you can find which resource is the bottleneck." },
  { "front": "Why dev speed doesn't predict scale", "back": "Bottlenecks are non-linear: shared resources saturate, queueing makes latency explode, contention and hot spots appear only under realistic concurrent load and data volume." }
] }
```

## Key takeaways

- Performance testing asks **"does it hold up under load, and where does it break?"** — by load shape:
  **load** (expected peak/SLOs), **stress** (breaking point + failure mode), **spike** (surge/
  autoscaling), **soak** (leaks over time).
- Beyond meeting SLOs, **stress reveals graceful degradation vs collapse** and the **bottleneck**;
  **soak** catches leaks.
- Do it with **realistic load + data in a production-like environment**, watching **p99 + saturation**
  to find the limiting resource.
- **Small-scale speed doesn't predict scale** — bottlenecks/queueing are non-linear; test before real
  traffic does.

## Up next

The most adventurous reliability practice: deliberately breaking things to prove resilience. Next:
**Chaos Testing**.
