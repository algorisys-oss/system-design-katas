---
title: "Multi-Region Active-Active"
slug: multi-region-active-active
level: advanced
module: global-scale
order: 29
reading_time_min: 15
concepts: [active-active, active-passive, multi-region, write-conflicts, failover, data-residency]
use_cases: []
prerequisites: [global-load-balancing, replication-strategies, cap-theorem]
status: published
---

# Multi-Region Active-Active

## Hook — a motivating scenario

You're already multi-region for latency and failover. The question now: do all regions **actively serve
writes** (active-active), or does one region take writes while others stand by (active-passive)?
Active-active gives the lowest latency and instant failover everywhere — but it forces you to confront
the hardest problem in distributed systems: **two regions accepting conflicting writes to the same data
at the same time**, an ocean apart.

## Mental model — active-active vs active-passive

Two ways to run multiple regions:
- **Active-passive (active-standby):** one **primary region** serves all writes; other regions are
  **standby** (replicas), promoted on failure. Simpler (one writer → no write conflicts), but standby
  capacity is idle and failover has a gap (promotion + replication catch-up).
- **Active-active:** **all regions actively serve traffic, including writes**. Lowest latency
  (everyone writes locally), full use of all regions, and near-instant failover (others are already
  live). The hard part: **concurrent conflicting writes across regions** must be reconciled.

```compare
{
  "options": [
    { "label": "Active-passive", "points": ["One region writes; others standby", "No write conflicts (single writer)", "Idle standby capacity; failover gap on promotion", "Simpler — common default"] },
    { "label": "Active-active", "points": ["All regions serve writes locally", "Lowest write latency + all regions utilized", "Near-instant failover (others already live)", "Must resolve cross-region write conflicts"] }
  ]
}
```

## Build it up — the write-conflict problem

In active-active, two regions can update the **same record concurrently** (a user in EU and a process
in US both edit it). Because regions are far apart, you **can't synchronously coordinate every write**
without paying cross-region latency on every request (defeating the point) — so writes are accepted
locally and replicated **asynchronously**, which means conflicts *will* happen. You need a
**conflict-resolution strategy** (recall multi-leader replication, CRDTs, vector clocks):
- **Last-Write-Wins (LWW):** simplest, but **loses data** under clock skew (recall logical clocks).
- **CRDTs:** merge concurrent updates **automatically and losslessly** for supported types (recall) —
  the strong choice for active-active.
- **Application/semantic merge or surfacing conflicts** to resolve by business rules.
- **Avoid conflicts by design:** partition writes so each record has a **home region** (only one region
  writes a given record), or route a given user/entity always to one region — sidestepping the problem.

```reveal
{
  "prompt": "Why is the central challenge of active-active multi-region the same as multi-leader replication, and what are the main ways to handle it?",
  "answer": "Because active-active means every region is effectively a write leader for the shared dataset — exactly the multi-leader replication model, just stretched across continents. Since regions are far apart, synchronously coordinating each write across regions would add cross-region round-trip latency to every request, destroying the low-latency benefit that motivated active-active; so writes are accepted locally and propagated asynchronously. That asynchrony means two regions can independently accept conflicting writes to the same record before they've seen each other's update — concurrent writes with no global order — which is the defining problem of multi-leader replication. The ways to handle it: (1) Last-Write-Wins by timestamp — trivial but lossy and unsafe under clock skew (recall logical clocks: wall-clock ordering across regions is unreliable, so LWW silently drops the 'losing' write). (2) CRDTs — design the data as conflict-free replicated types that merge concurrent updates deterministically and losslessly (counters, sets, etc.), the strongest general approach for active-active. (3) Application/semantic merge or surfacing siblings — resolve conflicts with business logic or let the app/user reconcile both versions (Dynamo-style). (4) Conflict avoidance by partitioning writes — give each record/entity a single 'home' region that owns its writes (or pin each user to one region), so concurrent conflicting writes to the same record can't occur; this trades some locality for eliminating conflicts and is often the most pragmatic choice. Which to use depends on the data: use CRDTs/merge where concurrent writes are inherent and must all be kept, and write-partitioning where you can naturally assign ownership. The key realization is that active-active inherits multi-leader's no-free-lunch: you either resolve concurrent conflicts (LWW/CRDT/merge) or structurally avoid them (home-region partitioning), because you can't both accept fast local writes everywhere AND have a single global order without coordination latency."
}
```

## Build it up — consistency, latency, and when each fits

- **CAP/PACELC reality:** active-active across regions means **asynchronous replication** → **eventual
  consistency** between regions (and conflict resolution). If you need **strong global consistency**,
  you must coordinate (consensus/synchronous quorum across regions), paying **cross-region latency** on
  writes — which active-active is trying to avoid. So active-active usually accepts **eventual
  consistency** (next chapter goes deeper).
- **When active-active fits:** global low-latency writes matter, you can tolerate eventual consistency /
  resolve conflicts (or partition writes by home region), and you want all regions utilized + instant
  failover. (Global social, collaborative, or AP-friendly workloads.)
- **When active-passive fits:** strong consistency / single-writer simplicity matters more than
  write latency, or conflict resolution is unacceptable (many financial/transactional systems) — accept
  the failover gap for correctness simplicity.

```reveal
{
  "prompt": "Why can't you simply have active-active AND strong global consistency AND low write latency all at once?",
  "answer": "Because they're in fundamental tension via CAP/PACELC. Strong global consistency (e.g. linearizability) requires that a write be coordinated/agreed across regions before it's acknowledged, so that every region reflects the latest write — which means each write must do a round trip to a quorum/consensus group spanning regions. Across continents that coordination adds tens to hundreds of milliseconds of cross-region latency to every write (the 'Else Latency' in PACELC, even when there's no partition), directly destroying the low-write-latency benefit that active-active exists to provide. Conversely, to get low write latency in every region, each region must accept and acknowledge writes locally without waiting for other regions — which means replication is asynchronous and regions can momentarily disagree and accept conflicting writes, i.e. eventual consistency with conflict resolution, NOT strong global consistency. And under an actual network partition, CAP forces the choice: either keep accepting local writes (available, eventually consistent — active-active's usual choice) or refuse writes to preserve consistency (CP, sacrificing the always-available local writes). So you can pick at most: (a) active-active + low latency + eventual consistency (accept conflicts), or (b) strong consistency + (effectively) single-region/coordinated writes + higher write latency (active-passive or synchronous multi-region consensus). You cannot have fast local writes in every region AND a single globally-consistent view AND availability under partition simultaneously, because the first requires not waiting for cross-region agreement and the second requires exactly that wait. That's why active-active systems generally embrace eventual consistency plus conflict resolution (or partition writes by home region to sidestep conflicts), and systems that demand strong global consistency accept the latency/single-writer cost instead. The next chapter explores the middle-ground consistency options across regions."
}
```

Where you land on the active-passive ↔ active-active dial is a trade between consistency simplicity and write latency/availability:

```tradeoff
{ "title": "Active-passive or active-active across regions?", "axis": { "left": "Active-passive (single writer)", "right": "Active-active (all regions write)" }, "steps": [
  { "label": "Active-passive", "detail": "One primary region writes; others standby. No write conflicts, simple consistency to reason about — but standby capacity is idle and failover has a gap (promotion + replication catch-up)." },
  { "label": "Active-active + write partitioning", "detail": "All regions write, but each record has a home region that owns its writes. Gives active-active utilization/failover while sidestepping concurrent conflicts — trades some locality." },
  { "label": "Active-active + conflict resolution", "detail": "All regions write locally with async replication and eventual consistency, reconciling concurrent writes via CRDTs (lossless), LWW (lossy), or semantic merge. Lowest latency, full utilization, instant failover." }
] }
```

## In the wild

- **Active-active stores:** DynamoDB Global Tables, Cassandra/ScyllaDB multi-DC, Cosmos DB multi-region
  writes, Redis Active-Active (CRDT-based) — all provide cross-region writes with conflict resolution.
  DynamoDB Global Tables typically propagate a write to other regions in **under ~1 second**
  (sub-second to single-digit seconds at the tail) per AWS's docs — which only works because that
  replication is **asynchronous**: a synchronous round trip between, say, `us-east-1` and `eu-west-1`
  costs roughly **70–90 ms** each way, so coordinating every write across the Atlantic would add that
  latency to every request. That gap is exactly why active-active leans on async replication + conflict
  resolution rather than synchronous cross-region coordination.
- **Active-passive / single-writer** is common for strongly-consistent systems (a primary region with
  cross-region read replicas; failover promotes a replica).
- **Write partitioning by home region** (each entity owned by one region) is a popular way to get
  active-active benefits while avoiding conflicts.
- Built on **global load balancing** (route users to regions, fail over — recall) and **multi-region
  consistency** choices (next chapter).

## Common misconception — "active-active is strictly better (more uptime/lower latency), so always use it"

Active-active buys latency/availability at the cost of **conflict resolution + eventual consistency** —
often not worth it.

```reveal
{
  "prompt": "Why isn't active-active always the right choice over active-passive, despite better latency and failover?",
  "answer": "Because active-active's benefits (local low-latency writes in every region, all regions utilized, near-instant failover) come bundled with a hard cost that active-passive avoids: concurrent cross-region writes to the same data, which force you into asynchronous replication, eventual consistency between regions, and a conflict-resolution strategy (LWW — lossy; CRDTs — only for expressible types; semantic merge — app complexity; or write-partitioning by home region — gives up some locality). For many systems, especially financial/transactional ones, that's unacceptable or not worth it: silently merging or dropping conflicting writes can corrupt money/inventory, and reasoning about eventual consistency and conflicts adds significant complexity and bug surface. Active-passive keeps a single writer, so there are NO write conflicts and consistency is simple to reason about; its costs are idle standby capacity and a failover gap (time to detect failure, promote a standby, and catch up replication) — often a perfectly acceptable trade when correctness and simplicity matter more than shaving write latency or achieving instant global failover. So the right choice depends on requirements: choose active-active when global low-latency writes and maximal availability/utilization are critical AND you can tolerate eventual consistency or naturally partition writes by home region (social, collaborative, AP-friendly workloads); choose active-passive when strong consistency and single-writer simplicity outweigh write latency and you can accept the failover gap (many transactional systems). 'Strictly better' ignores that active-active trades consistency simplicity and correctness guarantees for latency/availability — a trade that's frequently not worth it. Match the topology to whether your data can tolerate concurrent conflicting writes, not to which sounds more impressive."
}
```

**Active-active** runs **all regions serving writes** (lowest latency, full utilization, instant
failover) but inherits **multi-leader's cross-region write conflicts** → **async replication, eventual
consistency, and conflict resolution** (LWW/CRDTs/merge, or **partition writes by home region**).
**Active-passive** keeps a **single writer** (no conflicts, simpler) at the cost of idle standby + a
failover gap. Choose by whether your data tolerates **concurrent conflicting writes**.

## Self-test

```quiz
{
  "question": "The defining hard problem of active-active multi-region is:",
  "options": [
    "Routing users to the nearest region",
    "Concurrent conflicting writes to the same data across regions (multi-leader conflicts), needing resolution (LWW/CRDT/merge) or write-partitioning",
    "Caching static assets",
    "Choosing a DNS provider"
  ],
  "answer": 1,
  "explanation": "All regions write locally + async replication → concurrent conflicts (like multi-leader); you resolve them or avoid them via home-region write partitioning."
}
```

```quiz
{
  "question": "Active-passive multi-region is simpler than active-active mainly because:",
  "options": [
    "It uses no load balancer",
    "Only one region serves writes (single writer), so there are no cross-region write conflicts",
    "It has lower latency everywhere",
    "It never needs failover"
  ],
  "answer": 1,
  "explanation": "A single writing region eliminates write conflicts (and the need for conflict resolution); the trade-off is idle standby capacity and a failover gap."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Multi-region active-active — key terms", "cards": [
  { "front": "Active-passive (active-standby)", "back": "One primary region serves all writes; other regions are standby replicas, promoted on failure. No write conflicts (single writer), but standby capacity is idle and failover has a gap." },
  { "front": "Active-active", "back": "All regions actively serve traffic including writes. Lowest latency, full utilization, near-instant failover — but must reconcile concurrent conflicting writes across regions." },
  { "front": "Why active-active needs async replication", "back": "Synchronously coordinating every write across far-apart regions adds cross-region latency to each request, defeating the point. So writes are accepted locally and replicated asynchronously — meaning conflicts will happen." },
  { "front": "Last-Write-Wins (LWW)", "back": "Simplest conflict resolution: keep the write with the latest timestamp. But it loses data under clock skew, since wall-clock ordering across regions is unreliable." },
  { "front": "CRDTs (in active-active)", "back": "Conflict-free replicated data types merge concurrent updates automatically and losslessly for supported types — the strong choice for active-active conflict resolution." },
  { "front": "Write partitioning by home region", "back": "Avoid conflicts by design: give each record/entity a single home region that owns its writes (or pin each user to one region), so concurrent conflicting writes can't occur." }
] }
```

## Key takeaways

- **Active-passive** = one **primary region writes**, others **standby** (promoted on failure): **no
  write conflicts**, simpler — but **idle standby + failover gap**.
- **Active-active** = **all regions serve writes**: **lowest latency, full utilization, instant
  failover** — but inherits **multi-leader cross-region write conflicts**.
- Conflicts → **async replication + eventual consistency + resolution** (LWW lossy, **CRDTs** lossless,
  semantic merge) — or **avoid them** by **partitioning writes by home region**.
- It's **not strictly better**: active-active trades **consistency simplicity** for **latency/
  availability** — many (esp. transactional) systems prefer **active-passive** or write-partitioning.

## Up next

How consistent *can* data be across regions, and at what cost? Next: **Multi-Region Consistency**.
