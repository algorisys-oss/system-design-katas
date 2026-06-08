---
title: "Distributed Locks"
slug: distributed-locks
level: advanced
module: correctness-and-consensus
order: 5
reading_time_min: 15
concepts: [distributed-locks, mutual-exclusion, lease-ttl, fencing-tokens, redlock, correctness-vs-efficiency]
use_cases: []
prerequisites: [leader-election, distributed-consensus]
status: published
---

# Distributed Locks

## Hook — a motivating scenario

Two workers must not process the same job at once, so you reach for a lock — but a single-process mutex
means nothing across machines. So you build a **distributed lock** in Redis: `SET lock NX EX 30`. It
works… until a worker holding the lock pauses for a GC, its lock expires, a second worker grabs it, and
now **both** run the "exclusive" job and double-charge a customer. Distributed locking is deceptively
hard, and getting it *correct* requires more than a key with a TTL.

## Mental model — mutual exclusion across machines

A **distributed lock** provides **mutual exclusion across processes/machines**: at most one holder of a
named lock at a time, coordinated through a shared service (Redis, ZooKeeper/etcd, a database). Unlike a
local mutex, it must survive the holder **crashing** (or no one could ever acquire it again) — which is
why locks have a **lease/TTL** that auto-expires. That auto-expiry is exactly where correctness gets
tricky.

## Build it up — the TTL dilemma and fencing tokens

A lock with a TTL faces a dilemma:
- **Too short** → it expires while the legitimate holder is still working (a GC pause, a slow I/O), so
  someone else acquires it → **two holders** (the opening bug).
- **Too long** → if the holder crashes, everyone waits a long time before the lock frees.

There's no TTL that's always right, because you can't distinguish "holder is slow" from "holder is
dead." The robust fix is **fencing tokens** (recall leader election): each lock acquisition returns a
**monotonically increasing token**, and the **protected resource rejects any operation with a token
lower than the highest it has seen**. So even if an old holder resumes after its lease expired, its
writes are **fenced out**.

```sequence
{
  "title": "Why a TTL alone fails — and fencing fixes it",
  "actors": ["Worker1", "Lock", "Worker2", "Storage"],
  "steps": [
    { "from": "Worker1", "to": "Lock", "label": "acquire → token 33 (TTL 30s)" },
    { "from": "Worker1", "to": "Worker1", "label": "long GC pause... lease expires" },
    { "from": "Worker2", "to": "Lock", "label": "acquire → token 34" },
    { "from": "Worker2", "to": "Storage", "label": "write with token 34 (accepted)" },
    { "from": "Worker1", "to": "Storage", "label": "resumes, writes with token 33 → REJECTED (stale)" }
  ]
}
```

```reveal
{
  "prompt": "Why can't you fix distributed-lock safety just by picking a 'good' TTL, and what actually makes it correct?",
  "answer": "Because no TTL can reliably distinguish a slow holder from a dead one. Any holder can be paused arbitrarily long (stop-the-world GC, VM freeze, scheduler starvation, network stall) without being dead — so whatever TTL you pick, a real holder can exceed it and have its lease expire while it still believes it holds the lock. Make the TTL longer and you just delay recovery when a holder genuinely crashes (everyone blocks). So the lease is fundamentally a timeout guess, and timeouts can't guarantee mutual exclusion. What makes it correct is fencing tokens: each acquisition hands out a monotonically increasing token, and the resource being protected records the highest token it has accepted and rejects any operation carrying a lower one. Then even if an expired-but-unaware old holder resumes and tries to write, its stale (lower) token is refused — so at most one holder's writes can take effect at a time, regardless of TTL accuracy or clock issues. The lease provides liveness (someone can take over after a crash); fencing tokens provide safety (no two holders' writes both land). Safety must come from the resource enforcing token order, not from hoping the TTL was right."
}
```

## Build it up — correctness vs efficiency, and Redlock

A crucial distinction (from Martin Kleppmann's critique of distributed locking): **why** do you want
the lock?
- **Efficiency** — to avoid *duplicate work* (e.g. don't recompute the same cache entry twice). If the
  lock occasionally fails and two workers run, it's wasteful but **harmless**. A simple Redis lock is
  fine here.
- **Correctness** — to prevent *incorrect results* (double-charge, corrupted data). Here a lock failure
  is a **disaster**, so you **must** use **fencing tokens** and ideally a **consensus-backed** lock
  service (ZooKeeper/etcd) rather than relying on timing.

**Redlock** (a multi-Redis-instance locking algorithm) is contested precisely on this point: critics
argue it still depends on timing/clock assumptions and doesn't provide fencing, so it's unsafe for
correctness-critical locks. For correctness, prefer a consensus system + fencing tokens; for efficiency,
a single Redis lock is usually adequate.

```reveal
{
  "prompt": "When is a simple Redis `SET NX EX` lock perfectly fine, and when is it dangerous?",
  "answer": "It's fine when the lock is for efficiency, not correctness — i.e. its only job is to reduce duplicate or wasted work, and the system stays correct even if two holders occasionally run simultaneously. Example: preventing two workers from regenerating the same expensive cache entry — if the lock briefly fails and both regenerate it, you've wasted some CPU but the result is identical and nothing is corrupted. There, a single Redis lock with a TTL is simple and good enough. It's dangerous when the lock is for correctness — when two simultaneous holders would produce wrong results or corrupt/duplicate state (charging a card, transferring money, assigning a unique resource, mutating shared data). A Redis TTL lock can be violated by GC pauses, clock drift, failover, or lost writes, allowing two holders — and without fencing tokens the resource can't reject the stale holder's writes, so you get double-charges/corruption. For correctness-critical mutual exclusion, you need fencing tokens enforced at the resource and ideally a consensus-backed lock service (etcd/ZooKeeper), not a timing-based Redis lock. The deciding question: 'if this lock briefly allowed two holders, is it merely wasteful or actually incorrect?'"
}
```

The "why" behind the lock sets how much machinery you need — slide from pure efficiency to strict correctness:

```tradeoff
{ "title": "How much rigor does your distributed lock need?", "axis": { "left": "Efficiency (dup-work)", "right": "Correctness (no double-effect)" }, "steps": [ { "label": "Single Redis TTL lock", "detail": "Lock only avoids duplicate work (e.g. regenerating a cache entry). If it briefly fails and two holders run, it's wasteful but harmless — a plain SET NX EX is adequate." }, { "label": "Redis lock + fencing tokens", "detail": "Pushing toward correctness: keep the simple lock but have the resource reject any operation carrying a token lower than the highest it has seen, fencing out stale holders." }, { "label": "Consensus-backed lock + fencing", "detail": "Correctness-critical (double-charge, corruption): use etcd/ZooKeeper for ordered, fenceable acquisition rather than relying on Redis timing/clock assumptions." } ] }
```

## In the wild

- **Consensus-backed locks** (ZooKeeper, etcd) are the safe choice for correctness-critical mutual
  exclusion (and underpin leader election); they provide ordered, fenceable acquisition.
- **Redis locks** (`SET NX PX`, or Redlock) are common and fine for **efficiency** locks; pair with
  **fencing tokens** at the resource if you push toward correctness.
- **Databases** can provide locks (advisory locks, `SELECT ... FOR UPDATE`) within their transaction
  scope — often the simplest correct option when the resource *is* the database (recall transactions).
- The deciding question is always **efficiency vs correctness** — it determines how much rigor (fencing,
  consensus) you need.

## Common misconception — "a Redis key with a TTL is a safe distributed lock"

It provides liveness, not safety; correctness needs fencing tokens.

```reveal
{
  "prompt": "Why is 'SET lock NX EX 30' in Redis not a safe distributed lock for correctness-critical work, despite looking like mutual exclusion?",
  "answer": "Because it relies on a TTL/timeout to release the lock, and timeouts can't guarantee a single holder. A legitimate holder can be paused (GC, VM freeze, slow I/O) past the TTL, so Redis expires its lock and hands it to a second worker while the first still believes it holds it — now two workers run the 'exclusive' section simultaneously. Redis failover makes it worse: a lock acquired on a primary can be lost if the primary fails before replicating, letting another client acquire it. And critically, the plain Redis lock provides no fencing token, so the protected resource can't tell the stale holder's writes apart from the valid holder's — both land, causing double-processing/corruption. So `SET NX EX` gives liveness (the lock frees if a holder dies) and is adequate for efficiency locks (where double execution is merely wasteful), but it does not provide the safety needed for correctness-critical mutual exclusion. For that you need fencing tokens enforced at the resource and ideally a consensus-backed lock service. The key reframe: a TTL key prevents most concurrency most of the time, which is not the same as guaranteeing at-most-one — and 'most of the time' is unacceptable when a violation means a double charge."
}
```

A distributed lock needs a **lease (TTL) for liveness** but that alone **can't guarantee safety**
(slow≠dead). Correctness-critical locks require **fencing tokens** (resource rejects stale tokens) and
ideally a **consensus-backed** service; a plain Redis TTL lock suits **efficiency**, not correctness.

## Self-test

```quiz
{
  "question": "Why is a TTL-based distributed lock alone insufficient for correctness-critical mutual exclusion?",
  "options": [
    "TTLs are too slow",
    "A slow (paused) holder can have its lease expire while still working, so two holders run — and the resource can't reject the stale one without fencing tokens",
    "Redis can't store keys",
    "TTLs require synchronized clocks to be fast"
  ],
  "answer": 1,
  "explanation": "You can't distinguish slow from dead; the lease may expire under a real holder. Fencing tokens let the resource reject the stale holder's writes."
}
```

```quiz
{
  "question": "A simple Redis lock (no fencing) is acceptable when the lock is for:",
  "options": [
    "Correctness — preventing double-charges/corruption",
    "Efficiency — avoiding duplicate work, where occasional double-execution is merely wasteful (not incorrect)",
    "Both equally",
    "Neither"
  ],
  "answer": 1,
  "explanation": "Efficiency locks tolerate rare double-execution (just wasted work); correctness locks need fencing tokens + ideally consensus-backed services."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Distributed locks — key terms", "cards": [ { "front": "Distributed lock", "back": "Mutual exclusion across processes/machines — at most one holder of a named lock at a time, coordinated through a shared service (Redis, ZooKeeper/etcd, a database)." }, { "front": "Lease / TTL", "back": "An auto-expiry on a lock so a crashed holder's lock frees and others can acquire it. Provides liveness, but a paused holder's lease can expire mid-work." }, { "front": "Fencing token", "back": "A monotonically increasing token returned on each acquisition; the protected resource rejects any operation carrying a token lower than the highest it has seen, fencing out stale holders." }, { "front": "Efficiency vs correctness", "back": "Why you hold the lock: efficiency avoids duplicate work (failure merely wasteful); correctness prevents wrong results (failure is a disaster needing fencing + consensus)." }, { "front": "Redlock", "back": "A multi-Redis-instance locking algorithm, contested because it still depends on timing/clock assumptions and provides no fencing — so it's unsafe for correctness-critical locks." }, { "front": "Liveness vs safety", "back": "A TTL gives liveness (the lock frees if a holder dies) but can't guarantee safety (at-most-one) since you can't tell slow from dead; fencing tokens provide the safety." } ] }
```

## Key takeaways

- A **distributed lock** = mutual exclusion across machines via a shared service; it needs a
  **lease/TTL** so a crashed holder's lock frees (**liveness**).
- A TTL **can't guarantee safety** (you can't tell *slow* from *dead*) — a paused holder's lease can
  expire mid-work, allowing two holders.
- **Fencing tokens** (monotonic; resource rejects lower tokens) provide the safety; correctness-critical
  locks also want a **consensus-backed** service (etcd/ZooKeeper).
- Decide by **efficiency vs correctness**: a plain Redis TTL lock is fine for efficiency (dup-work
  avoidance), unsafe for correctness without fencing.

## Up next

Locking is one way to manage concurrency; databases offer a subtler one via versions. Next:
**Multi-Version Concurrency Control (MVCC)**.
