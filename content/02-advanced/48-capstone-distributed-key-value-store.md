---
title: "Capstone — Design a Distributed Key-Value Store"
slug: capstone-distributed-key-value-store
level: advanced
module: advanced-capstones
order: 48
reading_time_min: 22
concepts: [dynamo, consistent-hashing, quorums, vector-clocks, gossip, hinted-handoff, merkle-trees]
use_cases: []
prerequisites: [consistent-hashing, quorums-and-sloppy-quorums, gossip-protocols, merkle-trees, crdts]
status: published
---

# Capstone — Design a Distributed Key-Value Store

## The payoff

This capstone composes almost the entire **replication & anti-entropy** module into one legendary
design: a **Dynamo-style distributed key-value store** (the lineage behind DynamoDB, Cassandra, Riak).
It's the ultimate "AP" system — always writable, horizontally scalable, no single point of failure —
and it weaves together **consistent hashing, tunable quorums, vector clocks, gossip, hinted handoff, and
Merkle-tree anti-entropy**. Follow the method: requirements → estimate → design → trade-offs → failures.

## Mental model: a clock face of houses, and a council of neighbors

Picture the hash ring as a **clock face**. Every node sits at some hour mark, and every key lands at its own
spot on the dial. To find where a key lives, drop it on the face and let it **roll clockwise** to the next
**N houses** it passes — those N houses are its **preference list**, the replicas that store it. Add a new
house to the ring and only the keys that now roll into *it* move (~1/N); nobody else is disturbed — that's
incremental scaling.

Now picture reads and writes as **asking the neighbors**. You don't trust one house's word and you don't
wake the whole street: you **ask R of the N neighbors** when reading and only **commit a write once W of
them agree** to hold it. Set the quorum so the people you ask to read always overlap the people who
confirmed the last write (`R + W > N`) and a read tends to see the latest fact. When a house is dark
(down), a **stand-in neighbor takes the message** and slips it under the right door later (hinted handoff).
Keep that picture — clock face of houses, a council of neighbors — and every technique below has a home.

## 1 · Clarify requirements

**Functional:** `get(key)` and `put(key, value)` over a simple key-value model (no joins/queries) —
that's it.

**Non-functional (the interesting part):**
- **Always writable (high availability):** writes must succeed even during failures/partitions — an **AP**
  choice (recall CAP). "Add to cart" must never fail.
- **Horizontally scalable & incremental:** add nodes to grow; no single point of failure.
- **Eventually consistent** is acceptable; **tunable** consistency per operation (recall quorums).
- Scale: massive — billions of keys, thousands of nodes, commodity hardware (so failures are constant).

```reveal
{
  "prompt": "Why does choosing 'always writable / high availability' (AP) as the top requirement drive nearly every other design decision in a Dynamo-style store?",
  "answer": "Because committing to always-available writes under failures and partitions forces you, via CAP, to give up strong consistency — and that single choice cascades into the whole architecture. If writes must always succeed even when nodes are down or the network is partitioned, you cannot require coordination/consensus on the write path (that would block when a majority is unreachable), so you accept asynchronous replication and eventual consistency. That immediately implies: (1) Leaderless replication with tunable quorums (N/R/W) instead of a single primary, so any replica can accept writes and you can dial consistency vs latency per operation (recall quorums). (2) Sloppy quorums + hinted handoff, so when the 'home' replicas for a key are unreachable, writes are still accepted by stand-in nodes and reconciled later — preserving write availability through transient failures. (3) Conflict resolution, because accepting concurrent writes without coordination means replicas WILL diverge; you need vector clocks to detect concurrent vs causal writes and a resolution strategy (LWW/merge/siblings/CRDTs) since there's no single authority to order writes. (4) Consistent hashing for partitioning + replication placement, so you can scale incrementally and add/remove nodes with minimal data movement and no central coordinator. (5) Gossip for decentralized membership/failure detection (no central master to be a SPOF, matching 'no single point of failure'). (6) Anti-entropy with Merkle trees + read repair to converge replicas in the background, delivering the 'eventual' in eventual consistency. So 'always writable' is the keystone: it rules out consensus on the write path, which mandates leaderless quorum replication, which mandates conflict detection/resolution, decentralized membership, consistent-hashing placement, and background repair. Every signature Dynamo technique exists to make highly-available, eventually-consistent writes work at scale. Pick a different top requirement (say strong consistency) and you'd design a completely different system (consensus-based, CP). Requirements first — and this one is decisive."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Storage for the dataset (with replication)",
  "inputs": [
    { "key": "keys", "label": "Number of keys (billions)", "default": 10000000000 },
    { "key": "bytesPerItem", "label": "Avg bytes per item (key+value)", "default": 1000 },
    { "key": "replication", "label": "Replication factor (N)", "default": 3 }
  ],
  "formula": "keys * bytesPerItem * replication",
  "resultLabel": "Total raw storage",
  "resultUnit": "bytes"
}
```

```calc
{
  "title": "Nodes needed for that storage",
  "inputs": [
    { "key": "totalBytes", "label": "Total storage (bytes, from above)", "default": 30000000000000 },
    { "key": "perNodeBytes", "label": "Usable storage per node (bytes)", "default": 2000000000000 }
  ],
  "formula": "totalBytes / perNodeBytes",
  "resultLabel": "Approx nodes (storage-bound)",
  "resultUnit": "nodes"
}
```

> 10B keys × 1KB × 3 replicas = **30 TB**; at 2 TB usable/node → **~15 nodes** for storage alone (more
> for throughput/headroom). The point: it must **scale horizontally** across many nodes, with data
> **partitioned and replicated** — exactly what consistent hashing provides.

## 3 · Core design: consistent hashing + N/R/W quorums

**Partitioning & placement (consistent hashing, recall):** nodes and keys are placed on a **hash ring**;
each key is stored on the **N successor nodes** clockwise from its position (its **preference list**).
Adding/removing a node only moves **~1/N** of keys (recall) — incremental scaling, no reshuffle.
**Virtual nodes** spread load evenly and smooth failures.

**Replication & consistency (tunable quorums, recall):** each key is replicated to **N** nodes; a read
needs **R** responses, a write **W** acks. **R + W > N** gives read-your-writes-style overlap; tune per
op (e.g. N=3: W=2/R=2 balanced, W=1 for max write availability).

```flow
{
  "title": "Dynamo-style architecture (decentralized, no leader)",
  "nodes": [
    { "label": "Consistent-hash ring", "detail": "Keys → N successor nodes (preference list); vnodes for even spread. Add nodes → ~1/N keys move." },
    { "label": "Coordinator (any node)", "detail": "The node a client hits coordinates the get/put to the key's N replicas (no central master)." },
    { "label": "Quorum R/W", "detail": "Write: W acks; Read: R responses (R+W>N for overlap). Tunable per op." },
    { "label": "Gossip membership", "detail": "Nodes gossip who's alive + ring state — decentralized, no SPOF (recall gossip)." }
  ],
  "note": "Every node is equal (no leader). Consistent hashing places data; quorums tune consistency; gossip tracks membership."
}
```

The N/R/W knobs are a dial, not a switch — slide it to trade consistency for write availability and latency:

```tradeoff
{
  "title": "Tuning N/R/W quorums (N=3): how should you set W and R?",
  "axis": { "left": "Max write availability", "right": "Stronger consistency" },
  "steps": [
    { "label": "W=1, R=1", "detail": "One ack is enough to write and one response to read. Maximum availability and lowest latency, but R+W is not > N, so reads can miss the latest write." },
    { "label": "W=1, R=3", "detail": "Writes stay maximally available (one ack); reads query all replicas so R+W>N gives overlap, but reads pay more latency and need all N up." },
    { "label": "W=2, R=2", "detail": "Balanced: R+W>N for read-your-writes-style overlap, tolerates one node down on each path. The common default for N=3." },
    { "label": "W=3, R=1", "detail": "Every replica must ack each write (slow, fails if any replica is down), but reads are cheap and fresh. Leans toward consistency at the cost of write availability." }
  ]
}
```

## 4 · Handling failures and conflicts (the hard parts)

This is where the whole module converges:
- **Temporary node failure → sloppy quorum + hinted handoff (recall):** if a preference-list node is
  down, a write is accepted by the next healthy node with a **hint** and **handed off** when the node
  returns — keeping writes available.
- **Concurrent writes → vector clocks (recall):** each version carries a **vector clock**; on read,
  causally-superseded versions are dropped, but **concurrent** (conflicting) versions are returned as
  **siblings** for the client/app to **resolve** (LWW, merge, or **CRDTs** — recall). The store detects
  conflicts; resolution is semantic.
- **Permanent divergence → Merkle-tree anti-entropy + read repair (recall):** replicas periodically
  compare datasets via **Merkle trees** (find differences in ~O(log n)) and reconcile; **read repair**
  fixes stale replicas seen during reads. Together → eventual convergence.
- **Membership/failure detection → gossip (recall):** decentralized, scalable, no master.

```sequence
{
  "title": "A put() during a node failure (sloppy quorum + vector clock)",
  "actors": ["Client", "Coordinator", "ReplicaUp", "ReplicaDown"],
  "steps": [
    { "from": "Client", "to": "Coordinator", "label": "put(key, value) — coordinator = any node" },
    { "from": "Coordinator", "to": "ReplicaUp", "label": "write w/ vector clock (ack 1)" },
    { "from": "Coordinator", "to": "ReplicaDown", "label": "DOWN → write to a stand-in w/ HINT (sloppy)" },
    { "from": "ReplicaUp", "to": "Coordinator", "label": "W acks reached → success (stays available)" },
    { "from": "Coordinator", "to": "ReplicaDown", "label": "later: hinted handoff + anti-entropy reconcile" }
  ]
}
```

```reveal
{
  "prompt": "Trace how a single put() then get() for a key works end-to-end in this design — naming which technique handles each part.",
  "answer": "PUT: (1) The client sends put(key, value) to any node, which becomes the COORDINATOR (no leader — every node is equal, enabled by the decentralized design + gossip membership so the coordinator knows the ring). (2) CONSISTENT HASHING determines the key's preference list — the N successor nodes on the ring (with virtual nodes for even spread). (3) The coordinator attaches a VECTOR CLOCK to the new version (incrementing the entry for this write's context) so causality can later be reasoned about. (4) It sends the write to the N replicas and waits for W acks (TUNABLE QUORUM). (5) If a preference-list replica is down, the write goes to the next healthy node with a HINT (SLOPPY QUORUM + HINTED HANDOFF), so W can still be met and the write stays AVAILABLE; the hint is handed off when the down node recovers. Once W acks return, the put succeeds. GET: (1) The client sends get(key) to a coordinator. (2) Consistent hashing finds the preference list; the coordinator queries the replicas and waits for R responses (TUNABLE QUORUM; R+W>N gives overlap so a read sees the latest completed write). (3) The coordinator compares the returned versions by their VECTOR CLOCKS: versions that are causally superseded (one clock dominates another) are discarded, keeping only the latest; if it finds CONCURRENT versions (clocks that don't dominate each other — a real conflict), it returns them all as SIBLINGS for the application to resolve (LWW/merge/CRDT) and writes the reconciled value back. (4) If the read sees stale replicas (some returned an old version), READ REPAIR writes the newest version back to them. In the background, independent of any single request, MERKLE-TREE ANTI-ENTROPY periodically compares replicas and reconciles differences (cold data, missed writes), and GOSSIP keeps membership/failure state current across all nodes. So one put/get exercises essentially the whole module: gossip (membership) → consistent hashing (placement) → quorums (R/W) → sloppy quorum + hinted handoff (availability under failure) → vector clocks (conflict detection) → siblings + resolution/CRDTs (conflict handling) → read repair + Merkle anti-entropy (convergence). Each technique owns one concern, and together they deliver an always-writable, horizontally-scalable, eventually-consistent store with no single point of failure."
}
```

## 5 · Trade-offs and failure modes recap

- **AP by design:** always writable, eventually consistent; conflicts are **detected (vector clocks)** and
  **resolved (siblings/CRDTs)** — the app must handle them. Strong consistency would need a different
  (CP/consensus) design.
- **No SPOF / fully decentralized:** every node equal, **gossip** membership, **consistent hashing**
  placement — scales incrementally on commodity hardware (where failures are the norm).
- **Layered repair:** **hinted handoff** (transient) + **read repair** (on-read) + **Merkle anti-entropy**
  (background) → eventual convergence (recall the layered strategy).
- **Method recap:** requirements (AP was decisive) → estimate (storage → nodes → must partition/
  replicate) → design (ring + quorums + gossip) → trade-offs (eventual consistency, conflict handling) →
  failures (handoff/repair). This *is* Dynamo — and the toolkit generalizes to any large-scale store.

## Common misconception

**"Setting R + W > N gives you strong consistency."** This is the most persistent myth about quorum
stores, and it is wrong. `R + W > N` only guarantees that the set of replicas a read contacts **overlaps**
the set that acknowledged the last *completed* write — so the read set is *guaranteed to include at least
one node that has the latest durable version*. That is a useful property, but it is **not linearizability**:

- With a **sloppy quorum + hinted handoff**, the W acks may come from stand-in nodes that aren't even on the
  key's preference list, so a subsequent R-read of the home replicas can miss that write entirely — the
  overlap guarantee quietly breaks.
- **Concurrent writes** still produce divergent versions; the read returns them as **siblings**. The store
  detected a conflict, but you did not get a single "correct" current value.
- Reads can observe **in-flight** state: a write in progress that has reached some but not all replicas means
  two near-simultaneous reads can disagree about whether the write happened.

So `R + W > N` buys you read/write **overlap** and "read-your-writes-style" freshness on the common path —
not the global ordering guarantee of a CP/consensus system. If you truly need linearizability, you need a
different design. Quorums tune the consistency/availability dial; they do not flip it to "strong."

```quiz
{
  "question": "In a Dynamo-style store, data placement and incremental scaling are handled by:",
  "options": [
    "A single primary node assigning keys",
    "Consistent hashing — keys map to N successor nodes on a ring; adding a node moves only ~1/N of keys",
    "Two-phase commit",
    "A relational schema"
  ],
  "answer": 1,
  "explanation": "Consistent hashing (with vnodes) places each key on its preference list and lets you add/remove nodes moving only ~1/N of keys — no central master."
}
```

```quiz
{
  "question": "Concurrent conflicting writes are handled by:",
  "options": [
    "Locking the key cluster-wide",
    "Vector clocks to detect concurrent versions, returned as siblings for the app to resolve (LWW/merge/CRDTs)",
    "Rejecting the second write",
    "A global timestamp from one clock"
  ],
  "answer": 1,
  "explanation": "Vector clocks distinguish causal vs concurrent; concurrent versions are surfaced as siblings and reconciled semantically (the store detects, the app resolves)."
}
```

```quiz
{
  "question": "Writes stay available during a temporary node failure because of:",
  "options": [
    "Synchronous replication to all nodes",
    "Sloppy quorum + hinted handoff — a stand-in node accepts the write with a hint and hands it off when the node recovers",
    "A bigger cache",
    "Electing a new leader"
  ],
  "answer": 1,
  "explanation": "When a preference-list node is down, a healthy stand-in accepts the write (hint) so W can be met; the hint is delivered on recovery — keeping writes available."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Distributed key-value store — key terms", "cards": [
  { "front": "Preference list", "back": "The N successor nodes clockwise from a key's position on the consistent-hash ring, where that key is stored and replicated." },
  { "front": "N / R / W quorums", "back": "Each key is replicated to N nodes; a read needs R responses, a write W acks. R+W>N gives overlap; tunable per operation to trade consistency vs availability." },
  { "front": "Sloppy quorum + hinted handoff", "back": "If a preference-list node is down, a stand-in healthy node accepts the write with a hint and hands it off when the node recovers — keeping writes available." },
  { "front": "Vector clocks", "back": "Per-version causality metadata. On read, causally-superseded versions are dropped; concurrent (conflicting) versions are returned as siblings for the app to resolve." },
  { "front": "Merkle-tree anti-entropy", "back": "Replicas periodically compare datasets via Merkle trees to find differences in ~O(log n) and reconcile them in the background, driving eventual convergence." },
  { "front": "Gossip membership", "back": "Decentralized protocol where nodes exchange who is alive and the ring state — no central master, so there is no single point of failure." }
] }
```

## Key takeaways

- A **Dynamo-style key-value store** is the **AP** archetype: **always writable, horizontally scalable,
  no SPOF, eventually consistent** — composing the whole replication/anti-entropy module.
- **Consistent hashing (+ vnodes)** places keys on N successor nodes (preference list) and enables
  **incremental scaling** (~1/N moves); **tunable N/R/W quorums** dial consistency vs availability per op.
- **Failures/conflicts:** **sloppy quorum + hinted handoff** (transient availability), **vector clocks**
  (detect concurrent writes → **siblings/CRDTs** to resolve), **Merkle anti-entropy + read repair**
  (eventual convergence), **gossip** (decentralized membership).
- The **method** (requirements → estimate → design → trade-offs → failures) — with **AP** as the decisive
  requirement — generalizes to any large-scale storage system.

## Up next

One more end-to-end design, where **strong consistency and correctness** are non-negotiable. Next:
**Capstone — Design a Payment System**.
