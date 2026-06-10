---
title: "The Thundering Herd Problem"
slug: thundering-herd
level: advanced
module: resilience
order: 36
reading_time_min: 13
concepts: [thundering-herd, cache-stampede, jitter, request-coalescing, backoff, synchronized-clients]
use_cases: []
prerequisites: [cascading-failure-prevention, caching-patterns-overview, availability-and-the-nines]
status: published
---

# The Thundering Herd Problem

## Hook — a motivating scenario

A popular cache key expires. In the same instant, 10,000 in-flight requests all miss, all stampede the
database to recompute the *same* value simultaneously, and the database — sized for cached traffic —
falls over. Or: a service blips, 10,000 clients all retry at *exactly* the same second, and the
recovering service is instantly re-crushed. These are **thundering herds** — many actors doing the same
thing at the same moment — and they turn a small event into an outage.

## Mental model — synchronized demand spikes overwhelm a resource

Picture a **herd of cattle** crowded against a single narrow gate. While the gate stays shut they wait
calmly, but the **instant** it swings open every animal charges it at once — and the gate (built to pass
a steady trickle) is trampled. The gate isn't undersized for the *day's* traffic; it's undersized for
the *synchronized* surge. The fixes map straight onto this image: **spread the herd out** so they arrive
a few at a time (jitter), or **let one through and pass the result back** to the rest so the gate is only
crossed once (coalescing). It's the same picture as everyone hitting refresh on a ticket site at the
exact on-sale second.

A **thundering herd** happens when **many clients/requests act simultaneously**, creating a sudden,
synchronized spike that overwhelms a resource. The danger is the **synchronization** — the same work,
all at once — not the total amount over time. Classic triggers:
- **Cache stampede:** a hot key expires → all concurrent requests miss → all recompute/refetch at once
  (recall caching: cache misses).
- **Synchronized retries:** a dependency recovers (or many clients fail together) → everyone retries in
  the same instant → re-overload.
- **Synchronized timers/cron:** all clients poll or run a job on the same schedule (e.g. exactly on the
  minute) → simultaneous load.
- **Wake-on-event:** an event wakes all waiters at once (the original OS "thundering herd"), most of
  which find nothing to do.

```stepper
{
  "title": "A cache-stampede thundering herd",
  "steps": [
    { "title": "1 · Hot key cached", "body": "One popular key serves thousands of requests/sec from cache — DB barely touched." },
    { "title": "2 · Key expires", "body": "TTL elapses (or eviction). The next requests all miss simultaneously." },
    { "title": "3 · Stampede", "body": "Thousands of concurrent misses ALL hit the DB to recompute the SAME value at once." },
    { "title": "4 · Overload", "body": "The DB (sized for cached load) is swamped → latency spikes / failure → possible cascade." }
  ]
}
```

## Build it up — the defenses

The fixes all aim to **de-synchronize** or **deduplicate** the simultaneous work:
- **Jitter (randomization):** add randomness so actions **spread out** instead of aligning — randomize
  cache TTLs (so keys don't all expire together), and add **jitter to retry backoff** (recall:
  exponential backoff **+ jitter**) so clients don't retry in lockstep. The single most important
  trick.
- **Request coalescing / single-flight:** when many requests need the same uncached value, let **one**
  do the work while the others **wait for that result** — collapsing thousands of identical
  recomputations into one (recall cache stampede mitigation).
- **Early/probabilistic refresh (stale-while-revalidate):** refresh a hot key **before** it expires (in
  the background), or have only one request probabilistically refresh ahead of time — so the key never
  hard-expires under load (recall cache invalidation).
- **Locks/leases:** a per-key lock so only the lock-holder recomputes; others use the stale value or
  wait.

```reveal
{
  "prompt": "Why is adding jitter (randomization) such a powerful defense against thundering herds, across both cache expiry and retries?",
  "answer": "Because the root cause of a thundering herd is synchronization — many actors doing the same thing at the same instant — and jitter directly breaks that synchronization by spreading actions randomly over a window instead of aligning them. For cache expiry: if many keys are created/refreshed together (e.g. at deploy, or all with the same TTL), they expire together, causing a mass simultaneous miss/stampede; adding random jitter to each key's TTL (say, base ± a random spread) staggers expirations so misses are smeared across time, and the backend sees a manageable trickle of recomputations rather than a spike. For retries: when a dependency fails or recovers, all clients tend to retry on the same schedule (especially with fixed intervals or pure exponential backoff that everyone computes identically), so retries arrive in synchronized waves that re-crush the recovering service; adding jitter to the backoff (randomizing each client's wait) desynchronizes them so retries arrive spread out, letting the service recover and absorb load gradually. In both cases jitter converts a tall, narrow spike (which exceeds capacity and causes failure) into a low, wide distribution (which fits within capacity) — the same total work over time, but no instantaneous overload. It's powerful because it's cheap, simple, requires no coordination between clients, and attacks the fundamental issue (alignment) rather than symptoms; a few lines of randomization can be the difference between a smooth recovery and a self-inflicted outage. This is why 'exponential backoff WITH jitter' and 'randomized TTLs' are standard practice — the jitter, not just the backoff, is what prevents the synchronized herd. (Coalescing/single-flight complements it by also deduplicating identical concurrent work, but jitter is the broad, general desynchronizer.)"
}
```

## Build it up — combining defenses

In practice you layer them:
- For **cache stampedes:** randomized TTLs **+** single-flight/coalescing **+** stale-while-revalidate —
  so keys don't expire together, only one request recomputes, and hot keys refresh ahead of expiry.
- For **retry storms:** exponential backoff **+ jitter**, **circuit breakers** (recall — stop retrying a
  dead dependency), and **caps** on concurrent retries.
- For **synchronized schedules:** spread cron/poll times with jitter; avoid "everyone on the minute."
- It connects to **cascading failures** (recall): a thundering herd is a common *trigger*, and circuit
  breakers / load shedding are part of the defense.

```reveal
{
  "prompt": "How does request coalescing (single-flight) complement jitter, and when is each the right tool?",
  "answer": "They attack two different aspects of the herd, so they're complementary. Jitter desynchronizes WHEN actions happen — it spreads a synchronized spike over time so the resource isn't hit all at once. Request coalescing (single-flight) deduplicates WHAT work happens — when many concurrent requests need the SAME uncached value, it lets exactly one of them do the expensive computation/fetch while the others wait for and share that single result, collapsing thousands of identical operations into one. Use jitter when the problem is alignment of many DIFFERENT (or repeated-over-time) actions: randomized TTLs so many keys don't expire together, jittered retry backoff so clients don't retry in lockstep, staggered cron/poll schedules. Use coalescing when the problem is many SIMULTANEOUS requests for the SAME thing: a single hot key expiring with thousands of concurrent readers all wanting to recompute it — jitter on its own TTL doesn't help once it's expired and the herd is already waiting, but single-flight ensures only one recompute hits the backend and everyone else gets that result. In a cache stampede you typically want BOTH: randomized TTLs so hot keys don't all expire at the same moment (jitter, spreading different keys), AND single-flight per key so that when one key does expire, the concurrent misses for that key are coalesced into one backend call (dedup, for the same key) — often plus stale-while-revalidate so the key refreshes before expiry under load. So: jitter spreads load across time and across many keys/clients; coalescing collapses duplicate concurrent work for a single item. Neither replaces the other — jitter wouldn't dedup a single hot key's concurrent misses, and coalescing wouldn't prevent many different keys expiring together — and robust systems combine them with circuit breakers/caps for retries."
}
```

## In the wild

- **Caching layers** combat stampedes with **randomized TTLs, single-flight/coalescing
  (Go's `golang.org/x/sync/singleflight`), and stale-while-revalidate** (CDNs, Redis
  patterns — recall caching chapters).
- **Client SDKs / retry libraries** use **exponential backoff + jitter** (AWS SDK default) and circuit
  breakers to avoid retry storms.
- **Scheduling:** jittered cron and randomized poll intervals avoid synchronized "on the minute" spikes.
- The original **"thundering herd"** is the OS problem of waking all waiters on one event (e.g.
  `accept()` on many processes) — solved by waking one.

## Common misconception — "exponential backoff alone prevents retry storms"

Without **jitter**, backoff just makes everyone retry in lockstep at the *same* (longer) intervals.

```reveal
{
  "prompt": "Why is exponential backoff WITHOUT jitter still vulnerable to retry-storm thundering herds?",
  "answer": "Because exponential backoff alone only changes HOW LONG clients wait between retries, not whether they're synchronized — and if clients fail together and all compute the same backoff schedule, they stay aligned, just retrying at the same longer intervals. Picture a dependency that goes down: thousands of clients fail at roughly the same moment and all start backing off identically (wait 1s, then 2s, then 4s…). Without jitter, they all retry at ~1s together, all fail, all wait ~2s together, all retry at ~3s together, and so on — the retries arrive in synchronized waves, each wave a spike that re-crushes the (possibly recovering) dependency. Backoff made the waves less frequent, but each wave is still a thundering herd, and when the dependency finally comes back, the next synchronized wave can immediately knock it down again, preventing recovery. Jitter fixes this by randomizing each client's wait (e.g. random between 0 and the backoff bound, or backoff ± random spread), so retries are smeared across the interval instead of landing simultaneously — converting synchronized spikes into a smooth, manageable trickle that lets the dependency recover and absorb load gradually. That's why the correct, widely-recommended pattern is 'exponential backoff WITH jitter' (and bounded retries + circuit breakers), not backoff alone: backoff controls rate over time, jitter breaks the synchronization that causes the herd. Omitting jitter is a common, subtle mistake that leaves systems exposed to retry storms despite 'having backoff.'"
}
```

A **thundering herd** is a **synchronized** spike of identical work (cache stampede, retry storm,
on-the-minute jobs) that overwhelms a resource. Defend by **de-synchronizing** (**jitter** on TTLs and
**backoff**) and **deduplicating** (**single-flight/coalescing**, stale-while-revalidate, per-key
locks), plus **circuit breakers/caps** for retries. **Backoff without jitter** still herds.

## Self-test

```quiz
{
  "question": "A 'thundering herd' problem is fundamentally caused by:",
  "options": [
    "Too little total traffic",
    "Many actors doing the same thing at the same instant (synchronized spike) — e.g. a hot key expiring or all clients retrying together",
    "Slow disks",
    "Using a CDN"
  ],
  "answer": 1,
  "explanation": "It's the synchronization (same work, all at once) that overwhelms the resource — cache stampedes, retry storms, on-the-minute jobs."
}
```

```quiz
{
  "question": "Which pair of techniques best defends against thundering herds?",
  "options": [
    "Bigger timeouts and more replicas",
    "Jitter (randomize TTLs/backoff to de-synchronize) and request coalescing/single-flight (dedupe identical concurrent work)",
    "Removing the cache",
    "Retrying faster"
  ],
  "answer": 1,
  "explanation": "Jitter spreads actions over time; coalescing collapses duplicate concurrent work into one — together they prevent synchronized stampedes."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Thundering herd — key terms", "cards": [
  { "front": "Thundering herd", "back": "A synchronized spike of many actors doing the same work at the same instant, overwhelming a resource. The danger is the synchronization, not the total volume over time." },
  { "front": "Cache stampede", "back": "A hot cache key expires (or is evicted) and all concurrent requests miss simultaneously, all hitting the DB to recompute the same value at once." },
  { "front": "Jitter", "back": "Adding randomness so actions spread out instead of aligning — randomized cache TTLs and randomized retry backoff so clients don't act in lockstep. The single most important defense." },
  { "front": "Request coalescing / single-flight", "back": "When many requests need the same uncached value, let one do the work while the others wait for and share that result, collapsing identical recomputations into one." },
  { "front": "Stale-while-revalidate / early refresh", "back": "Refresh a hot key in the background before it expires (or have one request probabilistically refresh ahead of time) so the key never hard-expires under load." },
  { "front": "Why backoff alone fails", "back": "Exponential backoff without jitter only changes how long clients wait, not whether they're synchronized — they retry in lockstep at the same longer intervals, still herding." }
] }
```

## Key takeaways

- A **thundering herd** is a **synchronized** spike of identical work overwhelming a resource — **cache
  stampedes**, **retry storms**, **on-the-minute** jobs, wake-all events.
- The danger is **synchronization**, not total volume — defend by **de-synchronizing** with **jitter**
  (randomized **TTLs** and retry **backoff**).
- **Deduplicate** identical concurrent work with **single-flight/coalescing**, **stale-while-revalidate**
  (refresh hot keys before expiry), and **per-key locks/leases**.
- **Backoff without jitter still herds**; combine jitter + coalescing + **circuit breakers/caps** — it's
  a common **trigger of cascading failures**.

## Up next

When load (or data) concentrates on one partition. Next: **Hot Partitions**.
