---
title: "SQL vs NoSQL"
slug: sql-vs-nosql
level: foundations
module: database-fundamentals
order: 28
reading_time_min: 16
concepts: [sql, nosql, relational, document, key-value, schema, scaling, joins]
use_cases: []
prerequisites: [where-your-data-lives]
status: published
---

# SQL vs NoSQL

## Hook — a motivating scenario

Two startups pick databases on day one. One needs financial records with strict consistency and rich
queries across related tables; the other needs to store huge volumes of flexible event data and scale
writes massively. Pick the wrong type and the first corrupts money while the second hits a scaling
wall. "SQL or NoSQL?" is one of the first and most consequential design questions — and the honest
answer is "it depends," but on *what* is learnable.

## Mental model — a spreadsheet vs a filing system

- **SQL (relational)** is a set of **structured spreadsheets** (tables) with a fixed schema, where
  rows in different tables relate via keys, and a powerful query language (SQL) lets you filter, join,
  and aggregate across them.
- **NoSQL** is an umbrella for **non-relational** stores that relax the rigid schema and relational
  model to gain flexibility and scale — documents, key-value pairs, wide-columns, graphs.

Neither is "newer = better." They make different trade-offs around **schema, querying, consistency,
and how they scale.**

```compare
{
  "options": [
    { "label": "SQL (relational)", "points": ["Fixed schema, tables + rows", "Joins & rich queries (SQL)", "Strong consistency, ACID transactions", "Scales up; harder to scale writes horizontally"] },
    { "label": "NoSQL", "points": ["Flexible/!schema, varied models", "Queries tuned to access patterns", "Often tunable/eventual consistency", "Designed to scale out horizontally"] }
  ]
}
```

## Build it up — the NoSQL families and when each fits

"NoSQL" isn't one thing:

```match
{
  "prompt": "Match each NoSQL family to what it's good for.",
  "pairs": [
    { "left": "Document (MongoDB)", "right": "Flexible, nested records (e.g. a product catalog)" },
    { "left": "Key-Value (Redis, DynamoDB)", "right": "Fast lookups by key (sessions, caches)" },
    { "left": "Wide-Column (Cassandra)", "right": "Huge write volume across many nodes (events, time-series)" },
    { "left": "Graph (Neo4j)", "right": "Highly connected data + relationship queries (social graph)" }
  ]
}
```

**How to choose** — ask about your data and access patterns:
- **Relationships & rich, ad-hoc queries / transactions** (orders, payments, anything where
  correctness across tables matters) → **SQL**.
- **Flexible or rapidly-changing shape, simple access patterns, massive scale** (event logs,
  catalogs, huge key-value workloads) → **NoSQL**, chosen by family.
- **You don't know your query patterns yet** → **SQL is a safe default** — it's flexible to query
  later, mature, and handles most apps well until you have a concrete reason to specialize.

```reveal
{
  "prompt": "Why is SQL often the better *default*, even though NoSQL 'scales better'?",
  "answer": "Most applications never reach the scale where SQL's horizontal-write limits bite, and modern SQL scales further than people think (replicas, partitioning). Meanwhile SQL gives you ACID transactions, joins, and ad-hoc queries — huge when your access patterns are still evolving. NoSQL trades those for scale and flexibility, but you must model around fixed access patterns up front. Start with SQL unless you have a specific need (scale, data shape) that demands otherwise."
}
```

## In the wild

- **SQL:** PostgreSQL, MySQL — systems of record, financial/transactional data, anything relational.
- **NoSQL:** MongoDB (documents), Redis/DynamoDB (key-value), Cassandra (wide-column, write-heavy),
  Neo4j (graph).
- **Polyglot persistence:** real systems use *both* — e.g. PostgreSQL for orders, Redis for sessions,
  Elasticsearch for search, S3 for blobs. Pick per workload (an advanced-course topic).
- **NewSQL** (e.g. CockroachDB, Spanner) aims for SQL semantics *with* horizontal scale — the line
  between camps is blurring.

## Common misconception — "NoSQL scales and SQL doesn't" / "NoSQL has no schema so it's simpler"

Both halves are oversimplified.

```reveal
{
  "prompt": "If NoSQL is 'schemaless', where did the schema go — and why can that make things harder, not easier?",
  "answer": "The schema doesn't vanish; it moves from the database to your application code. The DB will happily store inconsistent shapes, so *your code* must handle every variation, enforce structure, and migrate old documents — bugs the database used to catch are now yours. 'Schemaless' means 'schema-on-read' (you interpret structure when reading) rather than 'schema-on-write' (DB enforces it). Flexibility is real, but so is the responsibility it shifts onto you."
}
```

SQL can scale much further than its reputation (replicas, partitioning, NewSQL), and NoSQL's
"schemaless" just relocates schema responsibility to your application. Choose by **data shape,
consistency needs, query patterns, and real scale** — not by which sounds more modern.

## Self-test

```quiz
{
  "question": "For a banking system needing transactions across accounts and rich queries, the better default is:",
  "options": ["A key-value store", "A relational (SQL) database", "A graph database", "A blob store"],
  "answer": 1,
  "explanation": "Relational DBs offer ACID transactions and joins/queries across related tables — ideal for financial correctness."
}
```

```quiz
{
  "question": "Which workload best fits a wide-column store like Cassandra?",
  "options": [
    "Complex multi-table joins with strong consistency",
    "Massive write volume of time-series/event data across many nodes",
    "A small app with evolving ad-hoc queries",
    "Highly connected social-graph traversals"
  ],
  "answer": 1,
  "explanation": "Wide-column stores are built for very high write throughput and horizontal scale (e.g. events/time-series)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "SQL vs NoSQL — key terms", "cards": [ { "front": "SQL (relational)", "back": "Structured tables with a fixed schema, related via keys, queried/joined/aggregated with SQL. Offers ACID transactions and strong consistency; scales up, harder to scale writes horizontally." }, { "front": "NoSQL", "back": "Umbrella for non-relational stores that relax rigid schema and the relational model to gain flexibility and scale. Includes document, key-value, wide-column, and graph families." }, { "front": "Document store (e.g. MongoDB)", "back": "NoSQL family for flexible, nested records such as a product catalog." }, { "front": "Wide-column store (e.g. Cassandra)", "back": "NoSQL family built for huge write volume across many nodes, e.g. events and time-series data." }, { "front": "Schema-on-read vs schema-on-write", "back": "'Schemaless' NoSQL interprets structure when reading (schema-on-read); SQL enforces it on write. The schema doesn't vanish — it moves to your application code." }, { "front": "Polyglot persistence", "back": "Using multiple databases per workload in one system, e.g. PostgreSQL for orders, Redis for sessions, Elasticsearch for search, S3 for blobs." } ] }
```

## Key takeaways

- **SQL** = fixed schema, joins, ad-hoc queries, ACID, strong consistency; **NoSQL** = flexible
  models built to scale out, tuned to known access patterns.
- NoSQL is a **family** (document, key-value, wide-column, graph) — pick by data shape and access
  pattern.
- **SQL is a strong default** until you have a concrete reason (scale, data shape) to specialize;
  real systems often use **both** (polyglot persistence).
- "NoSQL scales / SQL doesn't" and "NoSQL is schemaless = simpler" are **both oversimplified** —
  schema responsibility just shifts to your app.

## Up next

Whatever the database, you do four basic things with data. Next: **CRUD Operations**.
