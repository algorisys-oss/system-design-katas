---
title: "Capstone — Design a Payment System"
slug: capstone-payment-system
level: advanced
module: advanced-capstones
order: 49
reading_time_min: 22
concepts: [payments, idempotency, exactly-once, saga, transactional-outbox, double-entry, reconciliation]
use_cases: []
prerequisites: [idempotency-and-safe-methods, saga-pattern, transactional-outbox, two-phase-commit, slis-slos-error-budgets]
status: published
---

# Capstone — Design a Payment System

## The payoff

The final capstone is the **opposite** of the key-value store: where that chose **availability**, a
**payment system** chooses **correctness above all** — money must never be lost, double-charged, or
created from nothing. It composes the **transactions & eventing** module with **idempotency** and
**reliability**: idempotency keys, sagas, the transactional outbox, double-entry ledgers, and
reconciliation. The recurring theme: **at-least-once delivery + idempotency = effectively-once**, and
**correctness beats availability** when it's someone's money.

## 1 · Clarify requirements

**Functional:** charge a customer, move money between accounts, handle refunds — coordinating an external
**payment provider** (Stripe/bank) and internal accounts.

**Non-functional (correctness-first):**
- **No double-charge, no lost money, no money created:** the system must be **exactly-once in effect** for
  financial operations — the strictest correctness bar.
- **Auditable:** every movement must be traceable (regulatory + debugging).
- **Consistent over available (CP-leaning):** if unsure, it's better to **reject/hold** than to risk a
  wrong charge (recall CAP — the opposite choice from the KV store).
- **Resilient:** survive crashes/retries/provider timeouts **without** duplicating or losing money.

```reveal
{
  "prompt": "Why does a payment system make the opposite top-level choice (correctness/consistency over availability) from the Dynamo-style KV store, and how does that flip the design?",
  "answer": "Because the cost of being wrong is asymmetric and severe: a payment that's double-charged, lost, or created from nothing is real financial harm, fraud exposure, regulatory/compliance failure, and broken trust — far worse than a request being briefly unavailable or rejected. So the top requirement is exactly-once-in-effect correctness and auditability, and when the system is uncertain it must prefer to reject or hold (fail safe) rather than risk an incorrect money movement — a CP-leaning, consistency-over-availability stance (recall CAP). The KV store made the opposite call: 'always writable' (AP), accepting eventual consistency and conflict resolution because for a shopping cart a brief inconsistency or a merged conflict is acceptable and availability is paramount. That single inversion flips the whole design. The KV store embraced leaderless quorums, sloppy quorums, vector-clock conflicts, and eventual convergence to stay available; the payment system instead embraces strong consistency and careful coordination to stay correct: ACID transactions and a double-entry ledger as the source of truth (so money is conserved and balanced), idempotency keys so retries/duplicates don't double-apply (at-least-once + idempotency = effectively-once), sagas with compensation for multi-step cross-service flows (since you can't 2PC an external provider), the transactional outbox for reliable, atomic event emission, and reconciliation against the provider to detect/repair any discrepancy. Where the KV store tolerates and resolves conflicts after the fact, the payment system prevents incorrect states up front and verifies them after. Where the KV store stays up no matter what, the payment system would rather pause/hold/reject a transaction than commit a possibly-wrong one. So the requirement 'never get the money wrong' cascades into idempotency, exactly-once semantics, transactional integrity, auditability, and fail-safe behavior — a fundamentally CP, correctness-first architecture, opposite to the AP, availability-first KV store. Same toolkit (distributed systems), opposite priorities, opposite designs — driven entirely by what failure costs."
}
```

## 2 · The core challenge: exactly-once money movement

The defining problem: networks are unreliable, so clients and services **retry** — but retrying a
**charge** could **double-charge**. True exactly-once *delivery* is impossible (recall messaging), so you
engineer **exactly-once in effect** = **at-least-once delivery + idempotency**:
- **Idempotency keys (recall):** the client generates a unique key per payment intent and sends it with
  every (re)try. The payment service records the key with the result; a **repeat with the same key
  returns the original result instead of charging again**. This is the single most important payment
  pattern.
- **Idempotency end-to-end:** the **payment provider** (Stripe et al.) also accepts idempotency keys — so
  even your call *to them* is safe to retry without double-charging.

```sequence
{
  "title": "Idempotent charge survives a retry (no double-charge)",
  "actors": ["Client", "PaymentSvc", "Ledger", "Provider"],
  "steps": [
    { "from": "Client", "to": "PaymentSvc", "label": "charge $50 (idempotency-key=abc)" },
    { "from": "PaymentSvc", "to": "Ledger", "label": "key abc unseen → record intent + charge" },
    { "from": "PaymentSvc", "to": "Provider", "label": "charge w/ same key abc (provider also idempotent)" },
    { "from": "Client", "to": "PaymentSvc", "label": "TIMEOUT → retry charge (idempotency-key=abc)" },
    { "from": "PaymentSvc", "to": "Client", "label": "key abc seen → return ORIGINAL result (no 2nd charge)" }
  ]
}
```

```reveal
{
  "prompt": "Walk through how an idempotency key prevents a double-charge when a client times out and retries a payment it can't tell succeeded.",
  "answer": "The fundamental problem: after sending a charge, the client may get a timeout or network error and genuinely not know whether the charge succeeded (the request may have been processed but the response lost). If it retries naively, it risks charging twice; if it doesn't retry, it risks never charging. An idempotency key resolves this. (1) The client generates ONE unique idempotency key for this payment intent (e.g. a UUID tied to the cart/order) and includes it on the FIRST request and on every retry of that same intent. (2) On the first request, the payment service checks its store for that key, finds it unseen, and atomically records the key along with processing the charge (ideally recording the key + result in the same transaction as the ledger entry — the transactional inbox/idempotent-consumer idea), then performs the charge (calling the provider with the SAME key so the provider is also idempotent). (3) If the client times out and retries with the same key, the payment service looks it up, finds the key ALREADY recorded, and instead of charging again it returns the stored ORIGINAL result (success/failure + details) of the first attempt. So the second (and any further) retries are no-ops that simply return the first outcome — exactly-once in effect despite at-least-once delivery. Crucially the recording of the key must be atomic with the effect (so you can't charge-then-crash-before-recording, which would let a retry double-charge, nor record-then-crash-before-charging, which would skip the charge) — same atomicity lesson as the transactional inbox. End-to-end, the key is also passed to the external provider, which maintains its own idempotency, so even your service's retry of the provider call doesn't double-charge at the bank. The result: the client can safely retry as many times as needed until it gets a definitive response, and the customer is charged exactly once. This 'unique key + record-and-dedup atomically + return prior result on repeat' is the cornerstone pattern of payment systems, turning the inherently unreliable, retry-prone network into safe, exactly-once-in-effect money movement."
}
```

## 3 · High-level design: ledger + outbox + saga

```flow
{
  "title": "Payment system architecture (correctness-first)",
  "nodes": [
    { "label": "Payment service + idempotency store", "detail": "Dedupes by idempotency key; orchestrates the charge; records intent/result." },
    { "label": "Double-entry ledger (source of truth)", "detail": "Every movement = balanced debit+credit in one ACID transaction; money is conserved + auditable." },
    { "label": "Transactional outbox", "detail": "Emit 'payment succeeded/failed' events atomically with the ledger write (no dual-write — recall outbox)." },
    { "label": "Saga orchestrator", "detail": "Coordinates multi-step flows (reserve → charge → fulfill) with compensation on failure (recall saga)." },
    { "label": "Reconciliation job", "detail": "Periodically compares internal ledger vs provider records; flags/repairs discrepancies." }
  ],
  "note": "Idempotency (no dup) + double-entry ledger (money conserved) + outbox (reliable events) + saga (multi-step) + reconciliation (verify)."
}
```

- **Double-entry ledger** = the source of truth: each transaction records **balanced debit + credit** in
  **one ACID transaction** (recall ACID), so money is **conserved** (sums to zero) and every movement is
  **auditable** — you never just "set a balance."
- **Transactional outbox (recall):** emit payment events **atomically with** the ledger write (no
  dual-write problem), so downstream (fulfillment, notifications) reliably react.
- **Saga (recall):** multi-step flows (reserve funds → charge → fulfill → release) use **local
  transactions + compensations** (refund/release on failure) — since you **can't 2PC an external
  provider** (recall 2PC's limits).

```reveal
{
  "prompt": "Why use a double-entry ledger (balanced debits/credits) as the source of truth instead of just storing and updating account balances?",
  "answer": "Because a double-entry ledger makes money conservation, auditability, and correctness structural rather than hopeful. In double-entry, every financial event is recorded as one or more balanced entries — every debit has an equal and opposite credit — committed together in a single ACID transaction, and an account's balance is DERIVED from the sum of its entries (often with periodic snapshots), not stored and mutated directly. This gives several critical properties a 'just update the balance' approach lacks: (1) Money is conserved by construction — because debits and credits always net to zero, money can't be created or destroyed by a bug; the books always balance, and you can assert that invariant (sum of all entries = 0) as a check. With mutable balances, a partial failure or bug can credit one account without debiting another, silently creating or losing money. (2) Complete, immutable audit trail — the ledger is an append-only history of every movement with its cause, which is exactly what regulators, accountants, dispute resolution, and debugging require ('how did this balance come to be?'); mutable balances overwrite history and answer nothing. (3) Atomicity of a transfer — moving money between accounts is a single transaction containing both the debit and the credit, so it's all-or-nothing; you never see one side without the other. (4) Reconstructability and verification — because balances are derived from entries, you can recompute them, detect tampering/corruption, and reconcile against external providers entry-by-entry. (5) Natural support for holds/pending/reversals — refunds and reversals are new compensating entries, preserving the full history (you don't erase the original charge). Storing and mutating raw balances is simpler but fragile and unauditable: it conflates 'current state' with 'truth,' loses history, makes conservation a matter of every code path being perfect, and turns a single missed update into lost or invented money with no trail to find it. For a system where correctness and auditability are paramount and the cost of error is real money plus compliance failure, the double-entry ledger is the standard precisely because it bakes conservation and auditability into the data model — the source of truth is the immutable, always-balanced history, and balances are just a view of it. (This pairs with idempotency to prevent duplicate entries and with reconciliation to verify against the provider.)"
}
```

## 4 · Verifying correctness: reconciliation

Even with idempotency and ACID, distributed reality means your records and the **provider's** can drift
(a timeout where you don't know if the charge went through, a missed webhook). So payment systems run
**reconciliation**: periodically **compare the internal ledger against the provider's records** (and bank
statements), **flagging and repairing discrepancies**. It's the financial analogue of **anti-entropy**
(recall) — a background verify-and-repair that catches what the happy path missed, because **"probably
correct" isn't good enough for money**.

```reveal
{
  "prompt": "Why is reconciliation necessary even after you've built idempotency, ACID ledgers, and sagas — and how is it analogous to anti-entropy?",
  "answer": "Because distributed systems crossing a trust/process boundary (your system ↔ an external payment provider/bank) can always diverge in ways your internal mechanisms can't fully prevent, and for money 'probably correct' is unacceptable — you must VERIFY, not assume. Idempotency prevents duplicate processing, ACID ledgers keep your internal books balanced and atomic, and sagas coordinate multi-step flows with compensation — but none of these guarantee that your records MATCH the provider's, because: a charge may succeed at the provider while you get a timeout and don't learn the outcome; a webhook/callback confirming a payment may be lost or delayed; the provider may settle/refund/dispute asynchronously; clock/ordering differences, partial failures, or bugs can leave your ledger and the provider's records out of sync; and money you think moved may not have (or vice versa). Reconciliation handles this by periodically fetching the provider's records (and bank settlement statements) and comparing them line-by-line against your internal ledger, flagging discrepancies (a charge they have that you don't, or you have that they don't, amount mismatches, missing refunds) and repairing them (recording missed entries, investigating, holding/correcting), so the two sources of truth converge and any error is caught and fixed rather than silently persisting. It's directly analogous to anti-entropy in distributed datastores: just as replicas inevitably diverge (lost messages, downtime, missed updates) and you run background processes (read repair, Merkle-tree comparison) to detect and reconcile differences and guarantee eventual convergence, payment systems treat their ledger and the provider's ledger as two 'replicas' of financial truth that can drift, and run a background compare-and-repair to converge them. In both cases the principle is the same: the happy path plus careful per-operation correctness reduces but cannot eliminate divergence across an unreliable distributed boundary, so you add a systematic background verification that catches and fixes what slipped through. For money, reconciliation is non-negotiable because the stakes demand provable, audited correctness — you continuously prove the books match reality rather than trusting that they do. It's the safety net that turns 'each operation should be correct' into 'the whole system is verified correct over time.'"
}
```

## 5 · Trade-offs and method recap

- **Correctness over availability (CP-leaning):** when uncertain, **hold/reject** rather than risk a wrong
  charge — the opposite of the KV store's AP choice (recall CAP). Money's asymmetric cost justifies it.
- **Exactly-once in effect = at-least-once + idempotency** (recall): the central pattern — idempotency
  keys end-to-end, plus the **transactional inbox/outbox** for reliable, dedup'd processing.
- **Layered correctness:** **idempotency** (no dup) + **double-entry ledger** (conserved/auditable) +
  **saga** (multi-step + compensation) + **outbox** (reliable events) + **reconciliation** (verify) —
  defense in depth for money.
- **Method recap:** requirements (correctness was decisive) → exactly-once challenge → design (ledger +
  idempotency + outbox + saga) → verify (reconciliation) → trade-offs. Compare with the KV capstone:
  **same toolkit, opposite priorities** — the essence of system design.

Slide the dial to see how the same toolkit serves opposite priorities, from the KV store's stance to the payment system's:

```tradeoff
{ "title": "When uncertain, stay available or stay correct?", "axis": { "left": "Availability-first (AP)", "right": "Correctness-first (CP)" }, "steps": [ { "label": "Always writable (KV store)", "detail": "The Dynamo-style KV store stays available no matter what, accepting eventual consistency and conflict resolution — a brief inconsistency in a cart is acceptable." }, { "label": "Tolerate then reconcile", "detail": "Embrace at-least-once delivery and idempotency so retries are safe, and verify after the fact — accept some divergence as long as it's caught and repaired." }, { "label": "Hold or reject when unsure", "detail": "When the system is uncertain (e.g. a provider timeout), it prefers to hold or reject rather than risk a wrong charge — fail safe toward correctness." }, { "label": "Provably correct, audited", "detail": "Money must never be lost, double-charged, or created; double-entry ledgers, idempotency, and reconciliation make conservation and auditability structural — correctness above all." } ] }
```

## Self-test

```quiz
{
  "question": "The cornerstone technique that prevents double-charging when clients retry payments is:",
  "options": [
    "Two-phase commit with the bank",
    "Idempotency keys — a unique key per payment intent so a repeat returns the original result instead of charging again",
    "Caching the response",
    "Vector clocks"
  ],
  "answer": 1,
  "explanation": "Idempotency keys (end-to-end, including to the provider) make retries safe: the same key returns the first result — exactly-once in effect (at-least-once + idempotency)."
}
```

```quiz
{
  "question": "Why use a double-entry ledger as the source of truth?",
  "options": [
    "It's faster than a balance column",
    "Balanced debits/credits in one ACID transaction conserve money (sums to zero) and give a complete, auditable history — balances are derived",
    "It avoids needing idempotency",
    "It makes the system AP"
  ],
  "answer": 1,
  "explanation": "Double-entry bakes in money conservation and auditability; balances are derived from immutable balanced entries, not mutated directly."
}
```

```quiz
{
  "question": "Reconciliation in a payment system is analogous to which distributed-systems concept?",
  "options": [
    "Load balancing",
    "Anti-entropy — a background compare-and-repair (internal ledger vs provider records) that catches/fixes divergence the happy path missed",
    "Sharding",
    "Caching"
  ],
  "answer": 1,
  "explanation": "Like anti-entropy reconciling replicas, reconciliation compares your ledger against the provider's and repairs discrepancies — 'probably correct' isn't enough for money."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Payment system design — key terms", "cards": [ { "front": "Exactly-once in effect", "back": "Since exactly-once delivery is impossible, payments combine at-least-once delivery with idempotency so retries/duplicates don't double-apply — effectively-once money movement." }, { "front": "Idempotency key", "back": "A unique key per payment intent sent on every (re)try; the service records key + result and returns the original result on a repeat instead of charging again." }, { "front": "Double-entry ledger", "back": "The source of truth: each movement is a balanced debit + credit in one ACID transaction, so money is conserved (sums to zero), auditable, and balances are derived, not mutated." }, { "front": "Transactional outbox", "back": "Emit payment events atomically with the ledger write (no dual-write), so downstream fulfillment and notifications reliably react to a committed payment." }, { "front": "Saga", "back": "Multi-step flows (reserve → charge → fulfill → release) using local transactions plus compensations on failure, since you can't 2PC an external provider." }, { "front": "Reconciliation", "back": "A background job comparing the internal ledger against the provider's records, flagging and repairing drift — the financial analogue of anti-entropy." } ] }
```

## Key takeaways

- A **payment system** chooses **correctness over availability** (CP-leaning) — never double-charge, lose,
  or invent money — the **opposite** of the AP key-value store (recall CAP); money's asymmetric cost
  justifies it.
- The core challenge is **exactly-once money movement** = **at-least-once delivery + idempotency** —
  **idempotency keys end-to-end** (and to the provider) are the cornerstone (+ transactional inbox/outbox).
- Design = **double-entry ledger** (conserved, auditable source of truth) + **transactional outbox**
  (reliable events) + **saga** (multi-step flows with compensation, since you can't 2PC a provider) +
  **idempotency** (dedup).
- **Reconciliation** (the financial **anti-entropy**) verifies internal records vs the provider and
  repairs drift — "probably correct" isn't enough. **Same toolkit as the KV store, opposite priorities** —
  the essence of system design.

## You've completed the Advanced path — and the course 🎉

You can now reason about distributed systems end to end: **correctness & consensus, replication &
anti-entropy, distributed transactions, storage internals, global scale, resilience, and operability** —
and compose them into real designs. The two capstones make the deepest point of all: there's **no single
"best" architecture** — a key-value store optimizes for **availability**, a payment system for
**correctness**, using the **same toolkit** guided by **what failure costs**. That judgment —
trade-offs driven by requirements — is what system design *is*.
