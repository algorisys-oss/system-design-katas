---
title: "Multi-Tenancy"
slug: multi-tenancy
level: advanced
module: global-scale
order: 32
reading_time_min: 14
concepts: [multi-tenancy, isolation, shared-vs-siloed, noisy-neighbor, tenant-id, data-isolation]
use_cases: []
prerequisites: [database-sharding, database-federation, stateful-vs-stateless-services]
status: published
---

# Multi-Tenancy

## Hook — a motivating scenario

You run a SaaS app for 5,000 companies. Do you give each company its own database/servers (strong
isolation, but 5,000 things to run and pay for), or put everyone in **shared** infrastructure with a
`tenant_id` column (cheap and simple, but one bug or one heavy customer can affect everyone)?
**Multi-tenancy** is how one system serves many customers (tenants) — and the central decision is **how
much to isolate** them.

## Mental model — one system, many tenants, a sliding isolation scale

**Multi-tenancy** means a single application/infrastructure serves **multiple tenants** (customers/orgs)
whose data and activity must stay **logically separated**. The core design axis is **isolation vs
sharing**, a spectrum from fully shared to fully siloed.

Think of it as **housing**: a **shared (pooled)** system is an **apartment building** — everyone shares
the walls, plumbing, and electrical, so it's cheap and dense, but a noisy neighbor bleeds through and one
burst pipe can flood several units. A **siloed** system is a row of **standalone houses** — each tenant
gets private walls and utilities (strong isolation, no shared blast radius), but you pay to build and
maintain N separate houses. Most real SaaS, like most real cities, is a **mix**: apartments for the many
small tenants, detached houses for the few who need (and will pay for) privacy.

```compare
{
  "options": [
    { "label": "Shared (pooled)", "points": ["All tenants share DB/tables/compute; rows tagged with tenant_id", "Cheapest, most efficient, easy to manage at scale", "Weakest isolation: noisy-neighbor + data-leak risk", "Great for many small tenants"] },
    { "label": "Siloed (isolated)", "points": ["Each tenant gets own DB / schema / instance", "Strong isolation, security, per-tenant tuning/compliance", "Costly + operationally heavy (N of everything)", "Great for few large/regulated tenants"] }
  ]
}
```

Common middle grounds: **shared compute + per-tenant database/schema**, or **pooled by default + siloed
for big/enterprise tenants** (a hybrid "pods/cells" model).

## Build it up — the two big risks of sharing

Sharing infrastructure introduces two dangers you must engineer against:
- **Data isolation (the security risk):** with shared tables, **every query must be scoped by
  `tenant_id`** — one missing `WHERE tenant_id = ?` leaks one tenant's data to another (a serious
  breach). You enforce it with **row-level security**, a mandatory tenant filter in the data layer, or
  per-tenant schemas/keys — never relying on developers to remember.
- **Noisy neighbor (the performance risk):** in shared compute/storage, one tenant's heavy load
  (a huge query, a traffic spike) can **starve everyone else** (recall resource saturation). You
  mitigate with **per-tenant rate limits/quotas, resource isolation (bulkheads), and fair scheduling**
  — or by **siloing** the heavy tenant.

```reveal
{
  "prompt": "In a shared-table multi-tenant system, why is the tenant_id filter a security-critical concern, and how do you enforce it robustly rather than trusting every query?",
  "answer": "Because in a shared table, all tenants' rows live together, so the ONLY thing separating tenant A's data from tenant B's is the tenant_id predicate on each query. If a single query anywhere in the codebase omits or gets the tenant filter wrong (a forgotten WHERE tenant_id = ?, a join that drops it, an admin/report query, a new feature), it can return or modify another tenant's data — a cross-tenant data leak, which is among the most severe SaaS security failures (breach of confidentiality, compliance violation, loss of trust). Relying on every developer to remember the filter on every query is fragile: it's a single forgotten clause away from disaster, and it won't survive refactors, new endpoints, or ad-hoc queries. So you enforce isolation structurally, below the application code: (1) database row-level security (RLS) — e.g. Postgres RLS policies that automatically restrict every query to the current tenant based on a session variable, so even a query missing the filter is constrained by the DB; (2) a mandatory data-access layer / ORM scoping that injects the tenant predicate centrally so application code physically can't issue an unscoped query; (3) per-tenant schemas or databases, where the tenant boundary is the schema/connection itself, not a column (stronger isolation, more overhead); (4) per-tenant encryption keys so even leaked rows are unreadable. You also add defense in depth: tests that assert cross-tenant access fails, query auditing, and least-privilege DB roles. The principle is to make correct tenant isolation the default that's enforced by the platform (DB/middleware), not an opt-in each query must remember — because the cost of one mistake is a cross-tenant breach. Shared-table multi-tenancy is efficient, but it puts the entire isolation burden on a filter, so that filter must be guaranteed by the system, not by discipline."
}
```

## Build it up — choosing isolation, and tenant-aware everything

The isolation choice is driven by **tenant size/count, security/compliance needs, and cost**:
- **Many small tenants + cost-sensitive → pooled/shared** (one DB, `tenant_id`): most efficient; manage
  noisy-neighbor + isolation carefully.
- **Few large/regulated tenants (compliance, data residency, custom SLAs) → siloed** (own DB/instance):
  strong isolation worth the cost.
- **Hybrid (common):** pool small tenants; silo big/enterprise ones; or group tenants into **cells/pods**
  (each a shared stack for a subset) to bound blast radius (recall blast radius — coming up).

Everything becomes **tenant-aware**: requests carry a **tenant context**, and routing, caching (keys
namespaced by tenant), rate limits, metrics, and backups are all **per-tenant**.

```reveal
{
  "prompt": "What factors push you toward siloed (per-tenant) isolation vs pooled (shared), and why is a hybrid often best?",
  "answer": "Push toward siloed (each tenant own DB/schema/instance) when: security/compliance demands hard isolation (regulated industries, data-residency requirements, contractual single-tenancy); tenants are few but large, so the per-tenant overhead is acceptable and pooling them risks severe noisy-neighbor effects; you need per-tenant tuning, custom SLAs, independent scaling, or per-tenant backup/restore and encryption; or blast-radius concerns make co-locating tenants unacceptable. Siloing gives the strongest isolation and predictability but multiplies cost and operational burden (N databases/instances to deploy, patch, monitor, back up) and is wasteful for many small tenants. Push toward pooled (shared tables with tenant_id) when: you have many small tenants and cost-efficiency/density matters; tenants are similar and individually light; and you can robustly enforce data isolation (RLS/centralized scoping) and noisy-neighbor controls (quotas/rate limits/fair scheduling). Pooling is cheapest and simplest to operate at scale but has the weakest isolation and concentrates risk (one bug → cross-tenant leak; one heavy tenant → degrades all). A hybrid is often best because real customer bases are bimodal: lots of small tenants plus a few big/enterprise/regulated ones. You pool the long tail of small tenants for efficiency, and silo (or give dedicated cells to) the large/regulated ones that need isolation, compliance, or custom SLAs — getting cost-efficiency where you can and strong isolation where you must. The 'cells/pods' pattern generalizes this: group tenants into multiple shared stacks so each cell holds a bounded subset, limiting blast radius (a failure or noisy neighbor affects only that cell, not all tenants) while retaining most of pooling's efficiency. So the decision isn't all-or-nothing; you match isolation level to each tenant's size, risk, and requirements, and use cells to cap the blast radius of the shared tiers."
}
```

Drag the isolation dial from fully shared to fully siloed to see what you trade at each step:

```tradeoff
{ "title": "How much should you isolate tenants?", "axis": { "left": "Pooled / shared", "right": "Siloed / isolated" }, "steps": [ { "label": "Fully pooled", "detail": "All tenants share DB, tables, and compute; rows tagged with tenant_id. Cheapest and most efficient, easy to manage at scale, but weakest isolation: noisy-neighbor and data-leak risk." }, { "label": "Shared compute + per-tenant schema/DB", "detail": "Tenants share the app tier but get their own database or schema. Stronger data isolation than a shared table while keeping compute efficient — a common middle ground." }, { "label": "Cells / pods", "detail": "Group tenants into multiple shared stacks, each holding a bounded subset. Caps blast radius (a failure or noisy neighbor hits only that cell) while keeping most of pooling's efficiency." }, { "label": "Fully siloed", "detail": "Each tenant gets its own DB, schema, or instance. Strong isolation, security, per-tenant tuning and compliance — but costly and operationally heavy (N of everything)." } ] }
```

## In the wild

- **SaaS platforms** universally face this: Salesforce/Workday (heavily pooled with strong logical
  isolation), many B2B SaaS use **pooled + tenant_id** with **row-level security**; enterprise tiers
  often get **siloed** databases/instances.
- **Postgres row-level security**, per-tenant schemas, and **per-tenant encryption keys** are common
  isolation mechanisms; **cells/pods** bound blast radius (recall — next module).
- It composes with **sharding** (shard by tenant_id) and **federation/polyglot** (recall) — and with
  **rate limiting/quotas** for noisy-neighbor control.
- **Tenant context** flows through routing, caching (namespaced keys), metrics, and backups.

## Common misconception — "give every tenant their own database (max isolation) — or just share everything (max simplicity)"

Neither extreme is universally right; isolation is a **per-tenant cost/risk trade-off** (often hybrid).

```reveal
{
  "prompt": "Why are both 'always silo every tenant' and 'always share everything' wrong as universal rules?",
  "answer": "Because isolation is a trade-off between cost/efficiency and security/blast-radius that depends on tenant size, count, and requirements — so neither extreme fits all cases. 'Always silo every tenant' (own DB/instance per tenant) maximizes isolation and compliance but is operationally and financially crippling at scale: thousands of small tenants would mean thousands of databases/instances to provision, patch, monitor, back up, and pay for, with terrible resource utilization (each mostly idle) and slow onboarding — wildly over-engineered for small, low-risk customers. 'Always share everything' (one pool, tenant_id) maximizes efficiency and simplicity but concentrates risk: the weakest isolation means a single missing tenant filter can leak data across tenants, and one heavy tenant can noisy-neighbor everyone; for large or regulated tenants needing compliance, data residency, custom SLAs, or guaranteed performance, pure pooling is unacceptable. The right approach matches isolation to each tenant's profile: pool the long tail of many small, similar, low-risk tenants for cost-efficiency (with robust RLS/scoping and quotas to manage the two big risks), and silo or give dedicated cells to the few large/enterprise/regulated tenants that justify the overhead. This hybrid (often via cells/pods that bound blast radius) captures most of pooling's efficiency while providing strong isolation where it's needed. So the universal rules fail because they ignore the heterogeneity of real tenant bases and the cost/risk/compliance trade-offs; multi-tenancy design is about choosing the appropriate point on the isolation spectrum per tenant (or tenant tier), not a one-size-fits-all extreme."
}
```

**Multi-tenancy** serves many tenants from one system along an **isolation spectrum**: **pooled/shared**
(cheap, efficient — but **noisy-neighbor** + **data-leak** risks) ↔ **siloed** (strong isolation,
compliance — but costly). Sharing demands **enforced tenant_id isolation** (RLS/centralized scoping)
and **noisy-neighbor controls** (quotas/bulkheads). The best design is usually **hybrid** (pool small,
silo big; cells/pods to bound blast radius) — match isolation to each tenant's **size, risk, and
compliance**.

## Self-test

```quiz
{
  "question": "The central design decision in multi-tenancy is:",
  "options": [
    "Which programming language to use",
    "How much to isolate tenants — from fully shared/pooled (cheap, weak isolation) to fully siloed (strong isolation, costly)",
    "Whether to use a CDN",
    "How to name the database"
  ],
  "answer": 1,
  "explanation": "Multi-tenancy is one system serving many tenants; the key axis is the isolation-vs-sharing spectrum (pooled ↔ siloed), often hybrid."
}
```

```quiz
{
  "question": "Two key risks of a shared (pooled) multi-tenant design are:",
  "options": [
    "Too much isolation and high cost",
    "Cross-tenant data leaks (a missing tenant_id filter) and noisy neighbors (one tenant starving others)",
    "Slow DNS and large images",
    "Too many databases to manage"
  ],
  "answer": 1,
  "explanation": "Shared tables make the tenant_id filter security-critical (enforce via RLS/scoping), and shared resources let one tenant degrade others (use quotas/bulkheads)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Multi-tenancy — key terms", "cards": [ { "front": "Multi-tenancy", "back": "A single application/infrastructure serving multiple tenants (customers/orgs) whose data and activity must stay logically separated. The core design axis is isolation vs sharing." }, { "front": "Pooled (shared) tenancy", "back": "All tenants share DB, tables, and compute, with rows tagged by tenant_id. Cheapest and most efficient, but weakest isolation — prone to noisy-neighbor and data-leak risks." }, { "front": "Siloed (isolated) tenancy", "back": "Each tenant gets its own DB, schema, or instance. Strong isolation, security, per-tenant tuning and compliance — but costly and operationally heavy (N of everything)." }, { "front": "Data isolation (the security risk)", "back": "In shared tables, only the tenant_id predicate separates tenants; one missing WHERE tenant_id = ? leaks data. Enforce structurally via row-level security or centralized scoping, never per-query discipline." }, { "front": "Noisy neighbor", "back": "In shared compute/storage, one tenant's heavy load (a huge query or spike) can starve everyone else. Mitigate with per-tenant rate limits/quotas, bulkheads, and fair scheduling — or silo the heavy tenant." }, { "front": "Cells / pods", "back": "Grouping tenants into multiple shared stacks, each serving a bounded subset, to limit blast radius — a failure or noisy neighbor affects only that cell while retaining most of pooling's efficiency." } ] }
```

## Key takeaways

- **Multi-tenancy** = one system serving many **tenants**, kept **logically separated**; the core axis
  is **isolation vs sharing** (**pooled ↔ siloed**).
- **Pooled/shared** (one DB, `tenant_id`) is **cheap and efficient** but has **data-leak** and
  **noisy-neighbor** risks; **siloed** (per-tenant DB/instance) gives **strong isolation/compliance** at
  **high cost**.
- Sharing requires **enforced tenant isolation** (row-level security / centralized scoping — never
  per-query discipline) and **noisy-neighbor controls** (per-tenant **quotas/rate limits/bulkheads**).
- The best design is usually **hybrid** (pool small tenants, silo big/regulated ones; **cells/pods** to
  bound blast radius) — match isolation to each tenant's **size, risk, and compliance**.

## Up next

How requests get routed and managed between clients and many services. Next: **API Gateway vs Service
Mesh**.
