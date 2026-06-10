---
title: "Causal Consistency"
slug: causal-consistency
level: advanced
module: correctness-and-consensus
order: 2
reading_time_min: 15
concepts: [causal-consistency, happens-before, causal-order, dependencies, availability]
use_cases: []
prerequisites: [consistency-models, logical-clocks-and-vector-clocks, cap-theorem]
status: published
---

# Causal Consistency

## Hook — a motivating scenario

On a social app, Alice posts "I lost my job 😢"; Bob replies "So sorry to hear that!" Carol, on a
different replica, sees **Bob's reply before Alice's post** — a baffling, context-free condolence. No
data was lost; the replicas just delivered causally-related events out of order. **Causal
consistency** is the model that forbids exactly this: effects never appear before their causes —
while still staying highly available.

## Mental model — preserve cause → effect, allow concurrent to differ

Causal consistency guarantees that operations with a **causal (happens-before) relationship** are seen
in that order by **everyone**, while **concurrent** operations (no causal link) may be seen in
different orders on different replicas. It's built directly on the **happens-before** relation and
**vector clocks** from earlier: track each write's causal dependencies and don't show a write until
its dependencies are visible.

So: a reply always appears after the message it answers (causal), but two unrelated posts may show in
either order on different replicas (concurrent — and that's fine).

```sequence
{
  "title": "Causal order enforced across replicas",
  "actors": ["Alice", "ReplicaX", "ReplicaY", "Carol"],
  "steps": [
    { "from": "Alice", "to": "ReplicaX", "label": "post P 'I lost my job'" },
    { "from": "ReplicaX", "to": "ReplicaY", "label": "reply R depends-on P (causal dep tracked)" },
    { "from": "ReplicaY", "to": "ReplicaY", "label": "R arrives but P not yet → WAIT (don't show R)" },
    { "from": "ReplicaX", "to": "ReplicaY", "label": "P arrives → now show P, then R" },
    { "from": "ReplicaY", "to": "Carol", "label": "Carol sees P before R ✓" }
  ]
}
```

## Build it up — why causal is the practical ceiling under partitions

Recall CAP: under a partition you can't have linearizability **and** availability. But causal
consistency **can** be provided while staying **available** (and low-latency) — it's the **strongest
consistency model achievable in an always-available system**. That's a powerful result: you can forbid
the "reply before post" anomaly without giving up availability.

How it's implemented: each write carries its **causal dependencies** (e.g. a vector clock / set of
versions it read). A replica **delays applying/showing a write until all its dependencies are
present** locally. Concurrent writes (no dependency) need no ordering, so they apply freely — keeping
the system fast and available.

```reveal
{
  "prompt": "Why can causal consistency stay available under a network partition while linearizability cannot?",
  "answer": "Linearizability requires every read to reflect the single most-recent completed write in real time, which demands coordination across replicas on every operation; under a partition, replicas can't coordinate, so to avoid returning stale/incorrect data they must refuse requests — sacrificing availability (CP). Causal consistency only requires preserving the happens-before order of *causally related* operations, which can be enforced locally using metadata that travels with each write (its causal dependencies): a replica simply delays showing a write until it has that write's dependencies, and otherwise serves reads and accepts writes freely. Crucially it does NOT require global agreement on the order of concurrent operations or real-time recency — so a partitioned replica can keep operating with the data it has, applying causally-ready writes and accepting new ones, and reconcile later. Because it never needs cross-replica coordination to answer a request, it stays available (and low-latency) even during partitions. That's why causal consistency is the strongest model compatible with availability — it captures the ordering humans actually notice (cause before effect) without the all-or-nothing recency that forces CP."
}
```

## Build it up — what it does and doesn't give you

- **Gives:** no causally-out-of-order anomalies (reply-before-post, see-an-edit-before-the-create),
  plus it naturally subsumes the **session guarantees** (read-your-writes, monotonic reads — your own
  actions are causally prior).
- **Doesn't give:** a total order or real-time recency. **Concurrent** conflicting writes can still
  diverge across replicas and must be resolved (LWW, merge, or CRDTs — next chapters). Causal
  consistency orders *cause and effect*, not *independent conflicts*.
- **Cost:** tracking and shipping causal metadata (dependency sets / vector clocks) and delaying writes
  until dependencies arrive — real overhead, and metadata can grow.

```reveal
{
  "prompt": "Causal consistency preserves cause→effect, so does it eliminate write conflicts? Why or why not?",
  "answer": "No. Causal consistency only orders operations that are causally related (one happened-before the other). It says nothing about *concurrent* operations — writes made independently without either seeing the other. Two users editing the same field on different replicas at the same time are concurrent: neither causally precedes the other, so causal consistency permits replicas to apply them in different orders and to diverge. That's a genuine conflict that still must be resolved by some other mechanism — last-write-wins (lossy), application-level merge, surfacing siblings to the client, or CRDTs that merge deterministically. So causal consistency removes the *ordering* anomalies humans notice (effects before causes) and provides session guarantees, but it does not remove the need for conflict resolution on concurrent writes. Cause-and-effect ordering and concurrent-conflict resolution are separate problems; causal consistency solves the first, not the second."
}
```

Slide along the consistency spectrum to see what each point buys and costs:

```tradeoff
{ "title": "Where does causal consistency sit on the consistency spectrum?", "axis": { "left": "Eventual (most available)", "right": "Linearizable (most consistent)" }, "steps": [ { "label": "Eventual", "detail": "Highly available and fast, but allows causally-out-of-order anomalies like a reply appearing before its post. Concurrent writes diverge and must be resolved." }, { "label": "Causal", "detail": "The strongest model achievable while staying available under partitions. Preserves cause→effect ordering and subsumes session guarantees; concurrent conflicts still need resolution." }, { "label": "Linearizable", "detail": "Total order plus real-time recency: every read reflects the latest completed write. Requires cross-replica coordination, so under a partition it must sacrifice availability (CP)." } ] }
```

## In the wild

- **Causally-consistent stores / sessions:** MongoDB causal-consistency sessions and COPS provide
  causal consistency as a store-level model. **Dynamo-style systems** like **Riak** use **version
  vectors** to *detect* concurrent writes and surface siblings (causal tracking) — Cassandra instead
  resolves conflicts with last-write-wins on per-cell timestamps — but their default
  model is **eventual**, not causal. Many "collaborative" features rely on causal order.
- It's the model behind **"my reply can't appear before the message"**, comment threads, and
  edit-after-create ordering across replicas.
- Often combined with **CRDTs** (which handle the concurrent-conflict part) to get causal order +
  automatic merge.
- Practically delivered as **causal+session guarantees** atop an eventually-consistent store (recall
  consistency-models): strong-enough UX, still available.

## Common misconception — "causal consistency means strong consistency / no conflicts"

It orders cause and effect, not everything — concurrent conflicts remain.

```reveal
{
  "prompt": "Why is it wrong to treat causal consistency as 'basically strong consistency,' and what does that misunderstanding cause?",
  "answer": "Because causal consistency is deliberately weaker than strong (linearizable) consistency: it provides no total order of all operations and no real-time recency, and it explicitly allows concurrent operations to be applied in different orders on different replicas (and to conflict/diverge). It only guarantees that causally-related operations are seen in order. If you assume it's 'basically strong,' you'll expect every replica to agree on the latest value and to have conflicts handled for you — and you'll be wrong on concurrent writes, leading to surprising divergence and silent data issues unless you add conflict resolution (LWW/merge/CRDT). You might also assume reads are always current (real-time), which causal consistency doesn't promise. The correct mental model: causal consistency is the strongest *available* model and it fixes the cause→effect ordering anomalies humans notice, but it is not linearizability and does not resolve concurrent conflicts — you must still design for those. Treating it as strong consistency leads to under-handling conflicts and over-trusting recency."
}
```

Causal consistency enforces **cause-before-effect ordering everywhere while staying available** (the
strongest model under partitions) — but it does **not** give a total order, real-time recency, or
conflict resolution for **concurrent** writes (those need LWW/merge/CRDTs).

## Self-test

```quiz
{
  "question": "Causal consistency guarantees that:",
  "options": [
    "Every read returns the latest write in real time",
    "Causally-related operations are seen in order everywhere; concurrent operations may differ",
    "All replicas always agree instantly",
    "There are never any conflicts"
  ],
  "answer": 1,
  "explanation": "It preserves happens-before order for causally-related ops (no reply-before-post), while concurrent ops may be ordered differently."
}
```

```quiz
{
  "question": "A notable property of causal consistency is that it:",
  "options": [
    "Cannot be provided without sacrificing availability",
    "Is the strongest consistency model achievable while remaining available under partitions",
    "Eliminates the need for conflict resolution",
    "Requires synchronized wall clocks"
  ],
  "answer": 1,
  "explanation": "Unlike linearizability (CP), causal consistency can be kept while staying available — it's the strongest available model; concurrent conflicts still need resolution."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Causal consistency — key terms", "cards": [ { "front": "Causal consistency", "back": "Operations with a happens-before (causal) relationship are seen in that order by everyone; concurrent operations may be ordered differently on different replicas." }, { "front": "Happens-before relation", "back": "The causal link between operations (e.g. a reply depends on the post it answers). Causal consistency preserves this order; vector clocks track it." }, { "front": "Concurrent operations", "back": "Writes made independently with no causal link between them. Causal consistency does not order them, so they may diverge and require conflict resolution." }, { "front": "Causal dependencies", "back": "Metadata (vector clock / set of versions read) shipped with each write. A replica delays showing the write until all its dependencies are present locally." }, { "front": "Strongest available model", "back": "Causal consistency is the strongest consistency achievable while staying available under partitions — stronger than eventual, weaker than linearizable." }, { "front": "What causal does NOT give", "back": "No total order, no real-time recency, and no resolution of concurrent conflicts — those still need LWW, application merge, or CRDTs." } ] }
```

## Key takeaways

- **Causal consistency** ensures **cause→effect ordering everywhere** (no reply-before-post), while
  **concurrent** operations may be ordered differently per replica.
- It's built on **happens-before / vector clocks**: ship each write's **causal dependencies** and delay
  showing it until they're present.
- It's the **strongest model achievable while staying available** under partitions (stronger than
  eventual, weaker than linearizable) and subsumes **session guarantees**.
- It does **not** provide total order, real-time recency, or **concurrent-conflict resolution** — pair
  it with **LWW/merge/CRDTs**.

## Up next

For data that truly must agree (config, leadership, single source of truth), you need nodes to agree
on one value. Next: **Distributed Consensus (Paxos & Raft)**.
