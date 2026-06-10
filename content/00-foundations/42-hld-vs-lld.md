---
title: "HLD vs LLD"
slug: hld-vs-lld
level: foundations
module: foundations-of-system-design
order: 42
reading_time_min: 12
concepts: [high-level-design, low-level-design, abstraction, components, interfaces]
use_cases: []
prerequisites: [client-server-and-anatomy-of-a-request]
status: published
---

# HLD vs LLD

## Hook — a motivating scenario

In an interview you're asked to "design Twitter." You start naming database columns and class methods
— and lose the room, because they wanted the *big picture* first: which services exist, how data
flows, where the bottlenecks are. The opposite mistake — staying vague when asked to design one
component — is just as costly. Knowing which **altitude** to design at, and when to switch, is a core
system-design skill.

## Mental model — the map vs the street view

- **High-Level Design (HLD)** is the **map**: the major components (services, databases, caches, load
  balancers, queues), how they connect, and how data flows between them. It answers *what are the
  pieces and how do they fit?*
- **Low-Level Design (LLD)** is the **street view**: the internals of one component — its classes,
  data structures, schemas, APIs, and algorithms. It answers *how is this piece actually built?*

You **zoom out for HLD, zoom in for LLD** — and good design moves deliberately between the two.

```compare
{
  "options": [
    { "label": "High-Level Design (HLD)", "points": ["System-wide: services, DBs, caches, queues", "Boxes-and-arrows data flow", "Scaling, bottlenecks, trade-offs", "Audience: architecture, the 'shape'"] },
    { "label": "Low-Level Design (LLD)", "points": ["Inside one component", "Classes, schemas, API contracts, algorithms", "Edge cases, concurrency, validation", "Audience: implementation details"] }
  ]
}
```

## Build it up — designing top-down

The reliable approach is **outside-in**:

1. **Clarify requirements** — functional (what it does) and non-functional (scale, latency,
   availability).
2. **HLD first** — sketch the major components and data flow; identify where load concentrates and
   what to scale (load balancer → stateless app servers → cache → DB → object storage — the shape
   you've built up across this course).
3. **Drill into LLD** — for the critical/complex components, design the schema, APIs, and key
   algorithms.
4. **Iterate** — LLD details often reveal an HLD change (e.g. "this needs a queue"), so you bounce
   between levels.

```reveal
{
  "prompt": "Asked to 'design a URL shortener', why start with HLD (components + data flow) before LLD (the hashing function and schema)?",
  "answer": "HLD frames the problem and surfaces the decisions that matter most: you need an API service, a datastore mapping short→long URLs, probably a cache for hot redirects, and you reason about read-heavy traffic (redirects ≫ creations), scale, and the key generation strategy at a high level. If you dive straight into the hash function, you risk solving a detail while missing the architecture (caching, scaling reads, storage choice). HLD ensures you're building the right system before perfecting a part of it. Then LLD makes the critical pieces concrete."
}
```

## In the wild

- **Interviews** explicitly test HLD ("design X") and sometimes LLD ("design the rate limiter
  class"); knowing which is being asked is half the battle.
- **Design docs** typically lead with HLD (context, components, data flow, trade-offs), then LLD for
  the risky parts — so reviewers grasp the shape before the details. **Amazon** famously replaced
  slide decks with a **6-page narrative memo** read in silence for the first ~15–20 minutes of the
  meeting; the early pages set the high-level shape before any low-level detail.
- **A named HLD→LLD split:** **Twitter's** home timeline starts as an HLD box — a "fanout service"
  between the write path and a per-user timeline cache. Zoom in and that one box becomes LLD: on each
  tweet, fan out the tweet id into each follower's cached timeline (Redis lists). The catch surfaces
  only at LLD altitude — a celebrity with ~100M+ followers would mean 100M+ cache writes per tweet,
  so those accounts are handled by fanout-on-read (merged at read time) instead. The HLD box hid a
  decision that only the LLD made visible.
- **The course so far is your HLD vocabulary:** load balancers, caches, replicas, queues, CDNs —
  HLD is composing these into a data flow that meets requirements.
- **Capstones** (like the one ending this module) practice exactly this: requirements → HLD → key LLD.

## Common misconception — "more detail always means better design"

Detail at the wrong altitude is noise; the skill is choosing the right level for the question.

```reveal
{
  "prompt": "Why can jumping straight to detailed class diagrams and column types be a *worse* design approach than starting high-level?",
  "answer": "Premature detail locks you into decisions before you understand the system's shape and constraints. You can produce a beautiful LLD for a component that shouldn't exist, or miss a needed cache/queue/scaling concern that an HLD pass would have surfaced. It also wastes effort: HLD is cheap to change (move a box), LLD is expensive (rewrite code). Designing top-down — establish the architecture and trade-offs first, then detail the critical pieces — catches the big mistakes while they're still cheap. Right altitude beats maximum detail."
}
```

Good design isn't maximal detail — it's **the right level of detail for the decision at hand**, moving
top-down so the cheap-to-change big picture is settled before the expensive details.

## Self-test

```quiz
{
  "question": "Which belongs to High-Level Design (HLD)?",
  "options": [
    "The exact database column types and indexes",
    "Which services, caches, and databases exist and how data flows between them",
    "A specific class's method signatures",
    "The retry algorithm's edge cases"
  ],
  "answer": 1,
  "explanation": "HLD is the system-wide map of components and data flow; the others are component-internal LLD details."
}
```

```quiz
{
  "question": "The recommended way to approach a design problem is to:",
  "options": [
    "Start with detailed class diagrams, then zoom out",
    "Clarify requirements, do HLD (components/data flow), then drill into LLD for critical parts",
    "Only ever do HLD",
    "Pick a database first and build around it"
  ],
  "answer": 1,
  "explanation": "Work outside-in: requirements → high-level architecture → low-level detail for the important components, iterating."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "HLD vs LLD — key terms", "cards": [ { "front": "High-Level Design (HLD)", "back": "The map: major components (services, DBs, caches, queues, load balancers), how they connect, and how data flows. Answers what the pieces are and how they fit." }, { "front": "Low-Level Design (LLD)", "back": "The street view: the internals of one component — its classes, data structures, schemas, APIs, and algorithms. Answers how a piece is actually built." }, { "front": "Altitude", "back": "The level of detail you design at. The core skill is choosing the right altitude for the question and switching deliberately between HLD and LLD." }, { "front": "Outside-in (top-down) design", "back": "Clarify requirements, do HLD first (components and data flow), then drill into LLD for critical parts, iterating between levels as details reveal HLD changes." }, { "front": "Why HLD before LLD", "back": "HLD is cheap to change (move a box); LLD is expensive (rewrite code). Settling the architecture first catches big mistakes while they are still cheap." } ] }
```

## Key takeaways

- **HLD = the map** (services, DBs, caches, queues, data flow, scaling/trade-offs); **LLD = the street
  view** (schemas, classes, APIs, algorithms inside one component).
- Design **top-down**: requirements → HLD → LLD for the critical pieces, iterating between levels.
- **HLD is cheap to change, LLD is expensive** — settle the architecture before perfecting details.
- The skill is **choosing the right altitude** for the question, not maximizing detail.

## Up next

HLD requires rough numbers to reason about scale. Next: **Back-of-the-Envelope Estimation**.
