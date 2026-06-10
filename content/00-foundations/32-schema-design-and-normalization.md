---
title: "Schema Design & Normalization"
slug: schema-design-and-normalization
level: foundations
module: database-fundamentals
order: 32
reading_time_min: 15
concepts: [normalization, denormalization, redundancy, anomalies, joins, schema-design]
use_cases: []
prerequisites: [primary-and-foreign-keys]
status: published
---

# Schema Design & Normalization

## Hook — a motivating scenario

An early schema stores the customer's name and address *inside every order row*. It's simple — until
a customer moves. Now their address is right on new orders but wrong on old ones, support sees three
different addresses, and "fix the address" means updating thousands of rows (missing some). The same
fact, copied everywhere, drifts out of sync. **Normalization** is the discipline that prevents this.

## Mental model — store each fact once

Think of it like a **contacts app**: a friend's phone number is stored once on their contact card,
and every text and call simply **references** that card rather than re-typing the number — change the
card once and every conversation is instantly correct.

The core principle: **every fact lives in exactly one place.** A customer's address is a fact about
the *customer*, so it belongs in the `customers` table — and an order just **references** the customer
(by foreign key), rather than copying their details. Need the address on an order? **Join** to fetch
it from the one authoritative place.

Duplicated data is the root of update anomalies; normalization removes duplication by splitting data
into related tables connected by keys.

```reveal
{
  "prompt": "Name the three classic 'anomalies' that come from storing customer details repeatedly inside the orders table.",
  "answer": "Update anomaly: changing the address means updating many rows, risking inconsistency if you miss some. Insertion anomaly: you can't record a customer until they have an order (their info has nowhere else to live). Deletion anomaly: deleting a customer's last order also erases the only copy of their details. All three vanish once the customer is a single row in its own table that orders reference."
}
```

## Build it up — normalization, briefly

Normalization is a set of rules ("normal forms") for removing redundancy; the practical gist of the
first three:

- **1NF** — atomic values (no comma-separated lists in a cell; one value per column per row).
- **2NF** — every non-key column depends on the *whole* primary key (no partial dependencies).
- **3NF** — non-key columns depend *only* on the key, not on each other (no transitive dependencies,
  e.g. don't store both `zip` and the `city` derivable from it in the same table).

You rarely recite these formally — the working rule is just **"don't duplicate facts; give each
entity its own table and reference it by key."** That naturally lands you around 3NF.

## Build it up — when to denormalize (on purpose)

Normalization optimizes for **correctness and write-efficiency** (update a fact once). But reading
normalized data requires **joins**, which can be slow at scale. **Denormalization** deliberately
re-introduces some duplication to make reads faster — a calculated trade-off.

```compare
{
  "options": [
    { "label": "Normalized", "points": ["Each fact stored once", "No update anomalies — change in one place", "Reads need joins", "Default for transactional/write-heavy data"] },
    { "label": "Denormalized", "points": ["Some data duplicated/precomputed", "Faster reads (fewer joins)", "Must keep copies in sync on write", "Used for read-heavy / reporting / scale"] }
  ]
}
```

```reveal
{
  "prompt": "When is it reasonable to denormalize, say by storing a precomputed 'order_count' on the user row?",
  "answer": "When reads vastly outnumber writes and the join/aggregation is expensive at your scale (e.g. showing order counts on a high-traffic dashboard). You accept the cost of keeping the duplicate in sync (update it whenever an order is added/removed, ideally transactionally) in exchange for fast reads. The rule: normalize by default for correctness; denormalize selectively, with eyes open, where measured read performance demands it — and own the sync burden."
}
```

Schema design is a dial between write correctness and read speed — slide it per workload:

```tradeoff
{ "title": "How far should you denormalize a schema?", "axis": { "left": "Fully normalized", "right": "Heavily denormalized" }, "steps": [ { "label": "Fully normalized (~3NF)", "detail": "Each fact stored once, referenced by keys. No update/insert/delete anomalies — change a fact in one place. Reads need joins. The default for transactional, write-heavy data." }, { "label": "Selective denormalization", "detail": "Normalize by default, then precompute or duplicate a few measured hot read paths (e.g. an order_count on the user row). You own keeping those copies in sync on every write." }, { "label": "Read-optimized (star schema)", "detail": "Analytics/OLAP warehouses duplicate widely into star schemas; data is mostly append-only, so read and aggregate speed dominate over update cost." }, { "label": "Heavily denormalized", "detail": "NoSQL document models embed related data to match an access pattern and avoid joins entirely. Fastest reads, but copies of facts scatter and must be synced — anomalies return if you are careless." } ] }
```

## In the wild

- **OLTP (transactional) systems** — e.g. **PostgreSQL** and **MySQL** backing an order or billing
  service — lean normalized, because correctness and cheap single-place updates matter most.
- **OLAP / analytics / data warehouses** — e.g. **Snowflake**, **Amazon Redshift**, **Google
  BigQuery** — lean denormalized into **star schemas**; read/aggregate speed matters most and data
  is mostly append-only.
- **NoSQL document models** — e.g. **MongoDB** and **Amazon DynamoDB** — often denormalize by
  design: you embed related data to match an access pattern and avoid joins. DynamoDB serves such a
  single-key read in **single-digit milliseconds** at scale, whereas the equivalent multi-table join
  would be far slower.
- **Caching and materialized views** are forms of controlled denormalization for read speed.

## Common misconception — "normalize everything, always" (or "denormalize for speed by default")

Both extremes hurt; it's a deliberate trade-off per workload.

```reveal
{
  "prompt": "Why is 'always fully normalize' as wrong as 'denormalize everywhere for speed'?",
  "answer": "Over-normalizing can force many joins for common reads, hurting performance and complexity for no benefit. Over-denormalizing scatters copies of facts everywhere, bringing back update anomalies and sync bugs — the very problems normalization solves. The right answer is workload-driven: normalize by default for write correctness, then denormalize specific, measured hot read paths where joins are too costly, and take responsibility for keeping the duplicates consistent."
}
```

Schema design is a balance: **normalize for correctness, denormalize deliberately for read
performance** — driven by your actual read/write patterns, not dogma.

## Self-test

```quiz
{
  "question": "Storing a customer's address inside every order row most directly causes:",
  "options": [
    "Faster writes",
    "Update anomalies — the address can become inconsistent across rows",
    "Better referential integrity",
    "Smaller storage"
  ],
  "answer": 1,
  "explanation": "Duplicating the fact means an address change must update many rows; miss some and data drifts out of sync."
}
```

```quiz
{
  "question": "Denormalization is mainly a trade that:",
  "options": [
    "Improves write correctness at the cost of reads",
    "Speeds up reads (fewer joins) at the cost of keeping duplicated data in sync on writes",
    "Eliminates the need for primary keys",
    "Always saves storage"
  ],
  "answer": 1,
  "explanation": "Denormalization duplicates/precomputes data for faster reads, accepting the burden of syncing copies on write."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Schema design & normalization — key terms", "cards": [ { "front": "Normalization", "back": "The discipline of storing each fact in exactly one place by splitting data into related tables connected by keys, eliminating duplication and the anomalies it causes." }, { "front": "Update anomaly", "back": "When a fact is duplicated across many rows, changing it means updating all of them; miss some and the data drifts out of sync." }, { "front": "Insertion & deletion anomalies", "back": "Insertion: you cannot record an entity until a related row exists for its details to live in. Deletion: removing the last related row erases the only copy of those details." }, { "front": "1NF / 2NF / 3NF", "back": "1NF: atomic values, one per cell. 2NF: non-key columns depend on the whole key. 3NF: non-key columns depend only on the key, not on each other." }, { "front": "Denormalization", "back": "Deliberately re-introducing duplication or precomputed values to make reads faster (fewer joins), accepting the burden of keeping copies in sync on writes." }, { "front": "Normalized vs denormalized fit", "back": "OLTP/transactional systems lean normalized for correctness; OLAP/analytics, NoSQL document models, caches and materialized views lean denormalized for read speed." } ] }
```

## Key takeaways

- **Normalize = store each fact once**, in its own table, referenced by keys — eliminating update/
  insert/delete **anomalies**.
- The working rule ("don't duplicate facts; one entity per table") lands you ~**3NF** without
  memorizing the forms.
- **Denormalization** trades duplication + sync effort for **faster reads** — deliberate, workload-
  driven, common in analytics and NoSQL.
- Neither extreme is right: **normalize for correctness, denormalize hot read paths on purpose.**

## Up next

We keep invoking transactions — let's see how to use them in practice. Next: **Database
Transactions**.
