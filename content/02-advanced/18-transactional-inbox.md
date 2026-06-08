---
title: "Transactional Inbox"
slug: transactional-inbox
level: advanced
module: distributed-transactions
order: 18
reading_time_min: 12
concepts: [transactional-inbox, idempotent-consumer, deduplication, exactly-once-processing, at-least-once]
use_cases: []
prerequisites: [transactional-outbox, idempotency-and-safe-methods, message-queues]
status: published
---

# Transactional Inbox

## Hook — a motivating scenario

Your outbox reliably emits events **at-least-once**, so consumers *will* occasionally receive the same
"payment succeeded" event twice (relay retry, broker redelivery, consumer crash before ack). If your
consumer just processes whatever arrives, it credits the customer twice. The producer side guaranteed
the event isn't *lost*; now the **consumer** side must guarantee it isn't *double-processed*. The
**transactional inbox** is the standard way to make consumers **idempotent** so processing is
**effectively-once**.

## Mental model — record what you've processed, atomically with the work

The **transactional inbox**: the consumer keeps an **inbox table** of **already-processed message
IDs**. When a message arrives, in **one local transaction** it (1) checks whether the message ID is
already in the inbox — if so, **skip** (it's a duplicate); if not, (2) does the business work **and**
records the message ID in the inbox **together**, atomically. Because the dedup record and the work
commit in the same local transaction, a message is processed **exactly once** in effect, even though
it's *delivered* many times.

```sequence
{
  "title": "Transactional inbox: dedup + work in one local transaction",
  "actors": ["Broker", "Consumer", "DB"],
  "steps": [
    { "from": "Broker", "to": "Consumer", "label": "deliver event (id=abc) — maybe again later" },
    { "from": "Consumer", "to": "DB", "label": "BEGIN: is id=abc in inbox?" },
    { "from": "DB", "to": "Consumer", "label": "not seen → proceed" },
    { "from": "Consumer", "to": "DB", "label": "do work + INSERT id=abc into inbox — COMMIT (atomic)" },
    { "from": "Broker", "to": "Consumer", "label": "redelivers id=abc → inbox has it → SKIP" }
  ]
}
```

## Build it up — why the atomicity matters

The subtlety is *atomicity between the work and the dedup record*. If you did them separately — process,
then mark done — a crash in between would either reprocess (marked-after-crash lost) or skip work that
didn't finish. By committing the **business change and the inbox record in the same local transaction**
(same database), they're inseparable: either the message is fully processed *and* recorded, or neither.
On redelivery, the inbox row makes the duplicate a no-op.

This is the consumer-side mirror of the outbox: **outbox = produce reliably (no lost events); inbox =
consume idempotently (no double-processing)**. Together they turn **at-least-once delivery** into
**effectively exactly-once processing** — the practical answer to "exactly-once" (recall: true
exactly-once delivery is impossible; you get at-least-once + idempotency).

```reveal
{
  "prompt": "Why must the dedup check/record happen in the SAME transaction as the business work, rather than 'process the message, then mark it processed'?",
  "answer": "Because separating them reintroduces a failure window that breaks exactly-once. Consider 'process then mark': the consumer does the business work (e.g. credits the account), commits that, then crashes before writing the processed-id record. On redelivery, the inbox has no record of this id, so the consumer processes it again — double credit. Now consider 'mark then process': you record the id, crash before doing the work, and on redelivery you skip it as 'already processed' — but the work never happened (lost effect). Either ordering leaves a gap where a crash causes a duplicate or a loss. Committing the business change and the inbox dedup record in a single local ACID transaction removes the gap entirely: they succeed or fail together, so after commit the message is both done and recorded, and before commit neither happened (so redelivery safely reprocesses from scratch). That atomicity is exactly what makes the duplicate a guaranteed no-op and the work guaranteed-once. It works because both the inbox table and the business data live in the same database, so one local transaction spans them — no distributed commit needed. Without that atomicity, the inbox is just a best-effort dedup that still has races; with it, you get reliable effectively-once processing on top of at-least-once delivery."
}
```

## Build it up — variations and practicalities

- **Natural idempotency instead of an inbox:** if the operation is inherently idempotent (e.g. `SET
  status='paid'`, or an upsert keyed by the event), you may not need a separate inbox table — the work
  itself is safe to repeat. The inbox is the **general** mechanism when operations aren't naturally
  idempotent (increments, sends, appends).
- **Inbox cleanup:** processed-ID records grow unbounded — prune them (e.g. by time window beyond which
  redelivery can't occur), like DLQ/outbox housekeeping.
- **Same idea, different names:** "idempotent consumer," "dedup table," "processed-messages table" —
  all the transactional inbox.

```reveal
{
  "prompt": "When can you skip the inbox table, and when is it essential?",
  "answer": "You can skip a dedicated inbox/dedup table when the consumer's operation is *naturally idempotent* — i.e. applying it multiple times yields the same result as applying it once, with no extra effect. Examples: setting an absolute value or state ('SET order.status = paid', 'SET profile.email = X'), an upsert keyed by a stable id, or a conditional update guarded so a repeat is a no-op. In those cases, reprocessing a duplicate event simply re-applies the same final state harmlessly, so no explicit dedup is needed. The inbox becomes essential when the operation is NOT naturally idempotent — anything cumulative or side-effecting where repetition changes the outcome: incrementing a balance/counter ('balance += 100'), appending to a list, creating a new record per event, charging a card, sending an email/notification, or emitting a downstream message. Repeating those double-applies the effect, so you must record which message IDs you've handled and atomically skip duplicates — that's the transactional inbox. Rule of thumb: if you can phrase the work as 'set to a target / upsert' it's naturally idempotent (no inbox); if it's 'add/append/create/send', you need the inbox (or another idempotency key mechanism) to guarantee effectively-once. The inbox is the general fallback that makes any consumer idempotent regardless of operation type."
}
```

## In the wild

- The **inbox/idempotent-consumer** pattern is standard in event-driven microservices and pairs with
  the **transactional outbox** (producer) to get **effectively-once** across the pipeline.
- It's the same idea as **idempotency keys** in APIs/webhooks (recall) and payment processors' dedup —
  applied to message consumers.
- Frameworks/messaging libraries often provide built-in dedup/idempotency support (e.g. inbox tables,
  message-id dedup windows).
- Combined picture: **outbox (no lost events) + inbox (no double-processing) + at-least-once broker =
  reliable, effectively-once event processing.**

## Common misconception — "the broker/queue guarantees exactly-once, so consumers don't need dedup"

Even "exactly-once" claims usually mean at-least-once + dedup; the consumer still owns idempotency.

```reveal
{
  "prompt": "Some brokers advertise 'exactly-once' — why should consumers still implement an inbox/idempotency anyway?",
  "answer": "Because end-to-end exactly-once across independent systems is, in the general case, not achievable, and broker 'exactly-once' guarantees are narrower than they sound. They typically apply only within the broker's own boundary or a specific transactional configuration (e.g. Kafka's exactly-once semantics work for Kafka-to-Kafka processing within its transactions), and they don't cover the consumer's side effects on external systems — your database writes, calls to other services, emails, charges. The moment your consumer does work outside the broker's transaction, the broker can't guarantee that work happened exactly once: the consumer can process a message, perform the side effect, then crash before acking, so the broker redelivers and the side effect repeats. Network retries, rebalances, and at-least-once fallbacks also reintroduce duplicates. So in practice you design for at-least-once delivery and make the consumer idempotent (via a transactional inbox / dedup keyed by message id, committed atomically with the work, or naturally-idempotent operations). Relying on broker 'exactly-once' for your external side effects leads to double-processing bugs (double charges, duplicate records) exactly when failures occur. The robust, broker-agnostic stance is: assume duplicates can reach you, and guarantee effectively-once at the consumer through idempotency. Broker features can reduce duplicates, but the consumer still owns correctness for its own side effects."
}
```

The **transactional inbox** makes a consumer **idempotent** by recording **processed message IDs**
**atomically with the business work** (same local transaction) — so at-least-once delivery becomes
**effectively-once processing**. It's the **consumer-side mirror of the outbox**; consumers own
idempotency even with "exactly-once" brokers.

## Self-test

```quiz
{
  "question": "A transactional inbox prevents double-processing by:",
  "options": [
    "Making the broker deliver exactly once",
    "Recording processed message IDs and doing the work in the same local transaction, so duplicates are skipped",
    "Encrypting messages",
    "Using 2PC with the broker"
  ],
  "answer": 1,
  "explanation": "Atomically committing the work + the message-ID record means a redelivered message is detected and skipped — effectively-once processing."
}
```

```quiz
{
  "question": "Outbox and inbox together provide:",
  "options": [
    "True exactly-once delivery over the network",
    "Reliable producing (no lost events) + idempotent consuming (no double-processing) = effectively-once processing atop at-least-once delivery",
    "Synchronous 2PC",
    "Stronger consistency than ACID"
  ],
  "answer": 1,
  "explanation": "Outbox stops lost/phantom events; inbox stops duplicates being processed — the practical 'exactly-once' = at-least-once + idempotency."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Transactional inbox — key terms", "cards": [ { "front": "Transactional inbox", "back": "An inbox table of already-processed message IDs; in one local transaction the consumer checks the ID, does the business work, and records the ID atomically — making consumers idempotent." }, { "front": "Why atomicity of dedup-record + work?", "back": "Separating them reopens a crash window: 'process then mark' can double-process on redelivery; 'mark then process' can lose work. One local transaction makes them inseparable." }, { "front": "Effectively-once processing", "back": "At-least-once delivery plus consumer idempotency. True exactly-once delivery is impossible, so you combine at-least-once + dedup to process each message once in effect." }, { "front": "Outbox vs inbox", "back": "Outbox = produce reliably (no lost events) on the producer side; inbox = consume idempotently (no double-processing) on the consumer side. They are mirror patterns." }, { "front": "When can you skip the inbox?", "back": "When the operation is naturally idempotent (set/upsert keyed by event), repeating it is harmless. The inbox is essential for cumulative/side-effecting work (increment, append, send, charge)." }, { "front": "Misconception: brokers give exactly-once", "back": "Broker 'exactly-once' is narrow (often broker-internal/transactional config) and excludes external side effects. Consumers still own idempotency; assume duplicates can arrive." } ] }
```

## Key takeaways

- The **transactional inbox** makes consumers **idempotent**: record **processed message IDs** in an
  inbox table **atomically with the business work** (one local transaction) → duplicates are skipped.
- The **atomicity** of dedup-record + work is essential — separating them reopens a crash window that
  causes double-processing or lost work.
- It's the **consumer-side mirror of the outbox**: **outbox (no lost events) + inbox (no
  double-processing) = effectively-once** on top of at-least-once delivery.
- Skip the inbox only when operations are **naturally idempotent** (set/upsert); consumers own
  idempotency even with "exactly-once" brokers.

## Up next

A different way to model state itself — as an immutable log of changes. Next: **Event Sourcing**.
