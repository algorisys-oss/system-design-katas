---
title: "Replication Strategies"
slug: replication-strategies
level: intermediate
module: replication-and-partitioning
order: 8
reading_time_min: 16
concepts: [single-leader, multi-leader, leaderless, quorum, conflict-resolution, replication-topology]
use_cases: []
prerequisites: [database-replication, cap-theorem]
status: published
---

# Replication Strategies

## Hook — a motivating scenario

Your app goes global. Users in Tokyo writing to a primary in Virginia feel every write crawl across
the Pacific. "Let's accept writes in both regions!" — but now Tokyo and Virginia can both edit the
same record at once, and you have to decide *whose change wins* when they disagree. That question —
**where writes are allowed, and how conflicts are resolved** — is what separates the three replication
strategies.

## Mental model — how many places can accept a write?

The strategies differ on one axis: **who may accept writes.** Picture a bank: **single-leader** is
one cashier ringing up every transaction in order; **multi-leader** is several branch offices each
taking deposits locally, then reconciling their books later; **leaderless** is any teller serving you,
with several cross-checking (a quorum) to agree on your balance.

```compare
{
  "options": [
    { "label": "Single-leader", "points": ["One primary accepts all writes", "No write conflicts (one order)", "Simple + consistent; the common default", "Write latency/availability tied to the one leader"] },
    { "label": "Multi-leader", "points": ["Several leaders accept writes (e.g. per region)", "Low-latency local writes; survives region loss", "Write CONFLICTS possible → must resolve them", "Complex; used for multi-region / offline sync"] },
    { "label": "Leaderless", "points": ["Any replica accepts reads/writes", "Highly available; tunable via quorums", "Client/coordinator resolves consistency", "Dynamo-style (Cassandra, DynamoDB)"] }
  ]
}
```

## Build it up — single-leader (the default)

One primary orders all writes; replicas follow (the previous chapter). **No conflicts** — there's a
single source of truth and a single write order — which is why it's the default for most relational
systems. The limits: all writes funnel to one leader (a write bottleneck and a cross-region latency
problem), and write availability depends on that leader (mitigated by fast failover).

## Build it up — multi-leader and the conflict problem

**Multi-leader** lets multiple nodes accept writes (often one leader per region), so writes are
**local and fast**, and a region can keep working if cut off. The price: two leaders can edit the same
data concurrently, producing **write conflicts** that must be resolved when their streams meet.

```reveal
{
  "prompt": "Tokyo and Virginia leaders both update the same user's nickname at the same time to different values. How can this conflict be resolved?",
  "answer": "Common strategies: Last-Write-Wins (LWW) — pick the edit with the latest timestamp (simple, but silently discards one change and is sensitive to clock skew); application-defined merge — combine both per business rules (e.g. union of sets, or keep both and let the user choose); or CRDTs — data types mathematically designed to merge without conflicts (advanced course). There's no universally 'correct' winner — concurrent writes to the same value are inherently ambiguous, so multi-leader forces you to choose a resolution policy. That complexity is exactly why single-leader (which prevents conflicts) is the default unless you specifically need multi-region local writes."
}
```

## Build it up — leaderless and quorums

**Leaderless** (Dynamo-style: Cassandra, DynamoDB) drops the leader entirely — **any replica accepts
reads and writes**, and consistency is tuned with **quorums**: a write goes to W replicas, a read
queries R replicas, and if **R + W > N** (N = total replicas), reads and writes overlap on at least
one node, so reads see the latest **completed** write (under a strict quorum — concurrent writes,
partial failures, or sloppy quorums can still surface stale/conflicting values). This gives **high
availability** and a per-operation **consistency/latency dial** (recall CAP's tunable consistency), at
the cost of client/coordinator logic and techniques like read-repair to reconcile stale replicas
(advanced course). Leaderless doesn't escape conflicts either: when two clients write the same key
concurrently, it needs the **same resolution policies as multi-leader** (version vectors, last-write-
wins, or CRDTs), and background **anti-entropy** plus read-repair heal divergence between replicas
over time.

```reveal
{
  "prompt": "With N=3 replicas, why does choosing W=2 and R=2 give you strong-ish consistency, while W=1, R=1 does not?",
  "answer": "Consistency in quorum systems hinges on R + W > N. With N=3, W=2 + R=2 gives R+W=4 > 3, so the set of nodes a read contacts must overlap the set a write updated by at least one node — that node has the latest value, so the read can see it (taking the newest version). With W=1, R=1, R+W=2 ≤ 3: a write may land on one node and a read may hit two entirely different nodes, missing the update — fast and highly available, but you can read stale data. Quorums let you slide between availability/latency (lower R/W) and consistency (higher R/W) per operation."
}
```

Slide across the strategies to see the trade between write availability/locality and consistency simplicity:

```tradeoff
{ "title": "Where should writes be allowed?", "axis": { "left": "Consistency simplicity (no conflicts)", "right": "Write availability / locality" }, "steps": [ { "label": "Single-leader", "detail": "One primary orders all writes, so there are no conflicts and one source of truth — the default. But all writes funnel to one leader: a bottleneck, cross-region latency, and availability tied to that leader." }, { "label": "Multi-leader", "detail": "Several leaders (often one per region) accept local, fast writes and survive region loss. The price: concurrent edits to the same data create write conflicts you must resolve (LWW, merges, CRDTs)." }, { "label": "Leaderless", "detail": "Any replica accepts reads/writes; quorums (R + W > N) tune consistency per operation. Highly available with a consistency/latency dial, at the cost of client/coordinator logic and read-repair." } ] }
```

## In the wild

- **Single-leader** is the default for relational databases (PostgreSQL/MySQL) and most apps —
  consistency and simplicity.
- **Multi-leader** appears in **multi-region active-active** setups and offline-capable apps (each
  device/region a leader that syncs) — and brings conflict resolution (LWW, CRDTs).
- **Leaderless + quorums** powers AP-leaning, write-available stores (**Cassandra, DynamoDB, Riak**);
  you tune R/W per query.
- The choice is a **CAP-shaped decision per dataset**: most data → single-leader; globally-written or
  always-available data → multi-leader/leaderless with explicit conflict handling.

## Common misconception — "multi-leader / multi-master means you can write anywhere with no downside"

Accepting writes everywhere doesn't make conflicts disappear — it creates them.

```reveal
{
  "prompt": "Why is 'just enable multi-master so any node takes writes' not a free way to scale and globalize writes?",
  "answer": "Because allowing concurrent writes to the same data in multiple places guarantees write conflicts that single-leader simply can't have — and someone must resolve them (LWW silently drops data; merges/CRDTs add real complexity; clock skew breaks naive timestamp ordering). You also lose the single, total write order, so invariants like uniqueness or balances-can't-go-negative are far harder to enforce across leaders. Multi-leader buys low-latency local writes and regional independence, but it trades away conflict-freedom and easy consistency. It's the right tool for multi-region/offline needs — not a no-downside upgrade. If you don't need writes in multiple places, single-leader avoids the entire problem."
}
```

The strategies are a spectrum of **write availability vs consistency simplicity**: single-leader
prevents conflicts (default), multi-leader/leaderless gain write locality/availability but force you
to handle conflicts and tune consistency.

## Self-test

```quiz
{
  "question": "The defining difference between the replication strategies is:",
  "options": [
    "How data is encrypted",
    "Where writes are allowed (one leader vs multiple leaders vs any replica) and thus whether conflicts can occur",
    "Whether they use SSDs",
    "The programming language"
  ],
  "answer": 1,
  "explanation": "Single-/multi-leader/leaderless differ by who accepts writes — which determines conflict-freedom and the consistency/availability trade."
}
```

```quiz
{
  "question": "In a leaderless system with N=3 replicas, which R/W setting ensures a read can see the latest write?",
  "options": ["R=1, W=1", "R=2, W=2 (R + W > N)", "R=1, W=2 with N=4", "Any setting works"],
  "answer": 1,
  "explanation": "R + W > N (here 2+2 > 3) forces read and write quorums to overlap on a node holding the newest value."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Replication strategies — key terms", "cards": [ { "front": "Single-leader replication", "back": "One primary accepts all writes and orders them; replicas follow. No write conflicts and a single source of truth — the simple, consistent default for most relational systems." }, { "front": "Multi-leader replication", "back": "Several nodes (often one leader per region) accept writes, giving fast local writes and regional independence — but concurrent edits to the same data create write conflicts that must be resolved." }, { "front": "Leaderless replication", "back": "Dynamo-style (Cassandra, DynamoDB): any replica accepts reads and writes; consistency is tuned with quorums. Highly available with a per-operation consistency/latency dial." }, { "front": "Quorum rule (R + W > N)", "back": "With N total replicas, a write hits W and a read queries R nodes. If R + W > N, read and write sets overlap on a node holding the newest value, so reads see the latest completed write." }, { "front": "Conflict resolution (multi-leader)", "back": "Concurrent writes are inherently ambiguous, so you pick a policy: Last-Write-Wins (drops a change, clock-skew sensitive), app-defined merge, or CRDTs that merge mathematically." }, { "front": "CAP-shaped choice per dataset", "back": "Default to single-leader; for globally-written or always-available data, use multi-leader or leaderless with explicit conflict handling. The strategy is chosen per dataset, not globally." } ] }
```

## Key takeaways

- Strategies differ by **where writes are allowed**: **single-leader** (one writer, no conflicts —
  default), **multi-leader** (many writers, local + conflict-prone), **leaderless** (any replica,
  quorum-tuned).
- **Multi-leader creates write conflicts** you must resolve (LWW, merges, CRDTs) — concurrent edits
  are inherently ambiguous.
- **Leaderless quorums** give a per-operation consistency dial: **R + W > N** ⇒ reads see latest
  writes; lower R/W ⇒ more availability/speed, more staleness.
- It's a **CAP-shaped choice per dataset** — default to single-leader unless you need multi-region/
  always-available writes.

## Up next

Replication copies the *same* data many places; the other half of scaling splits *different* data
across machines. Next: **Database Sharding**.
