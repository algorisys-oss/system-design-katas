---
title: "Quorums & Sloppy Quorums"
slug: quorums-and-sloppy-quorums
level: advanced
module: replication-and-anti-entropy
order: 8
reading_time_min: 15
concepts: [quorum, r-w-n, tunable-consistency, sloppy-quorum, hinted-handoff, availability]
use_cases: []
prerequisites: [replication-strategies, cap-theorem, consistency-models]
status: published
---

# Quorums & Sloppy Quorums

## Hook — a motivating scenario

In a leaderless store (recall replication strategies), there's no single primary to ask — so how do
you read a *correct* value when copies live on multiple nodes and some are stale or down? And what
happens when a network partition makes the "right" nodes for a key unreachable — do you reject the
write (losing availability) or write it *somewhere else* (a sloppy quorum) and reconcile later?
**Quorums** answer the first; **sloppy quorums** answer the second.

## Mental model — overlap guarantees you see the latest write

Recall the quorum rule: with **N** replicas per key, a write must be acknowledged by **W** of them and
a read must query **R** of them. If **R + W > N**, the read set and the write set are guaranteed to
**overlap in at least one node** — so a read contacts at least one replica that has the latest
**completed** write (and you take the newest version among the responses). This holds under a **strict
quorum**; sloppy quorums, concurrent conflicting writes, and partial/failed writes can still surface
stale or conflicting values (covered below). Quorums let you **tune consistency vs availability/latency
per operation** by choosing R and W.

```compare
{
  "options": [
    { "label": "Strong-ish quorum (R+W > N)", "points": ["Read & write sets overlap → reads see latest write", "e.g. N=3, W=2, R=2", "Higher latency (wait for more nodes)", "Tunable toward consistency"] },
    { "label": "Fast quorum (R+W ≤ N)", "points": ["No guaranteed overlap → reads may be stale", "e.g. N=3, W=1, R=1", "Lowest latency, highest availability", "Tunable toward availability"] }
  ]
}
```

## Build it up — tuning R and W

Common settings on N=3:
- **W=2, R=2** (R+W=4>3): balanced strong-ish reads/writes — the typical default.
- **W=3, R=1:** writes hit all replicas (slow, less write-available), reads are fast and always
  current. Good for read-heavy, write-rare data.
- **W=1, R=3:** fast, always-available writes; reads must check all (and may still need conflict
  resolution). Good for write-heavy.
- **W=1, R=1** (R+W=2≤3): fastest and most available, but reads can be **stale** (no overlap).

Quorums also relate to durability: **W** controls how many copies have a write before it's acked (more
W = safer against node loss, like sync replication).

```reveal
{
  "prompt": "With N=3, why does W=2/R=2 guarantee a read sees the latest write, while W=1/R=1 does not?",
  "answer": "It's about set overlap. A write to W nodes lands on some subset of size W; a read queries some subset of size R. If R + W > N, those two subsets cannot be disjoint — by pigeonhole, any size-R set and any size-W set out of N nodes must share at least one node. That shared node received the latest write, so the read (which contacts it) sees that value and can pick the newest version among responses. With N=3, W=2/R=2 gives R+W=4>3, so overlap is guaranteed → reads see the latest write. With W=1/R=1, R+W=2≤3: the write may go to node 1 while the read queries node 3, with no overlap, so the read can completely miss the write and return stale (or no) data. Lower R/W means faster and more available (fewer nodes to wait for, tolerant of more being down) but sacrifices the overlap guarantee. The R+W>N inequality is precisely the dial between consistency (overlap → fresh reads) and availability/latency (smaller quorums)."
}
```

Slide R and W along the dial to see how each setting (on N=3) trades consistency for availability and latency:

```tradeoff
{ "title": "How should you set R and W on N=3?", "axis": { "left": "Availability / low latency", "right": "Consistency" }, "steps": [ { "label": "W=1, R=1 (R+W=2≤3)", "detail": "Fastest and most available — fewest nodes to wait for, tolerant of more being down. But no overlap, so reads can be stale." }, { "label": "W=1, R=3", "detail": "Fast, always-available writes; reads check all replicas (R+W=4>3, overlap holds) but may still need conflict resolution. Good for write-heavy data." }, { "label": "W=2, R=2 (R+W=4>3)", "detail": "Balanced default — read and write sets overlap, so reads see the latest completed write while neither side waits on all replicas." }, { "label": "W=3, R=1", "detail": "Writes hit all replicas (slow, less write-available); reads are fast and always current. Good for read-heavy, write-rare data." } ] }
```

## Build it up — sloppy quorums and hinted handoff

A strict quorum requires W of the **N designated "home" nodes** for a key. But under a partition,
fewer than W of those home nodes may be reachable — so a strict quorum would **reject the write**
(unavailable). A **sloppy quorum** trades strictness for availability: if the home nodes aren't
reachable, the write is accepted by **other reachable nodes** (outside the key's normal set), which
store it temporarily as a **hint** and **hand it off** to a home node once it recovers (the next
chapter, **hinted handoff**).

So a sloppy quorum keeps **writes available** during partitions — at the cost of weaker consistency
guarantees (the write isn't on its real home nodes yet, so reads against the home set might miss it
until handoff completes).

```reveal
{
  "prompt": "What problem does a sloppy quorum solve, and what guarantee does it give up?",
  "answer": "It solves write availability during failures/partitions. In a strict quorum, a write must be acknowledged by W of the key's N designated home replicas; if a partition or outage leaves fewer than W of those specific nodes reachable, the strict quorum can't be met and the write is rejected — the system becomes unavailable for that key even though plenty of other nodes are up. A sloppy quorum relaxes 'must be the home nodes': it accepts the write on any W reachable nodes, even ones outside the key's normal replica set, which hold it as a temporary 'hint.' This keeps the system accepting writes (high availability, AP-leaning) through the partition. What it gives up is the clean quorum-overlap consistency guarantee: because the write currently lives on stand-in nodes rather than the key's real home replicas, a read directed at the home set may not see it until the temporary holders perform hinted handoff (forwarding the data back to the proper home nodes once they're reachable). So during the window before handoff completes, you can get stale reads / weaker consistency. Sloppy quorum + hinted handoff is the classic Dynamo trade: favor write availability now, restore consistency shortly after via background repair (handoff, and anti-entropy/read-repair)."
}
```

## In the wild

- **Dynamo-style stores** (Amazon Dynamo, Cassandra, Riak, DynamoDB) use **tunable N/R/W quorums** and
  **sloppy quorums + hinted handoff** for high availability (recall leaderless replication).
- **Per-operation tuning:** Cassandra exposes consistency levels (ONE, QUORUM, ALL, LOCAL_QUORUM) that
  map to R/W choices — letting you pick per query (recall consistency models' "tunable").
- Quorums interplay with **read repair and anti-entropy** (next chapters) to fix stale replicas a
  quorum read surfaces.
- **W** doubles as a durability dial (how many copies before ack) — like choosing sync vs async
  replication (recall).

## Common misconception — "R+W>N guarantees strong (linearizable) consistency"

It guarantees overlap, not linearizability — concurrency and sloppy quorums still cause anomalies.

```reveal
{
  "prompt": "Why is 'R + W > N' NOT the same as strong/linearizable consistency, despite guaranteeing read-write overlap?",
  "answer": "R+W>N guarantees that a read set and a write set intersect, so a read will contact at least one replica holding the latest *completed* write and can return it (newest wins). But that's weaker than linearizability for several reasons. (1) Concurrent writes: two writes can happen concurrently to overlapping quorums, and quorums alone don't order them — you can still get conflicting versions that need resolution (LWW/vector clocks/CRDTs), and different reads may see different winners during the window. (2) Partial/failed writes: a write might reach some but not W replicas (or the coordinator crashes mid-write), leaving the value on a minority; subsequent quorum reads can flip between old and new until repair, violating monotonicity. (3) Sloppy quorums break the guarantee outright: the W acks may be on stand-in nodes, not the key's home replicas, so a read of the home set can miss the write until hinted handoff completes. (4) No real-time/linearizable ordering is enforced across operations. So R+W>N gives a useful 'reads usually see the latest write' overlap property and a consistency/availability dial, but real systems layer read repair, anti-entropy, and conflict resolution on top, and even then plain quorums provide something closer to regular-register semantics (a read sees the latest *completed* write, but concurrent writes aren't ordered), not linearizability (achieving linearizability needs extra mechanisms like consensus or strict quorums with read-repair-before-return). Treating R+W>N as 'strongly consistent' leads to assuming no stale reads or conflicts, which quorum stores can still exhibit."
}
```

**Quorums** (R/W out of N) tune consistency vs availability: **R+W>N** guarantees read/write **overlap**
(reads see the latest *completed* write) but **not linearizability** (concurrency/partial writes still
need conflict resolution). **Sloppy quorums** keep writes **available** under partition by accepting
them on stand-in nodes (+ hinted handoff), trading some consistency.

## Self-test

```quiz
{
  "question": "With N=3 replicas, which R/W setting guarantees a read sees the latest completed write?",
  "options": ["R=1, W=1", "R=2, W=2 (R+W>N)", "R=1, W=1 with N=4", "Any setting"],
  "answer": 1,
  "explanation": "R+W>N (2+2>3) forces the read and write sets to overlap on ≥1 node holding the latest write."
}
```

```quiz
{
  "question": "A sloppy quorum improves availability during a partition by:",
  "options": [
    "Requiring all N home nodes for every write",
    "Accepting writes on other reachable nodes (not the key's home set) that hold them as hints and hand off later",
    "Rejecting all writes",
    "Synchronizing clocks"
  ],
  "answer": 1,
  "explanation": "When home nodes are unreachable, the write goes to stand-in nodes (sloppy) and is later handed off — keeping writes available at some consistency cost."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Quorums & sloppy quorums — key terms", "cards": [ { "front": "N, R, W", "back": "N = replicas per key; W = nodes that must ack a write; R = nodes a read queries. Choosing R and W tunes consistency vs availability/latency per operation." }, { "front": "R + W > N", "back": "Guarantees the read set and write set overlap on at least one node, so a read contacts a replica holding the latest completed write (newest version wins)." }, { "front": "Strict quorum", "back": "A write needs W of the key's N designated home nodes. Under partition, if fewer than W home nodes are reachable the write is rejected — losing availability." }, { "front": "Sloppy quorum", "back": "When home nodes are unreachable, the write is accepted by other reachable stand-in nodes that hold it as a temporary hint — keeping writes available at some consistency cost." }, { "front": "Hinted handoff", "back": "Stand-in nodes that took a sloppy-quorum write store it as a hint and forward it to the proper home node once that node recovers." }, { "front": "Why R+W>N ≠ linearizability", "back": "It only guarantees overlap. Concurrent writes, partial/failed writes, and sloppy quorums still cause stale or conflicting reads needing conflict resolution and repair." } ] }
```

## Key takeaways

- **Quorums** (write to **W**, read from **R**, of **N**) tune **consistency vs availability/latency**;
  **R+W>N** guarantees read/write **overlap** (reads see the latest completed write).
- Common N=3 settings: **W2/R2** (balanced), **W3/R1** (read-optimized), **W1/R3** (write-optimized),
  **W1/R1** (fastest, stale-prone); **W** also tunes durability.
- **Sloppy quorums** keep writes **available** under partition by accepting them on **stand-in nodes**
  (+ **hinted handoff**), trading consistency.
- **R+W>N ≠ linearizability** — concurrency, partial writes, and sloppy quorums still require conflict
  resolution + repair.

## Up next

How do those stand-in nodes get the data back to its rightful home? Next: **Hinted Handoff**.
