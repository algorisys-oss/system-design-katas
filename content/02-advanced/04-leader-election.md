---
title: "Leader Election"
slug: leader-election
level: advanced
module: correctness-and-consensus
order: 4
reading_time_min: 14
concepts: [leader-election, terms, fencing-tokens, split-brain, lease, failover]
use_cases: []
prerequisites: [distributed-consensus, single-point-of-failure]
status: published
---

# Leader Election

## Hook — a motivating scenario

Many distributed jobs need exactly **one** node "in charge" — the primary that accepts writes, the
scheduler that assigns work, the coordinator that runs a migration. If zero nodes lead, nothing
happens; if **two** nodes think they lead (split-brain), they issue conflicting commands and corrupt
state. **Leader election** is how a cluster reliably picks one leader and — crucially — handles the
moment a leader dies or is wrongly presumed dead.

## Mental model — agree on exactly one coordinator (then fail over)

**Leader election** is the process by which nodes **agree on a single leader**, and re-elect a new one
when the leader fails. It's a direct application of **consensus** (recall): the cluster must agree on
"who is leader for term N," and majority-based consensus guarantees only one leader per term.

The leader serves a **term** (an ever-increasing number). When the leader stops sending **heartbeats**
(recall health checks/heartbeats), followers time out, start a new **term**, and elect a new leader by
majority vote. The term number is what makes stale leaders detectable.

Think of it like an **on-call rotation**: exactly one person holds the pager. If they go silent, the
team agrees on a new on-call holder and the old pager number is deactivated — so an ex-on-call who
comes back online can't keep paging people as if they were still in charge. The "term" is which shift
you're on; the "fencing token" is the deactivated old number.

```sequence
{
  "title": "Failover: heartbeats stop → new term → new leader",
  "actors": ["Leader(t1)", "FollowerB", "FollowerC"],
  "steps": [
    { "from": "Leader(t1)", "to": "FollowerB", "label": "heartbeat (term 1)" },
    { "from": "Leader(t1)", "to": "FollowerB", "label": "...crashes (heartbeats stop)" },
    { "from": "FollowerB", "to": "FollowerC", "label": "timeout → start term 2, request votes" },
    { "from": "FollowerC", "to": "FollowerB", "label": "vote granted (majority)" },
    { "from": "FollowerB", "to": "FollowerC", "label": "I am leader, term 2 (heartbeats resume)" }
  ]
}
```

## Build it up — split-brain and fencing tokens

The hard part isn't electing a leader — it's **the old leader that doesn't know it's been replaced**.
A leader that's merely slow or network-partitioned (not actually dead) can be **demoted** while still
believing it's the leader, and try to act — **split-brain**. Two defenses:
- **Terms/epochs:** every leader action is tagged with its term; nodes reject actions from an
  **outdated term**. A new election bumps the term, so the old leader's commands are ignored.
- **Fencing tokens:** the leader gets a monotonically increasing token; downstream resources
  (storage, locks) record the highest token seen and **reject any operation with a lower token** — so a
  stale leader's late writes are fenced out even if it still thinks it's in charge.

```reveal
{
  "prompt": "An old leader is partitioned away, a new leader is elected, then the old leader's network recovers and it tries to write 'as the leader.' How do fencing tokens prevent corruption?",
  "answer": "When the old leader was in charge it held some token, say 33. The new leader, elected with a higher term, holds a higher token, say 34, and uses it on its writes to shared resources (the storage/lock service). Those resources remember the highest token they've accepted (34). When the partitioned old leader recovers and sends a write stamped with its stale token 33, the resource sees 33 < 34 and rejects it. So even though the old leader still *believes* it's the leader (it never learned it was replaced), its operations are fenced out at the resource level — they can't take effect. This converts a dangerous split-brain (two leaders both writing) into a harmless one (the stale leader's writes are simply refused). Terms/epochs do the same at the protocol level (nodes ignore lower-term messages), but fencing tokens push the check all the way down to the resource, which is essential because the old leader can't be trusted to voluntarily step down — you must make its actions ineffective rather than rely on it knowing it's demoted."
}
```

## Build it up — leases and avoiding flapping

- **Leases:** a leader often holds a **time-bounded lease** (a lock with a TTL). It must renew before
  expiry; if it can't (crash/partition), the lease expires and another node can take over. Leases
  bound how long a dead leader's "reign" lingers, but rely on **bounded clock drift** (a too-slow
  clock can let an expired leader linger — hence fencing tokens as backup).
- **Avoid flapping/election storms:** randomized election timeouts (Raft) stop all followers from
  campaigning at once; tune timeouts so a brief blip doesn't trigger needless re-elections (recall
  heartbeat thresholds).

```reveal
{
  "prompt": "Why isn't a lease (a lock with a TTL) sufficient on its own to prevent split-brain, and what must back it up?",
  "answer": "Because leases depend on time, and time isn't trustworthy across machines (clock drift, GC/STW pauses, VM freezes). The classic failure: a leader holds a lease, then suffers a long stop-the-world GC pause or gets descheduled; meanwhile its lease expires and another node legitimately becomes leader. The original leader then wakes up, still believing its (now-expired) lease is valid because its own clock/perception lagged, and proceeds to write — split-brain. The lease's TTL bounded the *intended* reign, but a paused/slow node can act after expiry without realizing it. So leases must be backed by fencing tokens: each lease acquisition carries a higher monotonic token, and downstream resources reject operations bearing a token lower than the highest they've seen. That way, even if a paused old leader thinks its lease is still good, its writes (with the old token) are refused at the resource. Leases provide the timeout-based handoff; fencing tokens provide the safety guarantee that doesn't rely on clocks. You need both."
}
```

## In the wild

- **Implemented via consensus systems:** etcd/ZooKeeper/Consul provide leader-election primitives
  (often as leases + watches); databases use it to pick the **primary** and to **fail over** (recall
  replication).
- **Used for:** primary/replica failover, singleton schedulers/cron, partition ownership, migration
  coordinators — anywhere exactly one actor must act.
- **Fencing tokens** are standard in correct lock/lease usage (the "how to do distributed locking
  right" lesson — next chapter).
- Pairs with **heartbeats** (detect failure) and **terms** (detect stale leaders).
- **Concrete numbers:** etcd defaults to a **100 ms** heartbeat interval and a **1000 ms** election
  timeout — i.e. a follower waits ~1 s of silence before campaigning. ZooKeeper's default `tickTime`
  is **2000 ms**, and its session/leader timeouts are multiples of it. So detecting a dead leader and
  failing over typically takes on the order of **a second to a few seconds**, dominated by the
  election timeout, not the vote itself.

## Common misconception — "once a leader is elected, it stays the leader / electing one is the whole problem"

The dangerous case is the **demoted-but-unaware** old leader, not the election itself.

```reveal
{
  "prompt": "Why is 'just elect a leader' an incomplete solution, and what's the actually-hard part of leader election?",
  "answer": "Electing a single leader via majority consensus is well-understood and the easy part. The hard, dangerous part is failure handling — specifically the old leader that has been replaced but doesn't know it. A leader that's slow, GC-paused, or network-partitioned (not truly dead) can be voted out and a new leader elected, while the old one still believes it's in charge and tries to issue writes/commands → split-brain, with two 'leaders' producing conflicting actions and corrupting state. You can't rely on the old leader to gracefully step down (it may be unreachable or unaware), so correctness requires making its actions ineffective: tag everything with monotonically increasing terms/epochs so nodes ignore lower-term messages, and use fencing tokens so downstream resources reject operations carrying a stale token. Leases bound the reign by time but are undermined by clock drift/pauses, so they must be backed by fencing tokens. So leader election is really about safe failover and neutralizing stale leaders — not the moment of voting. Designs that only handle 'pick a leader' and assume it stays valid are exactly the ones that hit split-brain in production."
}
```

Leader election = **agree on one leader (via consensus) and fail over safely**. The crux is preventing
**split-brain** from a **demoted-but-unaware** old leader — solved with **terms/epochs** and **fencing
tokens** (leases bound the reign but need fencing because clocks lie).

## Self-test

```quiz
{
  "question": "The hardest correctness problem in leader election is:",
  "options": [
    "Choosing the fastest node",
    "Preventing split-brain — an old leader that was replaced but still thinks it's in charge and keeps acting",
    "Making elections fast",
    "Storing the leader's name"
  ],
  "answer": 1,
  "explanation": "A slow/partitioned old leader can be demoted yet keep issuing commands; terms and fencing tokens neutralize its stale actions."
}
```

```quiz
{
  "question": "A fencing token prevents a stale leader's late writes by:",
  "options": [
    "Encrypting them",
    "Carrying a monotonically increasing number that resources check, rejecting any operation with a lower token",
    "Making the leader faster",
    "Synchronizing all clocks"
  ],
  "answer": 1,
  "explanation": "Downstream resources record the highest token seen and reject lower ones, so an old leader's (lower-token) operations are fenced out."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Leader election — key terms", "cards": [ { "front": "Leader election", "back": "The process by which nodes agree on a single leader (via consensus) and re-elect a new one when the leader fails." }, { "front": "Term (epoch)", "back": "An ever-increasing number identifying a leader's reign. Majority consensus guarantees one leader per term; nodes reject actions tagged with an outdated term." }, { "front": "Split-brain", "back": "Two nodes both believe they lead and issue conflicting commands, corrupting state — typically caused by a demoted-but-unaware old leader." }, { "front": "Fencing token", "back": "A monotonically increasing token the leader carries; downstream resources record the highest seen and reject any operation with a lower token, fencing out stale writes." }, { "front": "Lease", "back": "A time-bounded lock (TTL) a leader must renew before expiry. Bounds a dead leader's reign but relies on bounded clock drift, so it needs fencing tokens as backup." }, { "front": "Demoted-but-unaware leader", "back": "A slow, GC-paused, or partitioned leader that was replaced but still thinks it's in charge and keeps acting — the dangerous core problem of leader election." } ] }
```

## Key takeaways

- **Leader election** uses **consensus** to agree on one leader per **term**, and **fails over** (new
  term, majority vote) when heartbeats stop.
- The dangerous case is the **demoted-but-unaware** old leader → **split-brain**; defend with
  **terms/epochs** and **fencing tokens** (resources reject stale tokens).
- **Leases** (TTL locks) bound a dead leader's reign but rely on **clocks** (drift/pauses break them) —
  back them with **fencing tokens**.
- Use **randomized timeouts** to avoid election storms; it underpins primary failover, singleton
  schedulers, and coordinators.

## Up next

Closely related: coordinating exclusive access across nodes. Next: **Distributed Locks**.
