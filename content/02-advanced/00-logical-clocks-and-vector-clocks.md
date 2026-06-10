---
title: "Logical Clocks & Vector Clocks"
slug: logical-clocks-and-vector-clocks
level: advanced
module: correctness-and-consensus
order: 0
reading_time_min: 9
concepts: [logical-clocks, lamport-timestamps, vector-clocks, causality, happens-before, clock-skew]
use_cases: []
prerequisites: [cap-theorem, replication-strategies]
status: published
---

# Logical Clocks & Vector Clocks

## Hook — a motivating scenario

Two servers in different datacenters each record an event with their wall-clock timestamp. Server A
says `10:00:00.250`, server B says `10:00:00.180`. So B's event happened first… except A's clock is
running ~300ms *ahead* of B's, so A's true time is earlier (≈`...-050`) despite its larger reading —
A's event actually happened first. In a distributed system you **cannot trust wall clocks** to order
events. To know what *really* happened before what, you need **logical clocks**
— counters that capture **causality**, not time.

## Mental model — order by causality, not by wall time

Physical clocks drift and skew across machines, so comparing timestamps from different nodes is
unreliable (recall: even within a datacenter, clocks differ by milliseconds). Logical clocks instead
track the **happens-before** relationship: event X *happened-before* Y if X *could have caused* Y —
because they're on the same node in sequence, or because a message from X's node was received before
Y. Everything else is **concurrent** (no causal order).

The goal isn't "what time did it happen?" but **"what could have influenced what?"**

## Build it up — Lamport timestamps

A **Lamport clock** is one integer counter per node, with simple rules:
1. Increment your counter before each local event.
2. Send your counter with every message.
3. On receive, set your counter to `max(local, received) + 1`.

This guarantees: if X happened-before Y, then `LC(X) < LC(Y)`. It gives a **total order** consistent
with causality (break ties by node ID).

```sequence
{
  "title": "Lamport timestamps across two nodes",
  "actors": ["NodeA", "NodeB"],
  "steps": [
    { "from": "NodeA", "to": "NodeA", "label": "event a1 → LC=1" },
    { "from": "NodeA", "to": "NodeB", "label": "msg (LC=2)" },
    { "from": "NodeB", "to": "NodeB", "label": "recv → LC=max(0,2)+1=3" },
    { "from": "NodeB", "to": "NodeB", "label": "event b1 → LC=4" }
  ]
}
```

**The catch:** Lamport clocks give `X→Y ⇒ LC(X)<LC(Y)`, but **not the reverse**. `LC(X) < LC(Y)` does
**not** mean X happened-before Y — they might be **concurrent**. Lamport clocks can't *detect*
concurrency.

```reveal
{
  "prompt": "Lamport clocks guarantee 'if X happened-before Y then LC(X) < LC(Y)'. Why is the converse false, and why does that matter?",
  "answer": "Because a single counter collapses all nodes' progress into one number, so two events on different nodes that never communicated can still end up with LC(X) < LC(Y) purely by how the counters advanced — even though neither caused the other (they're concurrent). The implication only runs one way: causality ⇒ ordered numbers, but ordered numbers ⇏ causality. This matters because to resolve conflicts in replicated data you often need to know whether two writes were causally related (one knew about the other → keep the later) or genuinely concurrent (a real conflict → must merge or pick). Lamport timestamps can't tell those apart — LC(X) < LC(Y) might mean 'X before Y' or 'concurrent.' Detecting concurrency requires more information per event, which is exactly what vector clocks provide."
}
```

## Build it up — vector clocks detect concurrency

A **vector clock** keeps a counter **per node** (a vector `[a, b, c]`). Rules: increment your own slot
on a local event; on receive, take the element-wise `max` then increment your own slot. Compare two
vectors:
- X **happened-before** Y if every element of X ≤ Y and at least one is strictly less.
- Otherwise (neither dominates), X and Y are **concurrent** — a real conflict.

So vector clocks can **distinguish causal from concurrent** — the thing Lamport clocks can't.

```reveal
{
  "prompt": "Node A has vector [2,1,0] for a write; Node B has [1,2,0] for another write to the same key. Are these causally ordered or concurrent, and what should the system do?",
  "answer": "Concurrent. Neither vector dominates the other: A's vector has a larger first element (2 vs 1) while B's has a larger second element (2 vs 1), so neither is element-wise ≤ the other. That means neither write 'saw' the other — they were made independently — so they genuinely conflict. The system can't silently pick a winner by causality (there is none); it must treat this as a conflict: resolve it via application merge logic, surface both versions ('siblings') to the client to reconcile (as Dynamo/Riak do), or use a CRDT that merges deterministically. Contrast this with vectors like [2,1,0] vs [3,1,0], where the first is ≤ the second element-wise — there the later write causally followed the earlier one, so you'd just keep the later. Vector clocks give you exactly this causal-vs-concurrent distinction that drives correct conflict handling."
}
```

## In the wild

- **Dynamo-style stores** (the 2007 Dynamo paper, Riak) use **vector clocks (or version vectors)** to
  detect concurrent writes and surface conflicts/siblings for resolution (recall leaderless replication
  + conflict resolution). Not every Dynamo-lineage store made this choice: **Cassandra** instead
  resolves conflicts with **last-write-wins on per-cell timestamps**, not causality tracking — simpler,
  but with exactly the data-loss-under-skew risk described below.
- **CRDTs** (a later chapter) build on causality tracking to merge automatically.
- **Lamport clocks** underpin many algorithms needing a consistent total order; a *contrasting*
  approach is Spanner's **TrueTime**, which instead **bounds physical-clock uncertainty** (GPS + atomic
  clocks) rather than tracking causality — different tool, same goal of safe ordering.
- **Last-Write-Wins** by wall-clock timestamp (recall multi-leader) is exactly the unreliable approach
  these fix — LWW silently loses data under clock skew.

## Common misconception — "just use timestamps to order events / sort by time"

Wall-clock ordering across nodes is unreliable and silently loses data.

```reveal
{
  "prompt": "Why is ordering distributed events by their wall-clock timestamps (and using Last-Write-Wins) dangerous, and what do logical clocks give you instead?",
  "answer": "Because physical clocks on different machines drift and skew (and can even jump backward via NTP corrections), so a later-occurring event can carry an earlier timestamp than an earlier-occurring one. If you order by wall-clock and resolve conflicts with Last-Write-Wins, you'll sometimes keep the wrong write and silently discard the one that actually came later causally — data loss that's invisible and clock-dependent. Logical clocks fix the ordering problem by tracking causality directly: Lamport clocks give a total order consistent with happens-before, and vector clocks additionally detect when two events are concurrent (a true conflict to resolve, not to silently drop). They don't tell you the real time, but they correctly tell you what could have influenced what — which is what you actually need to order events and resolve conflicts safely in a distributed system. Trust causality, not the wall clock. (Systems that do want timestamp ordering invest heavily in bounding clock error, e.g. Spanner's TrueTime, precisely because naive timestamps are unsafe.)"
}
```

Across nodes, **wall clocks are unreliable**; **logical clocks order by causality**. **Lamport
timestamps** give a causal total order but can't detect concurrency; **vector clocks** can — which is
why they're used for conflict detection in replicated stores.

## Self-test

```quiz
{
  "question": "Why can't you reliably order events from different machines using their wall-clock timestamps?",
  "options": [
    "Timestamps are too large to compare",
    "Clocks drift/skew across machines, so a later event can have an earlier timestamp",
    "Wall clocks don't include milliseconds",
    "Timestamps are encrypted"
  ],
  "answer": 1,
  "explanation": "Physical clocks differ across nodes (and can jump), so timestamp order may not reflect real causal order — logical clocks fix this."
}
```

```quiz
{
  "question": "The key capability vector clocks have that Lamport clocks lack is:",
  "options": [
    "Smaller storage",
    "Detecting whether two events are concurrent (a true conflict) vs causally ordered",
    "Using real wall-clock time",
    "Working on a single node only"
  ],
  "answer": 1,
  "explanation": "Vector clocks compare per-node counters to distinguish happens-before from concurrent; Lamport's single counter can't detect concurrency."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Logical clocks & vector clocks — key terms", "cards": [ { "front": "Logical clock", "back": "A counter that orders events by causality rather than wall-clock time, since physical clocks drift and skew across machines and can't be trusted to order distributed events." }, { "front": "Happens-before relationship", "back": "Event X happened-before Y if X could have caused Y — same node in sequence, or a message from X received before Y. Everything else is concurrent (no causal order)." }, { "front": "Lamport clock rules", "back": "One integer per node: increment before each local event; send the counter with messages; on receive set counter to max(local, received) + 1, giving a total order consistent with causality." }, { "front": "Lamport clock's limitation", "back": "X→Y implies LC(X)<LC(Y), but not the reverse: LC(X)<LC(Y) does not mean X happened-before Y. A single counter can't detect whether two events are concurrent." }, { "front": "Vector clock", "back": "One counter per node (a vector). Increment your own slot on a local event; on receive, take element-wise max then increment your own slot. Distinguishes causal from concurrent events." }, { "front": "Concurrent (in vector clocks)", "back": "When neither vector dominates the other (neither is element-wise ≤ the other), the two events are concurrent — a real conflict that must be merged or resolved, not silently ordered." } ] }
```

## Key takeaways

- Across nodes, **wall clocks are untrustworthy** (drift/skew); order events by **causality**
  (happens-before), not time.
- **Lamport clocks** (one counter, `max+1` on receive) give a **total order consistent with
  causality** — but `LC(X)<LC(Y)` doesn't imply X→Y (can't detect concurrency).
- **Vector clocks** (one counter per node) **distinguish causal vs concurrent** events — the basis for
  conflict detection in replicated stores.
- This is why **LWW-by-wall-clock loses data**, and why Dynamo-style systems use **version/vector
  clocks**.

## Up next

Causality underpins how we define what "consistent" even means. Next: **Consistency Models**.
