---
title: "Design a Notification System"
slug: notification-system
level: use-cases
module: core-building-blocks
order: 2
reading_time_min: 20
concepts: [fan-out, idempotency, dead-letter-queue, retry-backoff, templating, user-preferences]
use_cases: [notification-system]
prerequisites: [message-queues, publish-subscribe, dead-letter-queues, idempotency-and-safe-methods, transactional-outbox]
status: published
---

# Design a Notification System

> **Use case:** a platform service that, given an event ("your order shipped," "new login," "weekly
> digest"), **delivers a message to a user across one or more channels** — push, SMS, email — reliably
> and at most once per intent.
> **Domain:** every consumer app, marketplace, bank, and SaaS product has one; it's the shared spine
> behind transactional alerts, OTPs, and marketing blasts.
> **Scale:** millions of users, tens of millions of notifications/day with spiky peaks (a marketing
> campaign or an outage alert fans out to everyone at once), delivered through **third-party providers**
> (APNs, FCM, Twilio, SES) that each have their **own rate limits and failure modes**.
> **Core challenges:** **multi-channel fan-out**, **per-provider rate limits + retries with backoff**,
> a **dead-letter queue** for poison messages, **idempotency/de-duplication** so a user is never
> notified twice, **user preferences/opt-out**, **templating**, and **prioritization** (an OTP must not
> sit behind a million marketing emails).

A notification system looks like "call an API" but is really a **reliable async fan-out pipeline**: one
event becomes N messages across M channels, each handed to a flaky external provider, each of which must
arrive **exactly the number of times the user expects — usually once.**

## 1 · Clarify requirements

**Functional**
- Accept a **send request** (event type, target user(s), data payload) from any internal service.
- **Fan out** to the channels the user is eligible for: push, SMS, email (in-app/webhook later).
- Apply **user preferences**: opt-outs, per-channel and per-category toggles, quiet hours.
- **Render** the message from a versioned **template** + payload, localized per user.
- Deliver via the right **provider**, honoring its rate limits; **retry** transient failures.
- **De-duplicate**: the same logical notification must not reach a user twice.
- Support **priority tiers** (transactional/OTP vs marketing) with isolation.

**Non-functional**
- **Reliable:** transactional messages should be effectively at-least-once delivered to the provider,
  with at-most-once *user-visible* effect (de-dup).
- **Low latency for high priority:** an OTP should leave within a second or two even during a campaign.
- **Elastic:** absorb bursts (a digest to 10M users) without dropping or melting providers.
- **Observable:** per-message status (queued, sent, delivered, failed) and a graveyard for failures.

```reveal
{
  "prompt": "Why is 'a user must not be notified twice' the requirement that shapes the whole design, more than raw throughput?",
  "answer": "Because the pipeline is async and full of retries, and retries are the *correct* way to achieve reliability over flaky providers — so duplicates are not an edge case, they are the natural consequence of the architecture. A producer may publish the same event twice (its own retry), a queue delivers at-least-once (a consumer can crash after sending but before acking, so the message redelivers), and a provider call can succeed on the server but time out on your side (you don't know if it went through, so you retry). Each of these is individually reasonable; together they mean the same logical notification will frequently be processed more than once. If you do nothing, the user gets two OTP texts or three 'order shipped' emails, which erodes trust and, for SMS, costs real money per send. So the system must be built around an idempotency key per logical notification and a de-dup check at the last safe moment before handing to the provider — turning an at-least-once transport into an at-most-once user-visible effect. Throughput you solve by adding workers; exactly-once-feeling delivery you can only get by designing for it from the start."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Messages produced after fan-out",
  "inputs": [
    { "key": "users", "label": "Users notified/day", "default": 20000000 },
    { "key": "channelsPerUser", "label": "Avg channels per notification", "default": 1.6 }
  ],
  "formula": "users * channelsPerUser",
  "resultLabel": "Channel messages/day",
  "resultUnit": "messages/day"
}
```

```calc
{
  "title": "Peak send rate during a campaign burst",
  "inputs": [
    { "key": "burstMessages", "label": "Messages in the burst", "default": 10000000 },
    { "key": "drainMinutes", "label": "Minutes to drain", "default": 30 }
  ],
  "formula": "burstMessages / (drainMinutes * 60)",
  "resultLabel": "Required throughput",
  "resultUnit": "messages/sec"
}
```

> ~32M channel-messages/day at steady state, but a single 10M-user campaign demands **~5,500 msg/sec for
> 30 minutes**. That's the design driver: average throughput is modest, but **bursts** are huge — and
> downstream **providers cap you** (e.g. APNs ~hundreds–thousands/sec/connection, Twilio per-number
> limits, SES a per-account send rate). So the queue must **buffer the burst** and workers must **pace
> themselves to each provider's ceiling**, not to your own capacity.

## 3 · API & where it sits

The notification service is an **internal platform** behind a thin API; product services call it instead
of integrating providers themselves.

```
POST /v1/notifications
{
  "idempotency_key": "order-9931-shipped",   // de-dup across retries
  "user_id": "u_123",
  "event": "order.shipped",                   // selects template + category
  "priority": "transactional",                // transactional | marketing
  "data": { "order_id": "9931", "eta": "Tue" } // template variables
}
-> 202 Accepted { "notification_id": "...", "status": "queued" }
```

Key points: the call is **fire-and-forget (202)** — delivery is async; the **`idempotency_key` is
supplied by the caller** (it knows the business intent) so duplicate submissions collapse; channel
selection, templating, and provider choice are the service's job, not the caller's.

## 4 · High-level architecture

One event flows through ingestion → preference/fan-out → per-channel queues → workers → providers, with a
**DLQ** off to the side for messages that exhaust retries.

```flow
{
  "title": "Notification pipeline",
  "nodes": [
    { "label": "Ingest API", "detail": "Validate, stamp idempotency_key, write intent, publish event (transactional outbox so DB-write and publish don't diverge)." },
    { "label": "Preference + fan-out", "detail": "Look up user prefs/opt-outs/quiet-hours; expand 1 event into N channel-messages for eligible channels only." },
    { "label": "Priority topics/queues", "detail": "Route to per-channel, per-priority queues (e.g. push-high, email-bulk) so OTPs never queue behind a campaign." },
    { "label": "Channel workers", "detail": "Render template, run idempotency/de-dup check, call provider under its rate limit, retry transient errors with backoff." },
    { "label": "Providers", "detail": "APNs/FCM (push), Twilio (SMS), SES/SendGrid (email). Each has its own limits, error codes, delivery callbacks." },
    { "label": "DLQ", "detail": "Messages that exhaust retries land here for inspection, alerting, and manual/automated replay." }
  ],
  "note": "Status updates (sent/delivered/failed) flow back via provider webhooks into a status store the API can query."
}
```

**Data model (no exotic store needed):**
- **Notification intent** (the logical request): `notification_id`, `idempotency_key` (unique), `user_id`,
  `event`, `priority`, `payload`, `created_at`, aggregate status. Keyed for fast idempotency lookup.
- **Channel-message** (one per fan-out leg): `message_id`, parent `notification_id`, `channel`,
  `provider`, `attempt`, `status`, `provider_message_id`, `last_error`.
- **User preferences:** per-(user, category, channel) enabled flag, locale, quiet-hours, device tokens.
- **Templates:** `template_id` + `version`, per-channel + per-locale body, variable schema.
- **De-dup keys:** a short-TTL store (Redis) holding `seen:{idempotency_key}:{channel}` so a redelivered
  message is dropped before the provider call.

The backbone is a **message queue / pub-sub** (Kafka or SQS+SNS): it **buffers bursts**, **decouples**
the fast API from slow providers, and gives **at-least-once** delivery with replay.

## 5 · Deep dives

### 5a · Fan-out and the transactional outbox

The ingest step does two things that must not diverge: **persist the intent** and **publish an event**.
If you write to the DB and then publish to the queue as two separate calls, a crash in between leaves you
either with a saved notification nobody will send, or a sent notification nobody recorded.

The fix is the **transactional outbox** (a prerequisite chapter): in the same DB transaction that writes
the intent, append a row to an `outbox` table; a separate relay reads the outbox and publishes to the
queue, marking rows done. The DB write and the "intent to publish" commit atomically; the relay
guarantees the event eventually reaches the queue **at least once**.

```reveal
{
  "prompt": "Where does fan-out happen, and why expand one event into many channel-messages rather than letting a single worker handle all channels?",
  "answer": "Fan-out happens right after the preference lookup: one notification intent (event=order.shipped, user=u_123) becomes a set of independent channel-messages (push to device token X, email to address Y) — but only for channels the user has enabled for that category. Doing it this way, rather than one worker that sequentially sends push+SMS+email, matters because the channels are wildly different in latency, reliability, rate limit, and failure semantics. A push to APNs might take 50ms and rarely fail; an SMS via Twilio is slower, costs money, and has carrier-specific failures; email is slow and best-effort. If one worker handled all three in sequence, a slow or failing SMS provider would block the push, retries for one channel would re-trigger the others (duplicate push because SMS failed), and you couldn't scale or rate-limit channels independently. By fanning out into separate per-channel messages on separate per-channel queues, each leg retries, rate-limits, dead-letters, and scales on its own, and a failure on one channel never duplicates or stalls another. This is the publish-subscribe pattern: the event is published once, and each channel is an independent subscriber."
}
```

### 5b · Idempotency and de-duplication (so a user isn't notified twice)

Duplicates enter from three places (producer retry, queue at-least-once redelivery, provider call
ambiguity). You defend in layers:

```compare
{
  "options": [
    { "label": "At ingest (collapse duplicate requests)", "points": ["Unique constraint on idempotency_key", "Second POST with same key returns the original notification_id, doesn't re-queue", "Stops producer-side double-submits", "Cheap: one indexed lookup"] },
    { "label": "At the worker (drop redeliveries)", "points": ["Before the provider call, SETNX seen:{key}:{channel} in Redis with a TTL", "If the key already exists, ack and skip — a redelivered message is silently dropped", "Stops queue at-least-once duplicates", "TTL must exceed max retry window"] },
    { "label": "Provider-side keys", "points": ["Pass an idempotency key to the provider when supported (e.g. SES/Stripe-style)", "Provider itself collapses your retries of the same send", "Covers the 'sent but timed out' ambiguity", "Not all providers support it — fall back to the Redis check"] }
  ]
}
```

The subtle one is the **"sent but timed out"** case: the worker calls the provider, the provider accepts
the message, but the response is lost (network blip). The worker doesn't know it succeeded, so it
retries — a duplicate. Mitigations: set the de-dup key **before** the call (so a retry after a crash is
caught), prefer providers that accept an **idempotency key**, and treat ambiguous timeouts as "probably
sent" for transactional messages where a missed send is worse than a rare dupe — or the reverse for
expensive SMS, where a rare miss beats double-charging.

```reveal
{
  "prompt": "If the queue is at-least-once and the de-dup key has a TTL, what breaks if the TTL is too short — and why not just store de-dup keys forever?",
  "answer": "The de-dup key must outlive the longest possible time a duplicate could still arrive — which is the full retry window plus any queue redelivery delay. If the TTL is shorter, here's the failure: a message is processed and sent, the key is set, then it expires; meanwhile a redelivery of that same message (queued before, delayed by backoff or a slow consumer) finally arrives, finds no key, and sends again — a duplicate, exactly what you were preventing. So TTL must be >= max(retry backoff schedule, visibility-timeout redelivery window) with margin. You don't keep keys forever because the de-dup store is hot in-memory state (Redis) sized for cost and speed; with tens of millions of messages a day, infinite retention is huge and pointless — once a message is past any possible redelivery, its key can never collide again. The durable record of 'this notification was sent' lives in the channel-message table for audit; Redis only needs the key long enough to catch in-flight duplicates. A common choice: TTL of 24–48h, comfortably beyond a retry window measured in minutes to hours."
}
```

### 5c · Per-provider rate limits, retries, and the DLQ

Each provider enforces its own ceiling and returns a mix of **transient** (429, 5xx, timeout) and
**permanent** (invalid token, unsubscribed, malformed) errors. The worker's job is to **pace to the
ceiling** and **classify the error**:

- **Rate limiting outbound:** each channel worker holds a **token bucket per provider** (recall the rate
  limiter design) sized to that provider's documented limit, so you never exceed it and trigger
  throttling. Spread across workers via a shared counter or per-shard buckets.
- **Retry transient errors with exponential backoff + jitter:** `delay = base * 2^attempt + random`. Jitter
  prevents a **thundering herd** where thousands of failed messages retry in lockstep and re-overload the
  provider. Cap attempts (e.g. 5).
- **Don't retry permanent errors:** an invalid device token or "user unsubscribed" will never succeed —
  retrying wastes work and quota. Route straight to handling (prune the token / record opt-out).
- **Dead-letter queue (a prerequisite chapter):** a message that exhausts retries, or is a poison message
  (always crashes the worker), goes to a **DLQ** instead of being lost or blocking the queue. The DLQ is
  inspected, alerted on, and replayed after a fix.

```sequence
{
  "title": "A push message: rate-limited send, retry, then DLQ",
  "actors": ["Queue", "PushWorker", "Redis", "APNs", "DLQ"],
  "steps": [
    { "from": "Queue", "to": "PushWorker", "label": "deliver channel-message (attempt 1)" },
    { "from": "PushWorker", "to": "Redis", "label": "SETNX seen:{key}:push (de-dup) + take token from bucket" },
    { "from": "PushWorker", "to": "APNs", "label": "send push" },
    { "from": "APNs", "to": "PushWorker", "label": "503 Service Unavailable (transient)" },
    { "from": "PushWorker", "to": "Queue", "label": "nack → redeliver after backoff (2s, 4s, 8s…)" },
    { "from": "PushWorker", "to": "DLQ", "label": "after 5 failed attempts → dead-letter for inspection/replay" }
  ]
}
```

```tradeoff
{
  "title": "How aggressively should a failed send retry?",
  "axis": { "left": "Few retries / give up fast", "right": "Many retries / persistent" },
  "steps": [
    { "label": "1–2 retries, short backoff", "detail": "Low latency to DLQ, minimal duplicate risk and provider load — but transient blips (a 30s provider hiccup) cause avoidable failures. Good for low-value marketing." },
    { "label": "~5 retries, exponential + jitter", "detail": "The default: rides out short outages, spreads load, caps total delay to minutes. Balances delivery rate against duplicate/cost risk for most traffic." },
    { "label": "Many retries over hours", "detail": "Maximizes eventual delivery for critical transactional messages, but ties up workers, raises duplicate risk, and delays the DLQ signal. Use only for must-deliver, idempotent sends." }
  ]
}
```

### 5d · Prioritization

An OTP and a weekly digest cannot share a FIFO queue — a 10M-message campaign would bury the OTP for
half an hour. Isolate by **separate queues/topics per (channel, priority)**: `push-transactional`,
`push-bulk`, `sms-transactional`, etc. Workers drain high-priority queues first (or dedicate worker pools
to them), and the bulk lane is **rate-limited below** the provider ceiling so it can never starve the
transactional lane of provider quota. This is the same idea as multiple service classes — physical
separation beats a single queue with "priority" flags that backpressure can still clog.

## 6 · Trade-offs & failure modes

- **At-least-once transport + de-dup, not true exactly-once.** Real systems don't get exactly-once
  delivery for free; you approximate it with at-least-once queues plus idempotent processing. Accept that
  a rare duplicate is possible and choose, per channel, whether to bias toward never-miss or never-dupe.
- **Provider outage.** A provider can be down or throttling for minutes. The queue **buffers** during the
  outage; workers back off; if it's prolonged, messages age out to the DLQ. Multi-provider failover (send
  SMS via a backup carrier) adds resilience at the cost of complexity and another idempotency surface.
- **DLQ as a silent graveyard.** A DLQ with no alerting just loses messages quietly. It must page on
  growth, expose contents, and support **replay** — otherwise it's a hidden data-loss bug.
- **Preference staleness / quiet hours.** Sending after a user opted out (or at 3am) is a trust and
  sometimes legal (TCPA/GDPR) problem. Check preferences at fan-out *and* re-check at send for
  long-delayed messages.
- **Templating risks.** A bad template version can send broken or wrong-language messages to millions
  fast. Version templates, validate variables against a schema, and stage/canary template changes.
- **The status store is high-write.** Provider delivery webhooks generate a second flood of writes; size
  it for that and consider it eventually consistent.

## 7 · Scaling & evolution

- **Scale workers horizontally per channel/priority** independently — push needs different capacity than
  email — with each pool's concurrency capped by its provider's rate limit, not your hardware.
- **Shard de-dup and counters** (consistent hashing on idempotency_key) so the Redis layer scales past one
  node; size TTLs to keep memory bounded.
- **Campaign/scheduling layer** in front: rate-shape large campaigns over a window, support send-time
  optimization and time-zone-aware delivery, and let it draw from the same pipeline at `bulk` priority.
- **Aggregation/digest:** batch many low-priority events into one notification ("5 new comments") to cut
  volume and user fatigue — done in the fan-out stage with a short collection window.
- **Multi-provider routing:** choose provider per message by cost, region, or health, with automatic
  failover; the idempotency layer keeps failover from duplicating sends.
- **In-app/websocket channel:** add a real-time channel as just another subscriber to the same event —
  the pub-sub fan-out makes new channels cheap to add.

## Self-test

```quiz
{
  "question": "A worker calls the SMS provider; the provider sends the text but the HTTP response is lost to a timeout. With at-least-once queues, what's the main risk and the standard mitigation?",
  "options": [
    "No risk — timeouts mean the message wasn't sent",
    "The message is retried and the user gets a duplicate SMS; mitigate with a de-dup key set before the call and/or a provider idempotency key",
    "The queue automatically prevents all duplicates",
    "The worker should immediately dead-letter the message"
  ],
  "answer": 1,
  "explanation": "An ambiguous timeout means the send may have succeeded; retrying causes a duplicate (and for SMS, double cost). Setting the de-dup key before the call and using a provider idempotency key collapses the retry."
}
```

```quiz
{
  "question": "Why route OTPs and a 10M-user marketing campaign to separate queues instead of one queue with a priority flag?",
  "options": [
    "Priority flags are not supported by any queue",
    "A single queue can let the campaign's backlog delay OTPs for a long time; physically separate (channel, priority) queues and worker pools keep the transactional lane fast and isolate provider quota",
    "It saves storage",
    "Separate queues guarantee exactly-once delivery"
  ],
  "answer": 1,
  "explanation": "Shared FIFO buries urgent messages behind the bulk backlog. Dedicated queues/pools per (channel, priority), with the bulk lane rate-limited below the provider ceiling, keep OTPs from starving."
}
```

```quiz
{
  "question": "What is the role of the dead-letter queue (DLQ) in this design?",
  "options": [
    "To store every message ever sent for analytics",
    "To hold messages that exhausted retries or are poison (always crash the worker), so they don't block the queue or vanish — then be alerted on and replayed",
    "To rate-limit the providers",
    "To de-duplicate notifications"
  ],
  "answer": 1,
  "explanation": "The DLQ isolates undeliverable/poison messages from the live pipeline. It must alert on growth and support inspection and replay; otherwise it's a silent graveyard that hides data loss."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Notification system — key terms",
  "cards": [
    { "front": "Fan-out", "back": "Expanding one notification intent into N independent per-channel messages (push/SMS/email) for the channels a user has enabled — each retried and scaled on its own." },
    { "front": "Idempotency key", "back": "A caller-supplied key for a logical notification; a unique constraint at ingest plus a short-TTL de-dup check at the worker collapse retries so the user isn't notified twice." },
    { "front": "Transactional outbox", "back": "Write the intent and an outbox row in one DB transaction; a relay publishes the outbox to the queue, so the DB write and the event publish never diverge on a crash." },
    { "front": "Backoff + jitter", "back": "Retry transient failures after exponentially growing, randomized delays, so retries don't stampede the recovering provider (thundering herd)." },
    { "front": "Dead-letter queue (DLQ)", "back": "A side queue for messages that exhaust retries or poison the worker; inspected, alerted on, and replayed — not silently dropped." },
    { "front": "Priority isolation", "back": "Separate queues/worker pools per (channel, priority) so urgent OTPs never queue behind a bulk campaign, with the bulk lane capped below the provider's rate limit." }
  ]
}
```

## Key takeaways

- A notification system is a **reliable async fan-out pipeline**: one event → N channel-messages → flaky
  external providers. The queue **decouples** the fast API from slow providers and **buffers bursts**.
- **Duplicates are inherent** to retries + at-least-once queues; design for **at-most-once user-visible
  effect** with an idempotency key at ingest and a de-dup check (set *before* the provider call) at the
  worker.
- **Respect each provider's rate limit** (token bucket per provider), **retry transient errors with
  exponential backoff + jitter**, never retry permanent ones, and **dead-letter** what exhausts retries.
- **Isolate priority** with separate queues/pools so transactional messages never starve behind bulk;
  apply **preferences/opt-out** at fan-out and re-check at send.
- Use a **transactional outbox** so the persisted intent and the published event can't diverge, and keep
  the **DLQ alerted-on and replayable** so it never becomes a silent data-loss sink.

## Concepts exercised

This design applies, end to end: `message-queues` and `publish-subscribe` (the buffering, decoupling
backbone that fans one event out to independent per-channel subscribers) · `idempotency-and-safe-methods`
(caller-supplied idempotency keys and the de-dup check that turns at-least-once transport into an
at-most-once user effect) · `transactional-outbox` (committing the intent and the publish atomically) ·
`dead-letter-queues` (isolating poison and retry-exhausted messages for replay). It also draws on
`rate-limiting`/token-bucket (per-provider pacing), `consistent-hashing` (sharding de-dup keys and
counters), `backpressure-and-load-shedding` and `single-point-of-failure` (provider outages, the queue as
shock absorber), and `caching-fundamentals` + TTL (the de-dup key store).
