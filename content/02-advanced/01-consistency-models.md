---
title: "Consistency Models"
slug: consistency-models
level: advanced
module: correctness-and-consensus
order: 1
reading_time_min: 17
concepts: [linearizability, sequential-consistency, causal-consistency, eventual-consistency, read-your-writes, monotonic-reads]
use_cases: []
prerequisites: [cap-theorem, logical-clocks-and-vector-clocks, replication-strategies]
status: published
---

# Consistency Models

## Hook — a motivating scenario

"Eventually consistent" and "strongly consistent" are thrown around like binary options, but between
them lies a **spectrum** of precise guarantees — and choosing the right point on it is one of the most
consequential decisions in distributed data. Pick too strong and you pay in latency/availability; too
weak and users see impossible states (their own post vanishes, a counter goes backward). A
**consistency model** is the exact contract for *what a read is allowed to return* given concurrent
writes across replicas.

## Mental model — a contract for what reads can see

A consistency model defines the **guarantees about the order and visibility of operations** that a
distributed system promises clients. Stronger models are easier to reason about (behave more like a
single machine) but cost more latency and availability (recall CAP); weaker models are faster and more
available but admit surprising behaviors your app must handle.

```layers
{
  "title": "Consistency spectrum (strongest on top → weakest below)",
  "layers": [
    { "label": "Linearizability", "detail": "Acts like ONE copy: every read sees the latest completed write, in real-time order. Strongest, costliest.", "meta": "strongest" },
    { "label": "Sequential consistency", "detail": "All nodes see operations in the same order, consistent with each client's program order — but not necessarily real-time.", "meta": "strong" },
    { "label": "Causal consistency", "detail": "Causally-related operations are seen in order everywhere; concurrent ops may differ. Preserves cause→effect.", "meta": "middle" },
    { "label": "Eventual consistency", "detail": "Replicas converge if writes stop. No ordering guarantees meanwhile. Weakest, fastest, most available.", "meta": "weakest" }
  ]
}
```

## Build it up — the major models

- **Linearizability (strong):** the system behaves as if there's a **single copy** of the data and
  every operation happens **atomically at a single instant** between its call and return. A read
  *always* returns the most recent completed write, in real-time order. Easiest to reason about;
  requires coordination (consensus/quorums) → higher latency, reduced availability under partition (CP).
- **Sequential consistency:** all nodes agree on **one global order** of operations that respects each
  client's own program order — but that order needn't match real-time (an operation can appear to take
  effect later than it really did). Weaker than linearizability (no real-time guarantee).
- **Causal consistency:** operations that are **causally related** (recall happens-before/vector
  clocks) are seen in the same order by everyone; **concurrent** operations may be seen in different
  orders. It preserves cause-and-effect (your reply never appears before the message it answers) while
  staying highly available — the strongest model achievable under partitions.
- **Eventual consistency:** the only promise is that **if writes stop, replicas converge** to the same
  value. Meanwhile reads can be stale, reordered, or non-monotonic. Fastest and most available (AP).

```reveal
{
  "prompt": "What's the precise difference between linearizability and sequential consistency?",
  "answer": "Both provide a single global order of operations that all nodes agree on and that respects each client's program order. The difference is real-time: linearizability additionally requires that order to match the actual wall-clock ordering of non-overlapping operations — if write W completes before read R begins (in real time), R must see W (or a later value). Sequential consistency drops that real-time constraint: it only needs *some* global order consistent with each process's own order, so an operation can appear to take effect at a different real-time moment than it actually did, as long as everyone sees the same overall sequence. Practically: under linearizability, once your write returns, every subsequent read anywhere sees it; under mere sequential consistency, a later read on another client might still legally return the old value because the agreed order placed it earlier — even though in real time the write already finished. Linearizability = sequential + real-time recency, which is why it's strictly stronger (and costlier, needing tighter coordination)."
}
```

Slide from the strongest model to the weakest to see what you gain and what you give up:

```tradeoff
{ "title": "How strong should the consistency contract be?", "axis": { "left": "Strong (linearizable)", "right": "Weak (eventual)" }, "steps": [ { "label": "Linearizability", "detail": "Single-copy + real-time recency: a read always sees the latest completed write. Easiest to reason about, but needs coordination (consensus/quorums) → higher latency, reduced availability under partition (CP)." }, { "label": "Sequential consistency", "detail": "One global order respecting each client's program order, but not real-time. An operation can appear to take effect later than it really did. Weaker than linearizability, no real-time guarantee." }, { "label": "Causal consistency", "detail": "Causally-related operations seen in order everywhere; concurrent ones may differ. Preserves cause→effect while staying highly available — the strongest model achievable under partitions." }, { "label": "Eventual consistency", "detail": "Only promise: if writes stop, replicas converge. Reads may be stale, reordered, or non-monotonic meanwhile. Fastest and most available (AP)." } ] }
```

## Build it up — client-centric guarantees (the practical middle)

Beyond the global models, **session/client-centric guarantees** describe what *one user* experiences —
often what actually matters for UX, and cheaper than full linearizability:
- **Read-your-writes:** you always see your own writes (recall the replication-lag fix — route your
  reads to the primary or wait). Prevents "I posted, then it vanished."
- **Monotonic reads:** you never see time go backward (once you've read a value, you won't later read
  an older one). Prevents a refresh showing *older* data.
- **Monotonic writes / writes-follow-reads:** your writes apply in order; writes respect the reads
  they were based on.

These are often layered on an eventually-consistent store to give a sane per-user experience without
paying for global strong consistency.

```reveal
{
  "prompt": "An eventually-consistent app is mostly fine, but users complain their own just-posted comment disappears on refresh, and sometimes the comment list 'goes backward.' Which guarantees fix each, without going fully linearizable?",
  "answer": "The vanishing own-comment is a read-your-writes violation: after the user's write hits one replica, their refresh read hit a lagging replica that didn't have it yet. Fix with read-your-writes consistency: route a user's reads to a replica known to have their writes (e.g. the primary, or a replica caught up to their write's position), or pin them briefly after a write, or read the value from a cache. The 'list goes backward' (seeing older data after newer) is a monotonic-reads violation, caused by successive reads hitting replicas at different lag. Fix with monotonic reads: pin a user's session to a single replica (or one that's at least as fresh as their last read) so they never regress. Both are session/client-centric guarantees you can provide atop an eventually-consistent store, giving each user a coherent experience while keeping the system's overall availability/latency benefits — far cheaper than enforcing global linearizability for everyone."
}
```

## In the wild

- **Linearizability:** coordination/config stores and consensus systems (etcd, ZooKeeper, Spanner
  reads, a single-leader DB read on the leader) — where correctness demands it.
- **Causal consistency:** the sweet spot for many collaborative/social systems (COPS, MongoDB causal
  sessions) — strongest you can keep while staying available (recall CAP).
- **Eventual + client-centric guarantees:** Dynamo-style stores (DynamoDB, Cassandra) often add
  read-your-writes/monotonic reads per session for sane UX.
- **Tunable per operation:** quorum settings (R+W>N, recall) and "bounded staleness" let you pick a
  point on the spectrum per query.

## Common misconception — "consistency is just strong vs eventual"

It's a spectrum with precise, named levels — and the middle is where most real systems live.

```reveal
{
  "prompt": "Why is framing consistency as a binary 'strong vs eventual' choice misleading in practice?",
  "answer": "Because there's a whole spectrum of precise models between the extremes, and most production systems deliberately sit in the middle rather than at either end. 'Strong' usually means linearizability — maximally easy to reason about but expensive (coordination, higher latency, reduced availability under partition); 'eventual' means only convergence with no ordering, which is cheap/available but lets users see incoherent states. In between: sequential consistency (global order, no real-time), causal consistency (preserves cause→effect while staying available — often the practical best under partitions), and session/client-centric guarantees (read-your-writes, monotonic reads) that fix the worst user-visible anomalies cheaply on top of an eventual store. Treating it as binary makes you either over-pay for full linearizability where causal+session guarantees would do, or ship 'eventual' and get burned by vanishing/regressing data you could have prevented. The real engineering choice is selecting the weakest model that still gives correct behavior for each piece of data — and that's almost never just 'strong or eventual.'"
}
```

Consistency is a **spectrum** — linearizable → sequential → causal → eventual — plus **client-centric**
guarantees (read-your-writes, monotonic reads). Stronger = easier reasoning but costlier; pick the
**weakest model that's still correct** for each dataset.

## Self-test

```quiz
{
  "question": "Linearizability is stronger than sequential consistency because it additionally requires:",
  "options": [
    "Lower latency",
    "Real-time recency — a read after a write completes (in real time) must see that write",
    "Eventual convergence only",
    "No global order"
  ],
  "answer": 1,
  "explanation": "Both give a single global order respecting program order; linearizability adds the real-time constraint (reads see the latest completed write)."
}
```

```quiz
{
  "question": "A user's own just-written data disappearing on the next read is a violation of:",
  "options": [
    "Monotonic reads",
    "Read-your-writes consistency",
    "Linearizability only",
    "Durability"
  ],
  "answer": 1,
  "explanation": "Read-your-writes guarantees you always see your own writes; the fix is routing your reads to a replica that has them (or the primary)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Consistency models — key terms", "cards": [ { "front": "Consistency model", "back": "The precise contract for what a read is allowed to return given concurrent writes across replicas — the guarantees about order and visibility of operations a system promises clients." }, { "front": "Linearizability", "back": "Strongest model: behaves as a single copy where each op takes effect atomically at one instant; a read always returns the latest completed write in real-time order. Needs coordination (CP)." }, { "front": "Sequential consistency", "back": "All nodes agree on one global order respecting each client's program order, but not necessarily real-time. Weaker than linearizability because it drops the real-time recency guarantee." }, { "front": "Causal consistency", "back": "Causally-related operations are seen in the same order everywhere; concurrent ones may differ. Preserves cause→effect while staying available — the strongest model achievable under partitions." }, { "front": "Eventual consistency", "back": "Weakest model: the only promise is that if writes stop, replicas converge. Meanwhile reads can be stale, reordered, or non-monotonic. Fastest and most available (AP)." }, { "front": "Read-your-writes / monotonic reads", "back": "Client-centric guarantees: read-your-writes means you always see your own writes; monotonic reads means you never read an older value after a newer one. Cheaply fix UX anomalies atop eventual stores." } ] }
```

## Key takeaways

- A **consistency model** is the precise contract for **what reads may return** under concurrent
  writes; it's a **spectrum**, not strong-vs-eventual.
- **Linearizability** (single-copy + real-time) > **sequential** (global order, no real-time) >
  **causal** (preserves cause→effect, stays available) > **eventual** (converges, no ordering).
- **Client-centric guarantees** (read-your-writes, monotonic reads) cheaply fix the worst user-visible
  anomalies atop eventual stores.
- Stronger models cost **latency/availability** (CAP) — choose the **weakest model that's still
  correct** per dataset; often **causal + session** guarantees.

## Up next

Let's go deep on the model that's the practical ceiling under partitions. Next: **Causal Consistency**.
