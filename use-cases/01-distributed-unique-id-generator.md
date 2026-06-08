---
title: "Design a Unique ID Generator (Snowflake)"
slug: distributed-unique-id-generator
level: use-cases
module: core-building-blocks
order: 1
reading_time_min: 19
concepts: [snowflake-id, distributed-id, time-sortable, clock-skew, worker-id-assignment, bit-packing]
use_cases: [distributed-unique-id-generator]
prerequisites: [logical-clocks-and-vector-clocks, consistent-hashing, leader-election]
status: published
---

# Design a Unique ID Generator (Snowflake)

> **Use case:** a service (or in-process library) that hands out **globally-unique 64-bit IDs** for new
> rows, events, messages, and objects — and does it **without asking a central authority each time**.
> **Domain:** primary keys for sharded databases, message/tweet IDs, order IDs, event IDs — anywhere
> auto-increment can't keep up or can't span shards.
> **Scale:** tens of thousands to millions of new IDs per second across hundreds of machines, with
> **no coordination on the hot path**.
> **Core challenges:** packing **time + machine + sequence** into 64 bits so IDs are unique *and*
> roughly **time-sortable**; why **auto-increment** and **UUIDv4** fall short; surviving **clock skew
> and NTP backward jumps**; what to do when you **run out of sequence bits** in a millisecond; and how
> to **assign worker IDs** without two machines colliding.

Generating a unique number sounds like the most trivial task in computing — until you need it to be
unique across hundreds of machines, sortable by creation time, small enough to be a database key, and
produced millions of times a second with **zero round trips**. That tension is the whole design.

## 1 · Clarify requirements

**Functional**
- Produce IDs that are **globally unique** across the entire fleet, forever.
- IDs are **roughly time-ordered**: an ID minted later sorts after one minted earlier (within reason).
- Generation is **local and fast** — no network call to a sequencer per ID.
- IDs fit in a **64-bit signed integer** (a `BIGINT` primary key, a `long`) — not a 128-bit UUID.

**Non-functional**
- **High throughput:** ≥ thousands of IDs/sec **per machine**, millions fleet-wide.
- **Low latency:** generation is sub-microsecond (a few bit operations).
- **No coordination on the hot path:** machines don't talk to each other to mint an ID.
- **Highly available:** a machine can mint IDs even if the rest of the fleet is unreachable.

```reveal
{
  "prompt": "Why is 'roughly time-sortable, 64-bit, no coordination' the combination that makes this hard — rather than just 'unique'?",
  "answer": "Any one of those constraints alone is easy. Pure uniqueness is solved by a random 128-bit UUIDv4 — but it's 128 bits (a fat, random primary key that destroys B-tree insert locality), and it carries no time order. Time-sortability alone is solved by a database auto-increment sequence — but that needs a single central authority to hand out the next number, which is a coordination point, a bottleneck, and a single point of failure, and it doesn't span shards. Compactness (64 bits) alone is easy if you don't need uniqueness across machines. The trick is satisfying all of them at once: 64 bits is a tight budget, and you must carve it so that (a) different machines never collide without talking to each other, and (b) the high bits encode time so the IDs sort by creation order for free. Snowflake's answer is bit-packing: put the timestamp in the high bits (gives ordering), a machine/worker id in the middle (gives cross-machine uniqueness with no coordination), and a per-millisecond sequence in the low bits (gives uniqueness within one machine in one millisecond). The hard parts then become consequences of that layout — clock skew can break ordering and uniqueness, the sequence field can overflow, and worker ids must be assigned without collision."
}
```

## 2 · Estimate the scale

How many IDs can one machine mint per millisecond, and does the bit budget cover the fleet?

```calc
{
  "title": "Per-machine ID throughput (sequence bits)",
  "inputs": [
    { "key": "seqBits", "label": "Sequence bits (per ms)", "default": 12 },
    { "key": "msPerSec", "label": "Milliseconds per second", "default": 1000 }
  ],
  "formula": "Math.pow(2, seqBits) * msPerSec",
  "resultLabel": "Max IDs per machine per second",
  "resultUnit": "IDs/s"
}
```

```calc
{
  "title": "Lifetime of the timestamp field",
  "inputs": [
    { "key": "tsBits", "label": "Timestamp bits", "default": 41 },
    { "key": "msPerYear", "label": "Milliseconds per year (~)", "default": 31536000000 }
  ],
  "formula": "Math.round(Math.pow(2, tsBits) / msPerYear)",
  "resultLabel": "Years of millisecond timestamps",
  "resultUnit": "years"
}
```

> With **12 sequence bits** one machine mints up to **4,096 IDs/ms ≈ 4.1 million IDs/sec**, and with
> **10 worker-id bits** the fleet can have **1,024 machines** — so ~**4 billion IDs/sec fleet-wide**.
> A **41-bit millisecond timestamp** lasts about **69 years** from a chosen epoch. The numbers fit a
> 64-bit budget comfortably; the work is in the edge cases, not the throughput.

## 3 · The ID structure & the API

A Snowflake ID is one **64-bit signed integer**, sign bit unused, then three packed fields:

```
 0  | timestamp (41 bits, ms since custom epoch) | worker id (10 bits) | sequence (12 bits)
sign|<------------------ high bits ------------->|<--- machine -->     |<-- per-ms count ->
```

- **Sign bit (1):** left 0 so the number stays positive (databases / languages dislike negative keys).
- **Timestamp (41):** milliseconds since a **custom epoch** (e.g. 2020-01-01, not 1970) so the field
  doesn't waste decades of range. Being in the **high bits** is what makes IDs time-sortable.
- **Worker id (10):** which machine/process minted it. Often split (e.g. 5 datacenter + 5 machine).
- **Sequence (12):** a counter that increments for each ID minted **within the same millisecond** on
  the same worker, resetting to 0 each new millisecond.

The interface is just a local call — no arguments, no network:

```
nextId() -> int64   // monotonically non-decreasing per worker
```

## 4 · High-level architecture

There's no central server on the hot path. Each machine runs the generator **in-process** (a library)
or as a **local sidecar**; the only coordination is a **one-time worker-id assignment** at startup.

```flow
{
  "title": "Where IDs come from (no per-ID coordination)",
  "nodes": [
    { "label": "App instance", "detail": "Calls nextId() locally — a few bit ops, sub-microsecond, no network." },
    { "label": "Snowflake generator (in-process)", "detail": "Reads local clock, packs timestamp | workerId | sequence into one int64." },
    { "label": "Worker-id registry (startup only)", "detail": "ZooKeeper/etcd/config hands each instance a unique workerId once, at boot — never on the hot path." },
    { "label": "Local monotonic clock", "detail": "Kept close to real time by NTP; the source of the high bits and the thing that can misbehave." }
  ],
  "note": "The registry is touched once per process lifetime. Every nextId() call is purely local — that's why it survives fleet-wide partitions."
}
```

The only shared, mutable state is the **worker-id assignment**, and it's consulted **once at boot**,
not per ID. That single decision — push coordination to startup — is what gives Snowflake its
availability and throughput.

## 5 · Deep dive A — why not auto-increment or UUIDv4?

Before justifying Snowflake's complexity, rule out the two obvious alternatives.

```compare
{
  "options": [
    { "label": "DB auto-increment", "points": ["Central sequence hands out 1, 2, 3…", "Perfectly ordered & compact (64-bit)", "Needs a round trip + a single authority → bottleneck & SPOF", "Doesn't span shards; gaps/contention under load"] },
    { "label": "UUIDv4 (random 128-bit)", "points": ["Generated locally, no coordination", "Globally unique with overwhelming probability", "128 bits — fat key, poor B-tree insert locality (random)", "Not time-sortable at all"] },
    { "label": "UUIDv7 (time-ordered 128-bit)", "points": ["Local, time-prefixed (sortable) like Snowflake", "No worker-id setup needed", "Still 128 bits (2× the storage of a BIGINT)", "Good modern choice when 128 bits is acceptable"] },
    { "label": "Snowflake (64-bit packed)", "points": ["Local generation, no per-ID coordination", "64-bit, time-sortable, fits a BIGINT key", "Needs worker-id assignment + clock discipline", "The sweet spot when you need compact, sortable, coordination-free"] }
  ]
}
```

```reveal
{
  "prompt": "Concretely, what goes wrong with a random UUIDv4 as a primary key — beyond 'it's bigger'?",
  "answer": "Two real costs. First, size: a UUID is 128 bits (16 bytes) versus a 64-bit BIGINT (8 bytes). That doubles the primary-key storage, and because the PK is duplicated into every secondary index and every foreign key, the bloat multiplies across the schema and pushes more of the index out of RAM. Second, and more damaging, is insert locality. Most databases store rows in a B-tree (or clustered index) ordered by the primary key. A random UUIDv4 lands at a random position in that tree on every insert, so writes scatter across the whole index: pages constantly split, the working set of 'hot' pages is the entire index instead of just the tail, the buffer pool churns, and write amplification climbs. A time-sortable ID (Snowflake, or UUIDv7) instead appends near the end of the tree — sequential, cache-friendly inserts that keep only the tail hot. That ordering is the practical reason teams pick a sortable 64-bit ID: it's not just smaller, it makes the most common write pattern (insert recent rows) cheap. UUIDv4 also leaks no creation-time information, so you can't range-scan or paginate by ID."
}
```

Drag the dial — coordination buys you tighter ordering and compactness, at the cost of independence:

```tradeoff
{
  "title": "How much coordination can an ID scheme afford?",
  "axis": { "left": "Coordination-free / independent", "right": "Coordinated / globally ordered" },
  "steps": [
    { "label": "UUIDv4 (random)", "detail": "Zero coordination, generated anywhere — but 128-bit and totally unordered. Pick when uniqueness is all you need." },
    { "label": "Snowflake (time + worker + seq)", "detail": "Coordination only once (worker-id at boot). 64-bit and roughly time-sorted. The pragmatic middle." },
    { "label": "Per-key strict order (e.g. per shard)", "detail": "A small authority orders IDs within a partition; cross-partition order is approximate. More order, more coupling." },
    { "label": "Central auto-increment", "detail": "One global sequence: perfect order, compact — but a round trip per ID and a bottleneck/SPOF that can't scale or span shards." }
  ]
}
```

## 6 · Deep dive B — clock skew, sequence overflow, and worker ids

The timestamp field is both Snowflake's superpower and its weak point: it trusts the machine's clock.

### Clock moving backward (the dangerous case)

Wall clocks aren't monotonic. **NTP** (the protocol that disciplines machine clocks against time
servers) can **step the clock backward** to correct drift, and leap seconds or VM pauses can do the
same. If the clock jumps back, the timestamp in new IDs becomes **smaller than IDs already issued** —
breaking time-ordering and, worse, **risking duplicates** (the same timestamp + same worker + a
sequence range you already used).

The standard defense: the generator **remembers the last timestamp it issued** and **refuses to go
backward**.

```sequence
{
  "title": "nextId() guarding against a backward clock",
  "actors": ["Caller", "Generator", "Clock"],
  "steps": [
    { "from": "Caller", "to": "Generator", "label": "nextId()" },
    { "from": "Generator", "to": "Clock", "label": "now = currentMillis()" },
    { "from": "Clock", "to": "Generator", "label": "now (could be < lastTs after an NTP step-back)" },
    { "from": "Generator", "to": "Generator", "label": "if now < lastTs: clock went backward → wait, or throw" },
    { "from": "Generator", "to": "Generator", "label": "if now == lastTs: seq++ (if seq overflows, spin to next ms)" },
    { "from": "Generator", "to": "Generator", "label": "if now > lastTs: seq = 0; lastTs = now" },
    { "from": "Generator", "to": "Caller", "label": "(now << 22) | (workerId << 12) | seq" }
  ]
}
```

```reveal
{
  "prompt": "If the clock jumps backward, what are the realistic options, and why is 'just wait' usually right?",
  "answer": "When currentMillis() returns a value below the last timestamp you issued, you have a few choices. (1) Reject: throw an error / refuse to issue IDs until the clock catches back up — Twitter's original Snowflake did this (it would error if the clock moved backward), trading availability for a hard correctness guarantee. (2) Wait/spin: if the backward jump is small (a few milliseconds, which is the common NTP correction), block until the local clock catches up to lastTs, then resume — callers see a tiny latency blip but never a non-monotonic or duplicate ID. This is the usual production choice because real backward steps are small and rare. (3) Borrow/extend: some designs reserve extra bits or keep a logical offset so they can keep advancing a counter while the wall clock recovers (conceptually a logical clock layered over the physical one). What you must NOT do is blindly emit an ID with the smaller timestamp: combined with the same worker id, you could re-enter a (timestamp, sequence) space you already handed out and produce a DUPLICATE — the one failure the whole system exists to prevent. So the rule is: never let the timestamp go backward. Waiting is right when the skew is tiny; rejecting is right when correctness must be absolute and you'd rather fail loudly; large jumps (clock badly wrong) should alarm and pull the node out of rotation."
}
```

### Running out of sequence bits

With 12 sequence bits a worker can mint 4,096 IDs in a single millisecond. The **4,097th** request in
that same millisecond has nowhere to put its sequence number. The fix is simple and built into the
algorithm above: when the sequence **overflows**, the generator **busy-waits until the next
millisecond**, resets the sequence to 0, and continues. You only ever stall if you're sustaining more
than 4 million IDs/sec on one node — at which point you'd add sequence bits (steal from worker-id or
timestamp) or shard generation across more workers.

### Assigning worker ids without collisions

Two machines with the **same worker id** can mint the **same ID** in the same millisecond — the
cardinal sin. So each of the (up to) 1,024 worker ids must be **uniquely owned**. Options:

```compare
{
  "options": [
    { "label": "Static config", "points": ["Bake workerId into each host's config/env", "Dead simple, no dependencies", "Human error → two hosts share an id (silent duplicates)", "Painful to manage at hundreds of hosts / autoscaling"] },
    { "label": "Coordination service", "points": ["ZooKeeper/etcd hands out a unique id at boot", "Safe lease/sequential node guarantees no overlap", "Adds a startup dependency (but only at startup)", "How Twitter-style Snowflake did it"] },
    { "label": "Derive from infra", "points": ["Map a stable host identity (ordinal pod / IP) to an id", "No extra service if the platform already assigns it (e.g. StatefulSet ordinal)", "Must guarantee the mapping is unique & stable across restarts", "Clean on Kubernetes; risky with reused IPs"] }
  ]
}
```

```reveal
{
  "prompt": "Why is worker-id assignment a leader-election / coordination problem, and why is solving it once at startup enough?",
  "answer": "Worker-id assignment is the requirement 'exactly one live process owns each id at any time' — which is the same family of problem as leader election: a set of nodes must agree, without conflict, on who holds a unique role, and that agreement must survive crashes, restarts, and network partitions. A coordination service like ZooKeeper or etcd solves it directly: a booting generator creates an ephemeral sequential node (or grabs a lease) and is handed an id no other live node holds; if it dies, the lease expires and the id can be reclaimed. The crucial design move is that this coordination happens ONCE, at process startup, not on the hot path. Once a process owns worker id 37, every nextId() call is purely local — it never re-consults ZooKeeper — so the coordination service can even be temporarily down without stopping ID generation; it only matters when a new process boots and needs an id. That's why Snowflake is both coordination-free where it counts (per ID) and safe (the one piece of shared agreement is established up front). The danger to guard is two processes simultaneously believing they own the same id — which is exactly what leases/ephemeral nodes prevent, and why bare static config (no coordinator) is risky: nothing stops a copy-paste from giving two hosts the same id and silently minting duplicates."
}
```

## 7 · Trade-offs & failure modes

- **The clock is a dependency you don't control.** Snowflake's correctness rests on NTP keeping the
  wall clock sane. A badly wrong clock (large step, dead NTP) can break ordering or force the node to
  stall/reject. Mitigate: monitor clock drift, use a monotonic guard, and pull misbehaving nodes out.
- **Ordering is *approximate*, not total.** Two IDs minted in the same millisecond on **different
  workers** have no defined order between them (their worker-id bits decide the tiebreak, which is
  arbitrary). Snowflake gives *roughly* time-sorted, not a strict global order — fine for "newest
  first" feeds, not for anything needing exact causal ordering (use logical clocks for that).
- **Worker-id exhaustion / reuse.** Only 1,024 ids exist (with 10 bits). Aggressive autoscaling that
  churns hosts can exhaust or unsafely reuse ids; size the field for your churn, or reclaim safely via
  leases.
- **No central server, but a startup dependency.** If the coordination service is down, **existing**
  processes keep minting IDs fine; only **new** processes can't boot. That's a deliberate, good
  trade — the hot path stays independent.
- **Bit-budget is fixed at design time.** Splitting 64 bits as 41/10/12 bakes in limits (years,
  machines, per-ms rate). Changing the split later is a migration; choose with headroom.

## 8 · Scaling & evolution

- **Re-carve the bits** for your reality: more worker-id bits for a huge fleet, more sequence bits for
  hotter nodes, fewer timestamp bits if 69 years is overkill. The split is a policy decision.
- **Run it as a sidecar/library**, not a service, to keep generation local; if you must centralize,
  use a **batch-allocation** sequencer that hands out *ranges* of ids so the round trip is amortized
  over thousands of IDs.
- **Adopt UUIDv7** when 128 bits is acceptable and you want time-sortable IDs **without** managing
  worker ids — it trades storage for operational simplicity.
- **Monitor the clock** as a first-class signal (drift, step events) and alarm before skew causes
  stalls or rejects.

## Self-test

```quiz
{
  "question": "In a 64-bit Snowflake ID, why is the timestamp placed in the HIGH bits rather than the low bits?",
  "options": [
    "To make the number negative",
    "So that comparing IDs as integers sorts them by creation time (roughly time-ordered)",
    "To save space",
    "Because the database requires it"
  ],
  "answer": 1,
  "explanation": "The most-significant bits dominate integer comparison, so putting the timestamp there makes a larger ID mean a later creation time — giving rough time-sortability for free."
}
```

```quiz
{
  "question": "An NTP correction steps a generator's clock backward by 3 ms. What is the safe behavior for nextId()?",
  "options": [
    "Emit an ID with the smaller timestamp immediately",
    "Refuse to ever generate IDs again",
    "Detect now < lastTs and wait until the clock catches up (or throw) — never issue a smaller timestamp",
    "Switch to UUIDv4 permanently"
  ],
  "answer": 2,
  "explanation": "Issuing a smaller timestamp on the same worker can re-enter an already-used (timestamp, sequence) range and produce a duplicate. The generator must never go backward: wait for small skews, reject/alarm for large ones."
}
```

```quiz
{
  "question": "Why is assigning worker ids a coordination problem, and when does that coordination happen?",
  "options": [
    "It happens on every nextId() call, so the coordinator is on the hot path",
    "Two machines sharing a worker id can mint identical IDs; the unique-id assignment is done once at startup (e.g. via ZooKeeper/etcd lease)",
    "Worker ids are random, so collisions never matter",
    "It only matters for UUIDs"
  ],
  "answer": 1,
  "explanation": "Each worker id must be uniquely owned or duplicates occur. A coordination service grants a unique id once at boot; afterward generation is purely local, so the coordinator isn't on the hot path."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Unique ID generator — key terms",
  "cards": [
    { "front": "Snowflake ID", "back": "A 64-bit ID packed as sign(1) | timestamp(41) | worker id(10) | sequence(12). Locally generated, time-sortable, fits a BIGINT." },
    { "front": "Custom epoch", "back": "A chosen start time (e.g. 2020-01-01) the 41-bit timestamp counts from, so the field isn't wasting decades since 1970 — extends usable lifetime." },
    { "front": "Sequence field", "back": "Per-millisecond counter (12 bits = 4,096) that disambiguates IDs minted in the same ms on the same worker; resets to 0 each new ms, spins to next ms on overflow." },
    { "front": "Clock skew / backward jump", "back": "NTP/VM pauses can move the wall clock back, risking smaller timestamps and duplicates. Guard: remember lastTs and never go backward (wait or reject)." },
    { "front": "Worker-id assignment", "back": "Each machine must own a unique id (≤1,024 with 10 bits) or it can mint duplicate IDs. Granted once at boot via a coordination service (ZooKeeper/etcd) or stable infra identity." },
    { "front": "Roughly time-sortable", "back": "High-bit timestamp gives approximate ordering; IDs in the same ms on different workers have no defined order — not a strict global/causal order." }
  ]
}
```

## Key takeaways

- A Snowflake ID **bit-packs time + worker + sequence into 64 bits**, getting **uniqueness without
  coordination** and **rough time-ordering** in one compact key.
- **Auto-increment** needs a central authority (bottleneck/SPOF, can't span shards); **UUIDv4** is
  unordered and 128-bit (fat key, bad insert locality) — Snowflake is the **compact, sortable,
  coordination-free** middle (with **UUIDv7** as the simpler 128-bit alternative).
- The **clock is the weak point:** never let the timestamp move **backward** (wait for small skews,
  reject/alarm for large) or you risk duplicates; **sequence overflow** spins to the next millisecond.
- **Worker-id assignment is a coordination/leader-election problem** solved **once at startup** (lease
  from ZooKeeper/etcd or a stable host identity), so the per-ID hot path stays purely local.
- The **64-bit split is a fixed design choice** — size timestamp, worker, and sequence bits for your
  fleet size, node hotness, and required lifetime, with headroom.

## Concepts exercised

This design applies, end to end: `logical-clocks-and-vector-clocks` — the physical wall clock gives
only *approximate* order, and the backward-jump guard (remember `lastTs`, never regress) is a logical
clock layered over the physical one to preserve monotonicity. `leader-election` — assigning each worker
a uniquely-owned id is the same "exactly one owner per role" agreement leader election provides, done
once at startup via ZooKeeper/etcd leases. `consistent-hashing` — relevant when these IDs become keys
in a **sharded** datastore (the very reason auto-increment fails to span shards) and for distributing
generation load. It also touches `single-point-of-failure` (why a central sequencer is avoided) and
`caching-fundamentals`/TTL thinking only loosely; the heart of the design is bit-packing plus clock
discipline.
