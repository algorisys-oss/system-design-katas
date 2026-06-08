---
title: "ACID Properties"
slug: acid-properties
level: foundations
module: database-fundamentals
order: 30
reading_time_min: 15
concepts: [acid, atomicity, consistency, isolation, durability, transactions]
use_cases: []
prerequisites: [crud-operations, memory-vs-disk]
status: published
---

# ACID Properties

## Hook — a motivating scenario

A bank transfer is two steps: subtract ₹1000 from Alice, add ₹1000 to Bob. The server crashes right
after step one. Alice is out ₹1000 and Bob never got it — money vanished. The whole point of a
transactional database is to make that *impossible*: the two steps must succeed together or not at
all. The guarantees that make this work are **ACID**.

## Mental model — an all-or-nothing contract

A **transaction** groups multiple operations into one logical unit with a contract: either the entire
group takes effect, or none of it does — and once the database says "committed," it stays committed
even through crashes. ACID names the four parts of that contract.

```match
{
  "prompt": "Match each ACID property to what it guarantees.",
  "pairs": [
    { "left": "Atomicity", "right": "All steps happen, or none do (no half-done transactions)" },
    { "left": "Consistency", "right": "A transaction moves the DB from one valid state to another (rules/constraints hold)" },
    { "left": "Isolation", "right": "Concurrent transactions don't corrupt each other's view" },
    { "left": "Durability", "right": "Once committed, it survives crashes/power loss" }
  ]
}
```

## Build it up — each guarantee, with the transfer

- **Atomicity** solves the opening bug: wrap both steps in a transaction; if the crash hits after
  step one, the database **rolls back** — Alice's money is restored. All-or-nothing.
- **Consistency** means invariants hold across the transaction: e.g. total money is conserved, no
  negative balances, foreign keys valid. The transaction can't leave the DB violating its rules.
- **Isolation** means if two transfers run at once, neither sees the other's half-finished state —
  the result is as if they ran one after another (to the chosen isolation level).
- **Durability** means once "committed" is returned, the data is on stable storage (recall
  flush/WAL) and survives a crash — the bank won't "forget" a completed transfer.

```reveal
{
  "prompt": "Which ACID property prevents the 'money vanished' bug when the server crashes mid-transfer, and how?",
  "answer": "Atomicity. The two steps are one transaction; if it doesn't fully complete (commit), the database rolls back any partial changes on recovery — so the debit is undone and no money is lost. Without atomicity you'd be left with the debit but not the credit. (Durability then guarantees a *committed* transfer isn't lost to a later crash.)"
}
```

## Build it up — isolation is the subtle one

Run transactions concurrently and weird interleavings appear: **dirty reads** (seeing uncommitted
data), **non-repeatable reads**, **lost updates**. Databases offer **isolation levels** (Read
Committed → Repeatable Read → Serializable) that trade *more isolation* for *less concurrency/
performance*. Serializable is the strongest (as if fully sequential) but costs the most throughput.

```reveal
{
  "prompt": "Two requests both read a seat as 'available' and both book it. What went wrong, and which property addresses it?",
  "answer": "A lost update / double-booking from insufficient isolation: both transactions read the old state before either wrote, so the second clobbers the first's assumption. Stronger isolation (or explicit locking / optimistic concurrency, covered later) serializes the two so only one booking succeeds. Isolation is precisely about concurrent transactions not corrupting each other — and the level you choose trades safety against throughput."
}
```

Slide the isolation dial and watch safety trade against concurrency:

```tradeoff
{ "title": "How strict should the isolation level be?", "axis": { "left": "More concurrency", "right": "More isolation" }, "steps": [ { "label": "Read Committed", "detail": "Weakest of the three here: prevents dirty reads but allows non-repeatable reads and lost updates. Highest concurrency/throughput; the default in PostgreSQL/Oracle/SQL Server." }, { "label": "Repeatable Read", "detail": "Stronger: rows you read stay stable within the transaction, cutting more anomalies. MySQL/InnoDB's default. Costs some throughput versus Read Committed." }, { "label": "Serializable", "detail": "Strongest: results are as if transactions ran one after another, eliminating concurrency anomalies. Costs the most throughput, so reserve it where double-booking-style bugs matter." } ] }
```

## In the wild

- **Relational databases (PostgreSQL, MySQL)** provide ACID transactions — the reason they're the
  default for money, inventory, and anything where partial updates are unacceptable.
- **Durability** is implemented via a **write-ahead log** flushed on commit (recall memory vs disk).
- **Default isolation varies** (often Read Committed in PostgreSQL/Oracle/SQL Server; **MySQL/InnoDB
  defaults to Repeatable Read**); you raise it (or add locking) where double-booking-
  style bugs matter — at a throughput cost.
- **Distributed/NoSQL trade-offs:** spreading data across machines makes full ACID harder, so many
  systems offer weaker/tunable guarantees (the CAP theorem chapter explains why) — ACID vs BASE.

## Common misconception — "ACID = the database handles all correctness automatically"

ACID is powerful but bounded; you must actually *use* transactions and pick the right isolation.

```reveal
{
  "prompt": "A developer runs the debit and credit as two separate auto-committed statements (no explicit transaction) on an ACID database. Are they protected by atomicity?",
  "answer": "No. Each statement commits on its own, so a crash between them still loses money — atomicity only applies *within a transaction*. You must explicitly group the steps (BEGIN … COMMIT). Likewise, the default isolation level may allow concurrency anomalies unless you raise it or lock. ACID gives you the tools, but you have to wrap related operations in a transaction and choose the isolation that matches your correctness needs."
}
```

ACID guarantees apply **within properly-used transactions at the chosen isolation level** — it isn't
magic that makes any sequence of statements safe. You must group related operations and pick
isolation deliberately.

## Self-test

```quiz
{
  "question": "Which property guarantees that a committed transaction survives a subsequent crash?",
  "options": ["Atomicity", "Consistency", "Isolation", "Durability"],
  "answer": 3,
  "explanation": "Durability: once committed, the data is persisted to stable storage and survives crashes/power loss."
}
```

```quiz
{
  "question": "Raising the isolation level toward Serializable generally:",
  "options": [
    "Increases concurrency and throughput",
    "Reduces concurrency anomalies but can lower throughput",
    "Has no trade-offs",
    "Disables durability"
  ],
  "answer": 1,
  "explanation": "Stronger isolation prevents more anomalies but serializes more, trading throughput for safety."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "ACID properties — key terms", "cards": [ { "front": "Transaction", "back": "A group of operations treated as one logical unit: either the entire group takes effect or none of it does, and once committed it stays committed." }, { "front": "Atomicity", "back": "All steps of a transaction happen or none do. On failure the database rolls back partial changes, so there are no half-done transactions." }, { "front": "Consistency", "back": "A transaction moves the database from one valid state to another, keeping invariants/constraints (no negative balances, valid foreign keys, conserved totals)." }, { "front": "Isolation", "back": "Concurrent transactions don't corrupt each other's view; results are as if they ran sequentially, to the chosen isolation level." }, { "front": "Durability", "back": "Once a transaction is committed, the data is on stable storage (via write-ahead log / flush) and survives crashes and power loss." }, { "front": "Isolation levels", "back": "Read Committed, Repeatable Read, and Serializable trade more anomaly-prevention for less concurrency/throughput; Serializable is strongest but costs the most." } ] }
```

## Key takeaways

- A **transaction** is an all-or-nothing unit; **ACID** = **A**tomicity, **C**onsistency,
  **I**solation, **D**urability.
- **Atomicity** (rollback on failure) prevents half-done changes; **Durability** (WAL/flush) keeps
  committed data through crashes.
- **Isolation** is the subtle one: **isolation levels trade anomaly-prevention against throughput**.
- ACID applies **only within transactions you actually use** — group related operations and choose
  isolation deliberately; distributed systems often relax ACID (see CAP).

## Up next

Transactions and relationships rely on keys to identify and connect rows. Next: **Primary & Foreign
Keys**.
