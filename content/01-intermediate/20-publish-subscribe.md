---
title: "Publish/Subscribe Pattern"
slug: publish-subscribe
level: intermediate
module: messaging-and-streaming
order: 20
reading_time_min: 14
concepts: [pub-sub, fan-out, topics, decoupling, event-driven, queue-contrast]
use_cases: []
prerequisites: [message-queues, synchronous-vs-asynchronous-communication]
status: published
---

# Publish/Subscribe Pattern

## Hook — a motivating scenario

When an order is placed, five things must happen: email a receipt, update inventory, notify shipping,
refresh analytics, and index it for search. With a plain work queue you'd make the order service call
or enqueue to all five — and every time a new consumer appears ("now also update the loyalty
program"), you edit the order service. **Pub/sub** flips this: the order service **publishes one
event** — "order placed" — and any number of services **subscribe** independently. The publisher never
changes.

## Mental model — broadcast to all interested subscribers

Think of a **radio station broadcasting on a frequency**: the station (the **publisher**) transmits
without knowing who is tuned in, and every radio set to that frequency (a **subscriber**) receives the
same broadcast independently. Tune a new radio in and the station does nothing different.

In **publish/subscribe**, **publishers** emit messages to a **topic** without knowing who (if anyone)
is listening; **subscribers** register interest in a topic and each receives **its own copy** of every
message. It's **broadcast/fan-out**, versus a queue's deliver-to-one.

```flow
{
  "title": "One event, many independent subscribers",
  "nodes": [
    { "label": "Publisher", "detail": "Order service publishes 'order.placed' to a topic. Done — doesn't know subscribers." },
    { "label": "Topic", "detail": "The channel. Delivers a COPY of each message to every subscriber." },
    { "label": "Email svc", "detail": "Subscribes; gets its own copy → sends receipt." },
    { "label": "Inventory svc", "detail": "Subscribes; gets its own copy → decrements stock." }
  ],
  "note": "Add a new subscriber (analytics, search, loyalty) without touching the publisher. Fan-out."
}
```

## Build it up — pub/sub vs message queue

The defining difference is **who gets each message**:

```compare
{
  "options": [
    { "label": "Message queue (point-to-point)", "points": ["Each message → exactly ONE consumer in the group", "Competing consumers share the work", "For distributing/parallelizing tasks", "Adding consumers scales throughput"] },
    { "label": "Pub/Sub (fan-out)", "points": ["Each message → EVERY subscriber gets a copy", "Independent consumers, independent purposes", "For broadcasting events to many systems", "Adding subscribers adds new reactions"] }
  ]
}
```

This makes pub/sub the backbone of **event-driven architecture**: services emit events about what
happened; other services react, with **loose coupling** — the publisher has zero knowledge of
subscribers, so you add/remove reactions without changing the source.

```reveal
{
  "prompt": "An order must trigger email, inventory, analytics, and search updates. Why is pub/sub better here than the order service directly calling (or queueing to) each one?",
  "answer": "Direct calls/queues couple the order service to every downstream: it must know all of them, handle each one's failures/latency, and be modified every time a new consumer is added or removed. With pub/sub, the order service publishes a single 'order.placed' event and is done — it doesn't know or care who consumes it. Email, inventory, analytics, and search each subscribe independently and react on their own; adding 'loyalty points' later means deploying a new subscriber, with no change to the order service. Pub/sub gives fan-out + loose coupling: one event, many independent reactions, and the publisher stays stable as the ecosystem grows. (Each subscriber typically backs its subscription with its own queue for reliable, at-least-once processing.)"
}
```

## Build it up — reliability and combining with queues

Pub/sub and queues aren't either/or — they **compose**. A common robust pattern: a topic fans out to
**per-subscriber queues**, so each subscriber gets its own durable, at-least-once stream that its
(possibly many) workers drain — combining fan-out (pub/sub) with reliable work distribution + scaling
(queue) per consumer.

The same caveats apply: delivery is typically **at-least-once**, so subscribers must be **idempotent**;
and it's **asynchronous**, so reactions are eventually consistent (the receipt email arrives shortly
after the order, not in the same transaction).

```reveal
{
  "prompt": "How do pub/sub and message queues combine to give both fan-out AND reliable, scalable processing per consumer?",
  "answer": "Use a topic for fan-out and a durable queue per subscriber. The publisher emits an event to the topic; the broker delivers a copy into each subscriber's own queue. Within a subscriber, a pool of competing-consumer workers drains its queue (point-to-point), so that subscriber gets reliable at-least-once delivery, retries/acks, and horizontal scaling — independently of the others. So 'order.placed' lands in the email queue, the inventory queue, the analytics queue, etc., and each team scales/handles failures on its own. You get pub/sub's broadcast + loose coupling across subscribers AND a queue's durability + parallelism within each subscriber. Many brokers (and cloud services like SNS→SQS) implement exactly this topic-to-queues fan-out."
}
```

## In the wild

- **SNS→SQS (AWS), Google Pub/Sub, Redis Pub/Sub, NATS, MQTT, Kafka topics** provide pub/sub; many
  pair a topic with per-subscriber queues. The scale is large: AWS SNS allows up to **12.5 million
  subscriptions per standard topic**, and Google Cloud Pub/Sub retains unacknowledged messages for a
  default of **7 days** so subscribers can catch up after an outage.
- It's the foundation of **event-driven microservices** — services publish domain events; others react
  (recall it also powers **event-driven cache invalidation**).
- **Fan-out** use cases: notifications, audit logging, analytics, search indexing, cache invalidation —
  anything where one event has many independent consequences.
- Subscribers stay **idempotent** (at-least-once) and reactions are **eventually consistent**.

## Common misconception — "pub/sub and message queues are the same thing"

They differ on the one thing that matters: how many consumers get each message.

```reveal
{
  "prompt": "What's the precise difference between a message queue and pub/sub, and why does picking the wrong one cause bugs?",
  "answer": "A message queue is point-to-point: each message is delivered to exactly ONE consumer in the consumer group (competing consumers split the work) — use it to distribute/parallelize tasks. Pub/sub is fan-out: each message is delivered to EVERY subscriber (each gets its own copy) — use it to broadcast an event to many independent reactions. Picking wrong breaks things: if you need email AND inventory AND analytics to each react but you use a single shared queue, only one consumer gets each order (the others miss it) — silently dropped reactions. Conversely, if you want a task done once but wire it as pub/sub, multiple subscribers all do it (duplicate work/charges). The 'one consumer vs every subscriber' semantics is the whole decision."
}
```

A queue **distributes work (one consumer per message)**; pub/sub **broadcasts events (every subscriber
gets a copy)**. They compose (topic → per-subscriber queues) but solve different problems — choose by
whether each message needs **one** handler or **many**.

## Self-test

```quiz
{
  "question": "The defining difference between pub/sub and a point-to-point message queue is:",
  "options": [
    "Pub/sub is faster",
    "In pub/sub every subscriber gets a copy of each message (fan-out); in a queue each message goes to exactly one consumer",
    "Queues can't be durable",
    "Pub/sub doesn't need consumers"
  ],
  "answer": 1,
  "explanation": "Pub/sub broadcasts to all subscribers; a work queue delivers each message to a single competing consumer."
}
```

```quiz
{
  "question": "Pub/sub gives loose coupling because:",
  "options": [
    "Subscribers must register with the publisher",
    "The publisher emits an event without knowing its subscribers, so consumers can be added/removed without changing it",
    "It uses synchronous calls",
    "It guarantees exactly-once delivery"
  ],
  "answer": 1,
  "explanation": "Publishers are unaware of subscribers; new reactions are added by subscribing, with no change to the event source."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Publish/Subscribe — key terms", "cards": [
  { "front": "Publish/subscribe (pub/sub)", "back": "A messaging pattern where publishers emit messages to a topic and every subscriber gets its own copy — broadcast/fan-out, versus a queue's deliver-to-one." },
  { "front": "Topic", "back": "The channel publishers send to; it delivers a copy of each message to every registered subscriber, decoupling the publisher from who listens." },
  { "front": "Fan-out", "back": "One published event reaches many independent subscribers, each reacting for its own purpose (email, inventory, analytics, search)." },
  { "front": "Loose coupling in pub/sub", "back": "The publisher emits an event without knowing its subscribers, so consumers can be added or removed without changing the source." },
  { "front": "Topic-to-queues composition", "back": "A topic fans out into a durable per-subscriber queue; each subscriber's workers drain its queue for reliable, at-least-once, scalable processing." },
  { "front": "Pub/sub delivery semantics", "back": "Typically at-least-once and asynchronous, so subscribers must be idempotent and reactions are eventually consistent." }
] }
```

## Key takeaways

- **Pub/sub** broadcasts each message to **every subscriber** (fan-out) via **topics**; a **queue**
  delivers each message to **one** consumer (work distribution).
- Pub/sub gives **loose coupling + fan-out** — the backbone of **event-driven architecture** (publish
  events; many services react independently).
- It **composes with queues** (topic → per-subscriber durable queues) for fan-out *and* reliable,
  scalable per-consumer processing.
- Still **at-least-once + async** → subscribers must be **idempotent**, reactions eventually consistent.

## Up next

When a consumer can't process a message even after retries, where does it go? Next: **Dead Letter
Queues**.
