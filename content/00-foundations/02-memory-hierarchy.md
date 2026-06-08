---
title: "Memory Hierarchy"
slug: memory-hierarchy
level: foundations
module: computing-fundamentals
order: 2
reading_time_min: 16
concepts: [registers, cache, ram, disk, locality, cache-line, latency-tiers]
use_cases: []
prerequisites: [how-computers-work, binary-and-data-representation]
status: published
---

# Memory Hierarchy

## Hook — a motivating scenario

Two programs do the same total work — sum a million numbers. One reads them in order; the other
hops around the array randomly. Same CPU, same data, same count. The sequential one finishes **several
times faster**. No threads, no tricks. The only difference is *where the data was when the CPU asked
for it*.

That gap is the memory hierarchy at work — and it's the reason caching exists at every layer of every
system you'll ever design.

## Mental model — a desk, a drawer, a shelf, a warehouse

You're working at a desk:

- **Registers** = what's in your hands right now. Instant, but you can only hold a couple of things.
- **CPU cache** = the desk surface. Tiny, but reaching it is almost free.
- **RAM** = a drawer beside you. Bigger, a short reach away.
- **Disk/SSD** = a warehouse across town. Vast, but a trip there costs *enormously* more.

Computers are built as this pyramid: **the faster a tier is, the smaller and costlier it is.** The
CPU's whole strategy is to keep the data it's about to use as high up the pyramid as possible.

```layers
{
  "title": "The memory hierarchy (fastest/smallest on top)",
  "layers": [
    { "label": "CPU registers", "detail": "A handful of values the CPU operates on directly. Sub-nanosecond.", "meta": "~0.3 ns" },
    { "label": "CPU cache (L1/L2/L3)", "detail": "Kilobytes to tens of MB of recently/nearby-used data, kept close to the core.", "meta": "~1–10 ns" },
    { "label": "RAM (main memory)", "detail": "Gigabytes of fast, volatile working memory for everything currently running.", "meta": "~100 ns" },
    { "label": "SSD / Disk", "detail": "Hundreds of GB to TBs of persistent storage — survives power off, but far slower.", "meta": "~100 µs+" }
  ]
}
```

## Build it up — locality is why caches work

A cache only helps if future accesses are *predictable*. They usually are, because real programs have
**locality**:

- **Temporal locality** — if you used something, you'll likely use it again soon (a loop counter, a
  config value).
- **Spatial locality** — if you used something, you'll likely use what's next to it (the next array
  element, the next struct field).

So hardware doesn't fetch one byte from RAM — it fetches a whole **cache line** (typically 64 bytes)
into cache, betting you'll want the neighbors too. Sequential access cashes in that bet on every
line; random access throws it away — which is exactly why our two programs differed.

```reveal
{
  "prompt": "Why is iterating an array in order so much faster than jumping around it randomly?",
  "answer": "Sequential access uses each fetched 64-byte cache line fully (spatial locality) — one slow RAM trip serves many elements. Random access touches a different line each time, so almost every access is a cache miss that pays the full RAM (or worse) latency."
}
```

## In the wild

- **Latency ladder (memorize the shape):** register < L1 cache (~1 ns) < RAM (~100 ns) < SSD
  (~100 µs, ~1000× slower than RAM) < network round trip (~1–100 ms). Each step down is roughly an
  order of magnitude or more.
- **Databases** keep hot pages in an in-memory **buffer pool** so common queries never touch disk.
- **Redis/Memcached** are an entire product category built on one idea: keep hot data in RAM instead
  of paying disk/DB latency.
- **CPU-bound vs memory-bound:** much "slow code" isn't computing too much — it's *waiting on memory*.
  Data layout (arrays of structs vs structs of arrays) can matter more than the algorithm's big-O.

## Common misconception — "memory access is basically free / uniform"

Code reads like every variable access costs the same. It doesn't.

```reveal
{
  "prompt": "If RAM is ~100 ns and L1 cache is ~1 ns, roughly how much slower is a cache miss that goes to RAM?",
  "answer": "Around 100× slower. And if the data isn't even in RAM (a page on SSD), you're looking at ~100 µs — about 100,000× slower than L1. 'Where the data lives' can dwarf 'how much work you do'."
}
```

A single line of code can be 1 ns or 100,000 ns depending purely on which tier the data was in. When
something is mysteriously slow, ask *where the data lives*, not just *how much work it does*.

## Self-test

```quiz
{
  "question": "Order these from FASTEST to slowest to access:",
  "options": [
    "RAM → CPU cache → registers → SSD",
    "Registers → CPU cache → RAM → SSD",
    "SSD → RAM → CPU cache → registers",
    "CPU cache → registers → SSD → RAM"
  ],
  "answer": 1,
  "explanation": "Registers (fastest) → cache → RAM → SSD (slowest). Each step is larger and cheaper but slower."
}
```

```quiz
{
  "question": "Hardware loads a full 64-byte cache line instead of a single byte mainly to exploit:",
  "options": [
    "Integer overflow",
    "Spatial locality — you'll probably need the neighboring bytes",
    "Network bandwidth",
    "Disk durability"
  ],
  "answer": 1,
  "explanation": "Fetching the neighbors in one trip pays off because programs tend to use nearby data next (spatial locality)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Memory hierarchy — key terms", "cards": [ { "front": "Memory hierarchy", "back": "A pyramid of storage tiers (registers, cache, RAM, disk) where faster tiers are smaller and costlier; the CPU keeps soon-needed data as high up as possible." }, { "front": "Temporal locality", "back": "If you used something, you'll likely use it again soon — like a loop counter or config value reused across iterations." }, { "front": "Spatial locality", "back": "If you used something, you'll likely use what's next to it — the next array element or struct field — which is why caches fetch neighbors too." }, { "front": "Cache line", "back": "The fixed-size block (typically 64 bytes) hardware fetches from RAM at once, betting on spatial locality; sequential access uses it fully, random access wastes it." }, { "front": "Latency ladder", "back": "Register < L1 (~1 ns) < RAM (~100 ns) < SSD (~100 µs) < network (~1–100 ms); each step down is roughly an order of magnitude or more slower." }, { "front": "Buffer pool", "back": "An in-memory cache of hot database pages so common queries are served from RAM and never pay disk latency." } ] }
```

## Key takeaways

- Memory is a **pyramid**: faster tiers are smaller and pricier (registers → cache → RAM → disk).
- **Caches work because of locality** (temporal + spatial); hardware fetches whole **cache lines**,
  so sequential access is far faster than random.
- The latency tiers differ by **orders of magnitude** — a cache miss to RAM is ~100×, to disk
  ~100,000×.
- When code is slow, suspect **where the data lives**, not only how much it computes.

## Up next

We keep saying "the CPU asks for data." Next we open up the CPU itself — the **fetch–decode–execute**
loop that drives everything.
