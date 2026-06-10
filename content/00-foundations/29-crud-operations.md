---
title: "CRUD Operations"
slug: crud-operations
level: foundations
module: database-fundamentals
order: 29
reading_time_min: 11
concepts: [crud, create, read, update, delete, sql, soft-delete]
use_cases: []
prerequisites: [sql-vs-nosql, rest-api-fundamentals]
status: published
---

# CRUD Operations

## Hook — a motivating scenario

Almost every feature you'll build — a profile page, a shopping cart, a comment thread — boils down to
the same four actions on data: make it, read it, change it, remove it. Master these four and the
shape of most of an app's data layer is suddenly obvious. They even map cleanly onto the SQL and REST
you've already seen.

## Mental model — the four verbs of data

**CRUD** = **Create, Read, Update, Delete** — the complete lifecycle of a record. Everything an app
does to stored data is one of these (or a combination). The same four show up in three places you
know, which is why the mental model transfers everywhere:

```match
{
  "prompt": "Match each CRUD operation to its SQL statement and REST method.",
  "pairs": [
    { "left": "Create", "right": "INSERT  ·  POST /items" },
    { "left": "Read", "right": "SELECT  ·  GET /items/7" },
    { "left": "Update", "right": "UPDATE  ·  PUT/PATCH /items/7" },
    { "left": "Delete", "right": "DELETE  ·  DELETE /items/7" }
  ]
}
```

## Build it up — what each operation really involves

- **Create** — add a new record (`INSERT`). The DB usually assigns a primary key (an ID); creation is
  *not* idempotent by default (recall: two POSTs = two records).
- **Read** — fetch records (`SELECT`), the most frequent operation by far. Reads are where filtering,
  pagination, and indexing (next chapters) matter most.
- **Update** — modify existing data (`UPDATE … WHERE`). Two flavors map to REST: **PUT** replaces the
  whole record (idempotent), **PATCH** changes some fields.
- **Delete** — remove a record (`DELETE … WHERE`). Idempotent (already-gone stays gone) — but "really
  delete?" is a design question (below).

```reveal
{
  "prompt": "What's the danger of an UPDATE or DELETE statement without a WHERE clause?",
  "answer": "It applies to *every row* in the table. `DELETE FROM users;` wipes all users; `UPDATE accounts SET balance = 0;` zeroes everyone. The WHERE clause scopes the operation to specific rows — forgetting it is a classic catastrophic mistake. (This is why people test with SELECT first, use transactions, and keep backups.)"
}
```

## Build it up — soft delete vs hard delete

"Delete" is rarely as simple as it sounds. **Hard delete** truly removes the row. **Soft delete**
keeps the row but marks it (`deleted_at` timestamp / `is_deleted` flag) and filters it out of normal
queries — so data can be recovered, audited, or kept for referential integrity.

```reveal
{
  "prompt": "Why do many systems 'soft delete' (flag as deleted) instead of actually removing rows?",
  "answer": "Recoverability (undo, 'restore from trash'), audit/compliance (you must prove what existed), and integrity (other records may reference it — hard-deleting could orphan them or break history like past orders pointing to a now-deleted product). The cost is that every query must remember to exclude soft-deleted rows, and the table keeps growing. It's a deliberate trade: safety/auditability vs simplicity and storage."
}
```

Deletion isn't a single choice but a dial between keeping everything and removing everything:

```tradeoff
{
  "title": "Soft delete or hard delete?",
  "axis": { "left": "Soft delete (keep + flag)", "right": "Hard delete (truly remove)" },
  "steps": [
    { "label": "Pure soft delete", "detail": "Row stays, marked with deleted_at / is_deleted and filtered from queries. Maximum recoverability and audit trail, but every query must exclude flagged rows and the table keeps growing." },
    { "label": "Soft delete + retention", "detail": "Keep deleted rows for a window (e.g. trash you can restore), then purge. Balances undo and audit against unbounded table growth." },
    { "label": "Hard delete", "detail": "Row is gone for good. Simplest queries and smallest tables, but no recovery and you may orphan referencing records or break history." },
    { "label": "Hard delete for compliance", "detail": "Truly removing data can be required — e.g. 'right to be forgotten' privacy rules — where keeping it at all is the problem." }
  ]
}
```

## In the wild

- **CRUD is the backbone of admin panels, forms, and most REST resources** — frameworks scaffold it
  automatically. **Ruby on Rails** (`scaffold`) and **Django** (its built-in admin) generate full
  Create/Read/Update/Delete screens from a model definition, and tools like **PostgREST** and
  **Hasura** auto-expose a database's tables as ready-made REST/GraphQL CRUD APIs with no hand-written
  endpoint code.
- **Reads dominate:** most web workloads are read-heavy — commonly on the order of ~90-99% reads to
  ~1-10% writes — which is why caching and indexing (coming up) focus on reads.
- **Soft deletes** are common in business systems for audit/recovery; **hard deletes** matter for
  privacy/compliance (e.g. "right to be forgotten" may *require* truly removing data).
- **Bulk operations** (batch insert/update) are far more efficient than row-by-row — a frequent
  performance fix.

## Common misconception — "CRUD is trivial; the hard part is elsewhere"

The verbs are simple; doing them *safely and at scale* is not.

```reveal
{
  "prompt": "If CRUD is just four statements, where does the real engineering go?",
  "answer": "Into the qualities around them: scoping writes correctly (WHERE), doing multi-step changes atomically (transactions), making reads fast (indexes, pagination, caching), handling concurrent updates without clobbering each other (locking/optimistic concurrency), validating input, authorizing each action, and deciding deletion policy (soft vs hard). The four verbs are the easy part; correctness, performance, and safety around them are the actual work — and the subjects of the next chapters."
}
```

CRUD names the operations; the engineering is in transactions, indexing, concurrency, validation,
authorization, and deletion policy — everything that makes those four verbs correct and fast.

## Self-test

```quiz
{
  "question": "Which CRUD operation maps to SQL UPDATE and (typically) REST PUT/PATCH?",
  "options": ["Create", "Read", "Update", "Delete"],
  "answer": 2,
  "explanation": "Update modifies existing data → SQL UPDATE, REST PUT (replace) / PATCH (partial)."
}
```

```quiz
{
  "question": "A soft delete differs from a hard delete in that it:",
  "options": [
    "Permanently removes the row faster",
    "Marks the row as deleted (e.g. deleted_at) and excludes it from queries, keeping it recoverable",
    "Encrypts the row",
    "Deletes the whole table"
  ],
  "answer": 1,
  "explanation": "Soft delete flags rather than removes — enabling recovery, audit, and integrity, at the cost of query complexity."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "CRUD operations — key terms", "cards": [
  { "front": "CRUD", "back": "Create, Read, Update, Delete — the complete lifecycle of a record. Every action an app takes on stored data is one of these or a combination." },
  { "front": "Create", "back": "Add a new record (SQL INSERT, REST POST). The DB usually assigns a primary key; not idempotent by default — two POSTs make two records." },
  { "front": "Update: PUT vs PATCH", "back": "Both map to SQL UPDATE … WHERE. PUT replaces the whole record (idempotent); PATCH changes only some fields." },
  { "front": "Missing WHERE clause", "back": "An UPDATE or DELETE without WHERE applies to every row — DELETE FROM users wipes all users. WHERE scopes the operation to specific rows." },
  { "front": "Soft delete", "back": "Keep the row but mark it (deleted_at / is_deleted) and filter it from normal queries, so data stays recoverable, auditable, and referentially intact." },
  { "front": "Hard delete", "back": "Truly remove the row. Simplest and smallest, but unrecoverable; sometimes required for privacy ('right to be forgotten')." }
] }
```

## Key takeaways

- **CRUD = Create/Read/Update/Delete**, the full lifecycle of a record — mapping cleanly to **SQL**
  (INSERT/SELECT/UPDATE/DELETE) and **REST** (POST/GET/PUT-PATCH/DELETE).
- Always **scope writes with WHERE**; a missing WHERE on UPDATE/DELETE hits every row.
- **Soft vs hard delete** is a real design choice (recoverability/audit vs simplicity/privacy).
- The verbs are simple; the **engineering is in transactions, indexing, concurrency, and safety**
  around them.

## Up next

Multi-step changes must succeed or fail as a unit. Next: **ACID Properties**, the guarantees that make
that possible.
