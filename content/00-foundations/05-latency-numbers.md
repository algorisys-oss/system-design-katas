---
title: "Latency Numbers Every Engineer Should Know"
slug: latency-numbers
level: foundations
module: computing-fundamentals
order: 5
reading_time_min: 14
concepts: [latency, orders-of-magnitude, memory-vs-disk-vs-network, estimation]
use_cases: []
prerequisites: [memory-hierarchy, processes-threads-concurrency]
status: published
---

# Latency Numbers Every Engineer Should Know

## Hook — a motivating scenario

A teammate proposes "just call the user-service inside the loop — it's only a quick lookup." The loop
runs 1,000 times per request. Each call is a network round trip. You sense it's a bad idea but can't
say *how* bad. With a few memorized numbers, you can: 1,000 round trips ≈ 1,000 × ~1 ms = **~1 second**
of pure waiting, per request. Now it's obvious.

These numbers are the quantitative backbone of every design decision in this course.

## Mental model — the orders-of-magnitude ladder

You don't need exact figures — you need the **shape**: each tier is roughly an order of magnitude
(10×) slower than the one above. The jumps that matter most: **memory → SSD → network**.

```ladder
{
  "title": "Latency every engineer should know (approximate, log scale)",
  "items": [
    { "label": "L1 cache reference", "ns": 1 },
    { "label": "Branch mispredict", "ns": 3 },
    { "label": "L2 cache reference", "ns": 4 },
    { "label": "Mutex lock/unlock", "ns": 17 },
    { "label": "Main memory (RAM)", "ns": 100 },
    { "label": "Compress 1 KB", "ns": 2000 },
    { "label": "Read 1 MB from RAM", "ns": 3000 },
    { "label": "SSD random read", "ns": 16000 },
    { "label": "Read 1 MB from SSD", "ns": 50000 },
    { "label": "Round trip in same datacenter", "ns": 500000 },
    { "label": "Disk (HDD) seek", "ns": 10000000 },
    { "label": "Round trip CA → Netherlands → CA", "ns": 150000000 }
  ]
}
```

Toggle the **human scale** above: if an L1 cache hit took 1 second, a same-datacenter round trip
would take nearly a week, and an intercontinental round trip would take ~5 years. That gap is why we
cache, batch, and avoid chatty network calls.

## Build it up — the three numbers that drive design

Memorize these three and you can reason about most systems:

- **RAM ≈ 100 ns** — effectively free compared to anything below it.
- **SSD ≈ 100 µs–1 ms** — ~1,000× slower than RAM. This is why databases cache hot pages in memory.
- **Network round trip ≈ 0.5 ms (same DC) to ~150 ms (cross-continent)** — the slowest common
  operation, and the one most under your architectural control.

```reveal
{
  "prompt": "A request makes 50 sequential calls to other services, each a 1 ms same-datacenter round trip. What's the floor on its latency?",
  "answer": "~50 ms, just in network waiting — before any actual work. Sequential round trips add up linearly. The fix: batch the calls, fetch in parallel, or denormalize so you need fewer of them. This is why 'chatty' service designs feel slow."
}
```

## In the wild

- **N+1 query bug:** code that loops issuing one DB query per item turns a 1 ms page into a 500 ms
  page at 500 items. Same root cause as the chatty-service example — too many round trips.
- **Same-DC vs cross-region:** keeping a service and its database in the same region can cut tens of
  ms per call; a cross-region hop is ~10–100× more expensive.
- **Batching & pipelining:** Redis can do thousands of ops; doing them one-round-trip-at-a-time vs
  pipelined is the difference between 100 ms and 2 ms.
- **CDNs exist** precisely to turn a 150 ms cross-continent trip into a ~10 ms nearby-edge trip.

## Common misconception — "a network call is about as fast as a function call"

In code they look identical — `getUser(id)` — but they differ by ~6 orders of magnitude.

```reveal
{
  "prompt": "Roughly how many in-memory operations could you do in the time it takes for ONE cross-continent round trip (~150 ms)?",
  "answer": "Around a million RAM accesses (150 ms / 100 ns = 1.5 million). A remote call isn't 'a bit slower' than a local one — it's astronomically slower. Treat network boundaries as expensive and design to cross them rarely."
}
```

A local call and a remote call look the same in source code but are worlds apart. The boundary
between "in this process" and "over the network" is the most important performance line in any
system.

## Self-test

```quiz
{
  "question": "Roughly how much slower is an SSD read than a main-memory (RAM) read?",
  "options": ["About the same", "~10×", "~1,000×", "~1,000,000×"],
  "answer": 2,
  "explanation": "RAM ≈ 100 ns, SSD ≈ 100 µs–1 ms → about 1,000× slower. (Disk/HDD and network are slower still.)"
}
```

```quiz
{
  "question": "A page makes 200 sequential same-datacenter round trips (~1 ms each). The biggest win is:",
  "options": [
    "A faster CPU",
    "Reducing/batching the round trips so there are far fewer of them",
    "More RAM",
    "A larger disk"
  ],
  "answer": 1,
  "explanation": "200 × 1 ms = ~200 ms of pure waiting. Batch or parallelize the calls; the bottleneck is round-trip count, not compute."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Latency numbers — key terms", "cards": [
  { "front": "RAM (main memory) read latency", "back": "About 100 ns — effectively free compared to anything below it on the ladder, and the baseline you compare other tiers against." },
  { "front": "SSD read latency", "back": "Roughly 100 µs to 1 ms — about 1,000× slower than RAM, which is why databases cache hot pages in memory." },
  { "front": "Network round trip latency", "back": "About 0.5 ms within a datacenter up to ~150 ms cross-continent — the slowest common operation and the one most under your architectural control." },
  { "front": "Orders-of-magnitude ladder", "back": "Memorize the shape, not exact digits: each tier is roughly 10× slower than the one above. The biggest cliffs are RAM → SSD → network." },
  { "front": "Why sequential round trips matter", "back": "They add up linearly: 50 calls at 1 ms each is ~50 ms of pure waiting. Chatty designs and N+1 queries are death by a thousand hops." },
  { "front": "Local call vs remote call", "back": "They look identical in source code but differ by ~6 orders of magnitude; one cross-continent trip (~150 ms) equals roughly a million RAM accesses." }
] }
```

## Key takeaways

- Memorize the **shape**, not exact digits: each tier is ~10× the one above; the big cliffs are
  **RAM → SSD → network**.
- Three anchors: **RAM ~100 ns, SSD ~100 µs–1 ms, network round trip ~0.5–150 ms.**
- **Sequential round trips add up** — chatty designs and N+1 queries are death by a thousand hops.
- A **remote call is ~6 orders of magnitude slower than a local one** — design to cross the network
  boundary rarely.

## Up next

That closes the computing fundamentals. Now we follow the data out the door: **How the Internet Works
& Protocol Layers** — what actually happens when one machine talks to another.
