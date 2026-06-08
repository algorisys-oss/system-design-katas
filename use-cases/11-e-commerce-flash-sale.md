---
title: "Design E-commerce Checkout & Flash Sale (Amazon)"
slug: e-commerce-flash-sale
level: use-cases
module: large-scale-systems
order: 11
reading_time_min: 20
concepts: [inventory-reservation, oversell-prevention, idempotent-checkout, admission-control, cart-vs-order-consistency, payment-saga]
use_cases: [e-commerce-flash-sale]
prerequisites: [database-transactions, optimistic-vs-pessimistic-locking, idempotency-and-safe-methods, thundering-herd, cap-theorem]
status: published
---

# Design E-commerce Checkout & Flash Sale (Amazon)

> **Use case:** let shoppers add items to a cart and **check out** — turning a cart into a paid order
> while never **selling the same unit twice** — and survive a **flash sale** where 500,000 people try to
> buy 10,000 units in the same 60 seconds.
> **Domain:** Amazon, Shopify, ticketing (Ticketmaster), sneaker drops, console launches.
> **Scale:** normal traffic of thousands of checkouts/sec; a flash sale spikes 10–100× for a short
> window, all contending on a **tiny set of hot SKUs**.
> **Core challenges:** **inventory reservation** & **oversell prevention**, **optimistic vs pessimistic
> locking** by contention, **idempotent checkout** (no double-charge/double-order), the **thundering
> herd** of a drop (queueing & admission control), **cart (AP) vs order (CP)** consistency, and tying
> payment together with a **saga**.

Checkout is deceptively simple as a sentence ("buy this item") and brutal as a system: it's a
correctness problem (money and inventory must balance), a concurrency problem (everyone wants the same
unit at the same instant), and a load problem (a drop is a self-inflicted DDoS) — all at once.

## 1 · Clarify requirements

**Functional**
- **Cart:** add/remove items, view cart, persist across sessions and devices.
- **Checkout:** convert a cart to an **order**, reserve inventory, take payment, confirm.
- **Inventory:** decrement available stock so two buyers can't claim the last unit.
- **Flash sale:** a scheduled drop of a limited-quantity SKU; admit buyers fairly, reject the rest fast.

**Non-functional**
- **Never oversell.** Selling 10,001 of 10,000 units is a correctness bug that costs money and trust.
- **Never double-charge / double-order.** A retried "place order" click must create **one** order.
- **Stay up under the spike.** The site (especially browse/cart) must not fall over when the drop opens.
- **Fast, fair admission.** Tell losers "sold out" in milliseconds rather than timing them out.

```reveal
{
  "prompt": "Why split the system into a 'cart' part and an 'order' part with different consistency rules instead of treating it as one flow?",
  "answer": "Because the cart and the order have opposite cost-of-being-wrong profiles, so the right consistency choice differs. A cart is a convenience surface: if two devices briefly disagree about its contents, or an item shown as in-stock is actually gone, nothing irreversible happened — the user just edits and retries. So the cart can be AP (available, eventually consistent): keep it cheap, highly available, replicated, and never block adds even during a spike, because reserving real inventory at add-to-cart time would let idle carts hoard stock. The order, by contrast, is where money moves and inventory is consumed — being wrong means a double charge or an oversold unit, which are real losses. So the order path must be CP (strongly consistent): inventory decrement and order creation happen under a transaction / conditional update on a single authoritative store, accepting that this path is slower and can reject under contention. Treating it as one uniformly-strong flow would make browsing and carts fragile and slow during exactly the moment (the drop) they get the most traffic; treating it as one uniformly-weak flow would oversell. The split lets you spend strong consistency only where correctness is non-negotiable."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Flash-sale arrival rate (the thundering herd)",
  "inputs": [
    { "key": "shoppers", "label": "Shoppers hitting 'buy' at drop", "default": 500000 },
    { "key": "windowSec", "label": "Window they arrive in (s)", "default": 60 }
  ],
  "formula": "Math.round(shoppers / windowSec)",
  "resultLabel": "Checkout attempts per second on hot SKUs",
  "resultUnit": "req/s"
}
```

```calc
{
  "title": "Wasted work if every attempt reaches the DB",
  "inputs": [
    { "key": "attempts", "label": "Total buy attempts", "default": 500000 },
    { "key": "units", "label": "Units actually for sale", "default": 10000 }
  ],
  "formula": "Math.round((1 - units/attempts) * 100)",
  "resultLabel": "Attempts that MUST fail (sold out)",
  "resultUnit": "% of traffic"
}
```

> ~8,000 checkout attempts/sec land on **a handful of SKU rows**, and **98%** of them are doomed to
> "sold out." The whole game is to **decide the 98% cheaply** (admission control / queueing) so the
> authoritative inventory store only ever sees traffic close to the ~10,000 winners — not 500,000 racers.

## 3 · API & data model

```
addToCart(userId, sku, qty)            -> cart            // AP, fast, no reservation
getCart(userId)                        -> cart
checkout(userId, idempotencyKey)       -> order | 409     // CP, idempotent
reserve(sku, qty, orderId)             -> ok | OUT_OF_STOCK
confirmPayment(orderId, paymentResult) -> order(state)
```

Key fields:
- **`inventory(sku)`**: `{ available, reserved, version }`. `available` is the truth; `version` powers
  optimistic locking (recall: a version/CAS column that bumps on each write).
- **`order`**: `{ id, userId, items, state, idempotencyKey, ... }` where `state ∈ {PENDING_PAYMENT,
  PAID, CONFIRMED, CANCELLED}`.
- **`idempotencyKey`**: a client-generated unique ID for one checkout attempt — the dedup key that makes
  retries safe (recall: idempotent operations + safe methods).

## 4 · High-level architecture

```flow
{
  "title": "Browse → cart → checkout → fulfill",
  "nodes": [
    { "label": "CDN + edge", "detail": "Static product pages, drop landing page, and the 'sold out' page served from cache — most flash-sale traffic never touches origin." },
    { "label": "Waiting room / admission", "detail": "Virtual queue: issues a signed token to a controlled trickle of users; everyone else waits or is told sold out. Caps load on the real backend." },
    { "label": "Cart service (AP)", "detail": "Highly available KV store (e.g. DynamoDB/Redis), replicated, eventually consistent. No real inventory held here." },
    { "label": "Checkout / order service (CP)", "detail": "Strongly consistent. Reserves inventory and creates the order atomically; idempotent on the client's key." },
    { "label": "Inventory store", "detail": "Authoritative stock per SKU with atomic conditional decrement (optimistic version check or row lock)." },
    { "label": "Payment saga orchestrator", "detail": "Reserve → charge → confirm, with compensations (release reservation, refund) if any step fails." }
  ],
  "note": "The waiting room and CDN absorb the herd; only admitted, deduplicated traffic reaches the CP inventory store."
}
```

**Storage choices.** Cart lives in an AP key-value store keyed by user — it must stay writable during
the spike and tolerate a stale read. Inventory and orders live in a **strongly consistent** store (a
SQL row per SKU, or a single-row conditional write in a store like DynamoDB) because the decrement must
be atomic and globally agreed. Hot-SKU rows are the contention point everything else is designed to
protect.

## 5 · Deep dive A: reserving inventory without overselling

Overselling is a **lost-update race** (recall): two buyers both read `available = 1`, both decide
"yes," both write `available = 0`, and two orders ship one unit. The fix is to make the read-check-write
**atomic** and to choose a locking strategy by **contention level**.

```sequence
{
  "title": "Atomic conditional decrement (optimistic)",
  "actors": ["BuyerA", "BuyerB", "InventoryStore"],
  "steps": [
    { "from": "BuyerA", "to": "InventoryStore", "label": "read available=1, version=7" },
    { "from": "BuyerB", "to": "InventoryStore", "label": "read available=1, version=7" },
    { "from": "BuyerA", "to": "InventoryStore", "label": "UPDATE ... SET available=0, version=8 WHERE version=7" },
    { "from": "InventoryStore", "to": "BuyerA", "label": "1 row updated -> reserved!" },
    { "from": "BuyerB", "to": "InventoryStore", "label": "UPDATE ... WHERE version=7" },
    { "from": "InventoryStore", "to": "BuyerB", "label": "0 rows updated -> OUT_OF_STOCK, retry/reject" }
  ]
}
```

Two ways to make that decrement safe:

```compare
{
  "options": [
    { "label": "Optimistic (version/CAS)", "points": ["Read version, write WHERE version=read-value", "No lock held; loser sees '0 rows updated' and retries or fails", "Cheap when conflicts are rare", "Under extreme contention, most writers lose and retry -> wasted work, retry storms"] },
    { "label": "Pessimistic (SELECT ... FOR UPDATE)", "points": ["Lock the SKU row, decrement, commit, release", "Serializes contenders -> no wasted retries, guaranteed progress", "Holds a lock = throughput capped by lock hold time", "Hot row becomes a serialization bottleneck and a deadlock risk"] },
    { "label": "Atomic counter (Redis DECR / single conditional write)", "points": ["One indivisible op decrements stock and returns the result", "No multi-statement transaction, extremely fast", "Great for hot SKUs; durability/reconciliation handled separately", "Must reconcile the fast counter with the system-of-record inventory"] }
  ]
}
```

```reveal
{
  "prompt": "A flash sale is maximum contention on one SKU row. Optimistic locking shines when conflicts are rare — so why might it be the WRONG default here, and what do real systems do?",
  "answer": "Optimistic concurrency assumes most transactions don't actually collide, so it lets everyone proceed and only the rare loser retries. In a flash sale that assumption inverts: thousands of writers hit the same row each instant, so nearly all of them read the same version, nearly all of them fail the WHERE version=N check, and they all retry — producing a retry storm that amplifies load exactly when the system is most stressed (the classic optimistic failure mode under high contention). Pessimistic locking (SELECT ... FOR UPDATE) avoids the wasted retries by serializing access, guaranteeing each holder makes progress, but then total throughput is bounded by how fast you can acquire/release the lock on that single hot row, and you risk lock contention and deadlocks. So neither raw strategy is ideal for one ultra-hot SKU. Real systems sidestep the contention rather than fight it: (1) put the hot counter in an in-memory store and use a single atomic op (Redis DECR / a Lua script) so each reservation is one indivisible, lock-free operation, with the relational inventory reconciled asynchronously; (2) shard the stock across N buckets (e.g. 10,000 units split into 100 sub-counters of 100) so contenders spread over 100 rows instead of one — the same hot-partition fix used elsewhere; and (3) admit far fewer racers in the first place (the waiting room), so the authoritative store sees traffic near the number of units, where even optimistic locking is fine. The choice is contention-driven: optimistic for low contention, pessimistic/serialized for moderate contention on critical rows, and counter-sharding plus admission control for the extreme hot-SKU case."
}
```

Tune the strategy to how hot the SKU is:

```tradeoff
{
  "title": "Locking strategy vs contention on the SKU row",
  "axis": { "left": "Low contention", "right": "Extreme contention (flash sale)" },
  "steps": [
    { "label": "Optimistic version check", "detail": "Normal catalog: conflicts are rare, so version-check writes almost always succeed first try. Cheapest and lock-free." },
    { "label": "Pessimistic row lock", "detail": "A moderately hot item (popular but not a drop): serialize the few contenders so each makes guaranteed progress without retry storms." },
    { "label": "Sharded stock counters", "detail": "Split N units across K sub-counters so writers spread over K rows; reassemble remaining stock by summing. Turns one hot row into K warm ones." },
    { "label": "Atomic counter + admission control", "detail": "The drop: an in-memory atomic DECR behind a waiting room that only admits ~as many buyers as units. The store barely feels the herd." }
  ]
}
```

## 5 · Deep dive B: idempotent checkout (no double-charge)

The user double-clicks "Place order," their phone retries on a flaky network, or your gateway retries a
timed-out request. Without protection you create **two orders** and **charge twice**.

The fix: the client generates an **idempotency key** for the checkout attempt and sends it on every
retry. The server stores `(idempotencyKey → orderId)` the first time and, on any retry with the same
key, returns the **same** order instead of creating a new one (recall: idempotency makes retries safe).

```sequence
{
  "title": "Idempotent checkout under a retry",
  "actors": ["Client", "OrderService", "OrderStore"],
  "steps": [
    { "from": "Client", "to": "OrderService", "label": "checkout(key=abc123)" },
    { "from": "OrderService", "to": "OrderStore", "label": "INSERT order WHERE key=abc123 not exists" },
    { "from": "OrderStore", "to": "OrderService", "label": "created order #555 (PENDING_PAYMENT)" },
    { "from": "Client", "to": "OrderService", "label": "(timeout) RETRY checkout(key=abc123)" },
    { "from": "OrderService", "to": "OrderStore", "label": "key abc123 already exists -> read it" },
    { "from": "OrderService", "to": "Client", "label": "return existing order #555 (no new order, no second charge)" }
  ]
}
```

The idempotency key is enforced with a **unique constraint** on the order row (or a dedicated dedup
table): the second insert with the same key fails the constraint, and the service reads back the
original. Critically, the **payment charge** must also be idempotent — pass the same key to the payment
provider so a retried charge returns the original transaction rather than a second debit.

## 5 · Deep dive C: surviving the thundering herd

When the drop opens, every client request fires at once — the **thundering herd** (recall). Letting all
500,000 hit checkout would melt the inventory store even with perfect locking. The defense is a layered
funnel that turns the spike into a controlled trickle.

```flow
{
  "title": "Admission funnel for a drop",
  "nodes": [
    { "label": "CDN absorbs reads", "detail": "Product page, countdown, and 'sold out' page are static and cached at the edge — millions of views never reach origin." },
    { "label": "Virtual waiting room", "detail": "Users get a queue position + signed token. Tokens are released at a rate the backend can handle (e.g. 2k/s), not all at once." },
    { "label": "Single-flight / dedup", "detail": "Collapse duplicate in-flight requests per user (recall request coalescing) so one buyer = one attempt." },
    { "label": "Fast 'sold out' shedding", "detail": "Once a cheap in-memory counter hits zero, reject instantly with a cached page — never queue doomed buyers behind the DB." },
    { "label": "Authoritative reserve", "detail": "Only admitted, deduplicated, still-possible buyers run the atomic inventory decrement." }
  ],
  "note": "Each layer discards traffic the next layer would have wasted work on — load shedding, earliest and cheapest."
}
```

```reveal
{
  "prompt": "Why is a 'virtual waiting room' better than just letting everyone hit checkout and relying on the inventory lock to sort it out?",
  "answer": "Because the lock only enforces correctness, not survival. If 500,000 buyers all hit the authoritative inventory store, the locking strategy will indeed prevent overselling — but the store is now handling 8,000+ contended ops/sec on a hot row, connection pools saturate, latency climbs, timeouts trigger client retries (which double the load), and the contention can collapse throughput to near zero (a metastable failure where the system stays down even after the spike passes). The waiting room moves the queue OUT of the precious, stateful, hard-to-scale tier and into a cheap, stateless, horizontally-scalable front tier. It admits buyers at a rate the backend can actually sustain, hands losers a definitive 'sold out' immediately from cache instead of timing them out, and prevents the retry amplification that turns a spike into an outage. It's the e-commerce form of backpressure and load shedding: protect the scarce resource by controlling admission to it, decide the doomed 98% cheaply at the edge, and let the strongly-consistent core see only traffic it can handle. Correctness (the lock) and survival (admission control) are separate concerns and you need both."
}
```

## 5 · Deep dive D: payment as a saga

Checkout spans multiple services that can't share one ACID transaction — reserve inventory (inventory
service), charge the card (payment provider), confirm the order. We coordinate them with a **saga**: a
sequence of local transactions, each with a **compensating action** that undoes it if a later step
fails. There's no global rollback, so we roll *forward* to a consistent end state.

```sequence
{
  "title": "Order saga with compensations",
  "actors": ["OrderSvc", "Inventory", "Payment"],
  "steps": [
    { "from": "OrderSvc", "to": "Inventory", "label": "reserve(sku, qty) -> held" },
    { "from": "OrderSvc", "to": "Payment", "label": "charge(amount, idempotencyKey)" },
    { "from": "Payment", "to": "OrderSvc", "label": "DECLINED" },
    { "from": "OrderSvc", "to": "Inventory", "label": "COMPENSATE: release reservation" },
    { "from": "OrderSvc", "to": "OrderSvc", "label": "mark order CANCELLED -> consistent end state" }
  ]
}
```

If payment succeeds but order confirmation later fails, the compensation runs the other way (refund).
Reservations carry a **TTL**: if a buyer reserves a unit but never pays, the hold expires and the unit
returns to `available` — otherwise abandoned carts would permanently lock up a limited drop.

## 6 · Trade-offs & failure modes

- **Reserve-at-cart vs reserve-at-checkout.** Reserving when an item enters the cart guarantees the
  buyer can complete, but idle carts hoard limited stock (and create artificial scarcity). Reserving at
  checkout maximizes availability but risks "sold out at the last step." Most sites reserve at checkout
  with a short TTL hold; ticketing often reserves a seat in the cart with a visible countdown.
- **Oversell vs underutilization.** Sharded counters and async reconciliation can leave a few units
  stranded in a sub-counter that hit zero while another had stock — you under-sell slightly to avoid
  ever overselling. Periodic rebalancing recovers the stragglers.
- **Cart consistency.** AP carts can show a stale "in stock" badge; that's acceptable because the
  authoritative check happens at checkout. Never make the cart strongly consistent — it sacrifices the
  availability you most need during a drop.
- **Saga visibility windows.** Between "reserved" and "paid," inventory looks lower than it really is;
  expired reservations must be reaped promptly or the drop appears sold out while units sit held.
- **Payment provider outage.** The saga must handle a charge that times out with *unknown* result —
  reconcile by querying the provider with the idempotency key rather than blindly retrying or refunding.

## 7 · Scaling & evolution

- **Shard hot SKUs:** split a drop's stock across K sub-counters to convert one hot row into K warm ones
  (recall hot partitions); sum them to display remaining stock.
- **In-memory reservation tier:** serve reservations from Redis atomic ops at the spike, draining to the
  durable inventory store asynchronously and reconciling.
- **Pre-warm and pre-generate:** cache the drop page, "sold out" page, and waiting-room assets at the
  edge before the drop; pre-create inventory counters so the first request isn't a cold start.
- **Per-user purchase limits:** enforce "max 2 per customer" with the same idempotency/dedup machinery
  to stop bots from sweeping a limited drop.
- **Async order pipeline:** once inventory is reserved and payment authorized, push fulfillment
  (warehouse, shipping, email) onto a queue so the synchronous checkout path stays short.

## Self-test

```quiz
{
  "question": "Two buyers both read 'available = 1' for the last unit and both place an order. What is this, and what prevents it?",
  "options": [
    "A thundering herd; fixed by a CDN",
    "A lost-update race; fixed by an atomic conditional decrement (version check / row lock / atomic counter)",
    "A saga failure; fixed by a refund",
    "A stale cart read; fixed by strong cart consistency"
  ],
  "answer": 1,
  "explanation": "Two read-check-write sequences interleave so both pass — the classic lost update. Making the decrement atomic (optimistic version check, SELECT FOR UPDATE, or an atomic counter) ensures only one reservation wins."
}
```

```quiz
{
  "question": "Why is plain optimistic locking often a poor default for a single ultra-hot flash-sale SKU?",
  "options": [
    "It can't prevent overselling",
    "Under extreme contention nearly all writers fail the version check and retry, causing a retry storm",
    "It requires a SQL database",
    "It holds a lock too long"
  ],
  "answer": 1,
  "explanation": "Optimistic concurrency assumes conflicts are rare. On one hot row almost everyone collides, fails, and retries — amplifying load. Real systems shard the counter, use an atomic counter, and admit fewer racers."
}
```

```quiz
{
  "question": "A customer's 'Place order' request times out and the client retries with the same idempotency key. The correct behavior is:",
  "options": [
    "Create a second order to be safe",
    "Return the original order and charge once — the unique key dedups the retry",
    "Reject both orders",
    "Charge twice and refund one later"
  ],
  "answer": 1,
  "explanation": "The idempotency key (enforced by a unique constraint and passed to the payment provider) makes the retry return the original order with no second charge."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Checkout & flash sale — key terms",
  "cards": [
    { "front": "Oversell / lost-update race", "back": "Two buyers both read the last unit as available and both reserve it. Prevented by an atomic conditional decrement." },
    { "front": "Optimistic vs pessimistic locking", "back": "Version/CAS check (no lock, loser retries — best when conflicts rare) vs row lock (serialize contenders — best for moderate contention on critical rows)." },
    { "front": "Sharded stock counters", "back": "Split N units across K sub-counters so contenders spread over K warm rows instead of one hot row; sum to show remaining stock." },
    { "front": "Idempotency key", "back": "Client-generated unique ID per checkout attempt; a unique constraint dedups retries so one click = one order = one charge." },
    { "front": "Virtual waiting room", "back": "Admission control that releases buyers to checkout at a sustainable rate and rejects the rest fast — backpressure for a drop." },
    { "front": "Saga + compensation", "back": "Reserve -> charge -> confirm as local transactions, each with an undo (release, refund). No global rollback; roll forward to a consistent state." }
  ]
}
```

## Key takeaways

- **Split consistency by surface:** the **cart is AP** (available, eventually consistent — never block
  adds, never reserve real stock there); the **order/inventory path is CP** (atomic, authoritative).
- **Prevent oversell with an atomic decrement**, and choose the locking strategy by **contention**:
  optimistic when conflicts are rare, pessimistic for moderately hot rows, **sharded/atomic counters**
  for the ultra-hot drop SKU.
- **Make checkout idempotent** with a client **idempotency key** + unique constraint, propagated to the
  payment provider, so retries and double-clicks never create a second order or charge.
- **Survive the herd with admission control**, not just locks: CDN + a **virtual waiting room** decide
  the doomed ~98% cheaply so the consistent core only sees traffic near the number of units.
- **Coordinate payment with a saga** of compensable local transactions plus **TTL'd reservations**, so
  failures roll forward to a consistent end state without holding limited stock hostage.

## Concepts exercised

This design applies, end to end: `database-transactions` (the atomic read-check-write that prevents
oversell) · `optimistic-vs-pessimistic-locking` (chosen by contention on the SKU row, with
counter-sharding for the extreme case) · `idempotency-and-safe-methods` (the checkout/payment
idempotency key and unique constraint) · `thundering-herd` (the drop, defused with a CDN + virtual
waiting room and request coalescing) · `cap-theorem` (the AP cart vs CP order split) — plus
`backpressure-and-load-shedding` (admission control, cheap "sold out"), `hot-partitions` (sharding hot
SKUs), and the **saga** pattern for the multi-service payment flow.
