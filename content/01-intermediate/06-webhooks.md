---
title: "Webhooks"
slug: webhooks
level: intermediate
module: architecture-and-services
order: 6
reading_time_min: 13
concepts: [webhooks, callbacks, polling, signatures, retries, idempotency]
use_cases: []
prerequisites: [synchronous-vs-asynchronous-communication, idempotency-and-safe-methods, http-status-codes]
status: published
---

# Webhooks

## Hook — a motivating scenario

Your app needs to know when a customer's payment succeeds at a third-party provider. The naive
approach: poll their API every few seconds — "is it done yet? is it done yet?" — wasting requests,
adding latency, and hammering their rate limits. The better way: the provider **calls you** the moment
it happens. That reversed, event-driven HTTP callback is a **webhook** — "don't call us, we'll call
you."

## Mental model — reverse API call (a doorbell, not checking the door)

A normal API call: *you* request, *they* respond. A **webhook flips it**: *they* make an HTTP
request to *your* URL when an event occurs. You register a URL ("when a payment succeeds, POST to
`https://myapp.com/hooks/payments`"), and the provider pushes the event to you. It's polling's
opposite: instead of repeatedly checking the door, you install a doorbell.

```sequence
{
  "title": "Polling vs webhook",
  "actors": ["MyApp", "Provider"],
  "steps": [
    { "from": "MyApp", "to": "Provider", "label": "poll: any update? (repeat, mostly 'no')" },
    { "from": "Provider", "to": "MyApp", "label": "not yet…" },
    { "from": "MyApp", "to": "Provider", "label": "register webhook URL once" },
    { "from": "Provider", "to": "MyApp", "label": "POST event the instant it happens" },
    { "from": "MyApp", "to": "Provider", "label": "200 OK (acknowledge fast)" }
  ]
}
```

## Build it up — getting webhooks right

Receiving a webhook is receiving an untrusted HTTP request that you don't control the timing of, so
three concerns dominate:

- **Verify authenticity (signatures).** Anyone could POST to your public URL. Providers sign each
  payload (HMAC with a shared secret) and include the signature in a header; you recompute and
  compare. Most providers (e.g. Stripe) sign a **timestamp + payload**, so reject **stale timestamps**
  to defeat replayed (captured-and-resent) requests, and use a **constant-time comparison** when
  checking the HMAC to avoid leaking it via timing attacks. Never trust an unverified webhook.
- **Acknowledge fast, process async.** Return `200` quickly; do the real work in the background
  (recall sync-vs-async). If you do slow work inline, the provider may time out and **retry**, causing
  duplicates.
- **Expect retries → be idempotent.** Webhooks are **at-least-once**: providers retry on non-2xx or
  timeout, so the same event can arrive multiple times. Use the event's ID as an **idempotency key**
  (recall the idempotency chapter) so processing it twice is harmless.

```reveal
{
  "prompt": "A provider sends the same 'payment succeeded' webhook twice and your system credits the customer twice. What two things were missing?",
  "answer": "(1) Idempotency: you processed the event by its arrival rather than de-duplicating on the event's unique ID, so a retry double-applied it. Record processed event IDs (or use them as an idempotency key) and ignore repeats. (2) Likely also slow inline processing: if you did the crediting synchronously and were slow, the provider timed out and retried — so acknowledge fast (200) and process in the background. Webhooks are at-least-once by design; duplicates are expected, and idempotent handling is mandatory, not optional."
}
```

## Build it up — reliability and the receiver's burden

Webhooks shift work to the **receiver**:
- **You must be reachable and up.** If your endpoint is down, you miss events (providers retry for a
  while, then give up). Mitigate by acknowledging fast and queueing internally (durable processing),
  and by supporting **replay**/backfill for missed events.
- **Ordering isn't guaranteed.** Events may arrive out of order; don't assume sequence — reconcile by
  IDs/timestamps or fetch current state.
- **Local development is awkward** (your laptop isn't a public URL) — tools like tunnels (ngrok) or
  provider test consoles help.

```reveal
{
  "prompt": "Why is it risky to do all your webhook processing synchronously before returning 200, and what's the better pattern?",
  "answer": "If processing is slow or a downstream dependency hiccups, the provider's request times out before you respond — it treats that as a failure and retries, creating duplicate deliveries (and your endpoint looks unreliable). Worse, a burst of webhooks can overwhelm you if each holds the connection during heavy work. Better: validate the signature, persist the raw event to a durable queue, and return 200 immediately; a background worker processes it (idempotently) at its own pace. This decouples acknowledgement from processing — fast acks, no spurious retries, and you absorb spikes via the queue."
}
```

## In the wild

- **Payment providers (Stripe), GitHub, Slack, CI systems** all use webhooks for events
  (payment.succeeded, push, message) — with **signed payloads** and **documented retry policies**.
  Concretely: **Stripe** retries failed deliveries with exponential backoff for up to **3 days**, and
  expects a `2xx` response within about **20 seconds** or it treats the delivery as failed; **GitHub**
  considers a delivery failed if your endpoint doesn't respond within **10 seconds** (per their
  respective webhook docs).
- The robust receiver pattern: **verify signature → enqueue → 200 → process idempotently in the
  background** (ties together async, idempotency, queues).
- **Webhooks vs polling:** webhooks are efficient and near-real-time but put reliability on the
  receiver; polling is simple and receiver-controlled but wasteful and laggy. Some systems offer both.
- For high-volume internal eventing, providers/orgs often graduate to **message queues / event
  streams** (next module) instead of HTTP webhooks.

## Common misconception — "a webhook is just an API call; handle it inline and trust it"

Both halves are dangerous.

```reveal
{
  "prompt": "What's wrong with treating an incoming webhook like a trusted, exactly-once, synchronous request?",
  "answer": "Trusted: your webhook URL is public, so anyone can POST forged events — you must verify the provider's signature (HMAC) before acting, or attackers can fake 'payment succeeded'. Exactly-once: webhooks are at-least-once; retries on timeouts/non-2xx mean duplicates are normal, so you must de-duplicate via event IDs (idempotency) and not assume ordering. Synchronous: doing heavy work before responding invites timeouts → retries → more duplicates and overload; acknowledge fast and process async. Treating webhooks as trusted/exactly-once/inline leads to forged events, double-processing, and cascading retries — the three classic webhook bugs."
}
```

A webhook is an **untrusted, at-least-once, push** delivery. Verify its signature, acknowledge fast,
and process idempotently in the background — anything less invites forgery, duplicates, and retry
storms.

## Self-test

```quiz
{
  "question": "A webhook is best described as:",
  "options": [
    "Polling an API on a timer",
    "A reversed HTTP call: the provider POSTs an event to your registered URL when it happens",
    "A type of database index",
    "A WebSocket connection"
  ],
  "answer": 1,
  "explanation": "Webhooks invert the request direction — the server pushes events to your URL, replacing inefficient polling."
}
```

```quiz
{
  "question": "Because webhooks are delivered at-least-once (providers retry), receivers must:",
  "options": [
    "Process each event synchronously before responding",
    "Be idempotent — de-duplicate by event ID so repeats are harmless",
    "Trust any POST to the URL",
    "Disable retries"
  ],
  "answer": 1,
  "explanation": "Retries cause duplicate deliveries; idempotent processing (keyed on event ID) makes handling the same event twice safe."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Webhooks — key terms", "cards": [ { "front": "Webhook", "back": "A reversed HTTP call: the provider POSTs an event to a URL you registered the moment the event happens, replacing wasteful polling. 'Don't call us, we'll call you.'" }, { "front": "Webhook vs polling", "back": "Webhooks are efficient and near-real-time but push reliability onto the receiver; polling is simple and receiver-controlled but wasteful and laggy." }, { "front": "Signature verification", "back": "Your webhook URL is public, so anyone could POST forged events. Providers sign each payload (HMAC with a shared secret); you recompute and compare before acting." }, { "front": "At-least-once delivery", "back": "Providers retry on non-2xx or timeout, so the same event can arrive multiple times. Duplicates are expected by design, not an error." }, { "front": "Idempotency key (webhooks)", "back": "Use the event's unique ID to de-duplicate so processing the same event twice is harmless. Record processed IDs and ignore repeats." }, { "front": "Acknowledge fast, process async", "back": "Return 200 quickly and do the real work in the background. Slow inline processing risks provider timeouts, which trigger retries and duplicates." } ] }
```

## Key takeaways

- A **webhook** is a reversed API call: the provider **pushes** an event to your registered URL —
  efficient and near-real-time, replacing wasteful **polling**.
- Treat it as **untrusted**: verify the **signature** (HMAC) before acting.
- It's **at-least-once**: acknowledge fast with `200`, **process asynchronously**, and be
  **idempotent** (de-dup by event ID); don't assume ordering.
- The receiver owns reliability (uptime, retries, replay) — the robust pattern is **verify → enqueue →
  200 → process idempotently**.

## Up next

That completes services & architecture. Next module tackles data at scale — starting with **Database
Replication**.
