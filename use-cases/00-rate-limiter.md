---
title: "Design a Rate Limiter"
slug: rate-limiter
level: use-cases
module: core-building-blocks
order: 0
reading_time_min: 18
concepts: [rate-limiting, token-bucket, sliding-window, distributed-counters, redis, fail-open]
use_cases: [rate-limiter]
prerequisites: [rate-limiting, caching-fundamentals, consistent-hashing, single-point-of-failure]
status: published
---

# Design a Rate Limiter

> **Use case:** a service that decides, for each incoming request, whether to **allow** it or
> **reject** it (HTTP 429) based on configurable limits — e.g. "100 requests per minute per API key."
> **Domain:** every API gateway, public API, login endpoint, and abuse-prevention layer.
> **Scale:** millions of requests/sec across many servers; the check must add **well under a
> millisecond** and stay correct when traffic is spread over a fleet.
> **Core challenges:** choosing an algorithm (accuracy vs cost), keeping **counters consistent across
> servers**, doing it **atomically**, handling **hot keys**, and deciding **fail-open vs fail-closed**.

This is the smallest "real" distributed-systems design — and a favorite opener — because a one-line
requirement ("limit requests") forces you to confront shared mutable state, atomicity, latency, and
failure all at once.

## 1 · Clarify requirements

**Functional**
- Limit requests per **key** (API key / user ID / IP) to **N per time window**.
- On exceed, **reject with 429** and helpful headers (`Retry-After`, `X-RateLimit-Remaining`).
- **Configurable rules** per route/tier (free vs paid), changeable without redeploy.

**Non-functional**
- **Low latency:** the check is on every request's hot path → sub-millisecond overhead.
- **Distributed:** many app servers / gateway nodes must enforce **one shared limit** per key.
- **Highly available:** the limiter must not take the whole API down if its datastore blips.
- **Accurate enough:** small over/under-counting at window edges is usually acceptable; double the
  limit is not.

```reveal
{
  "prompt": "Why is 'enforce one shared limit per key across many servers' the requirement that makes this hard, rather than the algorithm itself?",
  "answer": "On a single server a rate limiter is trivial: an in-memory counter per key. The difficulty is that real APIs run behind many app servers / gateway nodes, and a key's requests are load-balanced across all of them — so a '100/min' limit must be enforced against the SUM of what every server has seen, not each server independently. That forces shared, mutable, hot state: either a central store (e.g. Redis) every node reads/writes on each request (adding network latency and a dependency that can fail), or per-node local counters that must be reconciled (which drift and can let traffic exceed the limit). On top of that the increment-and-check must be atomic (concurrent requests to the same key race), it must be fast (it's on every request), and it must degrade gracefully when the store is slow/down (fail-open vs fail-closed). So the algorithm (token bucket, sliding window) is the easy part; coordinating accurate, atomic, low-latency, fault-tolerant shared counters across a fleet is the actual system-design problem."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Counter store throughput (one op per request)",
  "inputs": [
    { "key": "rps", "label": "Peak requests/sec", "default": 1000000 },
    { "key": "opsPerReq", "label": "Counter ops per request", "default": 1 }
  ],
  "formula": "rps * opsPerReq",
  "resultLabel": "Counter store operations/sec",
  "resultUnit": "ops/s"
}
```

```calc
{
  "title": "Memory for active counters",
  "inputs": [
    { "key": "keys", "label": "Active keys (users/IPs in a window)", "default": 10000000 },
    { "key": "bytesPerKey", "label": "Bytes per counter entry", "default": 100 }
  ],
  "formula": "keys * bytesPerKey",
  "resultLabel": "Counter memory",
  "resultUnit": "bytes"
}
```

> ~1M ops/sec against the counter store and ~1 GB of counters for 10M active keys — small enough to
> live **in memory** (Redis), but 1M ops/sec on one node is a lot, so we'll need **sharding** and care
> about **hot keys**. Counters are also short-lived (one window) → set a **TTL** so memory self-cleans.

## 3 · API & where it sits

The limiter is **middleware** at the edge (API gateway / reverse proxy) — recall the gateway's
cross-cutting role. Its core operation:

```
allow(key, rule) -> { allowed: bool, remaining: int, retryAfter: seconds }
```

Called once per request before routing; on `allowed=false`, return **429** immediately (cheap reject —
recall load shedding: reject early, before doing real work).

## 4 · The core decision: which algorithm?

Five classic algorithms trade **accuracy** against **memory/cost**:

```compare
{
  "options": [
    { "label": "Fixed window", "points": ["Count per fixed clock window (e.g. each minute)", "Tiny: one counter per key", "Allows 2× burst at the window boundary", "Simplest; least accurate"] },
    { "label": "Sliding window log", "points": ["Store timestamp of every request", "Exact — no boundary burst", "Memory grows with request rate (expensive)", "Most accurate; costliest"] },
    { "label": "Sliding window counter", "points": ["Weighted blend of current + previous window", "Near-exact, smooths the boundary", "One/two counters per key (cheap)", "The common production choice"] },
    { "label": "Token bucket", "points": ["Tokens refill at a rate; each request takes one", "Allows controlled bursts up to bucket size", "Two numbers per key (tokens, last-refill)", "Great for 'steady rate + burst'"] },
    { "label": "Leaky bucket", "points": ["Requests queue and drain at a fixed rate", "Smooths output to a constant rate", "Needs a queue", "Good for shaping, not just limiting"] }
  ]
}
```

```reveal
{
  "prompt": "Why does the naive 'fixed window' counter allow up to 2× the limit, and how do sliding-window approaches fix it?",
  "answer": "Fixed window counts requests per aligned clock interval (e.g. all requests stamped 12:00:00–12:00:59 share one counter that resets at 12:01:00). The flaw is the boundary: a client can send N requests at 12:00:59 and another N at 12:01:00 — both windows allow N, so 2N requests go through in a ~1-second span even though the limit is N/minute. The burst is concentrated exactly at the reset. Sliding window log fixes it exactly by storing each request's timestamp and counting only those within the trailing window (e.g. last 60s from now), so there's no reset to game — but it costs memory proportional to the request rate. Sliding window counter approximates that cheaply: it keeps the current and previous fixed-window counts and computes a weighted estimate based on how far into the current window you are (e.g. 25% into this minute → 75% of the previous window's count + this window's count). That smooths the boundary to near-exact accuracy using just one or two integers per key, which is why it's the typical production choice. Token bucket also avoids the hard reset by refilling continuously rather than resetting, allowing bounded bursts instead of a 2× spike."
}
```

Drag the dial — more accuracy costs more memory/compute per key:

```tradeoff
{
  "title": "How accurate does the limiter need to be?",
  "axis": { "left": "Cheap / approximate", "right": "Exact / costly" },
  "steps": [
    { "label": "Fixed window", "detail": "One integer per key, O(1). Accepts a 2× burst at window edges — fine for coarse abuse limits where occasional overage is harmless." },
    { "label": "Sliding window counter", "detail": "One or two integers per key; weighted blend removes the boundary burst to near-exact. The sweet spot for most APIs." },
    { "label": "Token bucket", "detail": "Two numbers per key; enforces a steady rate while allowing controlled bursts — ideal when bursty-but-bounded traffic is desirable." },
    { "label": "Sliding window log", "detail": "A timestamp per request: exact, no edge effects, but memory grows with traffic. Reserve for low-volume, must-be-precise limits." }
  ]
}
```

## 5 · Deep dive: distributed counters, atomically

Where do the counters live, and how do concurrent requests not corrupt them?

```sequence
{
  "title": "A request through a centralized (Redis) limiter",
  "actors": ["Client", "GatewayNode", "Redis", "Service"],
  "steps": [
    { "from": "Client", "to": "GatewayNode", "label": "request (api-key=K)" },
    { "from": "GatewayNode", "to": "Redis", "label": "atomic INCR counter:K (+ set TTL) via Lua script" },
    { "from": "Redis", "to": "GatewayNode", "label": "new count (e.g. 101)" },
    { "from": "GatewayNode", "to": "Client", "label": "101 > 100 → 429 + Retry-After" },
    { "from": "GatewayNode", "to": "Service", "label": "(if allowed) forward request" }
  ]
}
```

- **Centralized store (Redis):** all nodes increment **one shared counter per key**, so the limit is
  globally accurate. The increment-and-check must be **atomic** — use Redis `INCR`/`INCRBY` or a **Lua
  script** (or a token-bucket script) so concurrent requests to the same key can't race past the limit
  (recall: this is the same read-modify-write hazard transactions solve).
- **Sharding:** at ~1M ops/sec, shard the counter store by **consistent hashing on the key** (recall) so
  each key maps to one node and load spreads — but watch **hot keys** (a single huge API key) which a
  later section addresses.
- **TTL:** counters expire at the window end, so memory self-cleans (recall caching TTL).

```reveal
{
  "prompt": "Why must the increment-and-check be atomic, and what specifically goes wrong if it isn't?",
  "answer": "Because many concurrent requests for the same key arrive at the same moment (that's exactly when a key is near its limit), and each does read-count → compare-to-limit → write-incremented-count. If those steps aren't atomic, requests interleave: two requests both read count=99, both see 99 < 100 (allowed), both write 100 — so two requests passed when only one should have, and under high concurrency the limit can be blown by a large margin. This is the classic lost-update / time-of-check-to-time-of-use race. The fix is to make the whole read-modify-write a single atomic operation at the store: Redis INCR returns the post-increment value atomically (so you compare the returned value to the limit, never a stale read), and for token-bucket logic (which reads tokens, computes refill, decrements, writes back) you wrap it in a Lua script that Redis executes atomically as one unit. Atomicity ensures every request observes and updates a consistent counter, so concurrency can't smuggle extra requests past the limit — the same correctness guarantee a database transaction provides for a balance update, applied to the rate counter."
}
```

## 6 · Trade-offs & failure modes

- **The store is a dependency on the hot path.** A central Redis adds a network round trip to every
  request and is a potential **SPOF/bottleneck** (recall). Mitigate: replicate it, shard it, and run it
  near the gateways.
- **Fail-open vs fail-closed.** If the counter store is unreachable, do you **allow** all traffic
  (fail-open: protect availability, risk abuse) or **reject** it (fail-closed: protect the backend,
  cause an outage)? Most user-facing APIs **fail open** for the limiter (better to skip limiting than to
  go down); abuse/security-critical limits may fail closed.
- **Hot key.** One enormous API key concentrates all its counter ops on a single shard (recall hot
  partitions). Mitigate: a **local pre-check** (token bucket in memory) that only consults the central
  store periodically, or shard a hot key with suffixes.
- **Latency.** The synchronous central check costs a round trip; the local-token-bucket approach
  (below) trades a little global accuracy for near-zero latency.

```tradeoff
{
  "title": "When the counter store is unreachable, the limiter should…",
  "axis": { "left": "Fail open (availability)", "right": "Fail closed (protection)" },
  "steps": [
    { "label": "Fail open", "detail": "Allow requests through unlimited. The API stays up; the risk is unthrottled abuse/overload during the outage. Default for most user-facing APIs." },
    { "label": "Degrade locally", "detail": "Fall back to a coarse per-node local limit (no global coordination) — keeps some protection without depending on the store." },
    { "label": "Fail closed", "detail": "Reject requests the limiter can't vet. Protects the backend from abuse but turns a limiter outage into an API outage. Reserve for security-critical limits." }
  ]
}
```

## 7 · Scaling & evolution

- **Local token bucket + async sync:** each node keeps an in-memory bucket and periodically reconciles
  with the central store — sub-microsecond checks, slightly looser global accuracy. The standard way to
  shed the per-request round trip at scale.
- **Sidecar / service mesh:** push limiting into the mesh's sidecar (recall API gateway vs service
  mesh) so every service gets consistent limiting for free.
- **Tiered rules & dynamic config:** store rules in a config service the gateways watch, so limits
  change without redeploy.
- **Layered limits:** per-IP (anti-DDoS at the edge/CDN) + per-API-key (fairness) + per-endpoint
  (protect expensive routes).

## Self-test

```quiz
{
  "question": "A 'fixed window' counter limited to 100/min can let through how many requests around a window boundary?",
  "options": ["Exactly 100", "Up to ~200 in a short span (a burst across the reset)", "Unlimited", "Exactly 50"],
  "answer": 1,
  "explanation": "100 at the end of one window + 100 at the start of the next pass within seconds. Sliding-window counter or token bucket removes this boundary burst."
}
```

```quiz
{
  "question": "Why must a distributed rate limiter's increment-and-check be atomic (e.g. Redis INCR / a Lua script)?",
  "options": [
    "To save memory",
    "Otherwise concurrent requests to the same key race (read 99, all see <100, all pass) and blow the limit",
    "To avoid using a network",
    "To make it fail closed"
  ],
  "answer": 1,
  "explanation": "Non-atomic read-modify-write lets interleaved requests all read a stale count and pass — the limit gets exceeded. Atomicity prevents the race."
}
```

```quiz
{
  "question": "If the central counter store goes down, a typical user-facing API rate limiter is configured to:",
  "options": [
    "Fail closed — reject all requests",
    "Fail open — allow requests (skip limiting) so the API stays up, accepting temporary abuse risk",
    "Crash the gateway",
    "Switch to a SQL database"
  ],
  "answer": 1,
  "explanation": "Most user-facing limiters fail open (availability over protection); security-critical limits may fail closed. Degrading to a local limit is a middle ground."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Rate limiter — key terms",
  "cards": [
    { "front": "Fixed window", "back": "Count requests per aligned clock window; cheap (one counter) but allows a ~2× burst at the window boundary." },
    { "front": "Sliding window counter", "back": "Weighted blend of current + previous window counts; near-exact and cheap — the common production choice." },
    { "front": "Token bucket", "back": "Tokens refill at a steady rate; each request consumes one. Enforces a rate while allowing bounded bursts (bucket size)." },
    { "front": "Atomic increment-and-check", "back": "Read-modify-write on the counter done as one indivisible op (Redis INCR / Lua) so concurrent requests can't race past the limit." },
    { "front": "Fail-open vs fail-closed", "back": "When the counter store is down: allow all (protect availability) vs reject all (protect the backend). Most user APIs fail open." },
    { "front": "Hot key", "back": "One key (huge API client) concentrating counter ops on a single shard; mitigate with local pre-checks or key-splitting." }
  ]
}
```

## Key takeaways

- A rate limiter looks trivial but forces **shared mutable state across a fleet** — the real problem is
  **accurate, atomic, low-latency, fault-tolerant counters**, not the algorithm.
- Pick the algorithm by **accuracy vs cost**: **fixed window** (cheap, edge-burst), **sliding window
  counter** (near-exact, cheap — the default), **token bucket** (rate + bursts), **sliding window log**
  (exact, costly).
- Distribute via a **central atomic counter** (Redis `INCR`/Lua) **sharded by consistent hashing**, with
  a **TTL**; for scale, use a **local token bucket + async sync** to drop the per-request round trip.
- Decide **fail-open vs fail-closed** deliberately (most user APIs fail open), and handle **hot keys**
  and the **store as a hot-path dependency/SPOF**.

## Concepts exercised

This design applies, end to end: `rate-limiting` (foundations) · `caching-fundamentals` + TTL ·
`consistent-hashing` (sharding the counters) · `database-transactions` (the atomic read-modify-write
hazard) · `single-point-of-failure` + `backpressure-and-load-shedding` (fail-open, cheap reject) ·
`hot-partitions` (hot keys) · `api-gateway` / `api-gateway-vs-service-mesh` (where it runs).
