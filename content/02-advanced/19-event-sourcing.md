---
title: "Event Sourcing"
slug: event-sourcing
level: advanced
module: distributed-transactions
order: 19
reading_time_min: 16
concepts: [event-sourcing, event-store, append-only, replay, snapshots, audit-log]
use_cases: []
prerequisites: [event-streaming-and-kafka, transactional-outbox, database-transactions]
status: published
---

# Event Sourcing

## Hook — a motivating scenario

A bank account row shows balance = $500. But *how* did it get there? Which deposits, withdrawals, fees,
reversals — in what order? With a normal table that stores only the **current state**, that history is
gone (overwritten on every update). For an auditable, debuggable, time-travelable system you want the
opposite: store **every change as an immutable event**, and derive the current state by replaying them.
That's **event sourcing**.

## Mental model — store the changes, not just the result

Normal storage keeps **current state**, overwriting on each update (the balance becomes $500; the
previous values are lost). **Event sourcing** instead stores an **append-only, immutable log of
events** — `Deposited $1000`, `Withdrew $400`, `Fee $100` — as the **source of truth**. The current
state is a **derived value**: fold (replay) the events to compute it (1000 − 400 − 100 = 500).

> The log of events *is* the database; current state is just a **projection** of it.

```flow
{
  "title": "Event-sourced account: events are truth, state is derived",
  "nodes": [
    { "label": "Command", "detail": "e.g. 'withdraw $400' — validated against current state." },
    { "label": "Append event", "detail": "Store immutable 'Withdrew $400' in the event store (never overwrite)." },
    { "label": "Event store (log)", "detail": "The append-only source of truth: every change, in order, forever." },
    { "label": "Projection / state", "detail": "Replay events → current balance (and any read views). Rebuildable anytime." }
  ],
  "note": "To get state, replay events. The history is never lost — it IS the data."
}
```

## Build it up — what it gives you

- **Complete audit trail / history:** every change is recorded immutably with its cause — invaluable
  for finance, compliance, and debugging ("how did we get into this state?").
- **Time travel:** reconstruct the state **as of any point** by replaying events up to that time.
- **Replay to rebuild / fix:** if a projection is buggy or you need a new read model, **rebuild it by
  replaying** the events (recall replay from event streaming).
- **Natural fit for events/CQRS:** the events you store are exactly what other services/read-models
  consume (pairs with **CQRS**, next chapter, and the **outbox**).

```reveal
{
  "prompt": "How does event sourcing let you build a brand-new read view (e.g. 'monthly spend per category') for data that's been live for years?",
  "answer": "Because the event store contains the full, ordered history of everything that ever happened — not just the current state — you can construct any new projection by replaying those events through new logic. To add 'monthly spend per category,' you write a projector that consumes the existing event stream from the beginning, categorizes each spend event, and accumulates per-month/per-category totals into a new read model. Since the events are immutable truth and retained, replaying them reproduces the exact historical sequence, so the new view is fully populated with years of back-data — something impossible if you'd only stored current balances (the historical detail would be gone). This is a superpower of event sourcing: read models are disposable, derived artifacts. You can add views you never anticipated, fix a bug in a projection by wiping and rebuilding it from events, or migrate to a new schema by replaying — all without touching the source of truth. It's the same 'retained log + replay' capability as event streaming (Kafka), applied to your domain state. The cost is that you must keep the full event history (or carefully snapshot) and that replaying large histories takes time (mitigated by snapshots), but the flexibility to derive any view from the complete past is exactly what storing changes-not-results buys you."
}
```

## Build it up — the costs and snapshots

Event sourcing is powerful but demanding:
- **Replay cost → snapshots:** replaying millions of events to get current state is slow. The fix is
  **snapshots**: periodically save the computed state (e.g. balance at event #1,000,000), then replay
  only events *after* the snapshot. (Recall Kafka log compaction — a related idea.)
- **Schema/event evolution:** events are immutable and kept forever, so you must handle **old event
  versions** (upcasting, versioned events) — you can't just "migrate" the past (recall serialization
  compatibility).
- **Querying is indirect:** you can't easily `SELECT` current state from raw events — you need
  **projections/read models** (hence CQRS). Eventual consistency between the event store and
  projections.
- **Complexity:** it's a major shift in how you model data; **overkill** for simple CRUD.

```reveal
{
  "prompt": "Why do event-sourced systems use snapshots, and what problem would arise without them?",
  "answer": "Because deriving current state requires replaying the entity's events from the beginning, and for a long-lived, high-activity entity that can be an enormous number of events. Without snapshots, every time you need the current state (e.g. to validate a new command against the latest balance, or to load an aggregate), you'd replay the entire history — potentially millions of events — which is slow and gets slower forever as more events accumulate, making each operation progressively more expensive (unbounded read/load latency). Snapshots fix this by periodically persisting the fully-computed state at a known point (say, the aggregate's state as of event #1,000,000). To get current state you then load the latest snapshot and replay only the events appended *after* it — a small, bounded number — instead of the whole history. This keeps state reconstruction fast and roughly constant regardless of how old the entity is. Snapshots are an optimization/cache, not the source of truth (the events remain authoritative, and you can always rebuild a snapshot by replaying), so they don't compromise event sourcing's guarantees — they just bound replay cost. Without them, event sourcing's replay-to-derive-state model would become impractically slow for any entity with a long history, which is why snapshotting (plus sometimes archiving very old events) is a standard part of production event-sourced systems."
}
```

## In the wild

- **Finance, accounting, audit-heavy domains** (where history/auditability is mandatory) and complex
  domains using **DDD** are classic event-sourcing fits.
- **Event stores:** EventStoreDB, Axon, Marten (Postgres), or Kafka used as an event log; pairs with
  **CQRS** (separate read models) almost always (next chapter).
- It underlies **time-travel/debugging**, rebuildable read models, and integration via the same events
  other services consume (recall outbox/streaming).
- **Snapshots + event versioning** are standard production concerns.

## Common misconception — "event sourcing is just keeping an audit log / a strictly better way to store data"

The events are the **source of truth** (a different model), and it's **overkill** for most CRUD.

```reveal
{
  "prompt": "How is event sourcing different from 'a normal database plus an audit log,' and why isn't it a default choice for all apps?",
  "answer": "With a normal database plus an audit log, the database's current-state tables are the source of truth and the audit log is a secondary, best-effort record of changes — the two can drift, the log might be incomplete, and the system functions even if the log is wrong. In event sourcing, the append-only event log IS the source of truth: there are no authoritative current-state tables to overwrite — current state is *derived* by replaying events, and read models/projections are disposable artifacts rebuilt from the log. That's a fundamentally different data model, not just an added log: writes are 'append an event,' reads come from projections, and history is intrinsic and authoritative rather than a side record. It's not a default choice because that power comes with substantial complexity and costs that most applications don't need: you must build and maintain projections to query anything (you can't simply SELECT current state from raw events), handle eventual consistency between the event store and read models, manage immutable event schema evolution (versioning/upcasting since you can't migrate the past), implement snapshots to bound replay cost, and shift your whole team's mental model. For ordinary CRUD apps where you mostly need current state and don't require full auditability, time travel, or rebuildable views, a normal database (optionally with an audit table or CDC) is far simpler and sufficient. Event sourcing shines specifically where complete history, auditability, temporal queries, and replay/rebuild flexibility are first-class requirements (finance, compliance, complex domains) — and is over-engineering elsewhere. So it's a deliberate architectural choice for those needs, not a strictly-better universal storage upgrade."
}
```

**Event sourcing** stores an **append-only log of immutable events as the source of truth**; current
state is a **derived projection** (replay events; use **snapshots** to bound cost). It gives full
**audit/history, time travel, and rebuildable views**, but adds **projection, event-versioning, and
complexity** — it's a deliberate choice for audit/temporal needs, **not** a default for simple CRUD.

## Self-test

```quiz
{
  "question": "In event sourcing, the source of truth is:",
  "options": [
    "The current-state table, with an audit log on the side",
    "An append-only log of immutable events; current state is derived by replaying them",
    "A cache",
    "The latest snapshot only"
  ],
  "answer": 1,
  "explanation": "Events are the truth; state is a projection computed by replaying them (snapshots just speed up replay). History is intrinsic, not a side log."
}
```

```quiz
{
  "question": "Snapshots are used in event sourcing to:",
  "options": [
    "Replace the event log as the source of truth",
    "Avoid replaying the entire history — load the latest snapshot and replay only events after it",
    "Encrypt events",
    "Delete old events permanently"
  ],
  "answer": 1,
  "explanation": "Snapshots bound replay cost: start from a saved state and replay only newer events; the event log remains authoritative."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Event sourcing — key terms", "cards": [
  { "front": "Event sourcing", "back": "Storing every change as an immutable, append-only event log that is the source of truth; current state is derived by replaying the events." },
  { "front": "Event store", "back": "The append-only log holding every event in order, forever — the authoritative source of truth, never overwritten." },
  { "front": "Projection / read model", "back": "A derived view computed by replaying events (e.g. current balance). Disposable and rebuildable; you query it instead of raw events." },
  { "front": "Replay", "back": "Folding events from the log to compute state, rebuild a buggy projection, or build a brand-new read view from full history." },
  { "front": "Snapshot", "back": "Periodically saved computed state at a point in the log; load it and replay only later events to bound replay cost. An optimization, not the source of truth." },
  { "front": "Event schema evolution", "back": "Because events are immutable and kept forever, old versions must be handled (versioned events, upcasting) — you can't migrate the past." }
] }
```

## Key takeaways

- **Event sourcing** stores an **append-only log of immutable events as the source of truth**; current
  state is a **derived projection** (replay to compute).
- It provides **full audit/history, time travel, and rebuildable read models** (replay to build new
  views or fix bugs) — and integrates naturally with events/CQRS/outbox.
- Costs: **replay cost (→ snapshots)**, **immutable event-schema evolution (versioning/upcasting)**,
  **indirect querying (→ projections/CQRS)**, and overall **complexity**.
- It's the **events-as-truth** model — not merely an audit log — and is **overkill for simple CRUD**;
  use it for audit/temporal/complex-domain needs.

## Up next

Event sourcing pushes you to separate writing events from reading state. That separation is its own
pattern. Next: **CQRS**.
