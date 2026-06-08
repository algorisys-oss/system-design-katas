---
title: "CAP Theorem"
slug: cap-theorem
level: foundations
module: foundations-of-system-design
order: 50
reading_time_min: 15
concepts: [cap, consistency, availability, partition-tolerance, cp, ap, eventual-consistency]
use_cases: []
prerequisites: [database-reads-vs-writes, single-point-of-failure, availability-and-the-nines]
status: published
---

# CAP Theorem

## Hook — a motivating scenario

Two data centers hold copies of your data. The network link between them breaks (a **partition**). A
write arrives at one side. You face a forced choice: accept the write (but now the two sides
disagree), or reject it to stay consistent (but now you're refusing service). There is no third
option that gives you both. This unavoidable trade-off — during a network partition — is the **CAP
theorem**, the foundational law of distributed data.

## Mental model — pick two, but really pick one (under partition)

CAP says a distributed data store can't simultaneously guarantee all three of:
- **C — Consistency:** every read sees the latest write (all nodes agree).
- **A — Availability:** every request gets a (non-error) response.
- **P — Partition tolerance:** the system keeps working despite dropped/delayed messages between nodes.

The catch: in any real distributed system, **partitions will happen** — networks fail. So **P is not
optional**. That means CAP really forces a choice between **C and A** *when a partition occurs*:

```compare
{
  "options": [
    { "label": "CP (Consistency + Partition tolerance)", "points": ["Stays consistent during a partition", "Refuses/blocks requests it can't make consistent", "Sacrifices availability", "E.g. banking, inventory; ZooKeeper, etcd"] },
    { "label": "AP (Availability + Partition tolerance)", "points": ["Stays available during a partition", "May return stale/conflicting data", "Sacrifices strong consistency", "E.g. feeds, carts; Cassandra, DynamoDB"] }
  ]
}
```

## Build it up — what the choice looks like during a partition

```stepper
{
  "title": "A write arrives during a network partition",
  "steps": [
    { "title": "Partition happens", "body": "The link between node A and node B breaks; they can't sync." },
    { "title": "A write hits node A", "body": "A can't reach B to agree. Now it must choose." },
    { "title": "CP choice", "body": "Reject or block the write (and possibly reads) to avoid disagreement — consistent, but unavailable for that operation." },
    { "title": "AP choice", "body": "Accept the write on A and reconcile later — available, but B is briefly stale (inconsistent)." },
    { "title": "Partition heals", "body": "AP systems reconcile diverged copies (eventual consistency, conflict resolution); CP systems resume normal operation." }
  ]
}
```

**Crucial nuance:** CAP is only a dilemma *during a partition*. When the network is healthy (the
normal case), you can have both C and A. So the real question is: **"when the network breaks, do I
prefer to be wrong-but-up (AP) or right-but-down (CP)?"** — for *this* data.

```reveal
{
  "prompt": "Why is 'partition tolerance' essentially non-negotiable, making CAP really a C-vs-A choice?",
  "answer": "Because networks in distributed systems *will* drop or delay messages — partitions are a question of when, not if (a switch fails, a cable is cut, a node is overloaded). A system that isn't partition-tolerant simply breaks when that happens, which isn't a real option for anything multi-node. So you must tolerate partitions, and the theorem says during one you can't have both perfect consistency and full availability — you choose. Hence 'pick two' in practice means 'P is mandatory; choose C or A for partition time.'"
}
```

## Build it up — eventual consistency and choosing per-data

AP systems usually offer **eventual consistency**: after a partition heals, replicas converge to the
same value (given no new writes). It's "available now, consistent soon" — perfect for data where brief
staleness is harmless (a like count, a social feed), unacceptable for data where it isn't (a bank
balance).

The decision is **per use case, even within one app:** make the payments/inventory path CP (correct
over available) and the feed/recommendations path AP (available over correct). This is why real
systems use multiple datastores (polyglot persistence).

```reveal
{
  "prompt": "Within one e-commerce app, why might the shopping cart be AP but the final 'place order / charge' be CP?",
  "answer": "A cart values availability and user experience: if replicas briefly disagree, showing a slightly stale cart (or merging items later) is acceptable — you don't want 'cart unavailable' during a partition. But placing the order and charging money cannot tolerate inconsistency — double-charging or overselling inventory is unacceptable, so it must stay consistent even at the cost of refusing the operation during a partition (CP). Same app, opposite CAP choices, because the cost of being 'wrong' differs enormously between the two. CAP is decided per data/operation, not once for the whole system."
}
```

Drag the dial to see what you give up **during a network partition** — and that the real choice is
*per data*, not one switch for the whole system:

```tradeoff
{
  "title": "During a partition: what do you give up?",
  "axis": { "left": "Consistency", "right": "Availability" },
  "steps": [
    { "label": "Consistency (CP)", "detail": "Refuse operations that can't be kept correct — reads never go stale, but some requests fail (unavailable) until the partition heals. Right for the money path: payments, inventory, a bank balance." },
    { "label": "Per-data mix", "detail": "Pick per use case within ONE app — CP for the order/charge path, AP for the feed/cart. Real systems do both (polyglot persistence). The point of the chapter." },
    { "label": "Availability (AP)", "detail": "Always respond — stay up, but reads may be briefly stale (eventual consistency: available now, consistent soon). Right for like counts, feeds, recommendations." }
  ]
}
```

## In the wild

- **CP stores:** ZooKeeper, etcd, traditional relational DBs in strict modes — for coordination,
  config, money, inventory.
- **AP stores:** Cassandra, DynamoDB (tunable), Riak — for high-availability, write-heavy, staleness-
  tolerant workloads.
- **"Tunable consistency":** many systems let you choose per-operation (e.g. quorum reads/writes) —
  CAP isn't always one global setting (deepened in the advanced course: quorums, consistency models).
- **PACELC** extends CAP: even when there's no partition (Else), you trade **latency vs consistency**
  — a useful refinement.

## Common misconception — "CAP means you permanently pick two of the three"

CAP is about behavior *during partitions*, not a permanent 2-of-3 badge.

```reveal
{
  "prompt": "Why is 'we're a CA system (consistent + available, no partition tolerance)' a misleading or meaningless claim for a distributed system?",
  "answer": "Because partition tolerance isn't something you opt out of — in a multi-node system partitions *will* occur, so you must handle them somehow. 'CA' really just describes a single-node system (or pretends partitions never happen), which doesn't hold for anything distributed. The honest framing is: P is a given, and the system chooses C or A *when a partition happens*; the rest of the time it can offer both. So real systems are CP or AP (and often tunable per operation), not 'CA'. CAP describes partition-time behavior, not a permanent fixed pick."
}
```

CAP isn't a static "choose 2 of 3" — partition tolerance is mandatory, so it's a **C-vs-A choice that
only bites during partitions**, made **per data/operation**, with the network-healthy case offering
both.

## Self-test

```quiz
{
  "question": "During a network partition, a CP system will:",
  "options": [
    "Stay available but may return stale/conflicting data",
    "Sacrifice availability (reject/block requests) to keep data consistent",
    "Ignore the partition entirely",
    "Always lose data"
  ],
  "answer": 1,
  "explanation": "CP favors consistency: it refuses or blocks operations it can't make consistent, giving up availability during the partition."
}
```

```quiz
{
  "question": "Why does CAP effectively reduce to a choice between Consistency and Availability?",
  "options": [
    "Because consistency is impossible",
    "Because partition tolerance is mandatory in real distributed systems, so under a partition you must choose C or A",
    "Because availability is always preferred",
    "Because all three are easy to achieve"
  ],
  "answer": 1,
  "explanation": "Partitions are inevitable, so P is required; during one you can't have both C and A, forcing the choice."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "CAP theorem — key terms", "cards": [
  { "front": "CAP theorem", "back": "During a network partition a distributed data store cannot guarantee both Consistency and Availability; you must choose one." },
  { "front": "Consistency (C)", "back": "Every read sees the latest write — all nodes agree on the current value." },
  { "front": "Availability (A)", "back": "Every request gets a non-error response, even if the data returned may be stale." },
  { "front": "Partition tolerance (P)", "back": "The system keeps working despite dropped or delayed messages between nodes. In real distributed systems P is mandatory." },
  { "front": "CP vs AP", "back": "CP = right-but-down: refuse/block to stay consistent (money, inventory). AP = wrong-but-up: stay available, reconcile later (feeds, carts)." },
  { "front": "Eventual consistency", "back": "AP behavior: after a partition heals, replicas converge to the same value given no new writes — available now, consistent soon." }
] }
```

## Key takeaways

- **CAP:** under a network **partition** (inevitable, so **P is mandatory**), you must choose between
  **Consistency** and **Availability** — you can't have both.
- **CP** = right-but-down (refuse to be inconsistent: money, inventory, coordination); **AP** =
  wrong-but-up (stay available, reconcile later: feeds, carts) via **eventual consistency**.
- CAP only bites **during partitions**; when healthy you get both — and the choice is made **per
  data/operation**, not once for the whole system.
- "CA" isn't real for distributed systems; many stores offer **tunable consistency** (and see
  **PACELC** for the latency-vs-consistency trade when there's no partition).

## Up next

Time to put it all together. The capstone composes everything in this course into one design: **Design
a URL Shortener**.
