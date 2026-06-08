---
title: "Split-Brain"
slug: split-brain
level: advanced
module: resilience
order: 38
reading_time_min: 14
concepts: [split-brain, network-partition, quorum, fencing, stonith, witness]
use_cases: []
prerequisites: [leader-election, distributed-consensus, cap-theorem]
status: published
---

# Split-Brain

## Hook — a motivating scenario

A network partition splits your 2-node primary/replica cluster: each node can still serve clients but
can't see the other. The replica assumes the primary died and **promotes itself**. Now **both nodes
think they're the primary**, both accept conflicting writes, and when the network heals you have two
divergent datasets and **no safe way to merge them** — data corruption. This is **split-brain**, the
nightmare scenario of every leader-elected/replicated system, and avoiding it is why **quorums** exist.

## Mental model — a partition creates two "brains," both acting as leader

**Split-brain** occurs when a **network partition** divides a cluster into groups that **can't
communicate**, and **more than one group acts as the authority** (leader/primary) simultaneously —
each accepting writes, producing **divergent, conflicting state**. The root issue: a node **can't
distinguish "the other node is dead" from "I can't reach the other node"** (recall: you can't tell slow/
unreachable from dead). If both sides assume the other is dead and take over, you get two brains.

```sequence
{
  "title": "Split-brain in a naive 2-node cluster",
  "actors": ["Primary", "Replica", "Clients"],
  "steps": [
    { "from": "Primary", "to": "Replica", "label": "heartbeats... then NETWORK PARTITION (can't reach each other)" },
    { "from": "Replica", "to": "Replica", "label": "'primary is dead' → promote SELF to primary" },
    { "from": "Clients", "to": "Primary", "label": "writes → accepted by old primary" },
    { "from": "Clients", "to": "Replica", "label": "writes → accepted by new 'primary' (BOTH are primary now!)" },
    { "from": "Primary", "to": "Replica", "label": "partition heals → two divergent datasets, conflict/corruption" }
  ]
}
```

## Build it up — quorum: the primary defense

The standard prevention is **majority quorum** (recall consensus): a node may only act as leader / accept
writes if it can reach a **majority (>half) of the cluster**. Because **two different majorities can't
coexist** (any two majorities overlap), **at most one side of a partition can have a majority** — so
only that side stays active; the **minority side steps down** (refuses writes) rather than risk a second
brain. This is a deliberate **CP choice** (recall CAP): the minority sacrifices **availability** to
preserve **consistency** (no split-brain).

- This is **why clusters use odd numbers (3, 5, 7)** and why a **2-node cluster can't safely
  auto-failover** — split 1–1, neither side has a majority (or both naively claim it).
- A **witness/tiebreaker** (a lightweight third voter, or an arbiter) gives an odd vote count so one side
  wins the quorum in an otherwise even split.

```reveal
{
  "prompt": "Why does requiring a majority quorum to be leader prevent split-brain, and why can't a 2-node cluster safely auto-failover?",
  "answer": "Split-brain happens when two partitioned groups both act as leader and accept writes. A majority-quorum rule prevents this by allowing a node to be leader / accept writes ONLY if it can reach more than half of the cluster's nodes. The key property is that any two majorities of the same set must overlap (two subsets each larger than half can't be disjoint), so at most ONE group on either side of a partition can ever assemble a majority — the other group, lacking a majority, must step down and refuse writes. That guarantees at most one active leader at a time, eliminating the second brain. It's a deliberate CP trade-off: the minority side gives up availability (it won't serve writes) to preserve consistency (no divergence). A 2-node cluster can't do this safely because when the network partitions, it splits 1–1: neither node can reach a majority (each sees only itself, which is not >half of 2), so a correct quorum rule would make BOTH step down — total unavailability, no failover at all. If instead you let a node take over when it can't see its peer (naive failover), then during a partition BOTH nodes conclude the other is dead and both promote themselves — classic split-brain. So with two nodes you're stuck: either no automatic failover (safe but unavailable) or split-brain risk (available but unsafe) — you fundamentally can't distinguish 'peer dead' from 'peer unreachable' with only two votes. That's why production clusters use an ODD number of nodes (3, 5, 7), so a partition always leaves a majority on exactly one side that can safely continue while the minority steps down — or, for a 2-node setup, you add a lightweight third voter/witness (arbiter) to break ties and provide the deciding quorum vote. Majority quorum turns 'both might take over' into 'only the majority side can,' which is the core of split-brain prevention."
}
```

## Build it up — fencing: defense when someone acts anyway

Quorum prevents two leaders from both *getting elected*, but you also need to neutralize an **old leader
that doesn't know it's been demoted** (recall leader election: the partitioned/paused old primary).
**Fencing** ensures a stale leader's actions **can't take effect**:
- **Fencing tokens** (recall): each leadership term gets a monotonically increasing token; the shared
  resource **rejects any operation with a stale (lower) token** — so the old primary's late writes are
  refused even if it still believes it's primary.
- **STONITH ("Shoot The Other Node In The Head"):** forcibly **power off / isolate** the old node (HA
  clusters) so it physically can't write — a blunt but effective fence.
- **Resource-level guards:** the storage/lock service enforces single-writer via leases + fencing tokens.

```reveal
{
  "prompt": "Quorum stops two leaders from being elected — so why do you ALSO need fencing to prevent split-brain damage?",
  "answer": "Because quorum governs who is allowed to be ELECTED leader, but it can't, by itself, stop a previously-legitimate leader that has been demoted but doesn't yet KNOW it from continuing to act. Consider a primary that gets partitioned away or suffers a long GC/VM pause: the majority side correctly elects a new leader (quorum did its job — only one side got a majority). But the old primary, isolated or frozen, still believes it's the leader; when its network recovers or it resumes, it may try to process writes it accepted or issue new ones, unaware it was replaced. Now you again have two writers acting, even though only one was 'elected' — quorum prevented dual election, not dual action by a stale leader. Fencing closes this gap by ensuring the stale leader's operations can't take effect at the resource level: with fencing tokens, each leadership term carries a monotonically increasing token, the new leader uses a higher token, and the shared storage/lock service records the highest token it has seen and REJECTS any write bearing a lower (stale) token — so the old primary's late writes are refused regardless of what it believes. STONITH takes the blunt approach of forcibly powering off/isolating the old node so it physically cannot write. Either way, fencing makes demotion effective at the point of action, not just at election. You need both because they cover different moments: quorum prevents a SECOND leader from being elected during a partition (no two brains chosen), while fencing prevents an OLD leader from causing damage after it's been superseded (no stale brain still writing). Relying on quorum alone leaves the classic window where a paused/partitioned ex-leader resumes and corrupts data; relying on fencing alone without quorum could let two sides both try to become leader. Together — majority quorum for safe election + fencing tokens/STONITH for neutralizing stale leaders — they prevent split-brain both at decision time and at action time."
}
```

## In the wild

- **Consensus systems** (etcd, ZooKeeper, Consul, Raft-based DBs) prevent split-brain via **majority
  quorum** — the minority partition becomes read-only/unavailable (CP).
- **Databases:** primary/replica setups use quorum + **witness/arbiter** nodes (e.g. MongoDB replica-set
  arbiter, Patroni for Postgres with etcd) to avoid two primaries; **fencing tokens** guard writes.
- **HA clusters** (Pacemaker/Corosync) use **STONITH** to fence a misbehaving node.
- This is the practical face of **CAP** (recall): under partition, choose **consistency (step down the
  minority)** over availability to avoid split-brain.

## Common misconception — "if a node can't reach the others, it should take over to stay available"

That naive failover *causes* split-brain — the minority must **step down**, not take over.

```reveal
{
  "prompt": "Why is 'if I can't reach my peers, I'll take over to keep serving' a dangerous rule, and what's the correct behavior?",
  "answer": "Because 'I can't reach my peers' is ambiguous — it could mean the peers are dead (where taking over is correct) OR that you are the one cut off by a network partition while the peers are alive and well on the other side (where taking over is catastrophic). A node cannot locally distinguish these cases. If every node follows 'take over when I can't see the others,' then during a partition BOTH sides conclude the others are dead and BOTH promote themselves to leader/primary — classic split-brain: two authorities accepting conflicting writes, producing divergent state that can't be safely merged when the partition heals (data corruption/loss). So optimizing each node for availability in isolation destroys consistency for the whole system. The correct behavior is quorum-based: a node may continue as leader / accept writes ONLY if it can reach a majority of the cluster. The majority side keeps serving; the minority side (which can't form a quorum) deliberately STEPS DOWN — refusing writes, going read-only or unavailable — precisely to guarantee it isn't a second brain. This is a conscious CP choice under CAP: the minority sacrifices availability to preserve consistency. You make it workable by using an odd number of nodes (so a partition leaves a clear majority on one side) and/or a witness/arbiter to break ties, plus fencing (tokens/STONITH) so any stale leader's writes are rejected. So the rule isn't 'take over to stay up' — it's 'only the side with a majority continues; the minority stands down.' Choosing availability over consistency here is exactly the mistake that creates split-brain; correct systems prefer unavailability of the minority over dual-leader corruption."
}
```

**Split-brain** is when a **network partition** lets **two groups both act as leader**, producing
**divergent/conflicting state**. Prevent it with **majority quorum** (only the majority side stays
active; the minority **steps down** — a CP choice), **odd node counts / a witness** for tie-breaking,
and **fencing** (fencing tokens / STONITH) so a **stale leader's writes are rejected**. Naive "take over
when isolated" failover **causes** split-brain.

## Self-test

```quiz
{
  "question": "Split-brain occurs when:",
  "options": [
    "A single server runs out of memory",
    "A network partition lets more than one group act as leader/primary simultaneously, accepting conflicting writes",
    "A cache key expires",
    "DNS fails to resolve"
  ],
  "answer": 1,
  "explanation": "Partitioned groups that can't see each other both assume authority and diverge — the core danger quorum + fencing exist to prevent."
}
```

```quiz
{
  "question": "The primary defense against split-brain is:",
  "options": [
    "Letting any isolated node take over to stay available",
    "Majority quorum — only the side that can reach >half the nodes stays active; the minority steps down (plus fencing for stale leaders)",
    "Using a 2-node cluster",
    "Increasing cache TTLs"
  ],
  "answer": 1,
  "explanation": "Two majorities can't coexist, so only one partition side stays active; the minority sacrifices availability (CP). Fencing neutralizes a demoted-but-unaware leader."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Split-brain — key terms", "cards": [ { "front": "Split-brain", "back": "When a network partition divides a cluster and more than one group acts as leader/primary simultaneously, accepting conflicting writes and producing divergent, unmergeable state." }, { "front": "Why can't a 2-node cluster auto-failover safely?", "back": "A partition splits it 1–1, so neither node can reach a majority. A correct quorum rule makes both step down (unavailable); naive failover makes both promote themselves (split-brain)." }, { "front": "Majority quorum", "back": "A node may act as leader / accept writes only if it can reach more than half the cluster. Two majorities can't coexist, so at most one partition side stays active; the minority steps down." }, { "front": "Witness / arbiter", "back": "A lightweight third voter added to an otherwise even cluster, giving an odd vote count so one side wins the quorum and breaks ties during a partition." }, { "front": "Fencing tokens", "back": "Each leadership term gets a monotonically increasing token; the shared resource rejects any operation carrying a stale (lower) token, so a demoted leader's late writes are refused." }, { "front": "STONITH", "back": "\"Shoot The Other Node In The Head\" — forcibly power off or isolate the old node in HA clusters so it physically can't write; a blunt but effective fence." } ] }
```

## Key takeaways

- **Split-brain** = a **network partition** lets **multiple groups act as leader**, accepting
  **conflicting writes** → divergent, unmergeable state (corruption).
- Root cause: a node **can't tell "peer dead" from "peer unreachable."** Prevent with **majority quorum**
  — only the **majority side stays active**, the **minority steps down** (a **CP** choice).
- Use **odd node counts (3/5/7)** and a **witness/arbiter** for tie-breaking; a **2-node cluster can't
  safely auto-failover**.
- Add **fencing** (**fencing tokens** rejecting stale writes, or **STONITH**) so a **demoted-but-unaware
  leader's actions can't take effect** — quorum + fencing together.

## Up next

How a system protects itself when demand simply exceeds capacity. Next: **Backpressure & Load
Shedding**.
