---
title: "RabbitMQ vs Kafka"
slug: rabbitmq-vs-kafka
level: intermediate
module: messaging-and-streaming
order: 25
reading_time_min: 13
concepts: [rabbitmq, kafka, broker, smart-broker, dumb-broker, routing, throughput]
use_cases: []
prerequisites: [message-queues, event-streaming-and-kafka, messaging-vs-streaming]
status: published
---

# RabbitMQ vs Kafka

## Hook — a motivating scenario

You need a broker and the team splits: half want **RabbitMQ**, half want **Kafka**, and the argument
is going in circles because they're comparing tools that solve *different* problems. RabbitMQ is a
**message broker** (a smart queue/router for tasks); Kafka is an **event-streaming log** (a durable,
replayable event store). Most "which is better" debates dissolve once you see they map onto the
messaging-vs-streaming distinction you just learned.

## Mental model — smart broker (RabbitMQ) vs dumb broker / smart consumer (Kafka)

- **RabbitMQ** is a **"smart broker"**: it does rich **routing** (exchanges, bindings, topics) and
  pushes messages to consumers; once a message is acked, it's **gone**. Optimized for flexible task
  delivery and per-message workflows.
- **Kafka** is a **"dumb broker, smart consumer"**: it just appends events to a **partitioned,
  retained log**; consumers **pull** and track their own **offsets**, and events stick around for
  replay. Optimized for high-throughput, durable, multi-consumer event streams.

```compare
{
  "options": [
    { "label": "RabbitMQ (message broker)", "points": ["Queue: consume → message removed", "Rich routing (exchanges/bindings), push to consumers", "Per-message workflows, priorities, complex routing", "Great for task queues / RPC / flexible delivery"] },
    { "label": "Kafka (event-streaming log)", "points": ["Log: events retained + replayable by offset", "Partitions for huge throughput; consumers pull", "Many independent consumers, history, ordering per partition", "Great for event pipelines / analytics / streaming"] }
  ]
}
```

## Build it up — the decisions that follow

- **Retention/replay:** Kafka keeps events (replay, late consumers, reprocessing); RabbitMQ deletes on
  ack (no built-in replay). → Need history/replay → Kafka.
- **Routing flexibility:** RabbitMQ's exchanges (direct, topic, fanout, headers) do sophisticated
  routing and per-message handling out of the box; Kafka's routing is simpler (topic + partition by
  key). → Complex routing/priorities/per-message logic → RabbitMQ.
- **Throughput/scale:** Kafka's partitioned log is built for very high sustained throughput and many
  consumers; RabbitMQ handles high rates but isn't a retained log. → Massive event firehose → Kafka.
- **Delivery model:** RabbitMQ push (broker tracks delivery); Kafka pull (consumer tracks offset) —
  affects backpressure and consumer control.

```reveal
{
  "prompt": "Map RabbitMQ and Kafka onto the 'messaging vs streaming' distinction — when does each win?",
  "answer": "RabbitMQ ≈ messaging (queue): consume-and-delete, one consumer per message, smart routing — it wins for task distribution, background jobs, RPC-style request/reply, priority queues, and workflows needing flexible routing or per-message handling, where you don't need to keep events after processing. Kafka ≈ streaming (log): retain-and-replay, many independent consumers reading by offset, partitioned for huge throughput — it wins for event pipelines, real-time analytics, log/metrics aggregation, CDC, event sourcing, and any case needing replay, history, or multiple consumers of the same event stream. So the choice mirrors the previous chapter: need transient smart delivery of tasks → RabbitMQ; need a durable, replayable, high-throughput event log → Kafka. They're not competitors so much as tools for the two different jobs."
}
```

## Build it up — they can coexist

Many systems run **both**: RabbitMQ (or SQS) for task queues and RPC-ish workflows, Kafka for the
event backbone/analytics. Don't force one into the other's role — RabbitMQ as a long-term event store
(no replay/retention model) or Kafka as a flexible per-message router with complex routing both fight
the tool's design.

```reveal
{
  "prompt": "What goes wrong if you use Kafka as a general-purpose task queue with complex routing, or RabbitMQ as a replayable event store?",
  "answer": "Kafka as a smart task queue: Kafka has minimal routing (topic + partition-by-key), no per-message priorities, and parallelism is capped by partition count — so implementing rich routing, priorities, selective consumption, or per-message acking/redelivery semantics is awkward and you fight the log model; you also carry partition/offset/retention ops for simple jobs. RabbitMQ as a replayable event store: once a message is acked it's deleted, so there's no replay, no late-joining consumer reading history, and no long-term log — you'd have to bolt on persistence it isn't designed for, and it won't match Kafka's retained-throughput model. Each misuse fights the tool's core design (smart-broker/consume-delete vs dumb-broker/retained-log), leading to brittle workarounds. Use RabbitMQ for flexible transient delivery and Kafka for durable replayable streams."
}
```

## In the wild

- **RabbitMQ:** task queues, background jobs, RPC/request-reply, priority and complex routing,
  microservice command delivery. (Similar niche: AWS SQS for simple queues.)
- **Kafka:** event streaming backbones, real-time analytics, log/metrics pipelines, CDC, event
  sourcing, stream processing sources. (Similar: Kinesis, Pulsar, Redpanda.)
- **Both together** is common — Kafka as the event spine, RabbitMQ/SQS for task distribution.
- The choice follows the **messaging-vs-streaming** decision, plus routing-flexibility (RabbitMQ) vs
  retained-throughput (Kafka).

## Common misconception — "RabbitMQ and Kafka are competitors; pick the 'better' one"

They're optimized for different jobs; "better" depends entirely on the job.

```reveal
{
  "prompt": "Why is 'which is better, RabbitMQ or Kafka?' usually the wrong question?",
  "answer": "Because they're built for different problems, so neither is universally better. RabbitMQ is a smart message broker optimized for flexible, transient task delivery with rich routing and consume-and-delete semantics. Kafka is a durable, partitioned event log optimized for high-throughput, replayable, multi-consumer event streams. Asking 'which is better' ignores the requirement: for background jobs / complex routing / RPC, RabbitMQ is better; for event pipelines / replay / analytics / huge throughput, Kafka is better. The right question is 'do I need transient smart-routed task delivery (messaging) or a durable replayable event log (streaming)?' — answer that, and the tool follows. Many architectures use both. Comparing them head-to-head as rivals is comparing a router to a ledger."
}
```

RabbitMQ (smart broker, consume-and-delete, rich routing) and Kafka (retained, partitioned, replayable
log) solve **different** problems — the choice follows **messaging vs streaming** + **routing vs
throughput**, and they often **coexist**.

## Self-test

```quiz
{
  "question": "A key architectural difference is that:",
  "options": [
    "RabbitMQ retains messages for replay; Kafka deletes on ack",
    "Kafka retains events in a replayable log (offset-based); RabbitMQ deletes messages once acked",
    "Both are identical",
    "Kafka does richer routing than RabbitMQ"
  ],
  "answer": 1,
  "explanation": "Kafka is a retained, replayable log; RabbitMQ is a smart broker that removes messages after they're acknowledged."
}
```

```quiz
{
  "question": "You need flexible per-message routing for a task/RPC workflow with priorities. Better fit:",
  "options": ["Kafka", "RabbitMQ", "A CDN", "A read replica"],
  "answer": 1,
  "explanation": "RabbitMQ's exchanges/bindings and consume-and-delete model suit flexible task delivery; Kafka's strength is retained, high-throughput event streams."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "RabbitMQ vs Kafka — key terms", "cards": [
  { "front": "RabbitMQ (smart broker)", "back": "A message broker doing rich routing (exchanges, bindings, topics) and pushing to consumers; once a message is acked it is removed. Optimized for flexible task delivery and per-message workflows." },
  { "front": "Kafka (dumb broker, smart consumer)", "back": "An event-streaming log that appends events to a partitioned, retained store; consumers pull and track their own offsets, and events stick around for replay. Optimized for high-throughput durable streams." },
  { "front": "Retention / replay", "back": "Kafka keeps events so late consumers, reprocessing, and replay work. RabbitMQ deletes messages on ack, with no built-in replay. Need history or replay points to Kafka." },
  { "front": "Routing flexibility", "back": "RabbitMQ exchanges (direct, topic, fanout, headers) give sophisticated routing and per-message handling out of the box. Kafka routing is simpler: topic plus partition by key. Complex routing or priorities points to RabbitMQ." },
  { "front": "Delivery model (push vs pull)", "back": "RabbitMQ pushes messages and the broker tracks delivery. Kafka consumers pull and track their own offset. This affects backpressure and consumer control." },
  { "front": "They can coexist", "back": "Many systems run both: RabbitMQ (or SQS) for task queues and RPC-ish workflows, Kafka as the event backbone/analytics spine. Don't force one tool into the other's role." }
] }
```

## Key takeaways

- **RabbitMQ** = a **smart message broker** (rich routing, push, consume-and-delete) — for **tasks/
  workflows/RPC** with flexible delivery.
- **Kafka** = a **durable, partitioned, replayable event log** (offset-based, pull) — for
  **high-throughput, multi-consumer event streams** with history.
- The choice follows **messaging vs streaming** (+ routing-flexibility vs retained-throughput); they
  frequently **coexist**.
- "Which is better?" is the wrong question — match the tool to **transient routed delivery** vs
  **durable replayable streaming**.

## Up next

A specialized messaging protocol for constrained, real-world devices. Next: **MQTT**.
