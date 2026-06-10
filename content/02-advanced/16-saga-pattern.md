---
title: "Saga Pattern"
slug: saga-pattern
level: advanced
module: distributed-transactions
order: 16
reading_time_min: 16
concepts: [saga, compensating-transactions, orchestration, choreography, eventual-consistency, idempotency]
use_cases: []
prerequisites: [two-phase-commit, synchronous-vs-asynchronous-communication, idempotency-and-safe-methods]
status: published
---

# Saga Pattern

## Hook — a motivating scenario

An order spans four services: payment, inventory, shipping, and loyalty points. You can't wrap them in
one ACID transaction (separate databases), and 2PC would block and couple them. But you still need
"all-or-nothing" *business* behavior: if shipping can't fulfill the order, the payment must be
refunded and the inventory released. The **saga pattern** delivers this — a sequence of **local
transactions**, each with a **compensating action** to undo it if a later step fails.

## Mental model — a chain of local transactions with undo steps

A **saga** breaks a distributed transaction into a sequence of **local** transactions (each
service commits to *its own* database normally). If any step fails, the saga runs **compensating
transactions** that **semantically undo** the prior committed steps — refund the payment, release the
inventory — in reverse order. There are no global locks and no atomic commit; instead you get
**eventual consistency with explicit rollback logic**.

```sequence
{
  "title": "Saga: local transactions + compensation on failure",
  "actors": ["Order", "Payment", "Inventory", "Shipping"],
  "steps": [
    { "from": "Order", "to": "Payment", "label": "charge (local commit) ✓" },
    { "from": "Order", "to": "Inventory", "label": "reserve stock (local commit) ✓" },
    { "from": "Order", "to": "Shipping", "label": "schedule shipment → FAILS ✗" },
    { "from": "Order", "to": "Inventory", "label": "COMPENSATE: release stock" },
    { "from": "Order", "to": "Payment", "label": "COMPENSATE: refund charge" }
  ]
}
```

## Build it up — orchestration vs choreography

Two ways to coordinate the steps:

```compare
{
  "options": [
    { "label": "Orchestration", "points": ["A central orchestrator tells each service what to do next", "Explicit, centralized workflow logic (easy to follow/monitor)", "Orchestrator is a component to build/run", "Good for complex sagas"] },
    { "label": "Choreography", "points": ["Services react to each other's events (no central brain)", "Decentralized, loosely coupled (pub/sub events)", "Flow is emergent — harder to trace/debug", "Good for simple sagas"] }
  ]
}
```

- **Orchestration:** a saga orchestrator (a state machine) drives the sequence and triggers
  compensations on failure. Centralized control = clear logic and observability, at the cost of
  building/operating the orchestrator.
- **Choreography:** each service emits **events** (recall pub/sub); others react and emit the next
  event. No central coordinator, very decoupled — but the end-to-end flow is implicit and harder to
  understand/debug as it grows.

```reveal
{
  "prompt": "Compensating transactions 'undo' earlier steps — but you can't literally un-send an email or un-ship a package. How do sagas handle effects that aren't truly reversible?",
  "answer": "Compensation is semantic, not a literal rollback to a prior state — you can't restore the exact previous world, you take a new action that counteracts the business effect. For a charge, the compensation is a refund (a new transaction), not erasing the charge. For inventory, release/return the reserved stock. For an already-sent email, you can't unsend it, so you send a follow-up ('disregard previous message / your order was cancelled'). For a shipped package, you can't un-ship it, so you trigger a return/recall or a refund. The key design implications: (1) order steps so that hard-to-compensate or irreversible actions come LAST (or after a point of no return), minimizing what must be undone — e.g. do all the reversible reservations/holds first and only actually ship/charge-capture near the end. (2) Use 'pending/reserved' states that are easy to release rather than immediately-final effects (reserve inventory, authorize payment, then capture/commit late). (3) Make compensations idempotent and themselves reliable (they can fail and be retried). (4) Accept that some effects are visible during the saga (no isolation), so design for that. So sagas don't promise you can perfectly reverse the world; they promise a defined compensating action per step that restores business-level consistency, and you structure the workflow (and use reservations) so irreversibility is contained. Where an action truly can't be compensated, you sequence it so that by the time you do it, success is assured — turning 'undo' into 'don't do the irreversible thing until everything else has succeeded.'"
}
```

## Build it up — the trade-offs you accept

- **No isolation:** unlike ACID, intermediate saga states are **visible** to others (another request
  can see the reserved-but-not-yet-confirmed state). You design around it (status fields, reservations)
  — sagas give A, C, D-ish behavior but **not I**.
- **Eventual consistency:** the system is temporarily inconsistent (charged but not yet shipped) until
  the saga completes or compensates.
- **Idempotency & reliability are mandatory:** steps and compensations run over async messaging
  (recall at-least-once), so they must be **idempotent** and retried; you need to handle a compensation
  *itself* failing.
- **Complexity:** you must design a compensation for every step and reason about partial failures and
  out-of-order events — real engineering effort.

```reveal
{
  "prompt": "Why must every saga step and compensation be idempotent, and what breaks if they aren't?",
  "answer": "Because sagas run as a series of steps coordinated over unreliable, asynchronous messaging (events/commands with at-least-once delivery, retries on timeout, possible duplicates and out-of-order arrival — recall messaging/queues). The orchestrator or event bus may deliver the same 'reserve inventory' command twice (a retry after a lost ack), or a compensation 'refund payment' might be redelivered. If steps aren't idempotent, a duplicate delivery double-applies the effect: reserve stock twice, charge or refund twice, ship two packages — corrupting state and money. Compensations especially must be idempotent because they often run during failure handling where retries are common; a non-idempotent 'refund' could issue multiple refunds. The fix is the standard idempotency toolkit: key each operation by a unique id (order/saga id + step) and de-duplicate, or make operations naturally idempotent (set state to a target value rather than increment, use conditional updates). Without idempotency you also can't safely retry, which sagas depend on to make progress through transient failures — so you'd be forced to choose between losing steps (skip retries) or duplicating them (retry). Idempotency is what lets the saga safely retry every step/compensation until it succeeds exactly once in effect, which is the foundation of saga reliability. (This is the same 'at-least-once delivery + idempotent processing = effectively-once' principle from the messaging chapters, now applied across a multi-step business transaction.)"
}
```

## In the wild

- **Microservice transactions** (order/checkout, travel booking, money movement) use sagas instead of
  2PC for availability + loose coupling (recall the 2PC chapter's reasoning).
- **Orchestrators:** workflow engines like Temporal, Camunda, AWS Step Functions, Netflix Conductor
  implement durable saga orchestration (state, retries, compensation). AWS Step Functions **Standard**
  workflows can run a single saga for up to **1 year** (365 days) — long enough to wait on slow steps
  like a shipping confirmation — and durably persist every state transition for replay.
- **Choreography** rides on event streams/queues (Kafka, recall pub/sub) — services emit and react to
  domain events.
- Sagas pair tightly with the **transactional outbox** (next chapter) to reliably emit each step's
  event atomically with its local DB commit.

## Common misconception — "a saga is just a distributed transaction / gives you ACID across services"

It gives **eventual** consistency with **compensation**, not isolation or atomic rollback.

```reveal
{
  "prompt": "Why is calling a saga 'a distributed transaction' misleading, and what guarantees does it actually provide vs ACID?",
  "answer": "A saga deliberately is NOT an atomic, isolated transaction — it's a sequence of independent local transactions stitched together with compensations, providing business-level consistency eventually rather than ACID. Key differences: (1) No atomicity in the strict sense — each local step commits immediately and independently; there's no global commit/rollback. If a later step fails, you don't roll back (the prior commits are durable); you run compensating transactions that take new actions to counteract them. (2) No isolation — intermediate states are visible to other operations (a reader can see 'payment charged, order not yet shipped' or 'inventory reserved'), unlike ACID where in-flight changes are hidden. This means you must design for visible intermediate states (statuses, reservations) and possible anomalies. (3) Only eventual consistency — the system is temporarily inconsistent until the saga completes or fully compensates. (4) Compensation is semantic, not a true undo, and can itself fail (needing idempotent retries). So a saga trades ACID's strong guarantees for availability, loose coupling, and no blocking/global locks — appropriate for cross-service workflows where 2PC is too costly/blocking. Treating it as 'ACID across services' leads to wrong assumptions: that intermediate states are hidden (they aren't), that failure auto-rolls-back cleanly (you must write compensations), and that there's isolation (there isn't), causing bugs like acting on uncommitted-looking states or forgetting compensation/idempotency. A saga is a pattern for maintaining consistency across services via compensable steps and eventual convergence — not a distributed ACID transaction."
}
```

The **saga pattern** implements a cross-service "transaction" as **local transactions + compensating
actions**, coordinated by **orchestration** (central) or **choreography** (events). It gives
**eventual consistency with explicit rollback** — **no isolation, no atomic commit** — and requires
**idempotent, retriable** steps/compensations.

## Self-test

```quiz
{
  "question": "A saga maintains consistency across services by:",
  "options": [
    "Using 2PC to commit all services atomically",
    "Running a sequence of local transactions, each with a compensating transaction to undo it if a later step fails",
    "Locking all databases until done",
    "Avoiding any state changes"
  ],
  "answer": 1,
  "explanation": "Sagas use local commits + compensations (semantic undo) for eventual consistency — no global locks or atomic commit (unlike 2PC)."
}
```

```quiz
{
  "question": "Orchestration vs choreography for sagas:",
  "options": [
    "Orchestration uses events with no coordinator; choreography uses a central brain",
    "Orchestration uses a central coordinator driving steps; choreography has services react to each other's events (decentralized)",
    "They are identical",
    "Choreography requires 2PC"
  ],
  "answer": 1,
  "explanation": "Orchestration = central workflow controller (clear/observable); choreography = event-driven, decoupled, but harder to trace."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Saga pattern — key terms", "cards": [ { "front": "Saga", "back": "A distributed transaction broken into a sequence of local transactions, each committing to its own database, with a compensating action to undo it if a later step fails." }, { "front": "Compensating transaction", "back": "A new action that semantically undoes a prior committed step (refund a charge, release stock) — not a literal rollback to a previous state." }, { "front": "Orchestration", "back": "A central orchestrator (state machine) drives the sequence and triggers compensations. Centralized, clear, observable — but you must build/run the orchestrator." }, { "front": "Choreography", "back": "Services react to each other's events with no central brain — decoupled via pub/sub, but the end-to-end flow is implicit and harder to trace/debug." }, { "front": "No isolation (saga)", "back": "Unlike ACID, intermediate saga states are visible to others (reserved-but-not-confirmed). You design around it with statuses and reservations; sagas give A,C,D-ish but not I." }, { "front": "Why idempotency is mandatory", "back": "Steps and compensations run over async at-least-once messaging with retries and duplicates, so each must be idempotent and retriable to avoid double-applying effects." } ] }
```

## Key takeaways

- A **saga** runs a distributed workflow as **local transactions + compensating transactions** (undo
  on later failure) — **no global locks, no 2PC**; the microservice answer to cross-service consistency.
- Coordinate via **orchestration** (central controller — clear, observable) or **choreography**
  (event-driven — decoupled, harder to trace).
- It provides **eventual consistency with compensation** — **not isolation/atomicity**; intermediate
  states are visible (design with reservations/statuses; do irreversible steps last).
- Steps and compensations run over async messaging, so they **must be idempotent and retriable**
  (pairs with the **transactional outbox**).

## Up next

Reliably emitting a saga step's event *atomically with* its local DB commit is its own problem. Next:
**Transactional Outbox**.
