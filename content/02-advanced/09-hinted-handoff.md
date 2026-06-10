---
title: "Hinted Handoff"
slug: hinted-handoff
level: advanced
module: replication-and-anti-entropy
order: 9
reading_time_min: 12
concepts: [hinted-handoff, hints, temporary-failure, availability, anti-entropy]
use_cases: []
prerequisites: [quorums-and-sloppy-quorums, replication-strategies]
status: published
---

# Hinted Handoff

## Hook — a motivating scenario

A write needs to go to its three home replicas, but one is briefly down for a deploy. Rejecting the
write (strict quorum) hurts availability; just skipping that replica leaves it permanently behind. The
elegant middle ground: a **healthy node temporarily accepts the write on the down node's behalf**,
holding a "**hint**," and **delivers it later** when the node returns. That's **hinted handoff** — the
mechanism that makes sloppy quorums work and keeps writes available through transient failures.

## Mental model — "I'll take that message and pass it along when you're back"

**Hinted handoff:** when a replica that *should* receive a write is temporarily unavailable, another
(healthy) node accepts the write and stores it with a **hint** — metadata saying "this really belongs
to node X." When node X recovers, the holder **hands off** the buffered writes to it, then discards the
hint. It's like a neighbor accepting a package for someone who's out and delivering it when they're
home.

```sequence
{
  "title": "Hinted handoff during a temporary node failure",
  "actors": ["Coordinator", "NodeB(home)", "NodeC"],
  "steps": [
    { "from": "Coordinator", "to": "NodeB(home)", "label": "write key=v ... NodeB is DOWN" },
    { "from": "Coordinator", "to": "NodeC", "label": "store key=v + hint 'belongs to NodeB'" },
    { "from": "NodeC", "to": "NodeC", "label": "hold the hint while NodeB is down" },
    { "from": "NodeB(home)", "to": "NodeC", "label": "NodeB recovers (rejoins)" },
    { "from": "NodeC", "to": "NodeB(home)", "label": "hand off buffered write → then drop hint" }
  ]
}
```

## Build it up — what it buys, and its limits

- **Keeps writes available** through **transient** failures (deploys, restarts, brief partitions) — the
  enabling mechanism behind **sloppy quorums** (recall): the write is acked now, repaired soon.
- **Speeds recovery:** when a node returns, hints replay the writes it missed *while it was down*, so it
  catches up quickly without a full data comparison.

But hinted handoff only covers the **recent, transient** case:
- It handles writes missed **during a known short outage** — the holder must keep the hints, so it's
  bounded (you can't buffer forever).
- It does **not** fix **long-term divergence** or data missed for other reasons (a node down too long,
  hints lost, dropped writes, bit rot). For that you need **anti-entropy / read repair** (next
  chapters) — the background process that compares full datasets and reconciles.

```reveal
{
  "prompt": "Hinted handoff repairs a node that was briefly down. Why isn't it sufficient on its own to keep all replicas consistent?",
  "answer": "Because it only covers writes that occurred during a known, bounded outage and were captured as hints by a stand-in node. Many sources of divergence fall outside that: a node down longer than the system is willing/able to buffer hints (hints expire or the holder runs out of space), the hint-holding node itself crashing and losing its hints before handoff, writes that were dropped or never reached enough nodes, sloppy-quorum writes that never got handed off, or silent corruption/bit rot over time. In all those cases replicas drift apart and hinted handoff has nothing buffered to fix it. So hinted handoff is the fast path for transient failures (replay recent missed writes when a node returns), but you also need a comprehensive background repair mechanism — anti-entropy (e.g. comparing datasets via Merkle trees) and read repair (fixing stale replicas detected during reads) — to detect and reconcile any divergence regardless of cause. Hinted handoff handles 'briefly down'; anti-entropy handles 'somehow diverged.' Production eventually-consistent stores use both."
}
```

## In the wild

- **Dynamo-style stores** (Cassandra, Riak, DynamoDB's lineage) implement hinted handoff to support
  **sloppy quorums** and fast recovery after brief node outages.
- Hints are typically **bounded** (a max hint window / size); if a node is down longer, the system
  relies on **anti-entropy/read repair** instead (and may stop storing new hints for it).
- It pairs with the other anti-entropy tools — **read repair** (fix on read) and **Merkle-tree
  anti-entropy** (background full reconciliation) — as the layered repair strategy.
- It's a key reason such stores stay **write-available (AP)** during routine node churn.

## Common misconception — "hinted handoff keeps all replicas fully consistent"

It's a transient-failure fast path, not a complete consistency mechanism.

```reveal
{
  "prompt": "Why is it a mistake to rely on hinted handoff alone for replica consistency in an eventually-consistent store?",
  "answer": "Because hinted handoff is narrow by design: it only restores writes that were missed during a brief, detected outage and successfully buffered as hints on a healthy node, then replayed when the original node returns. It assumes the outage is short (hints are bounded in time/space), the hint-holder survives to deliver, and the divergence came from that specific transient unavailability. Real systems diverge for many other reasons — nodes down beyond the hint window, lost/expired hints, the hint-holder crashing, dropped or under-replicated writes, sloppy-quorum writes never handed off, and silent corruption over time. None of those are covered by hinted handoff. If you rely on it alone, replicas can permanently drift and you'll serve inconsistent data with no path to convergence. That's why production stores layer it with anti-entropy (background dataset comparison and reconciliation, often using Merkle trees) and read repair (repairing stale replicas discovered during quorum reads). Hinted handoff is the cheap, fast recovery for the common transient case; the anti-entropy mechanisms are the safety net that guarantees eventual convergence regardless of how replicas diverged. You need both, and treating handoff as the whole solution leaves silent inconsistency."
}
```

Hinted handoff lets a **healthy node temporarily hold writes for a briefly-down replica and deliver
them on recovery** — enabling sloppy-quorum **write availability** and **fast catch-up**. But it only
covers **transient** failures; **long-term divergence** needs **anti-entropy / read repair**.

## Self-test

```quiz
{
  "question": "Hinted handoff works by:",
  "options": [
    "Rejecting writes when a replica is down",
    "Having a healthy node temporarily store a write (with a hint) for a down replica and deliver it when that replica recovers",
    "Synchronizing all replicas on every read",
    "Electing a new leader"
  ],
  "answer": 1,
  "explanation": "A stand-in node buffers the write as a hint for the unavailable home node and hands it off on recovery — enabling sloppy quorums."
}
```

```quiz
{
  "question": "Hinted handoff alone is insufficient for consistency because it:",
  "options": [
    "Is too slow",
    "Only covers writes missed during a brief, buffered outage — long-term divergence needs anti-entropy/read repair",
    "Requires a single leader",
    "Can't store any data"
  ],
  "answer": 1,
  "explanation": "Hints are bounded and only handle transient failures; other divergence (long outages, lost hints, corruption) needs background anti-entropy."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Hinted handoff — key terms", "cards": [
  { "front": "Hinted handoff", "back": "When a write's home replica is temporarily down, a healthy node accepts the write, stores it with a hint, and delivers it when the home node recovers." },
  { "front": "Hint", "back": "Metadata stored with a stand-in write saying which node the write really belongs to, so the holder can hand it off when that node returns." },
  { "front": "What hinted handoff buys you", "back": "Write availability through transient failures (the mechanism behind sloppy quorums) plus fast catch-up: a returning node replays missed writes without a full data comparison." },
  { "front": "Why hints are bounded", "back": "A holder can't buffer hints forever; there is a max hint window/size. If a node is down too long, the system stops storing hints and relies on anti-entropy/read repair instead." },
  { "front": "What hinted handoff does NOT cover", "back": "Long-term divergence: nodes down beyond the hint window, lost/expired hints, the holder crashing, dropped writes, or silent corruption. Those need anti-entropy / read repair." },
  { "front": "Why Dynamo-style stores stay write-available (AP)", "back": "Hinted handoff lets healthy nodes accept writes during routine node churn (deploys, restarts, brief partitions), so writes succeed instead of being rejected." }
] }
```

## Key takeaways

- **Hinted handoff**: a **healthy node temporarily accepts a write for a briefly-down replica** (as a
  **hint**) and **delivers it on recovery** — then drops the hint.
- It enables **sloppy-quorum write availability** through transient failures and gives **fast catch-up**
  when a node returns.
- It's **bounded** (hints can't be kept forever) and only covers **transient** outages — not long-term
  divergence, lost hints, or corruption.
- Pair it with **anti-entropy / read repair** for guaranteed eventual convergence.

## Up next

The background safety net that reconciles any divergence. Next: **Anti-Entropy & Read Repair**.
