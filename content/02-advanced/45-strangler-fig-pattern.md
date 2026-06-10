---
title: "Strangler Fig Pattern"
slug: strangler-fig-pattern
level: advanced
module: operability-and-patterns
order: 45
reading_time_min: 13
concepts: [strangler-fig, incremental-migration, legacy-modernization, facade, routing, big-bang-rewrite]
use_cases: []
prerequisites: [monoliths-vs-microservices, zero-downtime-migration, api-gateway]
status: published
---

# Strangler Fig Pattern

## Hook — a motivating scenario

You have a 10-year-old monolith that's hard to change but runs the business. The tempting move — a
**big-bang rewrite** ("we'll build the new system and switch over") — is also the most famous way to
fail: it takes years, the old system keeps changing underneath you, and the risky all-at-once cutover
often never ships. The **strangler fig pattern** modernizes incrementally instead: build the new system
**around** the old, **route functionality to it piece by piece**, and retire the old gradually — until
it's gone.

## Mental model — grow the new around the old, replace piece by piece

The name comes from the **strangler fig vine**, which grows around a host tree and gradually replaces it.
The pattern: put a **facade/router** (often an **API gateway** or proxy, recall) in front of the legacy
system, then **incrementally reimplement** pieces of functionality in the new system and **route those
requests to the new code**, leaving the rest on the legacy system — until, over time, **everything has
moved** and the legacy system can be **switched off**.

```stepper
{
  "title": "Strangling the monolith, piece by piece",
  "steps": [
    { "title": "1 · Put a facade in front", "body": "Route all traffic through a proxy/gateway pointing at the legacy system (no behavior change yet)." },
    { "title": "2 · Reimplement one piece", "body": "Build one feature/capability in the new system; route just that route/endpoint to it." },
    { "title": "3 · Repeat, expanding coverage", "body": "Migrate more pieces incrementally; the facade routes each to old or new. Both coexist." },
    { "title": "4 · Retire the legacy", "body": "Once all functionality is migrated, remove the legacy system and (optionally) the facade." }
  ]
}
```

## Build it up — why incremental beats big-bang

The strangler fig wins because each step is **small, shippable, and reversible**, and **value is
delivered continuously** — not all at the end:
- **Reduced risk / small blast radius:** you migrate **one piece at a time**, validate it in production
  (canary, recall), and **roll back** that piece if it misbehaves — vs a big-bang cutover where
  *everything* changes at once and failure is catastrophic (recall blast radius, zero-downtime
  migration).
- **Continuous delivery of value:** improvements ship **incrementally**; you're never sitting on a
  years-long rewrite with nothing in production.
- **The old system keeps working** throughout (and keeps getting urgent fixes) — old and new **coexist**,
  with the facade routing between them (the app-level analogue of dual-running in zero-downtime
  migration, recall).

```reveal
{
  "prompt": "Why do big-bang rewrites so often fail, and how does the strangler fig pattern avoid those failure modes?",
  "answer": "Big-bang rewrites ('build the whole new system, then switch over') fail for several compounding reasons. (1) Moving target: the legacy system keeps evolving (bug fixes, new features the business demands) while you rewrite, so the new system is chasing a spec that never stands still — you're never 'done.' (2) Underestimated complexity: the old system encodes years of accumulated, often undocumented, business logic and edge cases; reproducing all of it is far bigger than it looks, so timelines stretch into years. (3) No value until the end: you invest enormous effort with nothing in production for a long time, making it hard to justify, easy to cancel, and impossible to validate incrementally — feedback only comes at the risky end. (4) Catastrophic cutover: switching everything at once is all-or-nothing and high-risk; if the new system has problems (and it will, at full scale with real data), the blast radius is the entire system, and rollback is hard, so the cutover is terrifying and often repeatedly delayed or abandoned. The strangler fig pattern avoids all of these by being incremental: you put a facade/router in front and migrate ONE piece at a time, so (1) you can keep up with legacy changes (migrate stable pieces, and the still-evolving parts stay on legacy until ready), (2) complexity is tackled in small, comprehensible chunks rather than all at once, (3) each migrated piece delivers value and runs in production immediately, giving continuous feedback and ROI rather than a multi-year bet, and (4) risk is bounded — each step is small, validated in production (canary), and reversible by rerouting that piece back to legacy if it misbehaves (small blast radius, easy rollback), with old and new coexisting throughout so the system always works. You never do a scary all-at-once switch; the legacy system is 'strangled' gradually until it can be safely retired. So the strangler fig converts a high-risk, value-at-the-end, moving-target megaproject into a series of low-risk, value-delivering, reversible increments — which is why it's the recommended approach for modernizing legacy systems, while big-bang rewrites are a classic, well-documented way to fail."
}
```

## Build it up — making it work (and when not to)

- **The facade/router is key:** an **API gateway**, reverse proxy, or routing layer (recall) decides
  per-request whether to send it to legacy or new — enabling **gradual, reversible** migration and
  **canary** routing (a % to new).
- **Handle shared data carefully:** old and new often need the **same data**; use the **zero-downtime
  migration** techniques (dual-write, sync, CDC — recall) so both stay consistent during the transition,
  or keep one as the source of truth and sync.
- **Anti-corruption layer:** put a translation layer between new and legacy so the **legacy model doesn't
  contaminate** the new system's design (DDD term).
- **When not to:** for **small** systems, a clean rewrite may genuinely be simpler than the facade +
  coexistence machinery; the strangler fig shines for **large, business-critical, long-lived** systems
  where big-bang risk is unacceptable.

```reveal
{
  "prompt": "What practical mechanisms make the strangler fig pattern work, and is incremental migration always the right choice?",
  "answer": "The mechanisms: (1) A facade/router in front of everything — typically an API gateway or reverse proxy — that intercepts all requests and routes each to either the legacy system or the new implementation based on configurable rules (by route/endpoint, feature, user %, etc.). This is what enables migrating piece by piece, doing canary rollouts (send a small % of a route's traffic to the new code), and rolling back instantly by rerouting to legacy if something breaks. (2) Shared-data handling — because old and new code often operate on the same data, you apply zero-downtime-migration techniques: keep a clear source of truth and synchronize (dual-write, replication, or change-data-capture/CDC) so both systems see consistent data during the long coexistence period; mishandling this is a common failure point. (3) An anti-corruption layer (from DDD) — a translation/adapter layer between the new system and the legacy one so the legacy's (often messy) data model and assumptions don't leak into and corrupt the new system's cleaner design; the new code talks to the legacy through this boundary. (4) Incremental, validated steps — migrate stable, well-understood pieces first, validate each in production with observability/SLOs and canaries, and expand coverage over time until legacy can be retired. Is incremental always right? No. The strangler fig adds real machinery and cost: the facade/routing layer, running two systems in parallel, data synchronization, and an anti-corruption layer — overhead that's justified for LARGE, business-critical, long-lived systems where a big-bang rewrite's risk (catastrophic cutover, years with no value, moving target) is unacceptable. For SMALL systems or simple components, that overhead can exceed the benefit: a clean, well-tested rewrite-and-switch (possibly with a brief maintenance window if downtime is acceptable) may genuinely be simpler and faster, since the coexistence/sync complexity isn't worth it for a system you can rebuild quickly and cut over safely. So the strangler fig is the default for de-risking large legacy modernization, but the decision depends on size, criticality, and the cost of the cutover; match the approach to the risk — incremental when big-bang is too dangerous, direct rewrite when the system is small enough that incremental machinery is overkill."
}
```

## In the wild

- **Legacy modernization** (monolith → microservices, mainframe → modern stack) is the classic use;
  **Martin Fowler** popularized the term (2004), drawing on **Paul Hammant**'s documented strangler
  migrations. Widely used to de-risk large rewrites.
- **Named cases:** **Netflix** spent roughly **7 years (2009–2016)** moving off its monolithic
  data-center stack to hundreds of microservices on AWS — incrementally, service by service, never a
  big-bang cutover. **Amazon** likewise decomposed its original monolith ("Obidos") into services
  over years rather than rewriting at once. The common thread: a **multi-year, piece-by-piece** strangle,
  not a single switch.
- **Implemented with an API gateway / reverse proxy** (recall) for per-route routing, plus
  **zero-downtime migration** techniques (dual-write/CDC — recall) for shared data and an
  **anti-corruption layer** for clean boundaries.
- Pairs with **canary/progressive delivery** (recall) — route a % of traffic to the new piece, validate,
  ramp.
- Connects to **monoliths→microservices** decomposition (recall) — strangle the monolith one bounded
  context at a time.

## Common misconception — "rewrite it cleanly from scratch and switch over"

The big-bang rewrite is a classic failure mode; **incremental strangling** is the lower-risk default for
large systems.

```reveal
{
  "prompt": "Why is 'let's just rewrite it from scratch and switch over' usually the wrong instinct for a large legacy system?",
  "answer": "Because the big-bang rewrite-and-switch is one of the most reliably failure-prone approaches in software, especially for large, business-critical, long-lived systems — for reasons that are structural, not just execution problems. The legacy system embodies years of accumulated, often undocumented business logic and hard-won edge-case handling, so faithfully reproducing it is far larger than it appears, and underestimating that scope is near-universal. Meanwhile the old system can't be frozen — the business needs ongoing fixes and features — so it's a moving target the rewrite must keep chasing, meaning 'done' recedes. You also get no value and little validation until the very end: a multi-year effort with nothing in production is hard to fund, easy to cancel, and gives no real-world feedback until the risky finale. And the cutover itself is all-or-nothing: switching everything at once at full scale with real data invariably surfaces problems, but now the blast radius is the entire system and rollback is hard, so the cutover is terrifying, repeatedly delayed, and frequently never completed (the famous 'rewrite that shipped years late or never'). The strangler fig pattern is the lower-risk default precisely because it inverts every one of these: incremental migration of one piece at a time (tractable scope, can keep pace with legacy changes), continuous delivery of value and feedback (each migrated piece runs in production immediately), bounded risk with small blast radius and easy rollback (reroute a piece back to legacy via the facade), and no catastrophic cutover (old and new coexist, legacy is retired only after everything has moved). So 'rewrite from scratch and switch' is usually wrong for large systems because it maximizes risk, delays value, and fights a moving target — while strangling the system incrementally delivers modernization safely and continuously. (For small systems where a rewrite is quick and the cutover is low-risk, a direct rewrite can be fine — but for large, critical legacy, incremental strangling is the recommended approach.)"
}
```

The **strangler fig pattern** modernizes a legacy system **incrementally**: put a **facade/router** in
front, **reimplement and reroute functionality piece by piece** (old and new coexist), and **retire the
legacy gradually**. It beats the **big-bang rewrite** by being **low-risk, reversible, and
value-delivering throughout**. Make it work with an **API gateway, zero-downtime data techniques
(dual-write/CDC), and an anti-corruption layer**; a clean rewrite may suit only **small** systems.

## Self-test

```quiz
{
  "question": "The strangler fig pattern modernizes a legacy system by:",
  "options": [
    "Rewriting everything and switching over at once",
    "Putting a facade/router in front and incrementally reimplementing + rerouting functionality piece by piece until the legacy can be retired",
    "Freezing all changes for a year",
    "Adding more servers to the monolith"
  ],
  "answer": 1,
  "explanation": "It grows the new system around the old, migrating one piece at a time (old + new coexist via the facade), avoiding a risky big-bang cutover."
}
```

```quiz
{
  "question": "A key advantage of strangler fig over a big-bang rewrite is:",
  "options": [
    "It's always faster to finish",
    "Each step is small, shippable, and reversible (small blast radius, roll back a piece) and delivers value incrementally — vs an all-at-once, high-risk cutover",
    "It requires no facade or routing",
    "It needs no data synchronization"
  ],
  "answer": 1,
  "explanation": "Incremental migration bounds risk and delivers value throughout; big-bang rewrites chase a moving target, deliver value only at the end, and risk catastrophic cutover."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Strangler fig pattern — key terms", "cards": [
  { "front": "Strangler fig pattern", "back": "Modernize a legacy system incrementally: build the new system around the old, reroute functionality piece by piece, and retire the legacy gradually until it's gone." },
  { "front": "Big-bang rewrite", "back": "Build a whole new system then switch over at once. A classic failure mode: chases a moving target, delivers value only at the end, and risks a catastrophic cutover." },
  { "front": "Facade / router", "back": "An API gateway, reverse proxy, or routing layer in front of everything that decides per request whether to send it to legacy or new, enabling gradual, reversible, canary migration." },
  { "front": "Anti-corruption layer", "back": "A DDD translation layer between new and legacy so the legacy model and assumptions don't contaminate the new system's cleaner design." },
  { "front": "Coexistence (shared data)", "back": "Old and new run together during migration; use zero-downtime techniques (dual-write, sync, CDC) so both stay consistent, keeping a clear source of truth." },
  { "front": "When NOT to use it", "back": "For small systems, a clean rewrite may be simpler than the facade and coexistence machinery; the strangler fig shines for large, business-critical, long-lived systems." }
] }
```

## Key takeaways

- The **strangler fig pattern** modernizes legacy systems **incrementally**: a **facade/router** in
  front, **reimplement + reroute functionality piece by piece** (old + new coexist), then **retire the
  legacy gradually**.
- It beats the **big-bang rewrite** (a classic failure mode: moving target, value only at the end,
  catastrophic cutover) by being **small-step, reversible, low-blast-radius, and value-delivering
  throughout**.
- Make it work with an **API gateway/proxy** for per-route routing, **zero-downtime data techniques**
  (dual-write/CDC) for shared data, and an **anti-corruption layer** to protect the new design.
- It's the default for **large, critical, long-lived** systems; a clean rewrite may suit only **small**
  ones. It's the app-level form of incremental migration.

## Up next

A structural pattern for keeping business logic clean and testable. Next: **Hexagonal Architecture**.
