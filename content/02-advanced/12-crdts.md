---
title: "CRDTs (Conflict-Free Replicated Data Types)"
slug: crdts
level: advanced
module: replication-and-anti-entropy
order: 12
reading_time_min: 16
concepts: [crdt, commutativity, convergence, g-counter, or-set, strong-eventual-consistency, merge]
use_cases: []
prerequisites: [replication-strategies, causal-consistency, logical-clocks-and-vector-clocks]
status: published
---

# CRDTs (Conflict-Free Replicated Data Types)

## Hook — a motivating scenario

Two users edit the same shared document offline, then reconnect. Or a "like" counter is incremented on
three replicas during a partition. With last-write-wins, you **lose** edits/increments; with manual
conflict resolution, you write fragile merge code for every data type. What if the data structures
themselves were designed so that **any concurrent updates always merge correctly, automatically, with
no coordination**? That's a **CRDT** — and it's how collaborative apps and AP datastores converge
without losing data.

## Mental model — data types that merge deterministically

A **CRDT (Conflict-free Replicated Data Type)** is a data structure designed so that replicas can be
updated **independently and concurrently** (no coordination), and when their states are merged, they
**always converge to the same correct result** — regardless of the order or number of merges. The
merge operation is built to be **commutative, associative, and idempotent**, so "apply updates in any
order, even twice" yields the same answer. This gives **strong eventual consistency**: once replicas
have seen the same updates, they're identical — guaranteed by the math, not by careful merge code.

## Build it up — how the guarantee works (and a counter example)

The trick is that updates **commute**. Consider a **G-Counter** (grow-only counter): instead of one
shared number, each replica keeps a **per-replica count**, and the counter's value is the **sum**.
Increment only touches your own slot; merging two replicas takes the **element-wise max** of each
slot. Because max and sum are commutative/idempotent, replicas converge no matter the merge order —
and **no increment is ever lost** (unlike LWW on a single number).

```compare
{
  "options": [
    { "label": "Last-Write-Wins (naive)", "points": ["One value; latest timestamp wins", "Concurrent updates → one is LOST", "Sensitive to clock skew", "Simple but lossy"] },
    { "label": "CRDT", "points": ["Structured state that merges by design", "Concurrent updates all preserved + converge", "Merge is commutative/associative/idempotent", "Strong eventual consistency, no coordination"] }
  ]
}
```

```reveal
{
  "prompt": "Three replicas each increment a 'likes' counter during a partition (to +5, +3, +2). Why does a CRDT G-Counter converge to 10 while a last-write-wins single number loses data?",
  "answer": "With a single number + LWW, each replica independently sets likes to its own local total (say 5, 3, 2) and stamps it with a timestamp; when they reconcile, LWW keeps only the value with the latest timestamp — say 5 — discarding the other replicas' increments. You converge to a wrong, lossy value (5 instead of 10) because 'set to N' overwrites rather than combines. A G-Counter CRDT instead keeps a per-replica vector of counts, e.g. replica A={A:5}, B={B:3}, C={C:2}; the counter's value is the SUM of all slots. Increments only touch your own slot (no conflict, since no two replicas write the same slot), and merging takes the element-wise MAX per slot. After reconciliation every replica holds {A:5, B:3, C:2}, summing to 10 — correct and lossless. It converges regardless of merge order or duplicate merges because max is commutative, associative, and idempotent, and because each replica owns its slot so concurrent increments never actually conflict. The CRDT encodes 'these are independent contributions to add' into its structure, whereas LWW treats them as competing overwrites — which is why one preserves all updates and the other silently drops them."
}
```

## Build it up — families and richer types

- **State-based (CvRDTs):** replicas exchange their full state and **merge** via a function that
  computes a least-upper-bound (like the max above). Simple to reason about; merge must be a proper
  join.
- **Operation-based (CmRDTs):** replicas broadcast **operations** that must be commutative (and
  delivered reliably, usually in causal order — recall causal consistency); smaller messages.
- **Richer CRDTs:** **PN-Counter** (increment + decrement, two G-Counters), **G-Set/OR-Set**
  (add/remove sets — OR-Set tags elements so concurrent add/remove resolve sensibly), **LWW-Register**,
  and **sequence CRDTs** (RGA, used for collaborative text editing).

```reveal
{
  "prompt": "Removing an element from a replicated set seems to break CRDTs (concurrent add and remove of the same item) — how does an OR-Set resolve it?",
  "answer": "A naive set CRDT struggles because 'add X' and 'remove X' don't obviously commute: if one replica adds X while another removes X concurrently, what should the merged result be, and re-adding after a remove must work too. An OR-Set (Observed-Remove Set) solves this with unique tags: each add of X attaches a unique tag (e.g. a (replica, counter) id), so the set actually stores {X: set-of-tags}. A remove only deletes the tags it has *observed* at the time of removal, not the element wholesale. On merge, an element is considered present if it has at least one tag that hasn't been removed. So concurrent add and remove resolve as 'add wins' for that specific concurrent add: the remove only cancels the tags it saw, while the concurrent add introduced a new tag the remove didn't observe — so X remains in the set (its new tag survives). Re-adding after a remove also works because it creates a fresh tag. This makes add/remove effectively commutative and convergent: applying operations in any order yields the same tag-set, hence the same membership. The general CRDT technique is to enrich the state with enough metadata (unique tags, causal context/vector clocks) that conflicting-looking operations become commutative and mergeable — trading extra metadata (which can grow, needing GC/tombstone cleanup) for automatic, lossless convergence."
}
```

## In the wild

- **Collaborative editing:** Google Docs-style apps, Figma, and especially local-first tools use
  sequence CRDTs (e.g. **Yjs, Automerge**) so offline edits merge on reconnect.
- **AP datastores:** **Riak** ships CRDT types (counters, sets, maps); **Redis (CRDT-based Active-Active
  / Redis Enterprise)** uses them for multi-region; Azure Cosmos DB and others apply CRDT ideas.
- **Multi-leader / multi-region** replication (recall replication strategies) uses CRDTs to resolve
  concurrent writes automatically instead of LWW/manual merge.
- They pair with **causal delivery** (op-based) and need **garbage collection** of metadata/tombstones.

## Common misconception — "CRDTs make all conflicts disappear / are free"

They make merges *automatic and lossless for their data type* — but at a metadata cost and only for
expressible semantics.

```reveal
{
  "prompt": "What's the catch with CRDTs — why aren't they a universal 'no more conflicts' solution?",
  "answer": "CRDTs guarantee automatic, deterministic convergence (strong eventual consistency) without coordination — but only by encoding a *specific* conflict-resolution semantics into the data type, and at a real cost. First, the semantics are baked in and may not match what you want: a G-Counter/OR-Set 'resolves' concurrent updates by predefined rules (sum increments, add-wins, etc.), which is correct for those structures but isn't a general 'pick the business-correct answer' — for arbitrary invariants (e.g. 'account balance must not go negative', uniqueness constraints) there may be no CRDT that enforces them, because those require coordination/consensus, which CRDTs deliberately avoid. So 'conflict-free' means 'merges deterministically,' not 'always produces the outcome your business logic wants.' Second, they carry metadata overhead: tags, per-replica vectors, tombstones for removals — which grow over time and need garbage collection; op-based CRDTs also require reliable, often causal, delivery. Third, not every data type/operation has an efficient CRDT, and designing custom ones is subtle. So CRDTs are excellent where their built-in merge semantics fit (counters, sets, registers, collaborative text, multi-region replication) and you value availability + no-coordination merges, but they're not a free, universal conflict eliminator: invariants needing global agreement still need consensus, and you pay in metadata/GC. Choose CRDTs when the type's convergence semantics match your needs."
}
```

A **CRDT** is a data type whose updates **merge automatically and losslessly** (commutative/
associative/idempotent) → **strong eventual consistency without coordination**. But its
conflict-resolution semantics are **baked in** (may not match arbitrary invariants — those need
consensus) and it carries **metadata/GC overhead**.

## Self-test

```quiz
{
  "question": "A CRDT guarantees that concurrently-updated replicas converge because its merge operation is:",
  "options": [
    "Encrypted",
    "Commutative, associative, and idempotent (order/duplication-independent), so any merge order yields the same result",
    "Always run by a single leader",
    "Based on synchronized clocks"
  ],
  "answer": 1,
  "explanation": "Those algebraic properties mean updates can be merged in any order, any number of times, and still converge — strong eventual consistency, no coordination."
}
```

```quiz
{
  "question": "Compared to last-write-wins, a CRDT counter (e.g. G-Counter) is better because it:",
  "options": [
    "Is simpler to store",
    "Preserves all concurrent increments (per-replica slots summed) instead of discarding all but the latest",
    "Requires synchronized clocks",
    "Needs a single leader"
  ],
  "answer": 1,
  "explanation": "LWW keeps only one value (losing concurrent increments); a G-Counter sums per-replica counts and merges via max, losing nothing."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "CRDTs — key terms", "cards": [
  { "front": "CRDT", "back": "A replicated data type designed so replicas update independently with no coordination, and merging always converges to the same correct result regardless of order or number of merges." },
  { "front": "Strong eventual consistency", "back": "Once replicas have seen the same updates they become identical — guaranteed by the math (commutative/associative/idempotent merge), not by careful merge code." },
  { "front": "Why merges always converge", "back": "The merge operation is commutative, associative, and idempotent, so applying updates in any order, even twice, yields the same answer." },
  { "front": "G-Counter", "back": "A grow-only counter where each replica keeps a per-replica count; the value is the sum of all slots and merging takes the element-wise max, so no increment is lost." },
  { "front": "State-based vs op-based", "back": "State-based (CvRDT) replicas exchange full state and merge via a least-upper-bound join; op-based (CmRDT) broadcast commutative operations needing reliable, usually causal, delivery." },
  { "front": "OR-Set", "back": "An Observed-Remove Set that tags each add with a unique id; a remove deletes only observed tags, so concurrent add/remove resolve add-wins and re-adds work." }
] }
```

## Key takeaways

- A **CRDT** is a replicated data type whose **merge is commutative/associative/idempotent**, so
  concurrent updates converge **automatically and losslessly** — **strong eventual consistency without
  coordination**.
- Mechanism: structure the state so updates **commute** (e.g. **G-Counter** = per-replica slots,
  value=sum, merge=max); **OR-Set** uses tags so add/remove resolve.
- Families: **state-based (merge full state)** and **op-based (broadcast commutative ops, usually
  causal)**; rich types exist (PN-Counter, OR-Set, sequence CRDTs for collaborative text).
- Not magic: resolution semantics are **baked in** (invariants needing global agreement still need
  consensus) and there's **metadata/GC overhead**.

## Up next

How do replicas spread updates and membership info across a large cluster without a central
coordinator? Next: **Gossip Protocols**.
