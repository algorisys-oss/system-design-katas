---
title: "Multi-Region Consistency"
slug: multi-region-consistency
level: advanced
module: global-scale
order: 30
reading_time_min: 15
concepts: [multi-region-consistency, cross-region-latency, bounded-staleness, regional-quorum, pacelc, cache-coherence]
use_cases: []
prerequisites: [multi-region-active-active, consistency-models, quorums-and-sloppy-quorums]
status: published
---

# Multi-Region Consistency

## Hook — a motivating scenario

A user in Europe updates their setting; a service in the US reads it 20ms later and gets the old value.
Across a single datacenter, replication lag is sub-millisecond; **across continents it's tens to
hundreds of milliseconds**, dictated by the **speed of light** (a round trip Europe↔US is ~80–150ms).
That physical floor changes everything about consistency: any cross-region coordination costs *that
much per operation*. Multi-region consistency is about choosing **how consistent across regions** you
can afford to be.

## Mental model — the speed of light sets the price

Within a region, nodes are close (sub-ms), so coordination is cheap. **Across regions, the network
round trip is bounded by physics** (distance ÷ ~speed of light in fiber) — ~80–150ms intercontinental.
So **strong cross-region consistency = paying that round trip on every coordinated operation** (recall
PACELC: even with no partition, there's an **Else Latency** cost). Multi-region consistency is the
spectrum (recall consistency models) applied across that expensive link:

```layers
{
  "title": "Cross-region consistency options (stronger/costlier on top)",
  "layers": [
    { "label": "Strong (synchronous global)", "detail": "Every write coordinates across regions (consensus/sync quorum) → correct everywhere, but pays cross-region latency (~100ms) per write.", "meta": "costliest" },
    { "label": "Bounded staleness", "detail": "Reads may lag by at most X seconds/versions — a tunable middle ground.", "meta": "middle" },
    { "label": "Causal + session guarantees", "detail": "Read-your-writes / monotonic reads per user; preserves cause→effect across regions while staying fast.", "meta": "middle" },
    { "label": "Eventual", "detail": "Async replication; regions converge later. Lowest latency, most available (active-active default).", "meta": "cheapest" }
  ]
}
```

## Build it up — the options and their costs

- **Strong (synchronous) cross-region:** writes go through **consensus or a synchronous quorum spanning
  regions**, so all regions agree (linearizable-ish). Correct and simple to reason about, but **every
  write pays ~100ms** cross-region latency → low write throughput, and reduced availability if a region
  is partitioned (CP). Used only when correctness demands it (e.g. global financial invariants), often
  with clever clocks (Spanner's TrueTime).
- **Bounded staleness:** reads are guaranteed to be **no more than X seconds (or N versions) behind** —
  a tunable knob between strong and eventual (offered by Cosmos DB, DynamoDB global tables variants).
- **Causal + session guarantees** (recall): give each user **read-your-writes / monotonic reads** so
  *their* experience is coherent across regions, without global coordination — often the practical
  sweet spot.
- **Eventual:** async replication, regions converge later — the **active-active default** (lowest
  latency, highest availability), with conflict resolution (recall CRDTs/LWW).

```reveal
{
  "prompt": "Why does strong consistency across regions cost roughly a fixed ~100ms per write, and how do bounded-staleness or causal/session guarantees soften that?",
  "answer": "Strong (linearizable) consistency requires that before a write is acknowledged, enough regions agree on it so that any subsequent read anywhere sees it — which means each write must complete a coordination round trip (consensus/synchronous quorum) across geographically distant regions. The latency of that round trip is bounded by physics: signals travel through fiber at roughly two-thirds the speed of light, so an intercontinental round trip is on the order of 80–150ms, and you pay that on every coordinated write regardless of how fast your servers are (this is PACELC's 'Else Latency' — the cost exists even with no partition). So strong cross-region consistency caps write throughput and adds large, irreducible latency, and under a partition it must block writes to stay correct (CP). Bounded staleness softens this by NOT coordinating every operation: writes commit locally/asynchronously and reads are merely guaranteed to be at most X seconds or N versions behind the latest — you accept a controlled, known amount of staleness in exchange for local-speed reads/writes, tuning X to your tolerance. Causal + session guarantees soften it differently: instead of a global recency guarantee, they ensure each USER sees a coherent view — their own writes (read-your-writes) and no going-backwards (monotonic reads), plus cause-before-effect ordering — which can be provided with metadata (versions/causal tokens) and local serving, no cross-region consensus per operation. So both avoid the per-write global round trip: bounded staleness bounds how stale reads can be; causal/session bounds the anomalies a single user can observe. They give 'strong enough' behavior for many apps (the user never sees their own update vanish or time go backward) at local latency, reserving full synchronous cross-region coordination for the rare data with global invariants that truly require it."
}
```

Slide from strongest to weakest cross-region guarantee and watch latency and availability trade against correctness:

```tradeoff
{ "title": "How consistent across regions should you be?", "axis": { "left": "Strong / synchronous global", "right": "Eventual / async" }, "steps": [ { "label": "Strong (synchronous global)", "detail": "Writes coordinate across regions via consensus or synchronous quorum, so all regions agree — but every write pays ~100ms cross-region latency and blocks under partition (CP). Use only for true global invariants." }, { "label": "Bounded staleness", "detail": "Reads are guaranteed no more than X seconds or N versions behind — a tunable knob between strong and eventual, letting you pick your staleness tolerance (e.g. Cosmos DB)." }, { "label": "Causal + session guarantees", "detail": "Read-your-writes and monotonic reads keep each user's view coherent across regions at local latency, without global coordination — often the pragmatic sweet spot." }, { "label": "Eventual", "detail": "Async replication; regions converge later with conflict resolution. Lowest latency and highest availability — the active-active default." } ] }
```

## Build it up — cache coherence across regions

Multi-region caching adds another layer: if each region caches data, an update in one region leaves the
**other regions' caches stale** until invalidated/refreshed — **cross-region cache coherence**. You
can't synchronously invalidate every region's cache cheaply (same latency problem), so options are:
**short TTLs** (accept bounded staleness), **event-based invalidation** propagated across regions
(eventually), or **versioned keys** (recall cache invalidation) — all converging to *eventual*
coherence across regions, just like the data.

```reveal
{
  "prompt": "An update in the EU region leaves the US region serving a stale cached value. Why can't you just synchronously invalidate the US cache, and what do you do instead?",
  "answer": "You can't cheaply synchronously invalidate the US cache for the same reason strong cross-region consistency is expensive: doing so on the write path means the EU write must wait for a cross-region round trip (~80–150ms) to the US (and every other region) to confirm invalidation before acknowledging — adding that physics-bound latency to every write and reducing availability if a region is unreachable. That defeats the low-latency purpose of regional caches and multi-region serving. So instead you accept eventual cross-region cache coherence and use asynchronous mechanisms: (1) short TTLs — each region's cache entry expires quickly, bounding how long stale data can be served (bounded staleness; trades freshness for no cross-region coordination); (2) event-based invalidation — the EU write publishes an invalidation/update event that propagates to other regions asynchronously (via a global event bus/replication stream), and each region invalidates/refreshes its cache when it arrives (fast in practice, but still async/eventual, and must tolerate lost/out-of-order events with idempotent handling); (3) versioned keys — include a version in the cache key/value so a reader can detect/skip stale entries once the new version's data replicates, avoiding explicit invalidation. In all cases the US cache becomes correct shortly after, not instantly, which mirrors the underlying data being eventually consistent across regions. Where a particular piece of data truly can't tolerate cross-region staleness, you don't cache it regionally (or you read it strongly from its home region), accepting higher latency for that data. The general rule: cross-region cache coherence is eventual by necessity (physics), so design with TTLs/event invalidation/versioning and tolerate a bounded staleness window rather than trying to coordinate caches synchronously across regions."
}
```

## In the wild

- **Spanner** achieves strong global consistency using **TrueTime** (tightly-bounded clocks + commit
  waits) — paying latency for correctness; **CockroachDB/YugabyteDB** use Raft per range across regions.
- **Cosmos DB** offers **five tunable consistency levels** (strong → bounded staleness → session →
  consistent prefix → eventual) — a concrete realization of this spectrum; **DynamoDB Global Tables**
  are eventually consistent multi-region.
- **Causal/session guarantees** (read-your-writes, monotonic reads) are the common pragmatic choice for
  global apps (recall consistency models).
- **Cross-region cache coherence** uses TTLs / event-based invalidation / versioned keys (recall cache
  invalidation) — eventual by necessity.

## Common misconception — "with enough engineering, you can have strong consistency globally with no latency cost"

Cross-region coordination is **bounded by the speed of light** — strong global consistency *always*
costs round-trip latency.

```reveal
{
  "prompt": "Why is 'strong global consistency with no latency penalty' physically impossible, no matter how good your engineering?",
  "answer": "Because strong (linearizable) consistency requires cross-region agreement before acknowledging a write — every region (or a quorum spanning regions) must coordinate so that any later read anywhere reflects the write — and that coordination requires information to travel between geographically distant regions. The minimum time for that travel is set by physics: no signal can move faster than the speed of light, and in real fiber it's roughly two-thirds of that, so an intercontinental round trip is fundamentally ~80–150ms (often more with real network paths). No amount of engineering can beat the speed of light, so any protocol that needs a cross-region round trip per operation inherits that latency floor — this is PACELC's 'Else Latency,' present even without partitions. Clever systems like Spanner reduce the pain (TrueTime bounds clock uncertainty so it can order transactions and only 'commit-wait' a small interval), but Spanner still pays latency for cross-region strong consistency — it manages the cost, it doesn't eliminate it. So you fundamentally cannot have writes that are both globally strongly consistent AND acknowledged at local (sub-ms) latency, because the consistency guarantee requires waiting for remote regions and the wait is physically lower-bounded. That's why real multi-region systems either (a) accept that strong cross-region data pays ~100ms/write and use it sparingly for true global invariants, or (b) choose weaker models (bounded staleness, causal/session, eventual) that serve locally and converge asynchronously, getting low latency by NOT coordinating every operation globally. 'No-latency global strong consistency' would require faster-than-light coordination, which is impossible — the engineering choice is which consistency level to pay for where, not how to avoid the physics."
}
```

Across regions, the **speed of light fixes a ~100ms round-trip floor**, so **strong global consistency
always costs cross-region latency per write** (PACELC). Real systems pick from a **spectrum** — strong
(costly), **bounded staleness**, **causal/session** (the pragmatic sweet spot), or **eventual**
(active-active default) — and cross-region **cache coherence is eventual** (TTL/event-invalidation/
versioning) for the same reason.

## Self-test

```quiz
{
  "question": "Why does strong consistency across regions inherently cost latency?",
  "options": [
    "Because databases are slow",
    "Each coordinated write needs a cross-region round trip, bounded by the speed of light (~80–150ms intercontinental) — PACELC's latency cost",
    "Because of DNS caching",
    "It doesn't — strong global consistency is free with good engineering"
  ],
  "answer": 1,
  "explanation": "Cross-region coordination requires a round trip bounded by physics; strong consistency pays it per write (the 'Else Latency' in PACELC)."
}
```

```quiz
{
  "question": "A common pragmatic middle ground for global apps that avoids per-write global coordination is:",
  "options": [
    "Strong synchronous consistency everywhere",
    "Causal + session guarantees (read-your-writes, monotonic reads) — coherent per-user experience without cross-region consensus",
    "No replication at all",
    "Caching everything forever"
  ],
  "answer": 1,
  "explanation": "Session/causal guarantees keep each user's view coherent (their writes visible, no regressions) at local latency, without global coordination."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Multi-region consistency — key terms", "cards": [ { "front": "Why does strong cross-region consistency cost ~100ms per write?", "back": "Each coordinated write needs a cross-region round trip (consensus/sync quorum), bounded by the speed of light in fiber — ~80–150ms intercontinental. This is PACELC's 'Else Latency'." }, { "front": "Bounded staleness", "back": "Reads are guaranteed to be no more than X seconds or N versions behind the latest — a tunable knob between strong and eventual consistency (e.g. Cosmos DB)." }, { "front": "Causal + session guarantees", "back": "Read-your-writes and monotonic reads keep each user's view coherent across regions without global coordination — the pragmatic sweet spot for many global apps." }, { "front": "PACELC", "back": "Even with no partition, there is an Else Latency cost: strong consistency requires cross-region coordination, so it always pays round-trip latency per coordinated operation." }, { "front": "Cross-region cache coherence", "back": "An update in one region leaves other regions' caches stale; you can't cheaply invalidate synchronously, so use short TTLs, event-based invalidation, or versioned keys — eventual by necessity." }, { "front": "How Spanner achieves strong global consistency", "back": "TrueTime — tightly-bounded clocks plus commit waits — lets it order transactions globally. It manages the cross-region latency cost but does not eliminate it." } ] }
```

## Key takeaways

- Across regions, the **speed of light** fixes a **~80–150ms round-trip floor**, so **cross-region
  coordination is expensive** — **strong global consistency costs that latency per write** (PACELC).
- Pick from the **spectrum**: **strong** (synchronous global — costly, for true global invariants),
  **bounded staleness** (tunable lag), **causal/session** (per-user coherence — pragmatic sweet spot),
  **eventual** (active-active default).
- **Cross-region cache coherence** is **eventual** by necessity — use **short TTLs, event-based
  invalidation, or versioned keys**.
- **Strong global consistency with zero latency cost is physically impossible** — choose which data pays
  for which level, where.

## Up next

Pushing compute and data even closer to users — past regions, to the edge. Next: **Edge Computing &
Caching**.
