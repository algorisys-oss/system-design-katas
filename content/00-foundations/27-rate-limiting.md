---
title: "Rate Limiting"
slug: rate-limiting
level: foundations
module: apis-and-the-web
order: 27
reading_time_min: 14
concepts: [rate-limiting, token-bucket, sliding-window, throttling, 429, fairness]
use_cases: []
prerequisites: [http-status-codes, api-gateway]
status: published
---

# Rate Limiting

## Hook — a motivating scenario

A buggy client gets stuck in a loop and hammers your API 10,000 times a second. Without protection,
it exhausts your database connections and **every other user's requests start failing** — one
misbehaving caller takes down the service for everyone. Rate limiting is the seatbelt that caps how
many requests a caller can make, protecting the system and sharing capacity fairly.

## Mental model — a bouncer with a counter

A rate limiter is a bouncer at the door who counts how often each guest enters and says "you've had
enough for now, come back later." It protects the venue (your backend) from being overwhelmed and
keeps any one guest from hogging the place. When a caller exceeds the limit, you return **429 Too
Many Requests** (recall status codes), ideally with a `Retry-After` header telling them when to try
again.

## Build it up — common algorithms

The classic algorithms trade accuracy for simplicity:

```compare
{
  "options": [
    { "label": "Fixed window", "points": ["N requests per clock window (e.g. 100/min)", "Simple counter per window", "Bursts at window edges (2N across a boundary)", "Cheap, approximate"] },
    { "label": "Sliding window", "points": ["Counts over a rolling time range", "Smooths the edge-burst problem", "More accurate, a bit more state", "Common in practice"] },
    { "label": "Token bucket", "points": ["Tokens refill at a steady rate; each request spends one", "Allows controlled bursts up to bucket size", "Smooth average rate + burst tolerance", "Very popular"] }
  ]
}
```

**Token bucket** is the most-loved: a bucket holds up to *B* tokens and refills at *R* tokens/sec.
Each request takes a token; if the bucket is empty, the request is limited. This permits short bursts
(up to B) while enforcing a steady average rate (R) — matching real traffic, which is bursty.

```reveal
{
  "prompt": "Why can a naive 'fixed window' limit of 100/minute actually allow ~200 requests in a short span?",
  "answer": "The counter resets at each minute boundary. A client can send 100 requests at 11:00:59 (end of one window) and another 100 at 11:01:00 (start of the next) — ~200 requests in about a second, even though each window individually stayed under 100. Sliding-window or token-bucket approaches smooth this by considering a rolling time range or steady refill instead of a hard reset."
}
```

Sizing the token bucket is itself a dial — bucket size *B* trades strict steady-rate enforcement against tolerance for the bursts real traffic produces:

```tradeoff
{ "title": "How big should the token bucket be?", "axis": { "left": "Small B (strict rate)", "right": "Large B (burst-tolerant)" }, "steps": [
  { "label": "B = 1", "detail": "Effectively no burst allowance: requests are paced to the refill rate R. Strictest protection, but bursty real traffic gets limited even when average usage is fine." },
  { "label": "Small B", "detail": "A little headroom for short spikes while still pinning the average to R. Backends stay well protected; occasional legitimate bursts may still hit the limit." },
  { "label": "Large B", "detail": "Generous bursts up to B tokens are allowed before limiting kicks in. Matches bursty traffic better, but a full bucket can briefly send a large spike at the backend." }
] }
```

## Build it up — limits, keys, and distribution

- **What you key on** matters: per **API key/user** (fair quotas), per **IP** (block abusive
  sources), or **global** (protect a fragile backend). Often several layers at once.
- **Where it runs:** usually at the **gateway/edge** so backends never see the excess traffic.
- **Distributed limiting:** with many gateway instances, the count must be **shared** (e.g. in Redis)
  so the limit is enforced across all of them, not per-instance.
- **Communicate limits:** return `429` + `Retry-After`, and often `X-RateLimit-Limit/Remaining/Reset`
  headers so well-behaved clients can self-throttle.

```reveal
{
  "prompt": "You run 5 gateway instances, each enforcing '100 req/min per user' with its own in-memory counter. What's wrong?",
  "answer": "The user can actually do ~500/min — 100 at each of the 5 instances, since each counts independently. To enforce a true global 100/min, the counter must be shared across instances (e.g. an atomic counter in Redis). Per-instance in-memory limits multiply the real limit by the number of instances. Distributed rate limiting needs shared state."
}
```

## In the wild

- **Every major API** rate-limits (GitHub, Stripe, Twitter/X) and returns 429 + limit headers; SDKs
  back off on 429.
- **Token bucket** underlies many gateways and cloud throttles; **Redis** is the common shared store
  for distributed counters.
- **Layered limits:** burst vs sustained, per-user vs per-IP vs global, plus stricter limits on
  expensive endpoints (login, search).
- **Related defenses:** load shedding (drop low-priority work under stress) and backpressure — rate
  limiting is the first, simplest layer.

## Common misconception — "rate limiting is only about stopping malicious attackers"

Its biggest everyday value is protecting you from *accidents* and ensuring fairness.

```reveal
{
  "prompt": "Even with no attackers, why is rate limiting essential?",
  "answer": "Most overload is accidental: a buggy retry loop, a runaway batch job, a popular customer's traffic spike, or a thundering herd after a cache expiry. Without limits, one caller can exhaust shared resources (DB connections, CPU) and degrade the service for everyone. Rate limiting enforces fairness and gives the system a safety valve — protecting availability regardless of intent. It's a reliability tool first, a security tool second."
}
```

Rate limiting is fundamentally about **protecting availability and fairness** — accidental overload
is far more common than malicious attacks, and the limiter guards against both.

## Self-test

```quiz
{
  "question": "Which algorithm allows controlled bursts while enforcing a steady average rate?",
  "options": ["Fixed window", "Token bucket", "No limit", "Round robin"],
  "answer": 1,
  "explanation": "Token bucket refills at a steady rate (average) but lets requests spend accumulated tokens (bursts up to bucket size)."
}
```

```quiz
{
  "question": "When a client exceeds the rate limit, the appropriate response is:",
  "options": [
    "200 OK with empty body",
    "429 Too Many Requests, ideally with Retry-After",
    "404 Not Found",
    "Silently drop the connection"
  ],
  "answer": 1,
  "explanation": "429 signals rate limiting; Retry-After tells the client when to try again so it can back off correctly."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Rate limiting — key terms", "cards": [
  { "front": "Rate limiting", "back": "Capping how many requests a caller can make to protect the system and share capacity fairly, guarding against accidental overload as much as attacks." },
  { "front": "Token bucket", "back": "A bucket holds up to B tokens and refills at R tokens/sec; each request spends one. Allows bursts up to B while enforcing a steady average rate R." },
  { "front": "Fixed window", "back": "Counts N requests per clock window with a hard reset at each boundary. Simple but allows ~2N requests across a window edge." },
  { "front": "Sliding window", "back": "Counts requests over a rolling time range instead of a fixed clock window, smoothing the edge-burst problem at the cost of a bit more state." },
  { "front": "429 + Retry-After", "back": "The response when a caller exceeds the limit: 429 Too Many Requests, ideally with Retry-After telling the client when to try again." },
  { "front": "Distributed limiting", "back": "With many gateway instances, the count must be shared (e.g. in Redis) so the limit is enforced across all of them, not per-instance." }
] }
```

## Key takeaways

- Rate limiting caps requests per caller to **protect availability and share capacity fairly** —
  guarding against accidents as much as attacks.
- Know the algorithms: **fixed window** (simple, edge bursts), **sliding window** (smoother), **token
  bucket** (steady rate + bursts, very common).
- Choose a **key** (user/IP/global), enforce at the **edge/gateway**, and use **shared state (Redis)**
  for distributed limits.
- Respond with **429 + Retry-After** (and limit headers) so clients can self-throttle.

## Up next

That completes APIs & the Web. Next module: how data is actually stored and queried — starting with
**SQL vs NoSQL**.
