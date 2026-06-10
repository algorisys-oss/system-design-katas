---
title: "Monoliths vs Microservices"
slug: monoliths-vs-microservices
level: intermediate
module: architecture-and-services
order: 0
reading_time_min: 16
concepts: [monolith, microservices, coupling, deployment, distributed-systems, conway]
use_cases: []
prerequisites: [client-server-and-anatomy-of-a-request, vertical-vs-horizontal-scaling]
status: published
---

# Monoliths vs Microservices

## Hook — a motivating scenario

Your startup's app is one codebase, one deploy. It's been great — until the team grows to 40
engineers all stepping on each other in the same repo, one bad deploy takes down everything, and the
payments code can't scale independently of image processing. "Let's go microservices!" someone says.
Six months later you have 30 services, a distributed-systems debugging nightmare, and things are
*slower*. Both the monolith pain and the microservices pain are real — knowing which trade-off you're
choosing is the whole point of this chapter.

## Mental model — one big house vs a neighborhood of houses

- A **monolith** is one big house: all rooms (modules) under one roof, sharing utilities. Easy to
  build and move around in — but everyone shares the same walls, and you can't renovate the kitchen
  without affecting the house.
- **Microservices** are a neighborhood of small houses: each independently owned, built, and
  renovated — but now they must communicate over the street (the network), and coordinating the whole
  neighborhood is harder.

The core trade is **simplicity (monolith)** vs **independence (microservices)** — and that
independence is bought with **distributed-systems complexity**.

```compare
{
  "options": [
    { "label": "Monolith", "points": ["One codebase, one deploy", "Simple: in-process calls, one DB, easy local dev", "Scales as one unit; one bug can affect all", "Best early, small teams, unclear domains"] },
    { "label": "Microservices", "points": ["Many independently-deployed services", "Independent scaling, tech, and teams", "Network calls, distributed failures, ops overhead", "Best at scale, large orgs, clear bounded contexts"] }
  ]
}
```

## Build it up — what you gain and what it costs

**Microservices give you independence:**
- **Deploy independently** — ship the payments service without redeploying everything.
- **Scale independently** — run 20 instances of the hot service, 2 of the rest.
- **Team autonomy** — each team owns a service end to end (Conway's Law: systems mirror org
  structure).
- **Tech flexibility** — the right language/datastore per service.

**But you pay for it with distributed-systems complexity:**
- In-process function calls become **network calls** — slow, and they can fail/timeout (recall
  latency numbers, idempotency).
- One database becomes **many**, so cross-service transactions and joins get hard (no ACID across
  services).
- You need **service discovery, an API gateway, distributed tracing, and robust monitoring** just to
  operate.
- **Testing and debugging** span many services — a request hops through several before failing.

```reveal
{
  "prompt": "A team splits a working monolith into 15 microservices and finds the system is now slower and buggier. What likely went wrong?",
  "answer": "They paid the distributed-systems tax without needing it yet. In-process calls became chatty network calls (adding latency and new failure modes), one DB became many (breaking easy transactions/joins), and they now need gateways, discovery, tracing, and per-service ops they didn't have. Often the split also followed the wrong boundaries (services that must change together, so every feature touches several), creating a 'distributed monolith' — all the cost, none of the independence. Microservices solve organizational/scaling problems; applied to a small app with unclear boundaries, they add complexity for no benefit."
}
```

## Build it up — start monolith, split when it hurts

The widely-followed guidance is **"monolith first"**: start with a (well-structured, modular)
monolith, and extract services only when a real, specific pain appears — a module that must scale
independently, a team that needs to deploy without coordination, or a bounded context that's clearly
separate. Split along **bounded contexts** (business capabilities that change together), not
arbitrarily.

A **modular monolith** (clear internal module boundaries, one deploy) gives much of the
maintainability benefit without the distributed cost — and makes later extraction easier.

```reveal
{
  "prompt": "How do you decide WHERE to draw a service boundary when extracting from a monolith?",
  "answer": "Along bounded contexts — cohesive business capabilities whose data and logic change together (e.g. 'payments', 'catalog', 'notifications'). A good boundary minimizes cross-service calls and shared data: a service should own its data and expose a clear API, so it can be deployed and scaled independently. If two 'services' must always be changed and deployed together, the boundary is wrong (you've created a distributed monolith). Let team ownership and rate-of-change guide the cut, not technical layers (don't make a 'database service' and a 'UI service')."
}
```

Architecture is a dial from simplicity to independence — slide it as your team and scaling pains grow:

```tradeoff
{ "title": "How far toward microservices should you go?", "axis": { "left": "Simplicity (monolith)", "right": "Independence (microservices)" }, "steps": [ { "label": "Monolith", "detail": "One codebase, one deploy, in-process calls, one DB. Simplest to build, test, and run — best early, with a small team or an unclear domain." }, { "label": "Modular monolith", "detail": "Still one deploy, but clear internal module boundaries. Keeps maintainability without distributed cost and makes later extraction easier." }, { "label": "Extract a few services", "detail": "Split along bounded contexts only when a concrete pain appears — a module that must scale alone, or a team needing independent deploys." }, { "label": "Microservices", "detail": "Many independently-deployed services: full deploy/scale/tech autonomy, paid for with network calls, many databases, and heavy ops tooling. Best at scale with clear contexts." } ] }
```

## In the wild

- **Most successful systems started as monoliths** and extracted services as they scaled. Amazon
  spent the early-to-mid 2000s breaking up its `obidos` monolith into services; Netflix completed its
  monolith-to-cloud migration around 2008–2016 and now runs on the order of **1,000+ microservices**;
  Shopify deliberately kept a **modular ("majestic") monolith** — a multi-million-line Rails codebase —
  rather than splitting into microservices. Premature microservices is a common, expensive mistake.
- **Conway's Law** is real: independent teams want independently-deployable services; one team with
  one product is often better served by a monolith.
- **The "distributed monolith" anti-pattern** — services that must deploy together — is the worst of
  both worlds.
- Microservices presuppose the infrastructure in the rest of this course: gateways, async messaging,
  distributed caching, observability/tracing, and resilience patterns.

## Common misconception — "microservices are the modern, scalable, correct architecture"

They're a trade-off for specific problems, not a default upgrade.

```reveal
{
  "prompt": "Why isn't 'microservices' simply the better, more scalable choice that every serious system should adopt?",
  "answer": "Because the scalability they add is mostly organizational and operational, and it comes at a steep complexity cost that only pays off at a certain scale/team size. A monolith can scale a long way (horizontal scaling behind a load balancer, read replicas, caching — all from this course). Microservices add network latency, partial failures, eventual consistency, and heavy operational tooling. For a small team or unclear domain, that complexity slows you down and adds bugs. The right architecture depends on team size, organizational structure, and concrete scaling needs — not on what's fashionable. 'Right-sized' beats 'micro'."
}
```

Microservices solve **organizational scaling and independent deployment/scaling** — real problems at
large scale. They are not a universal upgrade; for many systems a well-structured monolith is the
better, simpler choice.

## Self-test

```quiz
{
  "question": "The primary cost you take on when moving from a monolith to microservices is:",
  "options": [
    "Slower local development only",
    "Distributed-systems complexity — network calls, partial failures, many databases, more ops tooling",
    "Higher cloud storage costs",
    "Losing the ability to use a database"
  ],
  "answer": 1,
  "explanation": "Independence is bought with distributed-systems complexity: network latency/failures, cross-service data, and operational overhead."
}
```

```quiz
{
  "question": "A 'distributed monolith' refers to:",
  "options": [
    "A monolith deployed on many servers",
    "Microservices that must be changed and deployed together — all the cost of microservices, none of the independence",
    "A microservice with its own database",
    "A monolith that uses microservice tools"
  ],
  "answer": 1,
  "explanation": "If services can't be deployed independently (wrong boundaries), you get the complexity of microservices without the benefit."
}
```

```quiz
{
  "question": "The common recommendation for a new product with a small team and unclear domain is to:",
  "options": [
    "Start with many microservices for future scale",
    "Start with a (modular) monolith and extract services only when a real pain appears",
    "Use one service per database table",
    "Avoid having any backend"
  ],
  "answer": 1,
  "explanation": "'Monolith first': start simple, split along bounded contexts when a concrete scaling/team/deploy pain justifies the distributed cost."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Monoliths vs microservices — key terms", "cards": [ { "front": "Monolith", "back": "One codebase, one deploy: in-process calls, one database, easy local dev. Scales as one unit and one bug can affect all. Best early, for small teams or unclear domains." }, { "front": "Microservices", "back": "Many independently-deployed services with independent scaling, tech, and team ownership — bought with network calls, distributed failures, and operational overhead." }, { "front": "Distributed-systems complexity", "back": "The cost of independence: in-process calls become network calls (slow, can fail), one DB becomes many (no cross-service ACID), plus discovery, gateways, tracing, and monitoring." }, { "front": "Bounded context", "back": "A cohesive business capability whose data and logic change together (e.g. payments, catalog). The right place to draw a service boundary so each service owns its data and a clear API." }, { "front": "Modular monolith", "back": "One deploy with clear internal module boundaries. Gives much of the maintainability benefit without distributed cost, and makes later extraction into services easier." }, { "front": "Distributed monolith", "back": "Anti-pattern: services that must be changed and deployed together — all the cost of microservices with none of the independence; the worst of both worlds." }, { "front": "Conway's Law", "back": "Systems mirror the organization that builds them. Independent teams want independently-deployable services; one team with one product is often better served by a monolith." } ] }
```

## Key takeaways

- **Monolith = simplicity** (one codebase/deploy, in-process calls, one DB); **microservices =
  independence** (deploy/scale/own per service) bought with **distributed-systems complexity**.
- Microservices solve **organizational and scaling** problems (Conway's Law) — not a default upgrade.
- **Start monolith (modular), split along bounded contexts** when a concrete pain appears; avoid the
  **distributed monolith**.
- Microservices presuppose the rest of this module: messaging, distributed caching, observability,
  and resilience.

## Up next

Independent services need to be scalable and replaceable — which starts with where they keep their
state. Next: **Stateful vs Stateless Services**.
