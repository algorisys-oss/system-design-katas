---
title: "Primary & Foreign Keys"
slug: primary-and-foreign-keys
level: foundations
module: database-fundamentals
order: 31
reading_time_min: 12
concepts: [primary-key, foreign-key, referential-integrity, relationships, surrogate-key]
use_cases: []
prerequisites: [crud-operations, sql-vs-nosql]
status: published
---

# Primary & Foreign Keys

## Hook — a motivating scenario

Your `orders` table has a row pointing to customer #500 — but customer #500 was deleted last month.
Now reports crash, emails bounce, and you have "ghost" orders belonging to nobody. The database could
have *prevented* this entirely with two simple constructs: **primary keys** (every row uniquely
identifiable) and **foreign keys** (references that can't point at nothing). They're how relational
databases keep data connected and trustworthy.

## Mental model — unique IDs and verified references

- A **primary key** is a row's unique, unchanging **ID badge** — guaranteed unique and non-null, so
  you can always pinpoint exactly one row (`users.id = 42`).
- A **foreign key** is a **verified reference** from one table to another's primary key
  (`orders.customer_id → users.id`). The database *enforces* that the referenced row exists — you
  can't create an order for a non-existent customer.

Together they model **relationships**: orders belong to users, comments belong to posts, line-items
belong to orders.

## Build it up — keys and referential integrity

```compare
{
  "options": [
    { "label": "Primary key", "points": ["Uniquely identifies a row", "Unique + not null", "One per table", "Indexed automatically (fast lookups)"] },
    { "label": "Foreign key", "points": ["References another table's PK", "Enforces the target exists", "Many allowed per table", "Models relationships between tables"] }
  ]
}
```

A foreign key gives you **referential integrity**: the database refuses operations that would leave a
dangling reference. That directly prevents the opening bug — you couldn't have deleted customer #500
while orders referenced them (the DB would block it or apply a defined rule).

**ON DELETE behavior** defines what happens when a referenced row is removed:
- **RESTRICT** — block the delete while references exist (forces you to handle them first).
- **CASCADE** — delete the dependents too (delete a user → delete their orders).
- **SET NULL** — keep the row but null out the reference.

```reveal
{
  "prompt": "How would a foreign key with ON DELETE RESTRICT have prevented the 'ghost orders' problem?",
  "answer": "With orders.customer_id a foreign key to users.id and ON DELETE RESTRICT, the database would refuse to delete customer #500 while any order still references them. You'd be forced to reassign or remove those orders first — so no order can ever point to a non-existent customer. Referential integrity makes the invalid state impossible rather than something you hope your app avoids."
}
```

## Build it up — natural vs surrogate keys

What should the primary key *be*? Two choices:
- **Natural key** — an existing meaningful value (email, ISBN). Risk: meaningful values change (people
  change emails), and a changing PK is painful since everything references it.
- **Surrogate key** — a synthetic ID with no business meaning (auto-increment integer, UUID). Stable
  forever, never needs to change. The common default.

```reveal
{
  "prompt": "Why do most schemas use a surrogate key (like an auto-increment id or UUID) instead of something natural like email as the primary key?",
  "answer": "Because business values change and aren't always unique/stable. If email were the PK and a user changes it, you'd have to update that value everywhere it's referenced (every foreign key) — error-prone and slow. A surrogate key has no meaning, so it never needs to change; the email can change freely as an ordinary column. Stable identity is the PK's job; meaningful data lives in regular columns."
}
```

## In the wild

- **Every relational table** should have a primary key; foreign keys wire tables into a coherent model.
- **Primary keys are auto-indexed**, making lookups and joins by ID fast (indexing is the next chapter).
- **UUID vs auto-increment:** UUIDs are globally unique (great for distributed systems / merging data)
  but larger and less index-friendly; auto-increment ints are compact and ordered. A real trade-off.
- **NoSQL** often pushes integrity into the application (no enforced foreign keys) — recall that
  "schemaless" shifts responsibility to your code.

## Common misconception — "the application can just make sure references are valid"

App-level checks are racy and inconsistent; the database enforces integrity reliably.

```reveal
{
  "prompt": "Why is enforcing 'the customer exists' in application code weaker than a database foreign key?",
  "answer": "App checks are subject to race conditions and bugs: two requests can both check 'customer exists', then one deletes the customer between the check and the insert (TOCTOU). Different code paths may forget the check entirely, and bulk imports or other services may bypass it. A foreign key is enforced by the database atomically on every write, from every code path — a single source of truth for integrity. App-level validation supplements it but can't replace its guarantees."
}
```

Referential integrity belongs in the database, where it's enforced atomically for every writer.
Application checks are useful UX but can't guarantee consistency the way a foreign key does.

## Self-test

```quiz
{
  "question": "What does a foreign key constraint guarantee?",
  "options": [
    "The column is encrypted",
    "The referenced row exists (no dangling references)",
    "The value is unique",
    "The row can never be deleted"
  ],
  "answer": 1,
  "explanation": "A foreign key enforces that the value points to an existing row in the referenced table — referential integrity."
}
```

```quiz
{
  "question": "A surrogate primary key (e.g. auto-increment id / UUID) is preferred over a natural key mainly because:",
  "options": [
    "It's encrypted",
    "It has no business meaning, so it never needs to change",
    "It's always smaller",
    "It removes the need for indexes"
  ],
  "answer": 1,
  "explanation": "Surrogate keys are stable; business values (like email) change, and a changing PK is painful since everything references it."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Primary & foreign keys — key terms", "cards": [
  { "front": "Primary key", "back": "A row's unique, non-null, unchanging ID that pinpoints exactly one row (users.id = 42). One per table, and auto-indexed for fast lookups." },
  { "front": "Foreign key", "back": "A verified reference from one table to another's primary key (orders.customer_id → users.id). The database enforces that the referenced row exists." },
  { "front": "Referential integrity", "back": "The guarantee that references can't dangle. The database refuses operations that would leave a foreign key pointing at a non-existent row." },
  { "front": "ON DELETE behavior", "back": "What happens when a referenced row is removed: RESTRICT blocks it, CASCADE deletes dependents too, SET NULL keeps the row but nulls the reference." },
  { "front": "Natural vs surrogate key", "back": "A natural key is an existing meaningful value (email, ISBN) that can change; a surrogate key is a synthetic meaningless ID (auto-increment, UUID) that stays stable forever." },
  { "front": "UUID vs auto-increment", "back": "UUIDs are globally unique (good for distributed systems) but larger and less index-friendly; auto-increment ints are compact and ordered. A real trade-off." }
] }
```

## Key takeaways

- A **primary key** uniquely identifies each row (unique, not null, auto-indexed); a **foreign key**
  references another table's PK and **enforces that the target exists**.
- Foreign keys provide **referential integrity** — they make invalid states (dangling references)
  impossible, and `ON DELETE` rules (RESTRICT/CASCADE/SET NULL) define cleanup.
- Prefer **surrogate keys** (stable, meaningless IDs) over natural keys (which change).
- Integrity belongs in the **database**, not just app code — it's enforced atomically for every writer.

## Up next

Wrapping multiple writes safely needs more than keys. Next: **Database Transactions** — using ACID in
practice.
