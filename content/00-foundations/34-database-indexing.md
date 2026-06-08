---
title: "Database Indexing"
slug: database-indexing
level: foundations
module: database-fundamentals
order: 34
reading_time_min: 15
concepts: [index, b-tree, full-table-scan, composite-index, write-cost, query-performance]
use_cases: []
prerequisites: [primary-and-foreign-keys, schema-design-and-normalization]
status: published
---

# Database Indexing

## Hook — a motivating scenario

A query that ran in 5 ms on your laptop takes 8 seconds in production. Same query, same code — but the
table grew from 1,000 rows to 50 million. The database is reading *every single row* to find the few
you asked for. Adding one line — an **index** — drops it back to milliseconds. Indexing is the single
highest-leverage performance tool in databases, and knowing when (and when not) to use it is essential.

## Mental model — the index at the back of a book

To find "transactions" in a 900-page book, you don't read every page — you flip to the **index**,
which lists the term and its page numbers, and jump straight there. A database index is the same: a
separate, sorted structure mapping column values → the location of matching rows, so the database can
**seek** instead of **scan**.

Without an index on the column you filter by, the database does a **full table scan** — reading every
row to find matches. That's the 8-second query.

```reveal
{
  "prompt": "Why does `WHERE email = '...'` get drastically faster with an index on email, but a query with no matching index stay slow no matter the hardware?",
  "answer": "An index keeps email values in a sorted structure (typically a B-tree), so the database can binary-search to the row(s) in O(log n) — a handful of steps even at 50M rows. Without it, the only option is to examine every row (O(n) full scan), which grows linearly with table size. Faster hardware shifts the constant but not the scaling: a scan of 50M rows is fundamentally more work than a few index hops. The fix is algorithmic (an index), not a bigger machine."
}
```

## Build it up — what an index costs

Indexes aren't free; they're a classic **read-vs-write trade-off**:

```compare
{
  "options": [
    { "label": "With an index", "points": ["Reads/filters/sorts on that column are fast (seek)", "Speeds up WHERE, JOIN, ORDER BY", "Extra storage for the index structure", "Every write must also update the index (slower writes)"] },
    { "label": "Without (full scan)", "points": ["No extra storage or write overhead", "Fine for tiny tables", "Reads scale O(n) — slow as data grows", "Sorting/filtering large tables is expensive"] }
  ]
}
```

So you index the columns you **frequently filter, join, or sort by** — not every column. Each index
adds storage and slows down every `INSERT`/`UPDATE`/`DELETE` (the index must be maintained), so
over-indexing a write-heavy table hurts.

**Composite indexes** cover multiple columns in order, e.g. `(user_id, created_at)` — great for
"this user's recent rows." Order matters: such an index helps queries filtering by `user_id` (and
optionally then `created_at`), but not ones filtering by `created_at` alone — like a phone book sorted
by (last name, first name) is useless for finding someone by first name.

```reveal
{
  "prompt": "You have a composite index on (last_name, first_name). Why does it help 'find by last_name' but not 'find by first_name alone'?",
  "answer": "The index is sorted by last_name first, then first_name within each last_name — like a phone book. Searching by last_name (a prefix of the key) lets you seek directly. But first_names are scattered all through the book (every last_name section has its own first names), so finding all 'John's by first name alone can't use this index — there's no single sorted location for them. Composite indexes work left-to-right (the 'leftmost prefix' rule)."
}
```

Indexing is a dial: how many indexes you add trades read speed against write cost.

```tradeoff
{
  "title": "How many indexes should a table carry?",
  "axis": { "left": "No indexes", "right": "Index everything" },
  "steps": [
    { "label": "No indexes", "detail": "Cheapest writes and least storage, but every filter/sort on a large table is a full scan — reads grow O(n) and slow down as data grows." },
    { "label": "Index the hot columns", "detail": "Index the columns you actually filter, join, or sort by. Reads seek in O(log n); writes pay only to maintain those few indexes. The sweet spot, verified with EXPLAIN." },
    { "label": "Add composite indexes", "detail": "Cover multi-column query patterns like (user_id, created_at). Helps leftmost-prefix queries but adds another structure every write must update." },
    { "label": "Index everything", "detail": "Every column indexed 'to be safe': writes update all indexes, multiplying write cost and I/O, and unused indexes waste storage and cache — pure overhead on write-heavy tables." }
  ]
}
```

## In the wild

- **Primary keys are indexed automatically**; you typically add indexes on **foreign keys** and on
  columns used in `WHERE`/`JOIN`/`ORDER BY`.
- **`EXPLAIN`/query plans** show whether a query uses an index or does a full scan — the first tool to
  reach for when a query is slow.
- **B-trees** are the default index (great for ranges and equality); **hash indexes** suit exact-match
  only; specialized indexes exist for text search, geo, JSON.
- **Over-indexing** is a real anti-pattern on write-heavy tables — each extra index taxes every write.

## Common misconception — "indexes make the database faster, so index everything"

Indexes speed *reads* on indexed columns but slow *writes* and cost storage — more isn't better.

```reveal
{
  "prompt": "A team adds an index to every column 'to be safe.' Why might the database get slower overall?",
  "answer": "Every INSERT/UPDATE/DELETE now has to update all those indexes, multiplying write cost and I/O — painful on write-heavy tables. Unused indexes also consume storage and memory (less room to cache useful data) and the query planner has more options to evaluate. Indexes you don't query by are pure overhead. The right approach is to index for your actual query patterns (verified with EXPLAIN), not blanket-index everything."
}
```

Indexing is targeted: add indexes that match real query patterns, measure with query plans, and
remember each one is paid for on **every write** and in storage. Right indexes = huge wins; wrong/
excess indexes = slower writes for nothing.

## Self-test

```quiz
{
  "question": "Without an index on the filtered column, a query on a large table must:",
  "options": [
    "Return instantly",
    "Do a full table scan, reading every row (O(n))",
    "Use the primary key automatically",
    "Fail with an error"
  ],
  "answer": 1,
  "explanation": "No usable index → full table scan, examining every row; cost grows linearly with table size."
}
```

```quiz
{
  "question": "The main cost of adding an index is:",
  "options": [
    "Reads become slower",
    "Slower writes (the index must be maintained) plus extra storage",
    "The table can no longer be queried",
    "It disables transactions"
  ],
  "answer": 1,
  "explanation": "Indexes speed reads on that column but every write must update them, and they consume storage — so index selectively."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Database indexing — key terms", "cards": [
  { "front": "Index", "back": "A separate, sorted structure mapping column values to row locations, letting the database seek to matching rows in O(log n) instead of scanning every row." },
  { "front": "Full table scan", "back": "Reading every row to find matches when no usable index exists. Cost grows linearly (O(n)) with table size — the cause of slow queries on large tables." },
  { "front": "Read-vs-write trade-off", "back": "Indexes speed reads/filters/sorts on a column but slow every INSERT/UPDATE/DELETE (the index must be maintained) and consume extra storage." },
  { "front": "Composite index", "back": "An index over multiple columns in order, e.g. (user_id, created_at). Works left-to-right (leftmost-prefix), so column order matters." },
  { "front": "Leftmost-prefix rule", "back": "A composite index on (last_name, first_name) helps filtering by last_name (a prefix) but not by first_name alone, since those are scattered throughout." },
  { "front": "EXPLAIN / query plan", "back": "Shows whether a query uses an index or does a full scan — the first tool to reach for when diagnosing a slow query." }
] }
```

## Key takeaways

- An **index** lets the database **seek** (O(log n)) instead of **scan** (O(n)) — the top tool for
  fast reads on large tables.
- Indexes cost **storage and slower writes** (maintained on every INSERT/UPDATE/DELETE) — index the
  columns you **filter/join/sort** by, not all of them.
- **Composite indexes** work **left-to-right** (leftmost-prefix); column order matters.
- Use **`EXPLAIN`/query plans** to confirm an index is used; **over-indexing** hurts write-heavy
  tables.

## Up next

Reads and writes have different scaling characteristics. Next: **Database Reads vs Writes**.
