---
title: "Zero-Downtime Migration"
slug: zero-downtime-migration
level: advanced
module: resilience
order: 40
reading_time_min: 16
concepts: [zero-downtime, expand-contract, dual-writes, backfill, schema-migration, rollback]
use_cases: []
prerequisites: [schema-design-and-normalization, api-versioning, blast-radius-and-failure-domains]
status: published
---

# Zero-Downtime Migration

## Hook — a motivating scenario

You need to rename a column, change a data type, split a table, or move to a whole new database — on a
system that's serving live traffic 24/7 and **can't be taken down**. The old "stop the app, run the
migration, start it back up" approach means downtime (and a terrifying all-or-nothing cutover). For
systems that must stay up, you migrate **incrementally**, with old and new coexisting, using the
**expand/contract** pattern.

## Mental model — make changes backward-compatible and incremental

The core principle: **never make a breaking change in one step on a live system.** Instead, evolve in
**small, backward-compatible steps** where the **old and new schemas/code coexist**, so at every moment
the running system works with whatever state the migration is in. The canonical approach is
**expand/contract (parallel change)**:

```stepper
{
  "title": "Expand / Contract (parallel change) — e.g. renaming a column",
  "steps": [
    { "title": "1 · Expand", "body": "Add the NEW column (don't touch the old). Schema now has both — additive, backward-compatible." },
    { "title": "2 · Dual-write", "body": "Deploy code that writes to BOTH old and new columns, but still reads the old (the source of truth)." },
    { "title": "3 · Backfill", "body": "Copy existing rows' old → new in batches (the historical data). Now new is fully populated." },
    { "title": "4 · Switch reads", "body": "Once new is verified complete/consistent, flip reads to the NEW column. New is now source of truth." },
    { "title": "5 · Contract", "body": "Stop writing the old column; after a safe period, drop it. Migration complete — no downtime." }
  ]
}
```

## Build it up — why each step is reversible and safe

The power of expand/contract is that **every step is small, backward-compatible, and reversible**:
- **Additive first (expand):** adding a column/table never breaks existing code (it ignores what it
  doesn't know — recall API/schema compatibility). The risky breaking part (dropping the old) comes
  **last**, after the new path is proven.
- **Dual-write + backfill** separate **new data** (written to both going forward) from **old data**
  (backfilled in batches) — so you converge the two representations without a big-bang copy or a
  read-time gap.
- **Verify before switching reads:** you can compare old vs new, run the new read path in **shadow**,
  and only flip when confident — and **roll back** by flipping back if something's wrong.
- **Contract last:** dropping the old column is irreversible, so it's the final step, done only after the
  new path has run safely in production.

```reveal
{
  "prompt": "In the expand/contract pattern, why must you dual-write and backfill before switching reads to the new column — and why drop the old column last?",
  "answer": "Because at the moment you switch reads to the new column, the new column must already contain correct data for EVERY row — both rows written after the change and rows that existed before it — or reads will return missing/wrong data. Dual-writing handles new and updated rows: once deployed, every write populates both the old (still the source of truth) and the new column, so going forward the new column stays current. But dual-writing alone doesn't fill in the historical rows that were written before dual-write started — those still have an empty/incorrect new column. Backfilling copies the old→new value for all those pre-existing rows, in batches (to avoid overloading the database), so the new column becomes complete. Only after dual-write (covers new data) AND backfill (covers old data) is the new column fully populated and consistent — and you verify that (compare old vs new, maybe shadow-read) — can you safely switch reads to it without users seeing gaps. If you switched reads before backfilling, old rows would read as null/missing; if you switched before dual-writing, new writes wouldn't be in the new column. You drop the old column LAST (the contract step) because dropping it is irreversible and breaking: if you dropped it too early and discovered a problem with the new path, you'd have no source of truth to fall back to and couldn't roll back. By keeping the old column intact (and even still dual-written) for a safe period after switching reads, you preserve the ability to flip reads back to the old column instantly if the new path misbehaves — a cheap rollback. Once the new path has proven itself in production over time, you stop writing the old column and finally drop it. So the ordering — expand (add new), dual-write (new data), backfill (old data), switch reads (after verification), contract (drop old, last) — ensures the new column is always complete before it's relied upon and that every step before the irreversible one is reversible."
}
```

## Build it up — bigger migrations and patterns

The same incremental, coexist-and-cutover thinking scales up:
- **Database/datastore migration (e.g. to a new DB):** **dual-write to both databases**, **backfill**
  history, **verify/reconcile**, **shift reads gradually** (a %), then **decommission** the old — often
  with the **strangler fig** pattern (recall — next module) for the surrounding app.
- **Online schema-change tools:** for big tables, tools like **gh-ost / pt-online-schema-change**
  (MySQL) build the new table + backfill + swap **without locking** the live table.
- **Backfills must be gentle:** batch + throttle so the backfill doesn't overload the DB or starve live
  traffic (recall load shedding / hot partitions); make backfills **idempotent and resumable**.
- **De-risk the cutover:** **feature flags** to switch read paths instantly, **shadow reads** to compare,
  **canary** by percentage, and an **instant rollback** path — keep the **blast radius** small (recall).

```reveal
{
  "prompt": "How do you migrate to an entirely new database with zero downtime, and how do you keep the cutover low-risk and reversible?",
  "answer": "You apply expand/contract at the datastore level, keeping old and new databases coexisting and converging before any cutover. Steps: (1) Stand up the new database alongside the old (expand). (2) Dual-write: deploy code that writes every change to BOTH the old and new databases (old remains the source of truth), so the new DB stays current for all new/updated data. (3) Backfill: copy historical data from old → new in throttled, idempotent, resumable batches so you don't overload either system or starve live traffic; now the new DB has full history. (4) Verify/reconcile: continuously compare old vs new (counts, checksums, sampled rows) and run the new read path in SHADOW (serve from old, also read from new and diff) to confirm correctness and performance under real load, without users seeing new results. (5) Shift reads gradually: behind a feature flag, route a small percentage of read traffic to the new DB (canary), watch metrics/errors, and ramp up — keeping blast radius small (recall failure domains); the flag lets you flip reads back to the old DB instantly if anything's wrong (cheap rollback). (6) Make new the source of truth once reads are fully and safely on it. (7) Contract: stop dual-writing and decommission the old DB only after a safe soak period. To keep it low-risk and reversible: dual-writing + keeping the old DB intact means you always have a working fallback until the very end; feature flags give instant read-path switching (no redeploy); shadow reads and reconciliation catch discrepancies before users do; canary/percentage rollout limits exposure; gentle, resumable backfills avoid self-inflicted overload; and you defer the only irreversible step (decommissioning old) until the new path is proven in production. The surrounding application is often migrated incrementally with the strangler fig pattern (route feature-by-feature to the new system) so you never do a big-bang switch. The whole philosophy: coexist, converge, verify, shift gradually, keep rollback cheap until the last irreversible step — never a single all-or-nothing cutover."
}
```

## In the wild

- **Expand/contract (parallel change)** is the standard for schema changes; **online schema-change
  tools** (gh-ost, pt-osc) and migration frameworks support additive/reversible steps.
- **Dual-write + backfill + gradual read cutover** is the playbook for **datastore migrations** (and is
  how big companies move between databases live); **CDC** (recall outbox/CDC) can drive replication to
  the new store.
- **Strangler fig** (next module) is the app-level analogue — incrementally route functionality to the
  new system.
- De-risked with **feature flags, shadow reads, canary %, reconciliation, and instant rollback** (recall
  canary deploys, blast radius).

## Common misconception — "take a maintenance window and run the migration"

For always-on systems, the safe approach is **incremental, backward-compatible coexistence** — not a
big-bang cutover (which means downtime *and* high risk).

```reveal
{
  "prompt": "Why is a 'big-bang' migration (maintenance window: stop, migrate, restart) both higher-risk and often unacceptable, and what's the alternative?",
  "answer": "It's unacceptable for always-on systems because it requires downtime — stopping the service while you migrate — which many products simply can't afford (24/7 users, SLAs, revenue, global traffic with no quiet hours). But beyond downtime, it's also far higher-RISK because it's all-or-nothing and largely irreversible under pressure: you make a breaking change in one step, and if anything goes wrong mid-migration (a bug in the migration script, data that doesn't convert cleanly, the migration taking longer than the window, the new code failing on the new schema), you're stuck with a partially-migrated system, users waiting, and a hard choice between pressing forward or attempting a risky rollback — all during an outage with the clock running. There's no gradual verification, no canary, no easy rollback, and the blast radius is 100% of users at once. The alternative — expand/contract / parallel change — removes both problems by migrating incrementally with old and new coexisting: add the new schema additively (non-breaking), dual-write to old and new, backfill history gently, verify the new path (shadow reads, reconciliation) under real load, switch reads gradually behind a feature flag (canary by %), and only drop the old (the irreversible step) last, after the new path is proven. At every moment the live system works, there's no downtime, each step is small and reversible (flip the flag back, the old data/path still exists), and the blast radius is controlled (ramp slowly, roll back instantly). You trade a single scary cutover for a longer but safe, observable, reversible sequence. So for live systems the right model is 'coexist and converge incrementally with cheap rollback,' not 'big-bang in a maintenance window' — the latter buys apparent simplicity at the cost of downtime and a high-stakes, hard-to-reverse failure mode. (Maintenance windows still have a place for small, low-traffic, or genuinely offline systems, but not for always-on services or risky large migrations.)"
}
```

**Zero-downtime migration** evolves a live system in **small, backward-compatible, reversible steps**
where **old and new coexist** — the **expand/contract** pattern: **expand** (add new) → **dual-write** →
**backfill** → **switch reads** (after verifying) → **contract** (drop old, last). Datastore moves use
**dual-write + backfill + gradual read cutover** (de-risked with **feature flags, shadow reads, canary,
reconciliation, rollback**). A **big-bang maintenance-window cutover** means downtime *and* high,
irreversible risk.

## Self-test

```quiz
{
  "question": "The expand/contract pattern for a zero-downtime column rename does the irreversible step (dropping the old column):",
  "options": [
    "First, to save space",
    "Last — only after adding the new column, dual-writing, backfilling, and switching reads to the verified new column",
    "Never",
    "Simultaneously with adding the new column"
  ],
  "answer": 1,
  "explanation": "Additive/reversible steps come first (so you can roll back); the breaking, irreversible drop happens last, after the new path is proven."
}
```

```quiz
{
  "question": "In a zero-downtime datastore migration, why dual-write to both old and new AND backfill?",
  "options": [
    "To use more storage",
    "Dual-write keeps NEW data current in both; backfill copies OLD historical data — together they make the new store complete before you switch reads",
    "To avoid using a feature flag",
    "Because backfill replaces dual-writing"
  ],
  "answer": 1,
  "explanation": "Dual-write covers ongoing changes; backfill covers pre-existing rows — both are needed so the new store is fully populated before reads switch (and old stays as a rollback)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Zero-downtime migration — key terms", "cards": [
  { "front": "Expand/contract (parallel change)", "back": "Migrate live by evolving in small backward-compatible steps where old and new coexist: expand (add new) → dual-write → backfill → switch reads → contract (drop old, last)." },
  { "front": "Dual-write", "back": "Deploy code that writes every change to BOTH the old and new columns/stores while still reading the old (the source of truth), keeping new data current in both." },
  { "front": "Backfill", "back": "Copy historical rows' old → new in throttled, idempotent, resumable batches, so pre-existing data populates the new column/store without overloading the database." },
  { "front": "Contract step", "back": "The final, irreversible step: stop writing the old column and drop it — done last, only after the new path is verified and proven safely in production." },
  { "front": "Why dual-write AND backfill", "back": "Dual-write covers new/updated rows going forward; backfill covers pre-existing historical rows. Both are needed so the new column is complete before you switch reads." },
  { "front": "De-risking a cutover", "back": "Feature flags (instant read-path switch), shadow reads (compare old vs new), canary by %, reconciliation, and instant rollback — keeping the blast radius small." }
] }
```

## Key takeaways

- **Zero-downtime migration** = evolve a live system in **small, backward-compatible, reversible steps**
  with **old and new coexisting** — never a big-bang breaking change.
- **Expand/contract (parallel change):** **expand** (add new, additive) → **dual-write** (new data to
  both) → **backfill** (old data) → **switch reads** (after verifying) → **contract** (drop old —
  irreversible, **last**).
- Scale it to **datastore moves** with **dual-write + backfill + gradual read cutover** (CDC can help);
  **online schema tools** (gh-ost/pt-osc) avoid locking; backfills must be **gentle, idempotent,
  resumable**.
- **De-risk** with **feature flags, shadow reads, canary %, reconciliation, instant rollback**, and a
  small **blast radius** — a **maintenance-window cutover** means downtime *and* high irreversible risk.

## Up next

That completes resilience & failure at scale. The final module covers operating and structuring systems
well. First: **SLIs, SLOs & Error Budgets**.
