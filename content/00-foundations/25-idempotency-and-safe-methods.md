---
title: "Idempotency & Safe Methods"
slug: idempotency-and-safe-methods
level: foundations
module: apis-and-the-web
order: 25
reading_time_min: 14
concepts: [idempotency, safe-methods, retries, idempotency-key, exactly-once, http-semantics]
use_cases: []
prerequisites: [http-fundamentals, http-status-codes]
status: published
---

# Idempotency & Safe Methods

## Hook — a motivating scenario

A customer taps "Pay" on a slow connection. The request times out, so the app retries automatically.
The payment actually went through both times — **they're charged twice**. The network, not the user,
caused a duplicate. In any system where requests can be retried (and they all can), the make-or-break
property is **idempotency**: can the same request be applied more than once without changing the
result?

## Mental model — light switch vs doorbell

- An **idempotent** action is like a light switch set to "on": flip it once or five times, the room is
  on. Doing it again has **no additional effect**.
- A **non-idempotent** action is like ringing a doorbell labeled "add one cookie to my order": each
  press adds another cookie. Repeat it and you get more than you wanted.

Two related-but-different terms:
- **Safe** = no side effects at all (pure read). GET is safe.
- **Idempotent** = repeating it gives the same end state (may have a side effect, but doing it twice
  ≠ doing it twice as much).

```compare
{
  "options": [
    { "label": "Safe (read-only)", "points": ["No side effects", "GET, HEAD", "Cacheable", "Retry freely"] },
    { "label": "Idempotent", "points": ["Same end state if repeated", "GET, PUT, DELETE", "Safe to retry", "May change state (once)"] },
    { "label": "Non-idempotent", "points": ["Each call adds an effect", "POST (by default)", "Risky to blindly retry", "Needs an idempotency key"] }
  ]
}
```

## Build it up — method semantics and the retry rule

HTTP defines these properties so the whole ecosystem can retry correctly:

```match
{
  "prompt": "Match each method to its property.",
  "pairs": [
    { "left": "GET", "right": "Safe + idempotent (pure read)" },
    { "left": "PUT (set to value X)", "right": "Idempotent (same result each time)" },
    { "left": "DELETE", "right": "Idempotent (already-deleted stays deleted)" },
    { "left": "POST (create)", "right": "Not idempotent by default" }
  ]
}
```

Why **PUT is idempotent but POST isn't:** `PUT /users/42 {name:"A"}` sets user 42's name to A —
applying it again yields the same state. `POST /users {name:"A"}` *creates* a user each time — two
calls = two users. That's why retrying a timed-out POST is dangerous (the opening double-charge).

```reveal
{
  "prompt": "Why is DELETE considered idempotent even though the second call 'does nothing'?",
  "answer": "Idempotency is about the *end state*, not the response. After DELETE /orders/7, order 7 is gone. Call it again: order 7 is still gone — same end state. The second call may return 404 instead of 204, but the resource's state is identical, so it's idempotent. You can safely retry a DELETE without corrupting anything."
}
```

## Build it up — making non-idempotent operations safe with an idempotency key

You can't make "create a payment" naturally idempotent — but you can make it *safe to retry* with an
**idempotency key**: the client generates a unique key per logical operation and sends it
(`Idempotency-Key: abc-123`). The server records the key with the result; if the same key arrives
again (a retry), it returns the **stored result instead of doing the work twice**.

```reveal
{
  "prompt": "How does an idempotency key turn a retried payment into a single charge?",
  "answer": "The client sends the same Idempotency-Key on the original request and any retry. On first receipt, the server processes the charge and saves (key → result). When the retry arrives with the same key, the server sees it already processed that key and returns the saved result without charging again. The network can retry freely; the operation happens exactly once. This is how Stripe and similar APIs make payments retry-safe."
}
```

## In the wild

- **Payment APIs (Stripe), message queues, and any "at-least-once" delivery** rely on idempotency
  keys — because retries and duplicate deliveries are inevitable. Stripe, for example, stores each
  idempotency key and its result for **24 hours**, so a retry within that window returns the saved
  response instead of charging again.
- **Client retry logic** should retry safe/idempotent requests freely (with backoff) and only retry
  non-idempotent ones if an idempotency key protects them.
- **"Exactly-once" is usually "at-least-once delivery + idempotent processing":** you can't prevent
  duplicates on the wire, so you make duplicates harmless.
- **PUT vs POST choice** in API design partly comes down to whether you want idempotent updates.

## Common misconception — "retries are safe / my network is reliable enough"

Duplicates aren't an edge case; they're a certainty at scale.

```reveal
{
  "prompt": "A request succeeds on the server but the response is lost on the way back, so the client retries. Did the operation happen 0, 1, or 2 times — and what should the design assume?",
  "answer": "It happened once (the server processed it), but the client doesn't know that — it only saw a timeout — so it retries, potentially making it happen twice. You can't distinguish 'request lost' from 'response lost' from the client side. Therefore design assuming retries will happen and make operations idempotent (naturally, or via idempotency keys). Hoping the network won't drop responses is not a strategy."
}
```

At scale, timeouts and lost responses are routine, so retries are routine, so duplicates are routine.
The robust answer isn't "retry less" — it's **make operations idempotent** so duplicates don't matter.

## Self-test

```quiz
{
  "question": "Which operation is NOT idempotent by default and risks duplicates on retry?",
  "options": ["GET /orders/7", "PUT /users/42 {name:'A'}", "DELETE /orders/7", "POST /orders {item:'book'}"],
  "answer": 3,
  "explanation": "POST create makes a new resource each call → two calls = two orders. GET/PUT/DELETE are idempotent."
}
```

```quiz
{
  "question": "An idempotency key makes a retried payment safe by:",
  "options": [
    "Encrypting the request",
    "Letting the server detect the duplicate key and return the stored result instead of charging again",
    "Making the network reliable",
    "Skipping authentication"
  ],
  "answer": 1,
  "explanation": "The server records key→result; a repeat key returns the saved result, so the charge happens exactly once."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Idempotency & safe methods — key terms", "cards": [
  { "front": "Safe method", "back": "A method with no side effects at all — a pure read. GET (and HEAD) are safe: they can be cached and retried freely." },
  { "front": "Idempotent method", "back": "Repeating the request yields the same end state. It may have a side effect, but doing it twice does not double the effect. GET, PUT, and DELETE are idempotent." },
  { "front": "Why is PUT idempotent but POST is not?", "back": "PUT sets a resource to a value, so reapplying it gives the same state. POST create makes a new resource each call, so two calls create two resources." },
  { "front": "Why is DELETE idempotent?", "back": "Idempotency is about end state, not the response. After deleting a resource it stays gone; a repeat call leaves the same end state even if it returns 404." },
  { "front": "Idempotency key", "back": "A unique client-generated key per logical operation (Idempotency-Key header). The server stores key to result and returns the saved result on a retry instead of doing the work twice." },
  { "front": "Exactly-once (in practice)", "back": "Usually means at-least-once delivery plus idempotent processing. You cannot stop duplicates on the wire, so you make duplicates harmless." }
] }
```

## Key takeaways

- **Safe** = no side effects (GET); **idempotent** = repeating yields the same end state (GET/PUT/DELETE);
  **POST** is non-idempotent by default.
- **Retry only idempotent/safe requests freely**; protect non-idempotent ones (e.g. payments) with an
  **idempotency key**.
- Idempotency is about the **end state**, not identical responses.
- At scale, **retries and duplicates are inevitable** — design operations to be idempotent rather than
  hoping the network behaves ("exactly-once" = at-least-once + idempotent processing).

## Up next

As APIs grow, a single entry point handles cross-cutting concerns (auth, rate limits, routing). Next:
**API Gateway**.
