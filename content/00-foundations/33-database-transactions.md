---
title: "Database Transactions"
slug: database-transactions
level: foundations
module: database-fundamentals
order: 33
reading_time_min: 13
concepts: [transactions, commit, rollback, begin, locking, optimistic-concurrency]
use_cases: []
prerequisites: [acid-properties, crud-operations]
status: published
---

# Database Transactions

## Hook — a motivating scenario

Two people buy the last concert ticket at the same instant. Both requests read "1 ticket left," both
decide "available," both write "sold." Now you've sold one ticket twice. Or: a checkout deducts
inventory, charges the card, and creates the order — but the charge fails after inventory was already
reduced. Transactions are the tool that makes multi-step changes **all-or-nothing** and concurrent
changes **safe**. This chapter is ACID *in practice*.

## Mental model — a scratchpad you can throw away

A transaction is a scratchpad: you `BEGIN`, do several operations tentatively, and then either
`COMMIT` (make them all real at once) or `ROLLBACK` (discard everything as if it never happened).
Until commit, your changes aren't visible to others and can be undone cleanly.

```sequence
{
  "title": "A transaction: commit vs rollback",
  "actors": ["App", "Database", "PaymentAPI"],
  "steps": [
    { "from": "App", "to": "Database", "label": "BEGIN" },
    { "from": "App", "to": "Database", "label": "UPDATE inventory -1" },
    { "from": "App", "to": "Database", "label": "INSERT order" },
    { "from": "App", "to": "PaymentAPI", "label": "charge card (external)... FAILED" },
    { "from": "App", "to": "Database", "label": "ROLLBACK (undo inventory + order)" },
    { "from": "Database", "to": "App", "label": "state unchanged — no partial checkout" }
  ]
}
```

## Build it up — using transactions correctly

The pattern: wrap the steps that must succeed *together* in one transaction.

```
BEGIN;
  UPDATE inventory SET qty = qty - 1 WHERE id = 7 AND qty > 0;
  INSERT INTO orders (...) VALUES (...);
COMMIT;   -- or ROLLBACK on any failure
```

Two rules that trip people up:
- **Keep transactions short.** A transaction holds resources (and often locks) until it commits.
  Long-running transactions (especially with a network/API call inside) block others and hurt
  throughput. Never call a slow external API in the middle of an open transaction.
- **Handle failure → rollback.** On any error, roll back so you don't leave partial changes.

```reveal
{
  "prompt": "Why is it dangerous to make an external HTTP call (e.g. charge a card) *inside* an open database transaction?",
  "answer": "The transaction holds locks/resources for the entire duration, and a network call can take hundreds of ms or hang — blocking other transactions and exhausting connections/locks, sometimes cascading into outages. External calls are also non-transactional (you can't 'rollback' a real charge). Pattern: do the DB work in a short transaction, and coordinate external side effects separately (e.g. reserve in a transaction, charge outside, then confirm) — this is what the outbox/saga patterns in later courses formalize."
}
```

## Build it up — concurrency: locking vs optimistic

For the double-booked-ticket problem, you need concurrent transactions not to clobber each other. Two
approaches (deepened in the advanced course):
- **Pessimistic locking** — lock the row before reading/updating (`SELECT … FOR UPDATE`), so the
  second transaction waits. Safe; can reduce concurrency.
- **Optimistic concurrency** — don't lock; on update, check a version/condition (`UPDATE … WHERE
  qty > 0` or a `version` column) and retry if it changed. Great when conflicts are rare.

```reveal
{
  "prompt": "How does `UPDATE tickets SET sold = sold + 1 WHERE id = 7 AND sold < capacity` prevent overselling without an explicit lock?",
  "answer": "The condition is evaluated atomically by the database as part of the single UPDATE. If two transactions race, the database serializes the row updates: the first succeeds (sold becomes capacity), and the second's WHERE (sold < capacity) is now false, so it updates 0 rows — the app sees 'no rows affected' and reports sold out. The atomic conditional write is a form of optimistic concurrency that avoids the read-then-write gap where double-booking happens."
}
```

Which concurrency control fits depends on how often transactions actually collide — slide from rare conflicts to heavy contention:

```tradeoff
{ "title": "Optimistic vs pessimistic concurrency: how often do transactions collide?", "axis": { "left": "Optimistic (check + retry)", "right": "Pessimistic (lock first)" }, "steps": [
  { "label": "Conflicts rare", "detail": "Optimistic shines: no locks taken, an atomic conditional update (WHERE qty > 0 or a version column) succeeds first try; retries almost never fire, so concurrency stays high." },
  { "label": "Occasional conflicts", "detail": "Optimistic still works but some updates affect 0 rows and must retry; wasted work grows with collision rate, eating into the throughput advantage." },
  { "label": "Heavy contention", "detail": "Pessimistic wins: lock the row first (SELECT … FOR UPDATE) so the second transaction waits rather than retrying repeatedly. Safe, but serializes access and reduces concurrency." }
] }
```

## In the wild

- **Money, inventory, bookings** — anywhere partial updates or double-spends are unacceptable — use
  transactions.
- **ORMs/frameworks** expose transactions (e.g. a `transaction { ... }` block); know what's inside
  the boundary.
- **Deadlocks** happen when two transactions wait on each other's locks; databases detect and abort
  one — apps should retry. Acquire locks in a consistent order to reduce them.
- **Distributed transactions** (across services/databases) are much harder — often replaced by sagas/
  outbox patterns (advanced course) rather than two-phase commit.

## Common misconception — "wrapping code in a transaction makes all concurrency safe"

A transaction is atomic, but the default isolation level still allows races unless you design for them.

```reveal
{
  "prompt": "Both ticket-buying requests run inside transactions, yet both still oversell. How is that possible if transactions are 'safe'?",
  "answer": "Atomicity (all-or-nothing) is not the same as isolation from concurrent reads. At common isolation levels, both transactions can read '1 left' before either writes, then both write — a lost update. The transaction boundary alone doesn't serialize that read-then-write. You need stronger isolation (e.g. Serializable), explicit locking (SELECT … FOR UPDATE), or an atomic conditional update. Transactions give you the tools; you must apply the right concurrency control for the conflict."
}
```

Transactions guarantee atomicity and durability, but **preventing concurrency anomalies requires the
right isolation level or locking strategy** — not just opening a transaction.

## Self-test

```quiz
{
  "question": "What does ROLLBACK do?",
  "options": [
    "Commits all changes immediately",
    "Discards all changes made since BEGIN, as if they never happened",
    "Locks the entire database permanently",
    "Deletes the table"
  ],
  "answer": 1,
  "explanation": "ROLLBACK undoes every change since BEGIN, restoring the pre-transaction state (atomicity in action)."
}
```

```quiz
{
  "question": "Why should you avoid slow external API calls inside an open transaction?",
  "options": [
    "External calls can't return JSON",
    "The transaction holds locks/resources for its whole duration, blocking others and risking timeouts",
    "Transactions can't contain network calls at all",
    "It improves throughput"
  ],
  "answer": 1,
  "explanation": "Open transactions hold locks/connections; a slow external call lengthens that, blocking others and exhausting resources."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Database transactions — key terms", "cards": [
  { "front": "Transaction", "back": "A group of operations treated as one all-or-nothing unit: BEGIN, do work tentatively, then COMMIT to make it all real or ROLLBACK to discard everything." },
  { "front": "COMMIT vs ROLLBACK", "back": "COMMIT makes all tentative changes real at once; ROLLBACK discards every change since BEGIN, restoring the pre-transaction state as if it never happened." },
  { "front": "Why keep transactions short?", "back": "An open transaction holds resources and often locks until commit. Long ones (especially with a slow external call inside) block others and hurt throughput." },
  { "front": "Pessimistic locking", "back": "Lock the row before reading/updating (SELECT … FOR UPDATE) so the second transaction waits. Safe, but can reduce concurrency." },
  { "front": "Optimistic concurrency", "back": "Don't lock; on update check a version/condition (e.g. WHERE qty > 0) and retry if it changed. Great when conflicts are rare." },
  { "front": "Atomicity is not isolation", "back": "A transaction being all-or-nothing doesn't prevent concurrent races. Lost updates need the right isolation level, explicit locking, or an atomic conditional update." }
] }
```

## Key takeaways

- A transaction (`BEGIN … COMMIT`/`ROLLBACK`) makes multiple operations **all-or-nothing**; roll back
  on any failure.
- **Keep transactions short** and **never wait on slow external calls inside them** (they hold
  locks/resources).
- Preventing concurrency anomalies (double-booking) needs **locking or the right isolation /
  conditional updates**, not just a transaction boundary.
- **Optimistic** (version/condition + retry) vs **pessimistic** (lock first) concurrency are the two
  core strategies.

## Up next

Reads dominate most systems, and finding rows fast needs the right structures. Next: **Database
Indexing**.
