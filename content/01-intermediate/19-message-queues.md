---
title: "Message Queues"
slug: message-queues
level: intermediate
module: messaging-and-streaming
order: 19
reading_time_min: 15
concepts: [message-queue, producer, consumer, decoupling, load-leveling, at-least-once, acknowledgement]
use_cases: []
prerequisites: [synchronous-vs-asynchronous-communication, idempotency-and-safe-methods]
status: published
---

# Message Queues

## Hook — a motivating scenario

A flash sale sends 50,000 orders in a minute. Your order service can process maybe 500/second, so
direct synchronous processing either melts the service or drops orders. Put a **message queue** between
the front door and the workers: the web tier drops each order into the queue and instantly returns
"received"; workers pull and process at their sustainable rate. The spike is absorbed, nothing is
lost, and the user isn't kept waiting. That buffering, decoupling component is a message queue.

## Mental model — a to-do list between producers and workers

A **message queue** is a durable buffer that sits between **producers** (who put messages in) and
**consumers** (who take them out). Producers and consumers don't talk directly or even need to be up
at the same time — they only share the queue. It's the concrete async-communication tool from earlier.

```flow
{
  "title": "Producer → queue → consumers",
  "nodes": [
    { "label": "Producers", "detail": "Web tier enqueues a message (e.g. 'process order 123') and returns immediately." },
    { "label": "Queue", "detail": "Durable buffer holding messages until a consumer takes one." },
    { "label": "Consumers", "detail": "Workers pull messages and process at their own pace; add workers to go faster." },
    { "label": "Ack / done", "detail": "Consumer acknowledges success; the message is removed (or re-delivered on failure)." }
  ],
  "note": "Producers and consumers are decoupled in time and rate — the queue absorbs spikes."
}
```

## Build it up — what a queue gives you

- **Decoupling** — producers don't know or wait for consumers (recall async): each side evolves and
  scales independently.
- **Load leveling (buffering)** — the queue absorbs spikes; consumers process at a steady rate instead
  of being overwhelmed (the flash-sale fix) — **load leveling**: work piles up safely in the queue
  rather than crashing the system. (A bounded queue can also create **backpressure** — signalling the
  producer to slow down when the queue fills — which is the related, opposite-direction mechanism.)
- **Scaling by adding consumers** — a queue is typically **point-to-point / work-queue** semantics:
  each message is delivered to **one** consumer in a group, so adding workers parallelizes throughput
  ("competing consumers").
- **Reliability** — messages are **durable** (persisted) and **acknowledged**: a consumer acks only
  after success; if it crashes mid-process, the unacked message is **redelivered** to another worker.

```reveal
{
  "prompt": "How does a message queue turn a traffic spike that would crash a service into something it can survive?",
  "answer": "By decoupling intake rate from processing rate. Without a queue, every incoming request must be handled synchronously right now, so a spike beyond capacity overwhelms the service (threads exhausted, timeouts, crashes) or drops work. With a queue, the producer just enqueues each item quickly and returns — intake is cheap — while consumers drain the queue at their sustainable rate. Excess work waits durably in the queue (it grows temporarily) instead of taking down the workers. This is load leveling: the queue is a shock absorber that converts a burst into a backlog the system can chew through over time. You add consumers to drain faster, and nothing is lost because messages persist until acked. (If the queue is bounded, a full queue can also exert backpressure — pushing back on the producer to slow down — the complementary mechanism.)"
}
```

## Build it up — delivery guarantees and idempotency

Acknowledgement creates the classic guarantee: **at-least-once** delivery. If a consumer processes a
message but crashes before acking, the queue redelivers it — so the same message can be processed
**more than once**. Therefore consumers must be **idempotent** (recall the idempotency chapter): use
the message ID to de-duplicate so reprocessing is harmless.

```reveal
{
  "prompt": "Why are message queues 'at-least-once' by default, and what must consumers do about it?",
  "answer": "To avoid losing messages, the queue only removes a message after the consumer acknowledges success. If the consumer crashes (or times out) after doing the work but before acking, the queue can't tell the work was done, so it redelivers the message to another consumer — hence the same message may be processed more than once (at-least-once). The alternative (ack before processing = at-most-once) risks losing messages on crash, which is usually worse. So consumers must be idempotent: key processing on the message/event ID and de-duplicate, so handling a redelivered message twice has no extra effect. 'Exactly-once' end-to-end is really at-least-once delivery + idempotent processing."
}
```

When you ack relative to processing sets a dial between never losing a message and never duplicating one:

```tradeoff
{
  "title": "When does the consumer acknowledge a message?",
  "axis": { "left": "At-most-once (ack before processing)", "right": "At-least-once (ack after success)" },
  "steps": [
    { "label": "Ack on receipt", "detail": "Consumer acks before doing the work. A crash mid-process loses that message — no redelivery, no duplicates. At-most-once: fast but lossy." },
    { "label": "Ack after success (default)", "detail": "Consumer acks only once processing succeeds. A crash before ack triggers redelivery, so a message can run more than once. At-least-once: nothing lost, but duplicates happen." },
    { "label": "At-least-once + idempotent consumer", "detail": "Keep at-least-once delivery but de-duplicate by message ID so reprocessing is harmless. This approximates exactly-once end-to-end without losing messages." }
  ]
}
```

## In the wild

- **RabbitMQ, AWS SQS, ActiveMQ, Redis-backed queues** implement point-to-point work queues with acks and
  redelivery.
- The canonical use: **offload slow/non-critical work** off the request path — emails, image
  processing, order fulfillment, notifications (recall sync-vs-async).
- **Competing consumers** scale throughput; **visibility timeouts / acks** handle consumer failures;
  failed messages go to a **dead-letter queue** (next-next chapter).
- Queues are the backbone of **task/job processing** systems (Celery, Sidekiq, etc.).

## Common misconception — "a queue means messages are processed instantly and exactly once"

Queues optimize for reliability and throughput, not instant or exactly-once.

```reveal
{
  "prompt": "Two assumptions about queues bite teams: that processing is instant, and that each message runs exactly once. Why are both wrong?",
  "answer": "Instant: a queue is asynchronous by design — a message waits until a consumer is free, and under load the backlog (and thus latency) grows. That's the point (load-leveling), but it means consumers see eventual, not immediate, processing; if you need an instant result, that's a synchronous call, not a queue. Exactly-once: to avoid losing messages, queues redeliver unacked ones, giving at-least-once delivery — so duplicates happen on retries/crashes. You don't get exactly-once for free; you approximate it with at-least-once delivery plus idempotent consumers (de-dup by message ID). Designing as if a queue is instant and exactly-once leads to surprised users (latency under load) and double-processing bugs."
}
```

Queues provide **decoupling, load-leveling, and reliable at-least-once delivery** — not instant or
exactly-once processing. Embrace eventual processing and make consumers **idempotent**.

## Self-test

```quiz
{
  "question": "The main benefit of putting a message queue between a producer and consumers is:",
  "options": [
    "Faster individual message processing",
    "Decoupling + load-leveling: producers enqueue quickly while consumers process at their own rate, absorbing spikes",
    "Guaranteed exactly-once, instant processing",
    "Eliminating the need for consumers"
  ],
  "answer": 1,
  "explanation": "A queue buffers work so intake and processing rates decouple, letting the system absorb bursts and scale consumers independently."
}
```

```quiz
{
  "question": "Because queues redeliver unacknowledged messages (at-least-once), consumers must be:",
  "options": [
    "Stateful",
    "Idempotent — de-duplicate by message ID so reprocessing is harmless",
    "Synchronous",
    "Single-threaded"
  ],
  "answer": 1,
  "explanation": "Crashes before ack cause redelivery/duplicates; idempotent consumers make processing the same message twice safe."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Message queues — key terms",
  "cards": [
    { "front": "Message queue", "back": "A durable buffer between producers (who enqueue) and consumers (who dequeue), decoupling them in time and rate so each side scales independently." },
    { "front": "Load leveling", "back": "The queue absorbs traffic spikes as a backlog so consumers process at a steady, sustainable rate instead of being overwhelmed and crashing." },
    { "front": "Backpressure", "back": "A bounded queue, when full, signals the producer to slow down — the complementary, opposite-direction mechanism to load leveling." },
    { "front": "Competing consumers", "back": "Point-to-point semantics where each message goes to one consumer in a group; adding workers parallelizes and scales throughput." },
    { "front": "At-least-once delivery", "back": "The queue removes a message only after the consumer acks success; a crash before ack triggers redelivery, so a message may be processed more than once." },
    { "front": "Idempotent consumer", "back": "A consumer that de-duplicates by message ID so reprocessing a redelivered message has no extra effect — required given at-least-once delivery." }
  ]
}
```

## Key takeaways

- A **message queue** is a durable buffer between **producers** and **consumers**, decoupling them in
  **time and rate**.
- It provides **load-leveling** (absorb spikes; a bounded queue can also apply backpressure),
  **independent scaling** (add competing
  consumers), and **reliable delivery** via persistence + acks/redelivery.
- Default semantics are **at-least-once** → consumers must be **idempotent** (de-dup by ID).
- Queues give **eventual, reliable** processing — not instant or exactly-once.

## Up next

Point-to-point delivers each message to one consumer. What if many independent consumers each need it?
Next: **Publish/Subscribe Pattern**.
