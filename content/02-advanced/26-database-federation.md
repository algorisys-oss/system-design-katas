---
title: "Database Federation"
slug: database-federation
level: advanced
module: storage-internals
order: 26
reading_time_min: 13
concepts: [federation, functional-partitioning, split-by-domain, cross-database-joins, sharding-contrast]
use_cases: []
prerequisites: [database-sharding, monoliths-vs-microservices, polyglot-persistence]
status: published
---

# Database Federation

## Hook — a motivating scenario

One giant database holds users, products, orders, and analytics — and it's straining. You could
**shard** (split the same data across nodes by key), but there's a simpler first move when your *tables*
belong to different concerns: give each **functional area its own database** — a users DB, a products
DB, an orders DB. That's **database federation** (functional partitioning) — splitting **by feature/
domain** rather than by row.

## Mental model — split by function, not by key

**Database federation** (a.k.a. **functional partitioning**) divides a database into **multiple
databases by function/domain** — each owning a distinct set of tables for a business area. Contrast with
**sharding**, which splits **one table's rows** horizontally across nodes by a shard key.

**Analogy:** picture one overstuffed office filing cabinet. *Federation* is splitting it into separate
cabinets **per department** — an HR cabinet, a Finance cabinet, a Sales cabinet — each department owns
its own cabinet with its own kinds of folders. *Sharding* is taking one **single** overflowing cabinet
(say, all customer folders) and dividing **those same folders alphabetically** across several identical
cabinets. Federation splits by *what kind of thing*; sharding splits one kind of thing by *which one*.

- **Sharding** = same data shape, **split by row** (users 1–1M here, 1M–2M there).
- **Federation** = different data, **split by feature** (users DB | products DB | orders DB).

```flow
{
  "title": "Federation: each domain gets its own database",
  "nodes": [
    { "label": "Users service → Users DB", "detail": "Accounts, profiles, auth — its own database." },
    { "label": "Products service → Products DB", "detail": "Catalog, inventory — separate database." },
    { "label": "Orders service → Orders DB", "detail": "Orders, payments — separate database." },
    { "label": "No shared DB", "detail": "Each domain's data + load isolated; scale/operate independently." }
  ],
  "note": "Split by FUNCTION (feature/domain), not by row (shard key). Aligns with service boundaries."
}
```

## Build it up — what it buys and what it costs

**Benefits:**
- **Load isolation & independent scaling:** each functional DB handles only its domain's traffic; a
  heavy analytics DB doesn't starve the orders DB. Each can be sized/tuned/scaled on its own.
- **Smaller, simpler databases:** each is smaller, with a focused schema — easier to manage, back up,
  and reason about.
- **Aligns with microservices:** each service owns its database (recall: services shouldn't share a DB)
  — federation is the data side of decomposition.

**Costs — the big one is cross-database operations:**
- **No cross-database joins or transactions:** you can no longer `JOIN orders` with `users` in SQL, or
  wrap a change to both in one ACID transaction (recall: no ACID across systems). You must join **in
  the application** (fetch from each) or denormalize, and coordinate cross-domain changes with
  **sagas/outbox** (recall).
- **More databases to operate** (the polyglot/ops cost from the previous chapter).

```reveal
{
  "prompt": "After federating into users / products / orders databases, a report needs each order with its customer's name and the product titles. Why is this now hard, and how do you do it?",
  "answer": "Because the data lives in three separate databases, you can no longer write a single SQL query that JOINs orders, users, and products — joins (and transactions) only work within one database, and federation deliberately split these by function. So the cross-domain join that was trivial in one big DB is now impossible at the database level. You handle it in one of a few ways: (1) Application-side join — query the orders DB for the orders, collect the user_ids and product_ids, then batch-fetch names from the users DB and titles from the products DB and stitch the results together in code (mind the N+1 problem: fetch in batches, not per-row). (2) Denormalization — store the data you frequently need together: e.g. copy the customer name and product title onto the order record at order time (orders are largely immutable history, so this is natural), so the report reads from one place. (3) A read model / CQRS projection — maintain a separate reporting store/materialized view that consumes events from each domain (via outbox/CDC) and pre-joins them for queries, accepting eventual consistency. (4) A data warehouse/ETL for heavy analytics — periodically copy each domain's data into an analytics store where cross-domain queries run. Which to use depends on freshness and frequency: occasional report → application-side join or warehouse; hot path needing the combined view → denormalize or a CQRS read model. The key point is that federation trades the convenience of cross-table joins/transactions for load isolation and independent scaling, so you move cross-domain composition into the application or into purpose-built read models, and coordinate cross-domain writes with sagas/outbox rather than distributed transactions."
}
```

## Build it up — federation vs sharding (and using both)

They solve different problems and **compose**:
- Reach for **federation** first when your single DB's load comes from **distinct functional areas** —
  splitting by domain is simpler than sharding and often enough (and it's the natural data boundary for
  microservices).
- Reach for **sharding** when a **single domain's table** is too big/hot to fit one node (e.g. the
  orders table alone is enormous) — split that table by key.
- **Large systems do both:** federate into per-domain databases, then **shard** the ones that
  individually outgrow a node (the orders DB sharded by order_id). Federation handles "different
  things"; sharding handles "too much of one thing."

```reveal
{
  "prompt": "When should you federate vs shard, and why might a large system need both?",
  "answer": "Federate (functional partitioning) when the load and size come from distinct functional areas — users, products, orders, analytics — that happen to share one database. Splitting by domain gives each its own DB, isolating load and letting each scale/operate independently; it's simpler than sharding, requires no shard-key design, and aligns with service boundaries (each microservice owns its data). It's the natural first move and often sufficient. Shard (horizontal partitioning) when a SINGLE domain's table is itself too large or too hot for one node — e.g. the orders table has billions of rows or write throughput beyond one machine. Sharding splits that one table's rows across nodes by a shard key, addressing 'too much of one thing.' A large system needs both because the two problems are orthogonal: federation separates different concerns (so the analytics workload doesn't crush orders, and teams own their domains), but it doesn't help when one domain alone exceeds a node's capacity; sharding scales a single hot dataset, but doesn't address mixing unrelated workloads in one DB. So you typically federate first into per-domain databases, then shard whichever federated databases individually outgrow a node (e.g. orders DB sharded by order_id, while the small products DB stays unsharded). Federation = split by function ('different things'); sharding = split by key ('too much of one thing'); combined, they let each domain scale on its own axis. Both also bring their costs (no cross-DB joins/transactions for federation; cross-shard query/transaction complexity for sharding), so apply each only where its specific pressure exists."
}
```

## In the wild

- **Amazon** famously spent the 2000s decomposing one monolithic Oracle database into **hundreds of
  service-owned databases** — each Amazon service got its own datastore, the canonical large-scale
  example of functional partitioning (the same decomposition that later birthed DynamoDB and the
  "two-pizza team" service model).
- **Microservices** naturally federate: each service owns its database (database-per-service), which *is*
  functional partitioning (recall monoliths-vs-microservices).
- **Federation precedes sharding** historically (a classic scaling step: split the monolith DB by
  feature before sharding individual tables).
- **Cross-domain reads** use **application-side joins, denormalization, or CQRS read models / data
  warehouses** (recall CQRS, polyglot); **cross-domain writes** use **sagas/outbox**.
- Combined with **sharding** and **polyglot persistence** in large systems.

## Common misconception — "federation is the same as sharding" / "it removes all scaling limits"

Federation splits **by function** (not row), and a single hot domain can still need **sharding**.

```reveal
{
  "prompt": "Why is conflating federation with sharding a mistake, and why doesn't federation alone solve all scaling problems?",
  "answer": "They partition along different axes and solve different pressures. Sharding (horizontal partitioning) splits a single table's ROWS across nodes by a shard key — same data shape, divided by key — to scale one large/hot dataset beyond a single machine. Federation (functional partitioning) splits a database by FUNCTION/DOMAIN — different tables for different business areas go to different databases — to isolate unrelated workloads and align with service boundaries. Calling them the same obscures their distinct trade-offs: federation breaks cross-domain joins/transactions (you join in the app or via read models, coordinate writes with sagas), whereas sharding breaks single-table queries that span shards (scatter-gather, cross-shard transactions) and requires careful shard-key choice to avoid hotspots. Federation alone doesn't remove all scaling limits because it only separates different things; if one domain's own dataset is too big or too hot for a single node (e.g. the orders table has billions of rows), giving it its own database doesn't help — that database still lives on one node and will hit the same wall. At that point you must shard that domain's table by key. So federation handles 'many different workloads in one DB,' and sharding handles 'one workload too large for a node'; they're complementary, and large systems federate first then shard the domains that outgrow a node. Treating federation as a synonym for sharding, or as a cure-all, leads to either misapplying the wrong technique or assuming you've scaled when a single hot domain is still bottlenecked on one machine."
}
```

**Database federation (functional partitioning)** splits a database **by function/domain** (users |
products | orders DBs) — for **load isolation and independent scaling**, and it's the data side of
microservices. The cost is **no cross-database joins/transactions** (join in-app, denormalize, or use
CQRS; coordinate writes with sagas). It's **not sharding** (split by row) — and a single hot domain may
still need sharding; large systems do **both**.

## Self-test

```quiz
{
  "question": "Database federation (functional partitioning) splits a database:",
  "options": [
    "By rows of one table, using a shard key",
    "By function/domain — each business area (users, products, orders) gets its own database",
    "Into read replicas",
    "By time range only"
  ],
  "answer": 1,
  "explanation": "Federation = split by feature/domain (different tables → different DBs). Sharding = split one table's rows by key. Different axes."
}
```

```quiz
{
  "question": "The main cost introduced by federating into per-domain databases is:",
  "options": [
    "Slower single-row lookups",
    "No cross-database joins or transactions — you must join in the app / denormalize / use read models, and coordinate writes with sagas",
    "It can't scale reads",
    "It requires synchronized clocks"
  ],
  "answer": 1,
  "explanation": "Splitting by domain means joins and ACID transactions can't span databases; cross-domain reads/writes move to the app, read models, or sagas."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Database federation — key terms", "cards": [ { "front": "Database federation (functional partitioning)", "back": "Splitting a database into multiple databases by function/domain — each owning a distinct set of tables for a business area (users DB | products DB | orders DB)." }, { "front": "Federation vs sharding", "back": "Federation splits by FEATURE/domain (different data → different DBs). Sharding splits one table's ROWS by a shard key (same data shape, divided across nodes)." }, { "front": "Main benefit of federation", "back": "Load isolation and independent scaling — each domain DB handles only its traffic, with smaller focused schemas; it's also the data side of microservices (database-per-service)." }, { "front": "Main cost of federation", "back": "No cross-database joins or transactions. You join in the application, denormalize, or use CQRS read models; coordinate cross-domain writes with sagas/outbox." }, { "front": "Federation then sharding", "back": "Federate first into per-domain databases; then shard whichever domain's table individually outgrows a node. Federation handles 'different things'; sharding handles 'too much of one thing'." } ] }
```

## Key takeaways

- **Database federation (functional partitioning)** splits a DB **by function/domain** (users | products
  | orders) — vs **sharding**, which splits **one table's rows** by key.
- Benefits: **load isolation, independent scaling, smaller focused schemas**, and it's the **data side
  of microservices** (database-per-service).
- Cost: **no cross-database joins/transactions** — compose in the **app**, **denormalize**, or use
  **CQRS read models/warehouses**; coordinate cross-domain writes with **sagas/outbox**.
- It's **not sharding** and isn't a cure-all — a single hot domain can still need **sharding**; large
  systems **federate then shard**.

## Up next

A higher-level data-architecture choice for combining batch and streaming. Next: **Lambda vs Kappa
Architecture**.
