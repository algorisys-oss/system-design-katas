---
title: "Messaging vs Streaming"
slug: messaging-vs-streaming
level: intermediate
module: messaging-and-streaming
order: 23
reading_time_min: 12
concepts: [messaging, streaming, queue, log, replay, retention, decision]
use_cases: []
prerequisites: [message-queues, event-streaming-and-kafka]
status: published
---

# Messaging vs Streaming

## Hook — a motivating scenario

Two features land on your desk: (1) "send a welcome email when someone signs up" and (2) "build a
real-time analytics pipeline over all user activity that data science can also replay monthly." Reach
for the wrong tool — a Kafka cluster for the emails, or a simple queue for the analytics — and you
either over-engineer a trivial task or hit a wall that loses replayable history. Knowing when to use a
**message queue** vs an **event stream** is a recurring, high-leverage decision.

## Mental model — consume-and-delete vs read-and-retain

You've met both; here they are head to head. The crux: **what happens to a message after it's read?**

```compare
{
  "options": [
    { "label": "Messaging (queue)", "points": ["Message consumed → removed", "One consumer per message (work distribution)", "Transient: no history/replay", "Simple to run; great for tasks/jobs"] },
    { "label": "Streaming (log)", "points": ["Event appended → retained", "Many consumers read independently by offset", "Replayable history; new consumers read the past", "Heavier to run; great for event pipelines"] }
  ]
}
```

## Build it up — the decision questions

Ask:
1. **Does each item need one handler, or many independent ones?** One → queue; many → streaming (or
   pub/sub).
2. **Do you need to replay / reprocess history, or let new consumers read past events?** Yes →
   streaming. No (fire-and-forget work) → queue.
3. **Is it transient task distribution or a durable event pipeline / source of truth?** Tasks → queue;
   pipeline/event-sourcing → streaming.
4. **How much operational weight can you carry?** Less → queue; you need streaming's powers → accept
   the cluster.

```match
{
  "prompt": "Match each use case to messaging (queue) or streaming (log).",
  "pairs": [
    { "left": "Send a welcome email on signup", "right": "Messaging — one-off task, consume & forget" },
    { "left": "Resize uploaded images (background jobs)", "right": "Messaging — distribute work to workers" },
    { "left": "Real-time analytics + monthly replay of activity", "right": "Streaming — retained, replayable, multi-consumer" },
    { "left": "Feed one event to email, search, fraud, analytics", "right": "Streaming / pub-sub — fan-out to many independent consumers" }
  ]
}
```

```reveal
{
  "prompt": "Both can do 'async processing', so what's the single sharpest question that decides queue vs stream?",
  "answer": "“After an item is processed, do you still need it — for replay, for other independent consumers, or as history?” If no (the work is done once and forgotten — send an email, resize an image), use a queue: it's simpler, and consume-and-delete is exactly right. If yes (you'll reprocess history, add new consumers that must read past events, fan out the same events to many independent systems, or treat the log as a source of truth), use streaming: retention + offsets are precisely those capabilities. Most other differences (one vs many consumers, ops weight) follow from this. The retain-and-replay need is the deciding factor; everything else is secondary."
}
```

## Build it up — they coexist (and blur)

Real systems use **both**: queues for background jobs and task distribution; streams for event
pipelines, analytics, and cross-service event buses. They also blur — Kafka can act queue-like (a
single consumer group), and some brokers add streaming-ish features. Don't force one tool to do the
other's job: use a queue where consume-and-forget fits, a stream where retain-and-replay matters, and
let each shine.

```reveal
{
  "prompt": "Why is using Kafka for simple background jobs (e.g. 'send this email') often a mistake, and the reverse (a plain queue for an analytics replay pipeline) also a mistake?",
  "answer": "Kafka for simple jobs: you take on partitions, offsets, retention sizing, and a broker cluster to operate — significant complexity — for a task that consume-and-delete handles trivially. You pay an ops/cognitive tax for replay/retention powers you don't use. A plain queue for analytics replay: once a message is consumed it's gone, so you can't reprocess history, can't add a new consumer that needs past events, and can't have multiple independent consumers reading at their own pace from a durable source — exactly what the analytics/replay requirement needs. So you'd hit a wall and lose data you can't recover. Each mistake is using a tool against its core model: streaming's value is retention/replay/multi-consumer; messaging's value is simple transient work distribution. Match the tool to whether you need history."
}
```

## In the wild

- **Messaging (SQS, RabbitMQ):** background jobs, task queues, work distribution, request buffering.
- **Streaming (Kafka, Kinesis, Pulsar):** activity/event pipelines, real-time analytics, log/metrics
  aggregation, CDC, event sourcing, cross-service event buses.
- **Both together** is normal: jobs on a queue, events on a stream; sometimes a stream feeds
  per-consumer queues (recall pub/sub + queues).
- Managed services blur the line, but the **retain-and-replay vs consume-and-delete** distinction
  still drives the choice.

## Common misconception — "streaming is the modern upgrade; use Kafka for everything"

Streaming's power is also its weight; it's not a universal replacement for queues.

```reveal
{
  "prompt": "Why isn't 'just use Kafka everywhere' the right modernization, even though streaming is more capable?",
  "answer": "Because capability isn't free. Streaming's retention, partitions, offsets, and cluster operations add real complexity and cost that only pay off when you actually need replay, history, or many independent consumers. For the large class of problems that are just 'do this task once and forget it,' a message queue is simpler, cheaper, and a better fit — consume-and-delete is the correct semantics, not a limitation. Standardizing everything on Kafka means every trivial job now carries streaming's operational and conceptual overhead, and developers must reason about partitions/offsets where a queue needed none. Use streaming where its powers are needed and messaging where simplicity wins; 'one tool for everything' trades fit for uniformity and usually adds more complexity than it removes."
}
```

The choice hinges on **consume-and-delete (messaging) vs retain-and-replay (streaming)**. Streaming is
more capable but heavier — use queues for transient task distribution, streams for durable, replayable,
multi-consumer event pipelines, and both where each fits.

## Self-test

```quiz
{
  "question": "The sharpest question for choosing streaming over a message queue is:",
  "options": [
    "Which is newer?",
    "Do you need to retain/replay events or have multiple independent consumers read the same (and past) events?",
    "Which uses less memory?",
    "Does it support JSON?"
  ],
  "answer": 1,
  "explanation": "Retain-and-replay + multiple independent consumers ⇒ streaming; consume-and-forget task distribution ⇒ a queue."
}
```

```quiz
{
  "question": "Sending a one-off 'welcome email' on signup is best handled by:",
  "options": [
    "A Kafka event-streaming cluster",
    "A simple message queue (consume the task, send the email, done)",
    "A read replica",
    "A CDN"
  ],
  "answer": 1,
  "explanation": "It's transient, consume-and-forget work for one handler — a queue is simpler and the right fit; Kafka would be over-engineering."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Messaging vs streaming — key terms", "cards": [
  { "front": "Messaging (queue)", "back": "Consume-and-delete: a message is removed once read, one consumer per message, transient with no history. Best for task/work distribution." },
  { "front": "Streaming (log)", "back": "Retain-and-replay: events are appended and retained; many consumers read independently by offset. Best for durable, replayable event pipelines." },
  { "front": "Consume-and-delete vs retain-and-replay", "back": "The crux of the choice: what happens to a message after it's read. Queues remove it; streams keep it so it can be reprocessed or read by new consumers." },
  { "front": "The single deciding question", "back": "After an item is processed, do you still need it — for replay, for other independent consumers, or as history? Yes → streaming; no → queue." },
  { "front": "Why not 'use Kafka for everything'?", "back": "Streaming's retention, partitions, offsets, and cluster ops add cost that only pays off when you need replay or many consumers. Simple consume-and-forget jobs fit a queue better." },
  { "front": "Do they coexist?", "back": "Yes — real systems use queues for background jobs and streams for event pipelines/analytics; sometimes a stream even feeds per-consumer queues." }
] }
```

## Key takeaways

- **Messaging (queue)** = **consume-and-delete**, one consumer per message, transient — best for
  **task/work distribution**.
- **Streaming (log)** = **retain-and-replay**, many independent consumers by offset — best for
  **durable, replayable event pipelines**.
- Deciding question: **do you need replay/history/multiple independent consumers?** Yes → streaming;
  no → queue.
- They **coexist**; don't force Kafka onto simple jobs or a plain queue onto replay pipelines.

## Up next

Once events flow through a stream, you compute over them continuously. Next: **Stream Processing
Patterns**.
