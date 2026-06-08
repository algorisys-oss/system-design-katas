---
title: "Design a Ticketing System (Ticketmaster)"
slug: ticketing-system
level: use-cases
module: correctness-and-booking
order: 17
reading_time_min: 20
concepts: [seat-inventory, temporary-holds, optimistic-locking, virtual-waiting-room, payment-saga, fairness]
use_cases: [ticketing-system]
prerequisites: [database-transactions, optimistic-vs-pessimistic-locking, saga-pattern, idempotency-and-safe-methods]
status: published
---

# Design a Ticketing System (Ticketmaster)

> **Use case:** sell tickets to events — concerts, sports, theater — where a buyer picks a specific
> **seat** (or a quantity of general-admission tickets), holds it while they pay, and completes
> purchase. **No seat may ever be sold twice.**
> **Domain:** Ticketmaster, AXS, SeatGeek, Eventbrite, airline/train seat selection, cinema booking.
> **Scale:** an event has 10k–100k seats, but a hot on-sale (a stadium tour) draws **millions of
> people clicking "buy" in the same minute** — extreme, bursty contention on a tiny, fixed inventory.
> **Core challenges:** seat inventory with **temporary holds (TTL)**, **preventing double-booking**
> (optimistic vs pessimistic locking), a **virtual waiting room** to tame the on-sale thundering herd,
> a **payment saga** that releases expired holds, and **fairness** between buyers.

A rate limiter protects against *too many requests*. A ticketing system is the opposite problem:
the requests are legitimate, the inventory is **fixed and scarce**, and the entire game is dividing a
few thousand seats among millions of people **correctly** and **fairly** without selling any seat
twice. Correctness under contention is the whole job.

## 1 · Clarify requirements

**Functional**
- Browse events; see a **seat map** with real-time availability (available / held / sold).
- **Hold** one or more seats for a short window (e.g. 5–10 minutes) while the buyer checks out.
- **Purchase** held seats: take payment, issue tickets, mark seats `sold`.
- **Release** holds automatically when the timer expires or the buyer abandons.
- **General admission (GA):** sell a *quantity* against a capacity counter (no specific seat).

**Non-functional**
- **Correctness first:** a seat is sold **at most once**, full stop. Overselling is a refund, a
  lawsuit, and a turned-away fan at the gate.
- **Massive bursty contention:** survive a 100k-seat on-sale with millions of concurrent buyers.
- **Low-ish latency for browsing**, but **strong consistency at the moment of holding/buying**.
- **Fairness:** buyers should be served roughly in arrival order, not "whoever has the fastest bots."

```reveal
{
  "prompt": "Why can't we just treat this like any high-traffic web service and scale it horizontally with eventually-consistent caches?",
  "answer": "Because the resource being contended is fixed, scarce, and indivisible: there are exactly N seats, and seat 14F is one object that must go to exactly one buyer. Eventual consistency means two app servers can both read 'seat 14F available' from their caches and both confirm it — that is a double-booking, the one outcome the business cannot tolerate. Browsing the seat map can be served from caches and tolerate staleness (a seat showing 'available' that's actually held is just a failed hold attempt, recoverable). But the hold-and-purchase path must be strongly consistent and serialized per seat: the decision 'is 14F still free, and if so claim it for me' has to be a single atomic, isolated read-modify-write so two buyers cannot both win. So this is not a throughput-scaling problem dressed up — it is a correctness-under-contention problem. We scale the read/browse path freely, but funnel the write/claim path through a serialized, transactional core, and we use a waiting room to keep the contention on that core bounded."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "On-sale arrival rate (the thundering herd)",
  "inputs": [
    { "key": "fans", "label": "Fans hitting the on-sale", "default": 2000000 },
    { "key": "windowSec", "label": "Spread over (seconds)", "default": 60 }
  ],
  "formula": "fans / windowSec",
  "resultLabel": "Peak arrivals",
  "resultUnit": "requests/s"
}
```

```calc
{
  "title": "Seat inventory size (storage is tiny)",
  "inputs": [
    { "key": "seats", "label": "Seats in the venue", "default": 60000 },
    { "key": "bytesPerSeat", "label": "Bytes per seat row", "default": 200 }
  ],
  "formula": "seats * bytesPerSeat",
  "resultLabel": "Inventory size per event",
  "resultUnit": "bytes"
}
```

> The asymmetry is the whole story: **~33k arrivals/sec** all racing for an inventory that fits in
> **~12 MB** — a few tens of thousands of rows. The data is trivially small (it lives in memory and
> in one database easily); the difficulty is the **contention ratio** — millions of writers fighting
> over thousands of rows in seconds. That is why we spend the design budget on **queueing the herd**
> and **serializing the claims**, not on storage.

## 3 · Data model & API

A handful of tables, with **state on each seat**:

```
seat(id, event_id, section, row, num, state, hold_id, version, updated_at)
   state ∈ { available, held, sold }
hold(id, user_id, event_id, seat_ids[], expires_at, state)
order(id, hold_id, user_id, amount, payment_status, state, idempotency_key)
```

Core API (all hold/purchase calls carry an **idempotency key** — recall idempotency: a retried
"buy" must not charge or claim twice):

```
GET  /events/{id}/seats              -> seat map (cacheable, may be slightly stale)
POST /holds      { event_id, seat_ids, idempotency_key } -> { hold_id, expires_at } | 409 conflict
POST /holds/{id}/purchase  { payment_token, idempotency_key } -> order | 402 | 410 expired
DELETE /holds/{id}                   -> release early
```

The hold is the linchpin: it is a **time-boxed reservation** that takes the seat out of circulation
*before* money changes hands, so the buyer has a guaranteed chance to pay without us pre-charging.

## 4 · High-level architecture

```flow
{
  "title": "Ticketing system — request flow",
  "nodes": [
    { "label": "Browser / app", "detail": "Seat map UI; polls availability; sends hold + purchase." },
    { "label": "Waiting room / queue", "detail": "Admits a bounded rate of users into the buy flow during on-sale spikes (thundering-herd control)." },
    { "label": "Inventory service", "detail": "Owns seat state. Serializes hold/claim per seat via DB transactions + version checks." },
    { "label": "Inventory DB (strongly consistent)", "detail": "Source of truth for seat state; row-level locking / optimistic version column." },
    { "label": "Hold-expiry worker", "detail": "Releases holds whose TTL passed; restores seats to available." },
    { "label": "Payment + order service (saga)", "detail": "Charges payment, issues tickets, finalizes seats=sold; compensates on failure." },
    { "label": "Seat-map cache", "detail": "Read-optimized availability for browsing; tolerates mild staleness." }
  ],
  "note": "Reads scale out through the cache; the write/claim path is funneled through the waiting room into a serialized inventory core."
}
```

**Storage choices.** The **inventory** lives in a strongly-consistent transactional store — a
relational DB (Postgres/MySQL) or a distributed SQL DB (Spanner/CockroachDB) — because seat claims
*need* transactions and row-level isolation. The **seat-map read view** is cached (Redis) and may lag
by a second. The **waiting-room queue** is a separate fast store (Redis sorted set or a managed queue)
holding millions of waiting tokens cheaply.

## 5 · Deep dive

### 5a · Holds with a TTL

A hold removes a seat from sale temporarily. Two ways to enforce expiry:

```compare
{
  "options": [
    { "label": "TTL field + sweeper (lazy)", "points": ["Each hold has expires_at; a background worker scans and releases expired holds", "Seat row keeps hold until swept", "Reads must treat held-but-expired as available (check expires_at on read)", "Simple, but freed seats reappear with a delay"] },
    { "label": "Store TTL (e.g. Redis EXPIRE)", "points": ["Hold key auto-expires in the cache layer", "No scan needed; key just vanishes", "Cache and DB can disagree — needs reconciliation", "Fast, but the durable seat state still needs updating"] },
    { "label": "Hybrid (durable state + sweeper + lazy read)", "points": ["expires_at in the DB is the source of truth", "Sweeper proactively frees most holds; reads lazily treat past-expiry holds as free", "Belt-and-suspenders: a missed sweep never leaks inventory", "The common production approach"] }
  ]
}
```

The hybrid wins because **inventory must never leak**: if the sweeper crashes, seats would stay
`held` forever and silently shrink the sellable pool. By making `expires_at` authoritative and having
*both* a sweeper and a lazy check-on-read, an expired hold is always reclaimable.

```reveal
{
  "prompt": "Why hold a seat at all? Why not just sell it the instant the buyer clicks, on a first-come-first-served charge?",
  "answer": "Because checkout is not instantaneous and money can fail. Between 'I want seat 14F' and 'payment succeeded' there are seconds-to-minutes: the buyer enters card details, the payment gateway does 3-D Secure, the bank may decline. If we sold (and charged) on the first click, a declined card means we charged-then-refunded a buyer for a seat they didn't get, and meanwhile the seat was either locked up with no clear release rule or double-sold to the next clicker. The hold is a reservation primitive: it claims the seat atomically *now* (so no one else can take it), gives the buyer a bounded, fair window to complete payment, and — crucially — auto-releases if they fail or abandon, returning the seat to the pool. It decouples 'reserve the scarce resource' (must be instant and exclusive) from 'collect the money' (slow and failure-prone). The TTL bounds how long one buyer can sit on a seat, which is what keeps inventory liquid during a hot on-sale instead of being frozen by abandoned carts."
}
```

### 5b · Preventing double-booking: optimistic vs pessimistic locking

This is the correctness core. Two concurrent buyers both want seat 14F; exactly one must win. Both
strategies rely on the database's isolation guarantees (recall database transactions).

```compare
{
  "options": [
    { "label": "Pessimistic locking", "points": ["SELECT ... FOR UPDATE locks the seat row inside a transaction", "The second buyer blocks until the first commits/rolls back", "Guaranteed correct; no retries needed", "Lock contention + held locks across a slow checkout hurt throughput; deadlock risk on multi-seat holds"] },
    { "label": "Optimistic locking", "points": ["Read seat + version; UPDATE seat SET state=held, version=version+1 WHERE id=? AND version=? AND state='available'", "If rows-affected=0, someone else won → retry or report conflict", "No locks held; great when conflicts are rare", "Wastes work under heavy contention (many losers retry)"] },
    { "label": "Conditional claim (atomic compare-and-set)", "points": ["A single UPDATE ... WHERE state='available' is itself the lock", "Exactly one of N racing updates affects the row", "No version column even needed for a single seat", "The minimal, idiomatic form of optimistic claim"] }
  ]
}
```

For a **hot on-sale** (thousands fighting for each seat), pessimistic `FOR UPDATE` would serialize
everyone behind held locks during slow checkouts and risk deadlocks when a hold spans several seats.
The usual choice is the **conditional/optimistic claim**: the `UPDATE ... WHERE state='available'`
*is* the atomic test-and-set — exactly one concurrent update changes the row, and every loser sees
`rows affected = 0` and is told the seat is gone. Holding a *set* of seats (e.g. 4 together) is done
as one transaction so it's all-or-nothing.

```sequence
{
  "title": "Two buyers race for seat 14F (optimistic claim)",
  "actors": ["BuyerA", "BuyerB", "Inventory", "DB"],
  "steps": [
    { "from": "BuyerA", "to": "Inventory", "label": "hold 14F (idem-key A)" },
    { "from": "BuyerB", "to": "Inventory", "label": "hold 14F (idem-key B)" },
    { "from": "Inventory", "to": "DB", "label": "UPDATE seat SET state=held WHERE id=14F AND state=available" },
    { "from": "DB", "to": "Inventory", "label": "A: rows affected = 1 (won)" },
    { "from": "DB", "to": "Inventory", "label": "B: rows affected = 0 (lost — already held)" },
    { "from": "Inventory", "to": "BuyerA", "label": "hold_id + expires_at" },
    { "from": "Inventory", "to": "BuyerB", "label": "409 conflict — pick another seat" }
  ]
}
```

```reveal
{
  "prompt": "When is pessimistic locking actually the better choice for seat holds, and when is optimistic better?",
  "answer": "It comes down to the conflict rate and how long the critical section is. Optimistic locking (claim with a conditional UPDATE, detect loss via rows-affected=0) wins when conflicts are RARE relative to attempts — most claims succeed on the first try, no locks are held, and the rare loser just retries or gets a 409. That fits the steady state and even most hot seats, because each individual claim transaction is microseconds long (one UPDATE), so the window for two writers to actually collide is tiny. Pessimistic locking (SELECT ... FOR UPDATE) wins when conflicts are FREQUENT and the work inside the lock is short and must not be wasted — taking the lock up front means losers wait instead of doing speculative work that gets thrown away, avoiding a retry storm. The trap with pessimistic locking in ticketing is holding the lock across the slow part: if you SELECT FOR UPDATE the seat and keep the transaction open while the human enters card details, you serialize the whole checkout and tank throughput. The right pattern is short transactions either way — claim the seat (flip it to 'held') in a brief transaction, then do the slow payment OUTSIDE any DB lock against the now-reserved seat. So in practice ticketing uses optimistic/conditional claims for the flip-to-held, and reserves pessimistic locking for tight, contended sections like decrementing a GA capacity counter where you want losers to wait rather than retry."
}
```

For **general admission**, there are no seat rows — just a capacity counter. The claim becomes
`UPDATE event SET remaining = remaining - q WHERE id=? AND remaining >= q` (a conditional decrement),
which is the same atomic test-and-set idea applied to a number.

### 5c · The virtual waiting room (taming the thundering herd)

If 2 million people hit the inventory service at once, even perfect locking collapses under load —
the DB melts and *everyone* gets errors. The fix is to **not let the herd reach the inventory at
once.** A **virtual waiting room** is an admission queue: when an on-sale starts, every arriving user
gets a **queue token** and a position, and the system **admits a bounded rate** (say 1,000
users/sec) from the front of the queue into the actual buy flow. Everyone else sees "you are number
48,210 in line."

```flow
{
  "title": "Virtual waiting room admission",
  "nodes": [
    { "label": "Arrive at on-sale", "detail": "User gets a signed queue token + position; parked on a waiting page that polls." },
    { "label": "Queue (Redis sorted set)", "detail": "Millions of tokens ordered by arrival time; cheap to store and pop." },
    { "label": "Admission controller", "detail": "Releases a fixed rate of tokens (matched to inventory-service capacity) into the active pool." },
    { "label": "Buy session", "detail": "Admitted user gets a short-lived pass; can browse seats and create holds." },
    { "label": "Inventory service", "detail": "Now sees only a bounded, steady rate of real claim attempts — no longer a herd." }
  ],
  "note": "The queue absorbs the spike; the inventory core only ever sees a flow it can handle."
}
```

This converts an unbounded spike into a **bounded, steady stream** the inventory core can serve with
correct locking. It is the same instinct as load shedding, but instead of dropping requests it
**parks them in order** — which also delivers fairness. Ticketmaster's "Smart Queue" and similar
products are exactly this.

```reveal
{
  "prompt": "Why does a waiting room give better outcomes than just letting everyone retry against the inventory service (with autoscaling)?",
  "answer": "Three reasons. First, the bottleneck isn't horizontally scalable: the contended resource is a fixed set of seat rows in a strongly-consistent store, so adding app servers just multiplies the number of clients hammering the same rows — autoscaling the front doesn't make the serialized core faster, it makes the contention worse. Second, an open free-for-all rewards the wrong behavior: whoever retries fastest (i.e. bots) wins, fairness collapses, and the retry storm itself becomes a self-inflicted DDoS that takes down the service for everyone, including legitimate buyers. A waiting room imposes arrival-order admission, which is both fairer and a natural rate limit. Third, it gives a vastly better user experience under overload: instead of millions of people getting timeouts and 500s and refreshing furiously (amplifying load), they each get a calm 'you're number N, estimated wait M minutes' page that polls slowly. The system degrades into a queue, not a crash. The queue store (a Redis sorted set of tokens) is cheap and scales to millions of waiters trivially, because waiting is just holding a position — no contention there. So the waiting room decouples 'how many people showed up' from 'how many the correctness core can safely serve per second,' which is the only number that actually matters."
}
```

Tune the admission rate against inventory capacity:

```tradeoff
{
  "title": "Waiting-room admission rate vs inventory protection",
  "axis": { "left": "Admit slowly (safe, long waits)", "right": "Admit fast (snappy, risky)" },
  "steps": [
    { "label": "Conservative", "detail": "Admit well under DB capacity. Inventory never strains and every admitted user has a smooth checkout, but the back of the queue waits a long time and may give up." },
    { "label": "Matched", "detail": "Admission rate ≈ measured sustainable claim throughput of the inventory core. The sweet spot: full utilization without tipping into lock contention or timeouts." },
    { "label": "Aggressive", "detail": "Admit faster than the core can serialize. Latency climbs, lock waits and conflict-retries spike, and you risk cascading timeouts — the herd just moved one hop downstream." }
  ]
}
```

### 5d · Payment saga & releasing expired holds

Purchase spans multiple services — inventory, payment, ticket issuance — with no distributed
transaction across them. This is a **saga** (recall): a sequence of local transactions, each with a
**compensating action** to undo it if a later step fails.

```sequence
{
  "title": "Purchase saga (happy path + compensation)",
  "actors": ["Buyer", "OrderSvc", "Inventory", "Payment"],
  "steps": [
    { "from": "Buyer", "to": "OrderSvc", "label": "purchase hold H (idem-key)" },
    { "from": "OrderSvc", "to": "Inventory", "label": "verify hold H still valid (not expired)" },
    { "from": "OrderSvc", "to": "Payment", "label": "charge card (idempotent)" },
    { "from": "Payment", "to": "OrderSvc", "label": "success → captured" },
    { "from": "OrderSvc", "to": "Inventory", "label": "commit: seats H → sold" },
    { "from": "OrderSvc", "to": "Buyer", "label": "order confirmed + tickets issued" }
  ]
}
```

If **payment fails**, the saga compensates: release the hold (seats → `available`) and report the
decline — nothing was over-claimed because the seat was only `held`, never `sold`. If the **hold
expired before payment** (the buyer dawdled), inventory rejects the commit with `410 Gone` and the
charge is either not attempted or refunded as compensation.

The **hold-expiry worker** is the safety net that keeps inventory liquid: it periodically frees holds
whose `expires_at` has passed. Combined with the lazy check-on-read, a seat *cannot* be permanently
lost to an abandoned cart.

```reveal
{
  "prompt": "Where does idempotency matter in the purchase saga, and what breaks without it?",
  "answer": "Idempotency matters at two spots and is the difference between a correct system and a fraud generator. (1) The charge step: networks time out, buyers double-click 'pay,' and the order service retries. Without an idempotency key on the payment call, a single purchase can charge the card two or three times. The buyer supplies (or the order service generates) an idempotency key, and the payment gateway dedupes — a retry with the same key returns the original charge result instead of charging again. (2) The whole purchase request: the same retry that double-charges could also create two orders for the same hold, or attempt to mark seats sold twice. The purchase endpoint keys on the idempotency key so a replay returns the already-created order rather than re-running the saga. There's also a subtle one at the seat-commit step: marking seats sold must be conditional (WHERE state='held' AND hold_id=H) so that a retried commit is a no-op the second time, not an error or a corruption. Without idempotency, the very mechanisms that make the system resilient — retries on timeout — become the mechanism that double-charges customers and corrupts inventory. With it, every step is safely replayable, which is exactly what a saga needs since any step can be retried after a partial failure."
}
```

### 5e · Fairness

"Fair" means buyers are served roughly in arrival order and bots don't get an outsized share. Levers:

- **The waiting room itself** orders admission by arrival time — the primary fairness mechanism.
- **Bot defense:** CAPTCHA / proof-of-work at queue entry, device fingerprinting, account verification,
  and **per-account purchase limits** (e.g. max 4 tickets) so one actor can't sweep a section.
- **Randomized admission** in some designs: rather than strict FIFO (which rewards being early to the
  page), admit randomly from everyone who joined within an initial window — this defeats "refresh at
  exactly T-0" bot strategies and is perceived as fairer.

## 6 · Trade-offs & failure modes

- **Strong consistency on the claim path costs throughput.** Serializing per-seat claims is the price
  of never double-booking; the waiting room is what makes that price affordable by bounding the rate.
- **Hold TTL is a tuning knob.** Too short and real buyers lose seats mid-checkout; too long and
  abandoned carts freeze inventory during a frenzy. 5–10 minutes is typical.
- **The inventory DB is the critical section / SPOF.** Replicate it and keep claim transactions
  *short* (flip-to-held only; payment happens outside any lock). For multi-region, the inventory for
  a given event is usually pinned to **one region** to keep claims serializable rather than fighting
  cross-region consensus latency.
- **Sweeper failure leaks inventory.** Mitigated by making `expires_at` authoritative + lazy
  check-on-read, so a missed sweep is self-healing.
- **Payment is slow and flaky.** The saga + compensation keeps inventory correct regardless of
  payment outcome; idempotency keeps retries from double-charging.
- **Waiting-room abuse.** Tokens must be **signed** so users can't forge a better position; bots will
  try to flood the queue, hence proof-of-work / CAPTCHA at entry.

## 7 · Scaling & evolution

- **Shard inventory by event.** Each event's seats are independent, so partition by `event_id` —
  a hot on-sale loads only its own shard, and unrelated events don't contend. Within a mega-event,
  shard further by section if one DB can't take the claim rate.
- **Read path: cache aggressively.** The seat map is read far more than written; serve it from Redis
  with short TTLs and push availability deltas over websockets/SSE so the UI stays live without
  hammering the DB.
- **Queue-based claim processing.** At extreme scale, turn claims into a per-seat (or per-section)
  serialized work queue so a single consumer applies claims in order — trading a little latency for
  zero lock contention.
- **Reserved-but-unpaid telemetry.** Track hold→purchase conversion to tune TTL and admission rate.
- **Resale & transfers.** Build on the same primitives: a transfer is "release seat from A, claim for
  B" as one transaction; resale is relisting a `sold` seat back into inventory.

## Self-test

```quiz
{
  "question": "Two buyers click 'hold seat 14F' at the same instant. Which mechanism guarantees exactly one succeeds without holding a lock across the slow checkout?",
  "options": [
    "Eventually-consistent cache reads on both servers",
    "A conditional/optimistic claim: UPDATE seat SET state='held' WHERE id=14F AND state='available' — exactly one update affects the row, the other sees rows-affected=0",
    "Letting both hold it and sorting it out at payment time",
    "Sharding the seat across two databases"
  ],
  "answer": 1,
  "explanation": "The conditional UPDATE is an atomic test-and-set: only one of the racing updates matches state='available', so exactly one buyer wins and the loser gets a 409. The flip-to-held is brief; payment happens afterward, outside any lock."
}
```

```quiz
{
  "question": "What is the primary reason a virtual waiting room is used during a hot on-sale, rather than just autoscaling the inventory service?",
  "options": [
    "It reduces storage costs for seat data",
    "The contended resource (fixed seat rows in a consistent store) doesn't scale horizontally; the queue bounds the claim rate to what the serialized core can safely serve, and admits users in fair arrival order",
    "It encrypts the seat map",
    "It eliminates the need for database transactions"
  ],
  "answer": 1,
  "explanation": "Adding app servers just multiplies clients hammering the same rows. The waiting room absorbs the spike, feeds the inventory core a bounded steady rate it can serialize correctly, and orders admission fairly — preventing a retry-storm self-DDoS."
}
```

```quiz
{
  "question": "A buyer's payment fails after a seat was put on hold. What keeps inventory correct?",
  "options": [
    "Nothing — the seat is lost forever",
    "The saga compensates by releasing the hold (seat → available); since the seat was only 'held', never 'sold', nothing was over-claimed, and the hold-expiry worker is the backstop",
    "The system marks the seat sold anyway",
    "Both buyers are charged"
  ],
  "answer": 1,
  "explanation": "Purchase is a saga: charge then commit-to-sold, with compensation. A failed payment releases the hold. Because money and seat-finalization are separate steps and the seat was only reserved, a failed charge can't corrupt inventory; expired holds are also swept automatically."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Ticketing system — key terms",
  "cards": [
    { "front": "Hold (reservation) + TTL", "back": "Atomically take a seat out of sale for a bounded window (e.g. 5–10 min) so the buyer can pay; auto-released on expiry so inventory stays liquid." },
    { "front": "Optimistic / conditional claim", "back": "UPDATE seat SET state='held' WHERE id=? AND state='available'. Exactly one racing update wins (rows-affected=1); losers see 0 → 409. No lock held across checkout." },
    { "front": "Pessimistic locking", "back": "SELECT ... FOR UPDATE locks the row so concurrent writers block. Correct, but holding it across slow payment kills throughput — keep the locked section tiny (e.g. GA counter)." },
    { "front": "Virtual waiting room", "back": "Admission queue that parks the on-sale herd in arrival order and admits a bounded rate into the buy flow, so the serialized inventory core never sees a thundering herd." },
    { "front": "Purchase saga", "back": "Charge payment, then commit seats→sold, with compensation (release hold / refund) on any failure — correctness without a distributed transaction across services." },
    { "front": "Hold-expiry worker", "back": "Background sweeper that frees holds past expires_at; with lazy check-on-read it guarantees abandoned carts never permanently leak inventory." }
  ]
}
```

## Key takeaways

- This is a **correctness-under-contention** problem, not a throughput problem: a tiny fixed
  inventory must be divided among millions **without ever selling a seat twice**.
- The **hold** decouples *reserve the scarce resource* (instant, exclusive, atomic) from *collect the
  money* (slow, flaky) — with a **TTL** so abandoned carts release their seats.
- Prevent double-booking with an **optimistic/conditional claim** (`UPDATE ... WHERE state='available'`)
  for seats and a **conditional decrement** for GA; reserve pessimistic `FOR UPDATE` for short,
  highly-contended counters. Keep claim transactions short — pay **outside** the lock.
- The **virtual waiting room** converts an unbounded on-sale spike into a bounded, fair, arrival-ordered
  stream the consistent inventory core can actually serve.
- Finalize purchases with a **saga + idempotency**: charge then commit-to-sold with compensation, so
  failures and retries never double-charge or corrupt inventory.

## Concepts exercised

This design applies, end to end: `database-transactions` (isolation is what makes a seat claim
atomic and prevents the lost-update double-booking) · `optimistic-vs-pessimistic-locking` (the
conditional claim vs `SELECT ... FOR UPDATE` decision at the heart of the inventory core) ·
`saga-pattern` (the multi-service purchase flow with compensating releases/refunds) ·
`idempotency-and-safe-methods` (idempotency keys so retried holds and charges don't double-claim or
double-bill). It also draws on `caching-fundamentals` + TTL (seat-map read view, hold expiry),
`backpressure-and-load-shedding` (the waiting room as ordered admission control), and
`single-point-of-failure` (the inventory DB as the serialized critical section to protect).
