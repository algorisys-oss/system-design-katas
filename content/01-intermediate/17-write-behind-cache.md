---
title: "Write-Behind Cache"
slug: write-behind-cache
level: intermediate
module: caching-patterns
order: 17
reading_time_min: 12
concepts: [write-behind, write-back, async-flush, batching, durability-risk, coalescing]
use_cases: []
prerequisites: [write-through-cache, memory-vs-disk]
status: published
---

# Write-Behind Cache

## Hook — a motivating scenario

You're tracking "views" on millions of items — a flood of tiny increments. Writing each one straight
to the database synchronously would crush it. What if you wrote to a fast in-memory cache, returned
instantly, and **flushed to the database in the background** in batches? That's **write-behind** (a.k.a.
write-back): the fastest write pattern — at the cost of a window where "saved" data isn't durable yet.

## Mental model — write to cache now, persist later

In **write-behind**, a write updates the **cache and is acknowledged immediately**; the cache flushes
the change to the **database asynchronously** afterward (often **batched** or **coalesced**). The
client gets a fast ack; durability happens behind the scenes.

```sequence
{
  "title": "Write-behind (ack from cache, async DB flush)",
  "actors": ["App", "Cache", "DB"],
  "steps": [
    { "from": "App", "to": "Cache", "label": "write key=value" },
    { "from": "Cache", "to": "App", "label": "ack immediately (fast!)" },
    { "from": "Cache", "to": "Cache", "label": "buffer / coalesce writes" },
    { "from": "Cache", "to": "DB", "label": "flush to DB later (batched, async)" }
  ]
}
```

## Build it up — why it's fast, and the durability risk

**Why it's fast:** writes hit memory and return; the slow DB work is deferred and amortized. Two
multipliers:
- **Batching** — flush many buffered writes in one DB operation (far cheaper than one-at-a-time).
- **Coalescing** — collapse repeated writes to the same key (1,000 view-increments → one `+1000`
  flush), hugely reducing DB load for hot counters.

**The risk — durability:** between the ack and the flush, the new data lives **only in the cache**. If
the cache crashes in that window, those acknowledged writes are **lost** (recall memory-vs-disk:
memory is volatile). So write-behind is for data where some loss is tolerable, or where the cache
itself is made durable/replicated.

```reveal
{
  "prompt": "Write-behind acknowledges a write before it's in the database. When is that acceptable, and when is it dangerous?",
  "answer": "Acceptable when losing a small, recent window of writes is tolerable and throughput matters more than perfect durability — e.g. view counts, like tallies, metrics, analytics buffers, last-seen timestamps. Losing a few seconds of increments on a rare cache crash is fine. Dangerous for data where every write must survive — payments, orders, account balances, anything financial or legally required: acking before persistence means a crash silently loses 'confirmed' operations, which is unacceptable. For those, use write-through (durable on ack) or write to the DB directly. The deciding question: 'if the cache died right now and lost the last N seconds of writes, is that a catastrophe or a rounding error?'"
}
```

## Build it up — making write-behind safer

To use write-behind for less-disposable data, you reduce the loss window and protect the buffer:
- **Durable buffer / replicated cache** — back the cache with an append-only log or replicate it, so a
  crash doesn't lose buffered writes (this starts to look like a message queue — next module).
- **Short flush intervals** — smaller window = less potential loss (trading off batching efficiency).
- **Ordering & conflicts** — async flush can reorder; ensure the DB ends in the correct final state
  (coalescing to "last value wins" per key helps).

```reveal
{
  "prompt": "How does coalescing make write-behind dramatically cheaper for something like a viral post's like counter?",
  "answer": "Without coalescing, 50,000 likes in a minute = 50,000 individual DB writes to the same row — contention and load that can melt the database (and they'd serialize on that hot row). Write-behind buffers them in the cache and coalesces: instead of 50,000 increments, it flushes a single 'add 50,000' (or sets the current total) once per interval. The DB sees one cheap write per flush regardless of traffic, while the cache serves the live count instantly. Coalescing turns a write storm on a hot key into a trickle of batched updates — the core reason write-behind suits high-frequency counters/metrics. The trade remains the loss window if the cache dies before flushing."
}
```

Tuning the flush interval slides write-behind between maximum throughput and maximum durability:

```tradeoff
{ "title": "How aggressively should write-behind flush?", "axis": { "left": "Long interval (throughput)", "right": "Short interval (durability)" }, "steps": [ { "label": "Long flush interval", "detail": "Maximum batching and coalescing — a write storm collapses into a few cheap DB writes. But the loss window is large: a cache crash loses everything buffered since the last flush." }, { "label": "Moderate interval", "detail": "A balance: still benefits from batching repeated writes to hot keys, while bounding how many seconds of acknowledged writes a crash could lose." }, { "label": "Short flush interval", "detail": "Smaller loss window means less potential data loss, but you give up batching efficiency — fewer writes are coalesced, so the DB sees more frequent flushes." }, { "label": "Durable / replicated buffer", "detail": "Back the cache with an append-only log or replica so buffered writes survive a crash. Durability without shrinking the window — but it starts to resemble a queue + consumer." } ] }
```

## In the wild

- **High-frequency counters/metrics** (views, likes, rate counters), **analytics/event buffering**,
  and **last-seen/heartbeat** timestamps are classic write-behind use cases.
- **Redis + periodic flush**, or purpose-built write-back caches; OS page caches and disk controllers
  use write-back internally (with the same durability caveat → `fsync`).
- Made safer with **durable/replicated buffers** — at which point it resembles a **queue + consumer**
  (the messaging module).
- Avoided for **financial/critical** data, where write-through or direct durable writes are required.

## Common misconception — "write-behind is just a faster write-through"

They make opposite durability promises; speed isn't the only difference.

```reveal
{
  "prompt": "Why is it wrong to think of write-behind as 'write-through but faster' and use it interchangeably?",
  "answer": "Because the speed comes precisely from giving up synchronous durability — the one guarantee write-through provides. Write-through acks only after the database has the write (durable, fresh, but slower). Write-behind acks from the cache before the DB has it (fast, but the write can be lost if the cache crashes pre-flush, and the DB is briefly behind). They're not two speeds of the same thing; they're a deliberate durability-vs-throughput trade. Swapping write-through for write-behind to 'go faster' silently introduces a data-loss window — fine for view counts, catastrophic for payments. Choose based on whether un-flushed writes being lost is acceptable, not just on speed."
}
```

Write-behind is the **fastest write pattern** because it **defers (and risks) durability** — the
opposite promise from write-through. Use it for **loss-tolerant, high-frequency** data (with batching/
coalescing), not as a drop-in faster write-through.

## Self-test

```quiz
{
  "question": "Write-behind (write-back) caching is fast because it:",
  "options": [
    "Writes to the database first, then the cache",
    "Acknowledges from the cache immediately and flushes to the DB asynchronously (often batched/coalesced)",
    "Skips the cache entirely",
    "Encrypts writes in transit"
  ],
  "answer": 1,
  "explanation": "It returns as soon as the cache is updated and persists to the DB later in the background, amortizing DB cost."
}
```

```quiz
{
  "question": "Write-behind is a poor fit for payment/order data because:",
  "options": [
    "It's too slow",
    "Acknowledged writes can be lost if the cache crashes before flushing to the DB",
    "It can't batch writes",
    "It always serves stale reads"
  ],
  "answer": 1,
  "explanation": "Acking before durability creates a loss window — unacceptable for critical data; use write-through or direct durable writes."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Write-behind cache — key terms", "cards": [ { "front": "Write-behind (write-back)", "back": "A write updates the cache and is acknowledged immediately; the cache flushes the change to the database asynchronously afterward. The fastest write pattern." }, { "front": "Batching", "back": "Flushing many buffered writes in a single DB operation, far cheaper than persisting one write at a time." }, { "front": "Coalescing", "back": "Collapsing repeated writes to the same key into one flush (1,000 increments to a single +1000), hugely cutting DB load for hot counters." }, { "front": "Durability risk / loss window", "back": "Between the ack and the flush, new data lives only in volatile cache memory. If the cache crashes in that window, acknowledged writes are lost." }, { "front": "Making write-behind safer", "back": "Use a durable/replicated buffer (append-only log), shorten flush intervals, and ensure correct final state via last-value-wins coalescing." }, { "front": "When to avoid write-behind", "back": "Financial/critical data — payments, orders, balances — where every write must survive. Use write-through or direct durable writes instead." } ] }
```

## Key takeaways

- **Write-behind (write-back)** acks from the **cache immediately** and flushes to the DB
  **asynchronously** — the fastest write pattern.
- **Batching + coalescing** make it ideal for **high-frequency counters/metrics** (collapse a write
  storm into a few DB writes).
- The trade is **durability**: un-flushed writes are **lost if the cache crashes** — only for
  loss-tolerant data (or with a durable/replicated buffer).
- It's **not** "faster write-through" — it makes the **opposite durability promise**.

## Up next

All these patterns hinge on keeping cache and DB consistent. Let's make invalidation a first-class
topic. Next: **Cache Invalidation Strategies**.
