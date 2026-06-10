---
title: "CQRS"
slug: cqrs
level: advanced
module: distributed-transactions
order: 20
reading_time_min: 14
concepts: [cqrs, command-query-separation, read-model, write-model, projections, eventual-consistency]
use_cases: []
prerequisites: [event-sourcing, database-reads-vs-writes, caching-patterns-overview]
status: published
---

# CQRS

## Hook — a motivating scenario

Your app's **writes** are simple per-entity updates (place order, update profile), but its **reads**
are complex, varied, and high-volume (dashboards joining many entities, search, analytics). Forcing
both through **one model and one schema** means every read fights the write-optimized design (and vice
versa): the normalized write schema makes reads do expensive joins, while read indexes slow writes.
**CQRS** says: stop sharing — use **separate models for commands (writes) and queries (reads)**.

## Mental model — split the write side from the read side

**CQRS (Command Query Responsibility Segregation)** separates the **write model** (commands that change
state) from the **read model** (queries that return data) — they become **different models, often
different data stores**, optimized independently. Writes go to a normalized, consistency-focused write
store; reads are served from one or more **denormalized read models (projections)** shaped exactly for
the queries they answer. The read side is kept in sync with the write side **asynchronously** (often via
events — recall pub/sub, outbox, event sourcing).

Think of a restaurant: the **kitchen** (write side) is laid out to *prepare dishes correctly and
consistently* — raw ingredients, prep stations, recipes — while the **menu and display boards** (read
side) are shaped for *diners to browse quickly*: denormalized, grouped, photographed, nothing like the
kitchen's internal layout. The two are deliberately different, and the menu is brought in sync **after**
each dish is ready, not in lockstep with every chop and stir.

```flow
{
  "title": "CQRS: separate write and read paths",
  "nodes": [
    { "label": "Command", "detail": "Write request → validated, applied to the write model (normalized, consistency-focused)." },
    { "label": "Write store", "detail": "Source of truth for writes; emits change events." },
    { "label": "Projector", "detail": "Consumes events; updates read models asynchronously." },
    { "label": "Read model(s)", "detail": "Denormalized views optimized per query (search index, dashboard table, cache)." }
  ],
  "note": "Writes and reads scale and evolve independently; read models are rebuilt from events."
}
```

## Build it up — why separate, and the eventual-consistency cost

```compare
{
  "options": [
    { "label": "Single model (CRUD)", "points": ["One schema for reads + writes", "Simple; fine for most apps", "Reads & writes compromise each other at scale", "One store to keep consistent"] },
    { "label": "CQRS", "points": ["Separate write model + read model(s)", "Each optimized + scaled independently", "Read side updated async → eventually consistent", "More moving parts (projectors, multiple stores)"] }
  ]
}
```

Benefits: **independent optimization** (normalized writes; denormalized, query-shaped reads — no joins
at read time), **independent scaling** (read models on read-optimized stores/replicas/caches — recall
reads-vs-writes), and **multiple tailored read models** from the same writes (a search index, a
reporting table, a cache — each a projection).

The cost is **eventual consistency between write and read sides**: after a command commits, the read
model updates **a moment later** (async projection), so a read right after a write may not reflect it
(recall read-your-writes — you handle it explicitly).

```reveal
{
  "prompt": "A user updates their profile (command) and the next page read shows the OLD profile. Why does this happen under CQRS, and how do you handle it?",
  "answer": "Because CQRS keeps the read model separate and updates it asynchronously from the write model. When the command commits to the write store, an event is emitted and a projector updates the read model — but that happens a moment later, so a read issued immediately after the write may hit a read model that hasn't been updated yet (eventual consistency between write and read sides). It's the same read-your-writes problem as replication lag, now between the command store and the query store. Ways to handle it: (1) read-your-writes UX — after a command, briefly read from the write model/source of truth for that user, or have the client optimistically show the value it just submitted; (2) return the new state (or a version/token) from the command and have the client wait until the read model catches up to that version before reading; (3) make projection fast/synchronous for critical paths (at a latency cost) while keeping the rest async; (4) accept and design for the small staleness window where it's harmless. The key is to acknowledge CQRS trades immediate read-after-write consistency for the benefits of separate, optimized read/write models — and to add read-your-writes handling only where the staleness would confuse users (like their own profile), rather than forcing global synchronous projection everywhere."
}
```

How fresh the read side is depends on how synchronously you project — a dial from fully async to synchronous on critical paths:

```tradeoff
{ "title": "How synchronously should projections update the read model?", "axis": { "left": "Fully async", "right": "Synchronous on critical paths" }, "steps": [
  { "label": "Fully async projection", "detail": "Commands commit fast; projectors update read models a moment later. Maximum independence and scaling, but a read right after a write may be stale (eventual consistency)." },
  { "label": "Version/token wait", "detail": "Command returns a version the client waits for before reading. Keeps projection async yet lets a caller confirm the read model caught up to its own write." },
  { "label": "Read source of truth for that user", "detail": "After a command, briefly read from the write model for that user (read-your-writes UX), so their own change is never stale while others stay async." },
  { "label": "Synchronous projection", "detail": "Project critical paths synchronously for immediate read-after-write consistency, at a latency cost — applied only where staleness would confuse users, not globally." }
] }
```

## Build it up — CQRS, event sourcing, and when to use it

- **CQRS pairs naturally with event sourcing** (previous chapter): the events are the write model's
  output, and **projections** build the read models by consuming them — rebuildable, multiple views.
  But **CQRS doesn't require event sourcing** (you can project from a normal write DB via Change Data
  Capture (CDC — streaming the write DB's row-level changes as events)),
  and event sourcing doesn't strictly require CQRS (though it nearly always uses it for querying).
- **When to use:** read and write workloads are **very different/asymmetric**, you need **multiple
  specialized read models**, or read/write scaling differs hugely. **When not to:** simple CRUD where
  reads and writes share a model fine — CQRS's extra moving parts (projectors, multiple stores,
  eventual consistency) are **overkill**.

```reveal
{
  "prompt": "When is CQRS worth its added complexity, and when is it over-engineering?",
  "answer": "It's worth it when reads and writes are genuinely asymmetric or conflicting enough that a single shared model hurts. Strong signals: very different read vs write shapes (simple per-entity writes but complex, multi-entity, varied reads like dashboards/search/reporting) where one schema can't serve both well; vastly different scaling needs (e.g. read-heavy by 100:1, wanting read models on caches/replicas/search engines independent of the write store); the need for multiple tailored read models from the same data (a search index, a denormalized dashboard table, an analytics view); or pairing with event sourcing, where projections are the natural way to query. In those cases CQRS lets each side be optimized, scaled, and evolved independently, which outweighs the overhead. It's over-engineering when you have ordinary CRUD with similar, modest read/write patterns that one model serves comfortably — there, CQRS adds real cost for no benefit: extra components (projectors), multiple data stores to operate and keep in sync, and eventual consistency between write and read sides (with the read-your-writes complications). You also don't need full CQRS to get some of its benefits — a read replica or a cache in front of one model handles many read-scaling cases without splitting the model. So adopt CQRS deliberately when the read/write asymmetry, multiple-read-model need, or event-sourcing pairing justifies the moving parts; default to a single model (plus replicas/caching) for typical apps. Like event sourcing, it's a targeted architectural choice, not a universal upgrade."
}
```

## In the wild

- **Used with event sourcing** in complex/DDD domains; also standalone where read/write needs diverge.
- **Read models** are commonly a **search index (Elasticsearch), a denormalized SQL/NoSQL table, or a
  cache** — each a projection updated via events/CDC (recall outbox, streaming).
- It's a generalization of patterns you've seen: **read replicas** and **materialized views** are
  lightweight steps toward CQRS (separate read-optimized copies).
- Many systems apply CQRS **partially** — only for the few areas with strong read/write asymmetry —
  rather than everywhere.
- The pattern is documented as a canonical reference in the **Microsoft Azure Architecture Center**
  ("CQRS pattern"), which describes exactly this split — a write store plus separately-shaped read
  models kept in sync asynchronously — and is widely used to back e-commerce catalogs and order systems
  where reads vastly outnumber writes (read:write ratios in the order of 10:1 to 100:1 are typical).

## Common misconception — "CQRS just means using a read replica / you should apply it everywhere"

It's separate *models*, not just a replica — and it's a targeted choice, not a default.

```reveal
{
  "prompt": "Why is CQRS more than 'use a read replica,' and why shouldn't you apply it across an entire application by default?",
  "answer": "A read replica is the SAME data model/schema copied to another node for read scaling — reads and writes still share one model. CQRS goes further: it uses a DIFFERENT read model from the write model — a separately-designed, usually denormalized representation (or several) shaped for specific queries, populated asynchronously via events/projections, possibly in a different kind of store (search index, document store, cache, reporting DB). So CQRS changes the modeling, not just the topology: you design commands and the write model for consistency, and independent read models for query performance, accepting eventual consistency between them. That's why it's more powerful (tailored, independently-scaled read views; multiple views from one write source) but also more complex (projectors to build/maintain, multiple stores, sync and eventual-consistency handling). You shouldn't apply it everywhere by default because most parts of an app have symmetric, modest read/write needs that a single model serves simply; blanket CQRS multiplies components and consistency headaches for no benefit. The pragmatic approach is to keep a single model (optionally with replicas/caching for read scaling — the lighter tools) for the bulk of the system, and reserve true CQRS for the specific bounded contexts where read/write asymmetry, multiple specialized read models, or event sourcing make the separation pay off. So: CQRS ≠ read replica (it's separate models), and it's a selective, deliberate pattern, not an everywhere-default."
}
```

**CQRS** separates the **write model (commands)** from the **read model(s) (queries)** — different,
independently-optimized models kept in sync **asynchronously** (eventual consistency). It enables
tailored, independently-scaled reads and pairs naturally with **event sourcing** — but it adds
**projectors, multiple stores, and eventual consistency**, so it's a **targeted** choice (not a read
replica, not a default).

## Self-test

```quiz
{
  "question": "CQRS fundamentally means:",
  "options": [
    "Adding a read replica of the same schema",
    "Using separate models (and often stores) for writes (commands) and reads (queries), optimized independently",
    "Caching all queries",
    "Storing events as the source of truth"
  ],
  "answer": 1,
  "explanation": "CQRS = separate write and read models, each optimized/scaled on its own; read models are projections kept in sync asynchronously."
}
```

```quiz
{
  "question": "The main trade-off CQRS introduces is:",
  "options": [
    "Writes become impossible",
    "Eventual consistency between the write side and the asynchronously-updated read model(s)",
    "It removes the ability to query",
    "It requires synchronized clocks"
  ],
  "answer": 1,
  "explanation": "Read models update asynchronously after writes, so reads can briefly be stale (read-your-writes must be handled), plus more moving parts."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "CQRS — key terms", "cards": [
  { "front": "CQRS", "back": "Command Query Responsibility Segregation: separate the write model (commands that change state) from the read model(s) (queries), as different models and often different stores, optimized independently." },
  { "front": "Write model", "back": "The command side — normalized, consistency-focused store that is the source of truth for writes and emits change events." },
  { "front": "Read model (projection)", "back": "A denormalized view shaped exactly for the queries it answers (search index, dashboard table, cache), kept in sync from the write side asynchronously." },
  { "front": "Projector", "back": "Component that consumes change events from the write side and updates the read model(s) asynchronously; lets read models be rebuilt from events." },
  { "front": "Eventual consistency cost", "back": "The read model updates a moment after a command commits, so a read right after a write may be stale — the read-your-writes problem between command and query stores." },
  { "front": "When CQRS is overkill", "back": "Simple CRUD with symmetric, modest read/write needs one model serves fine — its projectors, multiple stores, and eventual consistency add cost for no benefit." }
] }
```

## Key takeaways

- **CQRS** separates the **write model (commands)** from the **read model(s) (queries)** — different,
  independently-optimized models/stores.
- Benefits: **independent optimization & scaling** (normalized writes; denormalized query-shaped reads)
  and **multiple tailored read models** (search/dashboard/cache) from the same writes.
- Cost: **eventual consistency** between write and read sides (async projection → handle read-your-
  writes) plus **more moving parts** (projectors, multiple stores).
- It **pairs naturally with event sourcing** (projections from events) but neither requires the other;
  it's a **targeted** pattern (≠ read replica), **overkill for simple CRUD**.

## Up next

That completes distributed transactions & eventing. Next module dives into how databases physically
store and lay out data. First: **LSM Trees & Compaction**.
