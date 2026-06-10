---
title: "Three-Phase Commit"
slug: three-phase-commit
level: advanced
module: distributed-transactions
order: 15
reading_time_min: 8
concepts: [3pc, non-blocking-commit, timeouts, pre-commit, network-partition, consensus]
use_cases: []
prerequisites: [two-phase-commit, distributed-consensus]
status: published
---

# Three-Phase Commit

## Hook — a motivating scenario

Two-phase commit has one terrible failure mode: if the coordinator dies after participants vote YES,
they **block forever** holding locks. The obvious question: can we add a step so participants can
**safely decide on their own** if the coordinator vanishes, instead of blocking? **Three-phase commit
(3PC)** does exactly that — and understanding *why it still doesn't fully solve the problem* is a great
lesson in the limits of distributed agreement.

## Mental model — insert a "pre-commit" so timeouts are safe

3PC splits 2PC's commit phase in two, adding a **pre-commit** step between voting and committing, plus
**timeouts** that let participants act unilaterally:
1. **CanCommit?** — coordinator asks; participants vote YES/NO (like 2PC prepare).
2. **Pre-commit** — if all voted YES, coordinator says "prepare to commit" (everyone acknowledges
   they're ready, but hasn't committed yet).
3. **Do-commit** — coordinator says "commit"; participants commit.

The point of the extra phase: **pre-commit signals that everyone agreed to commit**. So if the
coordinator dies, a participant that reached **pre-commit can safely commit on timeout** (it knows all
voted YES); one that's still in the voting phase can safely **abort on timeout**. This makes 3PC
**non-blocking** under a clean coordinator crash (in a **fail-stop, partition-free** model) — the fix
2PC lacked.

```sequence
{
  "title": "Three-phase commit (extra pre-commit enables safe timeouts)",
  "actors": ["Coordinator", "ServiceA", "ServiceB"],
  "steps": [
    { "from": "Coordinator", "to": "ServiceA", "label": "CanCommit?" },
    { "from": "ServiceA", "to": "Coordinator", "label": "YES" },
    { "from": "Coordinator", "to": "ServiceA", "label": "Pre-commit (all agreed)" },
    { "from": "ServiceA", "to": "Coordinator", "label": "ack ready" },
    { "from": "Coordinator", "to": "ServiceA", "label": "Do-commit → commit" }
  ]
}
```

## Build it up — why 3PC still isn't the answer

3PC fixes blocking on a **clean coordinator crash**, but it has serious caveats:
- **It fails under network partitions.** 3PC's safety relies on timeouts and the assumption that a
  silent node has *failed*. Under a **partition**, nodes are alive but isolated — different sides can
  reach different conclusions on timeout (some pre-committed side commits; the other side aborts) →
  **inconsistency / split-brain**. So 3PC trades 2PC's *blocking* for *possible inconsistency under
  partition* — usually a worse deal.
- **More latency:** an extra round trip (three phases instead of two) for every commit.
- **Still a coordinator-centric protocol** with complexity.

Because of the partition problem, **3PC is rarely used in practice**. The real solution to "atomic
commit without blocking *and* without inconsistency" is **consensus** (Paxos/Raft, recall): make the
commit decision itself a consensus value over a replicated, majority-backed log, so there's no single
coordinator to block on and majorities prevent split-brain.

```reveal
{
  "prompt": "3PC is non-blocking where 2PC blocks — so why is it rarely used, and what's actually used instead?",
  "answer": "3PC removes 2PC's block-on-coordinator-crash by adding a pre-commit phase plus timeouts, so a participant that reached pre-commit can safely commit on its own (it knows everyone agreed) and one still voting can safely abort — no indefinite in-doubt waiting. But that safety depends on timeouts meaning 'the other node crashed,' which breaks under network partitions: in a partition, nodes are alive but can't communicate, so different partitions can time out and make *different* unilateral decisions — one side commits (it had reached pre-commit) while the other aborts — producing inconsistency/split-brain, which is worse than blocking. So 3PC trades 2PC's liveness problem (blocking) for a safety problem (inconsistency under partition), and since partitions are exactly the failures distributed systems must survive, that trade is usually unacceptable. It also adds an extra round-trip of latency and more complexity. What's used instead for non-blocking atomic commit is consensus (Paxos/Raft): the commit decision is agreed via a majority-quorum, replicated log, so there's no single coordinator whose failure blocks anyone, and majority overlap prevents split-brain even under partition (the minority side simply can't make progress, preserving safety). Distributed databases that need atomic commit (e.g. Spanner/CockroachDB) back the coordinator/decision with consensus rather than using 3PC. For loosely-coupled services, sagas/outbox sidestep distributed atomic commit entirely. 3PC is mostly of theoretical/historical interest — a cautionary tale that you can't get fault-tolerant atomic commit just by adding phases and timeouts; you need consensus."
}
```

## In the wild

- **3PC is mostly theoretical/historical** — taught to illustrate the limits of timeout-based atomic
  commit; rarely deployed because of the partition-inconsistency flaw.
- **Consensus-backed commit** is the practical answer: distributed databases (Spanner, CockroachDB)
  use **Paxos/Raft** to replicate the commit decision, getting non-blocking atomic commit without
  split-brain.
- **The cost is concrete:** 3PC's third phase adds one extra coordinator round trip versus 2PC, so
  every commit pays an additional network RTT — on the order of **~1 ms intra-datacenter** but
  **~50–150 ms cross-region** — for a protocol that still isn't partition-safe.
- For services, **sagas + outbox** (next chapters) avoid distributed atomic commit altogether.
- The lineage: **2PC (blocking) → 3PC (non-blocking but partition-unsafe) → consensus (the real fix)**.

## Common misconception — "3PC fixes 2PC, so it's the better protocol to use"

It fixes blocking but introduces inconsistency under partitions — net worse, and consensus supersedes
it.

```reveal
{
  "prompt": "Why is 'just use 3PC instead of 2PC' bad advice?",
  "answer": "Because 3PC swaps one serious problem for another that's usually worse, and a better solution exists. 2PC's flaw is liveness: it blocks (holds locks, in-doubt) if the coordinator crashes, but it never produces inconsistent results. 3PC adds a pre-commit phase and timeouts so participants can decide unilaterally and not block — solving liveness on a clean crash — but its correctness assumes a timeout means the peer is dead. Under a network partition (nodes alive but isolated, a normal distributed failure), that assumption is false: different partitions can independently time out and reach conflicting decisions (one commits, one aborts), violating atomicity/causing split-brain. So 3PC trades 2PC's blocking (a safe-but-stuck state) for possible inconsistency (an unsafe state) precisely in the partition scenarios distributed systems must handle — a bad trade. It also costs an extra round-trip and adds complexity. And it's superseded: consensus protocols (Paxos/Raft) provide non-blocking atomic commit AND remain safe under partitions, because the decision is a majority-quorum value on a replicated log — no single coordinator to block on, and majorities prevent divergent decisions (the minority just can't proceed). That's why real systems use consensus-backed commit (or avoid distributed commit via sagas/outbox), not 3PC. So 3PC isn't 'better 2PC'; it's a historically interesting step that demonstrates timeouts alone can't give fault-tolerant atomic commit — you need consensus."
}
```

**3PC** adds a **pre-commit** phase + timeouts to make atomic commit **non-blocking** on coordinator
crash — but it can become **inconsistent under network partitions**, costs an extra round trip, and is
**rarely used**. The real fix for non-blocking, partition-safe atomic commit is **consensus**.

## Self-test

```quiz
{
  "question": "The extra 'pre-commit' phase in 3PC exists to:",
  "options": [
    "Speed up commits",
    "Let participants safely decide on their own (via timeout) if the coordinator crashes, making it non-blocking",
    "Encrypt the transaction",
    "Avoid using a coordinator entirely"
  ],
  "answer": 1,
  "explanation": "Pre-commit signals everyone agreed, so a pre-committed participant can commit on timeout (and a voting one can abort) — removing 2PC's blocking."
}
```

```quiz
{
  "question": "3PC is rarely used in practice because:",
  "options": [
    "It's slower than everything",
    "It can produce inconsistency under network partitions; consensus (Paxos/Raft) provides non-blocking AND partition-safe atomic commit",
    "It can't commit anything",
    "It requires CRDTs"
  ],
  "answer": 1,
  "explanation": "3PC trades blocking for partition-inconsistency; consensus-backed commit is the real, partition-safe solution (and sagas avoid distributed commit)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Three-phase commit — key terms", "cards": [
  { "front": "Three-phase commit (3PC)", "back": "An atomic-commit protocol that splits 2PC's commit phase by adding a pre-commit step plus timeouts, so participants can decide unilaterally if the coordinator crashes — making it non-blocking on a clean crash." },
  { "front": "Pre-commit phase", "back": "The extra middle step: after all vote YES, the coordinator says 'prepare to commit' and everyone acknowledges readiness without committing. It signals that everyone agreed, enabling safe timeout decisions." },
  { "front": "Why pre-commit makes 3PC non-blocking", "back": "A participant that reached pre-commit can safely commit on timeout (it knows all voted YES); one still voting can safely abort. No indefinite in-doubt waiting on the coordinator." },
  { "front": "3PC's partition flaw", "back": "Its safety assumes a silent node has failed. Under a partition, isolated-but-alive sides can time out and reach conflicting decisions (one commits, one aborts) → inconsistency / split-brain." },
  { "front": "Why 3PC is rarely used", "back": "It trades 2PC's blocking for possible inconsistency under partition (usually worse), adds a round trip, and is coordinator-centric. Consensus supersedes it." },
  { "front": "The real fix (consensus)", "back": "Paxos/Raft make the commit decision a majority-quorum value on a replicated log — no single coordinator to block on, and majorities prevent split-brain even under partition. Used by Spanner, CockroachDB." }
] }
```

## Key takeaways

- **3PC** inserts a **pre-commit** phase + **timeouts** between vote and commit so participants can
  **decide unilaterally** if the coordinator crashes → **non-blocking** (fixing 2PC's flaw).
- But it's **unsafe under network partitions** (isolated sides can reach conflicting decisions →
  split-brain), adds a **round trip**, and is **rarely used**.
- The real solution for **non-blocking + partition-safe** atomic commit is **consensus** (Paxos/Raft);
  distributed DBs back commit with it.
- Lineage: **2PC (blocking) → 3PC (non-blocking, partition-unsafe) → consensus (the actual fix)**;
  services often avoid the whole problem with **sagas/outbox**.

## Up next

The dominant microservice alternative to distributed atomic commit. Next: **Saga Pattern**.
