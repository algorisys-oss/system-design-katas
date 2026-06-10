---
title: "Design a Hotel/Flight Booking System (Booking.com)"
slug: hotel-flight-booking
level: use-cases
module: correctness-and-booking
order: 18
reading_time_min: 20
concepts: [saga-pattern, inventory-holds, idempotency, overbooking, read-through-cache, compensation]
use_cases: [hotel-flight-booking]
prerequisites: [saga-pattern, two-phase-commit, database-transactions, caching-patterns-overview]
status: published
---

# Design a Hotel/Flight Booking System (Booking.com)

> **Use case:** let a traveler **search availability** across many hotels/airlines, then **book**
> a specific room or seat — taking payment — **without ever selling the same unit twice**.
> **Domain:** Booking.com, Expedia, Airbnb, airline reservation systems (Amadeus/Sabre), Ticketmaster.
> **Scale:** billions of search queries/day (overwhelmingly **reads**), millions of bookings/day
> (rare but must be **exactly right**), inventory sourced from **thousands of third-party providers**.
> **Core challenges:** read-heavy availability search with **caching vs staleness**; **holds** during
> checkout; **overbooking** strategy; a **multi-step booking saga** (reserve unit + charge card) with
> **compensation**; **idempotent** booking; and **cancellations/refunds**.

This design is the canonical "correctness under concurrency" problem. Search is a classic read-heavy,
cache-everything system — but the moment a user clicks *Book*, the relaxed, eventually-consistent world
of search collides with a hard invariant: **a room/seat is sold at most once**, and **money and
inventory must agree** even though they live in different systems that can each fail mid-transaction.

## 1 · Clarify requirements

**Functional**
- **Search** availability by destination, dates, guests/passengers; filter and sort by price.
- **Hold** a selected room/seat for a few minutes while the user enters payment details.
- **Book**: atomically reserve the unit *and* charge payment; return a confirmation number.
- **Cancel** a booking and issue a **refund** per the fare/rate rules.
- Inventory comes from **owned + third-party providers** (other reservation systems, channel managers).

**Non-functional**
- **Search:** low latency (<300 ms), extremely high read volume, **stale-but-fast is acceptable**.
- **Booking:** **correctness over latency** — never double-sell; never charge without reserving.
- **Idempotent** booking: a retried/duplicated request must not create two bookings or two charges.
- **Available:** search must survive a provider being slow/down (degrade, don't fail).

```reveal
{
  "prompt": "Search and booking have opposite consistency requirements. Why split the system along that line, and what does each side optimize for?",
  "answer": "Search is read-heavy by ~1000:1 and tolerates staleness: showing a room that was taken 5 seconds ago is annoying but harmless — the user just re-picks. So search optimizes for throughput and latency: heavily cached, denormalized, served from read replicas and edge caches, eventually consistent. Booking is the opposite — it's low-volume but its invariant is absolute: a unit is sold at most once, and money must never move without inventory moving with it. So booking optimizes for correctness: it goes to the system of record (not a cache), uses transactions/conditional updates to claim a unit atomically, and coordinates a multi-step saga across the inventory store and the payment provider with compensation on failure. Splitting them lets each side use the right tool — a fast eventually-consistent read path and a slow strongly-consistent write path — instead of forcing the whole system to be as strict (and slow) as booking or as loose (and wrong) as search. The 'available' inventory shown in search is a cached projection; the truth is only resolved at the moment of the hold/booking, which is why search results can never be a binding promise."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Search read throughput",
  "inputs": [
    { "key": "searchesPerDay", "label": "Searches/day", "default": 2000000000 },
    { "key": "fanout", "label": "Availability lookups per search", "default": 20 },
    { "key": "peakFactor", "label": "Peak-to-average factor", "default": 4 }
  ],
  "formula": "Math.round(searchesPerDay / 86400 * peakFactor * fanout)",
  "resultLabel": "Peak availability lookups/sec",
  "resultUnit": "ops/s"
}
```

```calc
{
  "title": "Booking write volume (the hard path)",
  "inputs": [
    { "key": "bookingsPerDay", "label": "Bookings/day", "default": 2000000 },
    { "key": "writesPerBooking", "label": "Writes per booking (hold+reserve+charge+confirm)", "default": 4 }
  ],
  "formula": "Math.round(bookingsPerDay / 86400 * writesPerBooking)",
  "resultLabel": "Average booking-path writes/sec",
  "resultUnit": "writes/s"
}
```

> Search runs at **~1.8 million availability lookups/sec** (≈2B searches/day × 20-property fan-out ×
> 4 peak) — must be cached and read-replicated.
> Bookings are only **~90 writes/sec average** — tiny throughput, but every one must be transactional,
> idempotent, and coordinated with payment. **The scale challenge is on reads; the correctness
> challenge is on writes.** Design each independently.

## 3 · Data model & API

The system of record is an **inventory ledger** keyed by `(unit, date-range)`. For hotels a "unit" is a
room-type-night; for flights it's a seat (or, more precisely, a fare-class seat on a flight leg).

```
Inventory(unit_id, date, total, sold, held)         -- the truth; available = total - sold - held
Hold(hold_id, unit_id, dates, user, expires_at)     -- temporary claim, TTL'd
Booking(booking_id, unit_id, dates, user, status, idempotency_key, payment_ref)
```

Core API:

```
search(destination, dates, guests) -> [offers]        # cached, eventually consistent
hold(unit_id, dates, user) -> { hold_id, expires_at } # claims inventory for ~10 min
book(hold_id, payment, Idempotency-Key) -> { booking_id, confirmation }
cancel(booking_id) -> { refund_status }
```

`book` takes an **`Idempotency-Key`** (client-generated, e.g. a UUID per checkout attempt). The server
stores the result against that key, so a retry returns the *same* booking instead of making a new one.

## 4 · High-level architecture

```flow
{
  "title": "Read path (search) vs write path (booking)",
  "nodes": [
    { "label": "Search service", "detail": "Queries a denormalized availability index; results served from cache/read replicas. Eventually consistent." },
    { "label": "Availability cache", "detail": "Read-through cache (Redis/edge) of available counts per unit/date. Short TTL; refreshed from inventory + provider feeds." },
    { "label": "Inventory service (SoR)", "detail": "System of record. Holds and bookings claim units here via transactions / conditional updates. Strongly consistent." },
    { "label": "Booking saga orchestrator", "detail": "Drives hold -> reserve -> charge -> confirm, with compensation on any failure. Stateful, idempotent." },
    { "label": "Payment service", "detail": "External PSP (Stripe/Adyen). Charge is itself idempotent via the same key; refunds are compensation." },
    { "label": "Provider adapters", "detail": "Sync inventory feeds from third-party reservation systems; push bookings out and reconcile." }
  ],
  "note": "Search reads from the cache; booking writes to the inventory SoR and coordinates payment via the saga. The cache is a stale projection of the SoR — it is never the booking authority."
}
```

- **Inventory store:** a strongly-consistent database (e.g. partitioned SQL or Spanner-class). Holds and
  bookings are **row-level conditional updates** — `UPDATE ... SET held = held + 1 WHERE total - sold - held >= 1`.
  The `WHERE` clause is the entire safety mechanism: it fails if no inventory is left.
- **Availability cache:** read-through, short TTL, refreshed from the SoR and provider feeds. Search reads
  this; it is allowed to be wrong by a few seconds.
- **Saga orchestrator:** persists each step so it can resume/compensate after a crash (see deep dive).

## 5 · Deep dive A — Holds and overbooking

A naive flow ("check availability in search, then book") races: two users see "1 room left" and both
click book. The fix is the **hold** — a short-lived, atomic claim that decrements available inventory
*before* payment, so only one user can proceed to checkout for that unit.

```sequence
{
  "title": "Hold then book (the happy path)",
  "actors": ["User", "Booking", "Inventory", "Payment"],
  "steps": [
    { "from": "User", "to": "Booking", "label": "hold(room, dates)" },
    { "from": "Booking", "to": "Inventory", "label": "conditional UPDATE held+1 WHERE available>=1" },
    { "from": "Inventory", "to": "Booking", "label": "ok -> hold_id, expires in 10 min" },
    { "from": "Booking", "to": "User", "label": "held — enter payment" },
    { "from": "User", "to": "Booking", "label": "book(hold_id, card, Idempotency-Key)" },
    { "from": "Booking", "to": "Payment", "label": "charge (idempotent)" },
    { "from": "Payment", "to": "Booking", "label": "captured" },
    { "from": "Booking", "to": "Inventory", "label": "convert hold -> sold (held-1, sold+1)" },
    { "from": "Booking", "to": "User", "label": "confirmation #" }
  ]
}
```

A **hold** that's never converted must auto-expire (TTL), or one abandoned checkout would lock a room
forever. If the hold expires before payment completes, the booking is rejected and the user re-holds.

**Overbooking** is a deliberate, separate decision. Airlines and hotels routinely sell *more* units than
exist, betting that some fraction of bookings no-show or cancel — empty inventory is lost revenue. This
is a **business policy bolted onto the same mechanism**: the conditional update's threshold becomes
`available >= -overbookBuffer` instead of `>= 0`. The risk is "walking" a guest (bumping a passenger).

```tradeoff
{
  "title": "How aggressively should you overbook?",
  "axis": { "left": "Never overbook (safe)", "right": "Overbook heavily (revenue)" },
  "steps": [
    { "label": "Zero overbooking", "detail": "Sell exactly inventory. No bumps ever, but no-shows = permanently empty rooms/seats = lost revenue. Common for premium/luxury where a bump is unacceptable." },
    { "label": "Model-driven buffer", "detail": "Forecast no-show/cancel rate per route/date and overbook by that amount (airlines do this constantly). Maximizes yield; occasional bumps handled with compensation/vouchers." },
    { "label": "Aggressive overbooking", "detail": "Push the buffer high to chase 100% fill. More denied boardings/walks, higher compensation cost and reputational damage. Only worth it where bumps are cheap to absorb." }
  ]
}
```

```reveal
{
  "prompt": "Why is a hold the right primitive here, and what failure does it introduce that you must handle?",
  "answer": "A hold converts an optimistic 'check then book' (which races) into a pessimistic atomic claim: it decrements available inventory in the system of record the instant the user selects a unit, so concurrent shoppers immediately see one fewer available and only the holder can proceed to pay. That eliminates the double-sell race during the seconds-to-minutes of checkout, which is exactly the window where two users would otherwise both think a unit is free. The failure it introduces is the abandoned hold: a user who holds a room and then closes the tab would tie up inventory indefinitely, starving real buyers. So every hold MUST carry a TTL (e.g. 10 minutes) and expire automatically — released back to available by a sweeper or a lazy check at read time. The TTL is a trade-off: too short and slow payers lose their hold mid-checkout; too long and abandoned holds suppress sellable inventory. Holds also must be idempotent and tied to the user/session so a refresh doesn't stack multiple holds. In effect a hold is a lease — a time-bounded reservation — which is the same idea as a lock with a lease timeout, chosen because an indefinitely-held lock in a system with flaky human clients is a guaranteed deadlock of inventory."
}
```

## 5 · Deep dive B — The booking saga, compensation, and idempotency

Booking spans **two systems that can't share a transaction**: your inventory database and an external
payment provider. You cannot wrap "reserve the room" and "charge the card" in one ACID transaction —
the PSP is a separate service over the network. This is the textbook case for a **saga**: a sequence of
local transactions, each with a **compensating action** that undoes it if a later step fails.

```compare
{
  "options": [
    { "label": "Distributed transaction (2PC)", "points": ["One atomic commit across inventory + payment", "Requires both to be 2PC participants — PSPs are not", "Locks inventory for the whole protocol", "Blocks if the coordinator dies; poor availability", "Not viable across an external payment API"] },
    { "label": "Saga (orchestrated)", "points": ["Each step is a local transaction (reserve, charge, confirm)", "On failure, run compensations in reverse (refund, release hold)", "No cross-service locks; works with external PSPs", "Eventually consistent, but reaches a correct end state", "The standard pattern for booking + payment"] }
  ]
}
```

The orchestrator persists the saga's state after each step, so if it crashes mid-flow it resumes and
either completes or compensates. Two outcomes only: **fully booked** (room sold + card charged), or
**fully unwound** (hold released + card refunded). Never half: charged-but-no-room, or
room-sold-but-not-charged.

```sequence
{
  "title": "Saga failure: payment captured, then inventory step fails",
  "actors": ["Orchestrator", "Inventory", "Payment"],
  "steps": [
    { "from": "Orchestrator", "to": "Inventory", "label": "hold confirmed (held)" },
    { "from": "Orchestrator", "to": "Payment", "label": "charge -> captured" },
    { "from": "Orchestrator", "to": "Inventory", "label": "convert hold->sold ... FAILS (hold expired / unit gone)" },
    { "from": "Orchestrator", "to": "Payment", "label": "COMPENSATE: refund the capture" },
    { "from": "Orchestrator", "to": "Inventory", "label": "COMPENSATE: release any hold" }
  ]
}
```

**Idempotency** is what makes the saga safe to retry. The user's browser may resend `book` (network
blip, double-click); the orchestrator may retry a step after a timeout. Every step keys off the
client's **`Idempotency-Key`**:
- The inventory "convert" and the payment "charge" both record the key; a duplicate request returns the
  *first* result instead of acting twice. (PSPs like Stripe support an `Idempotency-Key` header natively.)
- The booking record itself is unique on the key, so two concurrent `book` calls produce **one** booking.

```reveal
{
  "prompt": "Payment succeeded but converting the hold to a sale failed. Why can't you 'just charge after reserving' to avoid this, and what does compensation actually do?",
  "answer": "You can reorder the steps, but you can never make 'reserve inventory' and 'charge card' a single atomic action — they're in different systems with no shared transaction, so SOME ordering will leave a window where one succeeded and the other hasn't. If you charge first and reservation fails, you've taken money with nothing to show. If you reserve first and charge fails, you're holding a unit you can't sell to anyone else. Either way you need compensation, not avoidance. Compensation is the saga's recovery: a semantically-reversing local transaction for each completed step, run in reverse order when a later step fails permanently. Here: the payment was captured but the unit couldn't be sold (the hold expired, or an overbooked unit ran out), so the orchestrator issues a refund (compensating the charge) and releases any hold (compensating the reservation), landing in a clean 'no booking, no charge' state. Note compensation is not a rollback — the charge really happened and the refund really happens; the books just net to zero. The orchestrator must persist that it's in the 'compensating' state and make each compensation idempotent, because compensations themselves can fail and be retried. This is why booking is eventually consistent: for a brief window money and inventory disagree, but the saga guarantees they converge to a correct, consistent end state."
}
```

## 5 · Deep dive C — Search caching and staleness

Search serves the firehose of reads from a **read-through availability cache** and read replicas, never
from the inventory SoR directly. Available counts change constantly, so the cache carries a **short TTL**
(seconds to a minute) and is also invalidated/decremented when a hold or booking lands. The accepted
truth: **search results are advisory**, not a promise. The binding check happens only at `hold`.

```tradeoff
{
  "title": "Availability cache freshness",
  "axis": { "left": "Long TTL (fast, stale)", "right": "Short TTL / write-through (fresh, costly)" },
  "steps": [
    { "label": "Long TTL (minutes)", "detail": "Cheapest, highest hit rate, fastest search. More 'sold out at checkout' surprises because the cache lags the SoR. Fine when conversion is low." },
    { "label": "Short TTL + invalidate on write", "detail": "Decrement/evict the cache when a hold or booking commits. Much fresher; more cache traffic. The common middle ground." },
    { "label": "Write-through / live count", "detail": "Every search consults near-real-time counts. Minimal surprises but pushes read load onto the SoR — only feasible for hot, low-cardinality inventory." }
  ]
}
```

For **third-party inventory**, you can't see the provider's live counts on every search, so adapters
**poll/stream feeds** and cache them, then **re-validate at hold time** by calling the provider's
reservation API. If the provider rejects, the hold fails gracefully and search just had a stale number.

## 6 · Trade-offs & failure modes

- **Stale search → checkout failure.** The cache lags the SoR, so a user can pick a sold-out unit. Accept
  it: re-validate at hold, show a clean "just taken, here are alternatives" path.
- **Saga left dangling.** Orchestrator crashes mid-flow. Mitigate: persist saga state per step, run a
  recovery worker that resumes or compensates; make every step idempotent.
- **Hold leakage.** Crashed sweeper → abandoned holds suppress inventory. Mitigate: TTL on holds + lazy
  expiry at read time so an expired hold is never counted.
- **Double charge / double booking.** Retries without idempotency. Mitigate: `Idempotency-Key` on `book`,
  carried into the PSP and the booking row's unique constraint.
- **Overbooking blowback.** Buffer set too high → bumps/walks, compensation cost, reputation hit. Mitigate:
  model no-show rates per segment; keep buffers conservative where bumps are expensive.
- **Provider down.** A third-party feed is stale or its reserve API fails. Mitigate: degrade search
  (show cached, flag uncertainty), fail the specific hold, never block the whole catalog.

## 7 · Scaling & evolution

- **Partition inventory** by unit (hotel/flight + date) so hot dates/properties shard independently;
  holds/bookings for a unit are single-partition transactions (no cross-shard 2PC).
- **CQRS:** a write-optimized inventory SoR feeds a separate read-optimized search index/cache
  asynchronously — the cleanest expression of the read/write split.
- **Event-driven saga:** drive the orchestrator off a durable log (Kafka/outbox) so steps and
  compensations survive crashes and replay deterministically.
- **Dynamic pricing & yield management** layer on top: the same no-show models that set overbooking
  buffers also drive price, maximizing revenue per unit.
- **Multi-region:** pin each unit's inventory to a home region (its source of truth) to keep the claiming
  transaction local and strongly consistent, while search caches replicate globally.

## Self-test

```quiz
{
  "question": "Why can't 'reserve the room' and 'charge the card' be wrapped in a single ACID transaction?",
  "options": [
    "Because ACID transactions are too slow",
    "Because the payment provider is a separate external system with no shared transaction — so you use a saga with compensation instead",
    "Because rooms and cards use different currencies",
    "Because the inventory database doesn't support transactions"
  ],
  "answer": 1,
  "explanation": "The PSP is an external service over the network and isn't a 2PC participant. Booking is a saga: local transactions per step, with compensation (refund, release hold) if a later step fails."
}
```

```quiz
{
  "question": "What is the primary purpose of a 'hold' during checkout?",
  "options": [
    "To make search results load faster",
    "To atomically claim the unit before payment so two users can't both book the last room",
    "To cache the price for the user",
    "To replace the need for a payment provider"
  ],
  "answer": 1,
  "explanation": "A hold is a short-lived atomic claim that decrements available inventory before payment, closing the double-sell race during the checkout window. It must carry a TTL so abandoned holds release."
}
```

```quiz
{
  "question": "A user double-clicks 'Book' and two identical requests arrive. What prevents two bookings and two charges?",
  "options": [
    "A longer hold TTL",
    "Overbooking buffers",
    "An Idempotency-Key carried into the booking row's unique constraint and the PSP's idempotent charge",
    "A bigger availability cache"
  ],
  "answer": 2,
  "explanation": "Idempotency: the client-supplied key makes the booking unique and the charge idempotent, so a duplicate request returns the first result instead of acting twice."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Booking system — key terms",
  "cards": [
    { "front": "Hold (lease)", "back": "A short-lived, TTL'd atomic claim on a unit during checkout. Decrements available inventory before payment so the unit can't be double-sold; auto-expires if abandoned." },
    { "front": "Booking saga", "back": "A sequence of local transactions (hold -> charge -> convert to sold) where each step has a compensating action, since inventory and payment can't share one ACID transaction." },
    { "front": "Compensation", "back": "A semantically-reversing transaction (refund the charge, release the hold) run when a later saga step fails, so the system reaches a clean all-or-nothing end state." },
    { "front": "Idempotency-Key", "back": "A client-generated key on the book request, carried into the payment charge and the booking's unique constraint, so retries/double-clicks produce exactly one booking and one charge." },
    { "front": "Overbooking", "back": "Deliberately selling more units than exist, modeling no-show/cancel rates to maximize fill. Risk: bumps/walks, absorbed with compensation (vouchers)." },
    { "front": "Availability cache staleness", "back": "Search reads a short-TTL cached projection of inventory; results are advisory, not binding. The real check happens at hold time against the system of record." }
  ]
}
```

## Key takeaways

- **Split read from write.** Search is read-heavy and eventually consistent (cache + replicas);
  booking is low-volume and strongly consistent (transactions in the system of record). Optimize each
  separately — search results are advisory, the binding check is at **hold** time.
- **Holds prevent double-selling** by claiming a unit atomically before payment; they must carry a
  **TTL** so abandoned checkouts release inventory back.
- **Booking is a saga, not a 2PC transaction:** inventory and the external PSP can't share an atomic
  commit, so each step has a **compensating action** (refund, release) and the orchestrator drives the
  flow to all-or-nothing.
- **Idempotency makes retries safe:** an `Idempotency-Key` flows into the charge and the booking's
  unique constraint, guaranteeing one booking and one charge despite duplicates.
- **Overbooking is a separate business policy** layered on the same conditional-update mechanism,
  trading occasional bumps for revenue from no-shows.

## Concepts exercised

This design applies, end to end: `saga-pattern` (the multi-step booking flow with compensation across
inventory and payment) · `two-phase-commit` (the alternative we *reject*, because the external PSP can't
participate) · `database-transactions` (the conditional `UPDATE ... WHERE available >= 1` that claims a
unit atomically, and the booking row's unique constraint) · `caching-patterns-overview` (the
read-through availability cache, TTL vs invalidation, and the read/write CQRS split). It also exercises
idempotency keys, leases/holds, and overbooking as a yield-management policy.
