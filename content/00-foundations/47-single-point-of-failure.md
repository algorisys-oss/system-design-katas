---
title: "Single Point of Failure"
slug: single-point-of-failure
level: foundations
module: foundations-of-system-design
order: 47
reading_time_min: 13
concepts: [spof, redundancy, failover, high-availability, blast-radius]
use_cases: []
prerequisites: [load-balancing, vertical-vs-horizontal-scaling]
status: published
---

# Single Point of Failure

## Hook — a motivating scenario

You diligently ran three app servers behind a load balancer — then the **one** load balancer crashed
and the whole site went down anyway. Or: three app servers, but all talking to a **single** database
that died. Redundancy in one place is worthless if there's a lone, un-backed component somewhere else
on the critical path. Finding and removing those lone components — **single points of failure** — is
the heart of building reliable systems.

## Mental model — the weakest link in the chain

A request flows through a chain of components. If **any one** of them has no backup, the whole chain
fails when it fails — like a chain that breaks at its weakest link, or a bucket brigade with one
irreplaceable person. A **single point of failure (SPOF)** is any component whose failure takes down
the system because nothing else can take over.

```flow
{
  "title": "Find the SPOF in this 'redundant' setup",
  "nodes": [
    { "label": "Load balancer ×1", "detail": "SPOF! Only one — if it dies, nothing reaches the servers, however many there are." },
    { "label": "App servers ×3", "detail": "Redundant — one can die and the LB routes around it. Good." },
    { "label": "Database ×1", "detail": "SPOF! All servers depend on this one DB; if it fails, the whole system fails." }
  ],
  "note": "Three app servers feel 'redundant', but the single LB and single DB are still SPOFs on the critical path."
}
```

## Build it up — eliminate SPOFs with redundancy + failover

The cure is **redundancy** (more than one of each critical component) plus **failover** (automatic
switch to a healthy backup):

- **Stateless tiers** (app servers) → run multiple behind a load balancer (you've done this).
- **The load balancer itself** → run it redundantly (active-passive pair, or multiple with DNS/anycast
  failover) so it isn't a SPOF.
- **The database** → a **primary with replicas** and automatic **failover** (promote a replica if the
  primary dies); spread across availability zones.
- **Whole zones/regions** → deploy across multiple **availability zones** so one datacenter outage
  doesn't take you down.

```reveal
{
  "prompt": "How do you remove the database SPOF without losing consistency?",
  "answer": "Run a primary plus one or more replicas (recall reads-vs-writes), ideally in different availability zones, with automatic failover: if the primary fails, a replica is promoted to primary and traffic redirects to it. Writes still funnel to a single primary at a time (preserving consistency), but the *role* is now redundant — no single machine's death is fatal. You accept a brief failover window and the complexity of promotion/replication lag, in exchange for surviving a node or zone loss. One sharp caveat: with *asynchronous* replication a failover can actually lose recently-acknowledged writes — if the primary acknowledged a write but died before the replica received it, promoting that replica silently drops it (failover is not automatically lossless). That data-loss risk is precisely why *synchronous* replication is sometimes chosen: it guarantees a replica has the write before acking, at the cost of higher write latency."
}
```

## Build it up — finding SPOFs and weighing the cost

Trace the **critical path** of a request and ask at each hop: *"If this one thing dies, does the
system go down?"* Anything that answers "yes" and has count = 1 is a SPOF. But redundancy costs money
and complexity, so you prioritize by **blast radius** (how much breaks) and likelihood — make the
highest-impact components redundant first; some low-impact ones you may consciously leave single.

```reveal
{
  "prompt": "Is it always worth eliminating every single point of failure?",
  "answer": "No — redundancy has real costs (double the infrastructure, failover complexity, data-sync challenges, more things to operate). You prioritize by blast radius and probability: a single load balancer or database on the critical path is high-impact and must be made redundant; a non-critical internal tool used by two people may be fine as a SPOF. The goal isn't 'zero SPOFs at any cost' — it's matching redundancy investment to how much an outage of each component actually hurts (and aligning with your availability target / SLO). Reliability engineering is deciding *which* SPOFs are worth removing."
}
```

Redundancy isn't all-or-nothing — slide from leaving a component single to making every hop redundant, weighing cost against blast radius:

```tradeoff
{
  "title": "How much redundancy should this component get?",
  "axis": { "left": "Leave it single (accept the SPOF)", "right": "Full redundancy + failover" },
  "steps": [
    { "label": "Accept the SPOF", "detail": "Low-impact, low-likelihood component (e.g. an internal tool used by two people): single instance is fine. Cheapest, simplest — you consciously accept the risk." },
    { "label": "Add a backup", "detail": "Run a second instance (active-passive) so one death isn't fatal. More infrastructure and some failover wiring, but the component is no longer a SPOF." },
    { "label": "Automatic failover", "detail": "Backup is promoted automatically when the primary dies (e.g. promote a replica). Adds promotion/replication complexity, but survives a node loss with only a brief failover window." },
    { "label": "Multi-AZ redundancy", "detail": "Spread redundant instances across availability zones so a whole datacenter outage isn't fatal. Highest cost and complexity; reserved for high-blast-radius, critical-path components." }
  ]
}
```

## In the wild

- **Multi-AZ deployments** are the baseline cloud pattern: redundant instances + databases across
  availability zones so one datacenter failure isn't fatal.
- **Managed databases** offer automatic replica failover; **load balancers** are run redundantly by
  cloud providers by default.
- **Chaos engineering** (deliberately killing components) is how mature teams *find* hidden SPOFs
  before real outages do (an advanced-course topic).
- **It's not just servers:** a single shared cache, a single message broker, a single config service,
  or even a single person who knows a system can be a SPOF.

## Common misconception — "we have multiple servers, so we're fault-tolerant"

Redundancy in one tier doesn't make the *system* fault-tolerant — the whole critical path must be
redundant.

```reveal
{
  "prompt": "A team runs 10 app servers and calls the system 'highly available,' but a single load balancer and single database sit in front/behind. How available is it really?",
  "answer": "Not very — its availability is gated by its least-redundant critical component. With a single LB and single DB, either one failing takes everything down regardless of the 10 app servers; the 10 servers only protect against app-server failures. Availability is a property of the *entire critical path*, not the most-redundant tier. True high availability requires redundancy + failover at every critical hop (LB, app, DB, and across zones). Counting servers in one tier creates a false sense of safety."
}
```

A system is only as available as its **least-redundant component on the critical path**. Redundancy
must cover *every* critical hop — finding the lone one is the whole exercise.

## Self-test

```quiz
{
  "question": "Three app servers sit behind ONE load balancer and use ONE database. The single points of failure are:",
  "options": [
    "The three app servers",
    "The load balancer and the database",
    "There are none",
    "Only the network"
  ],
  "answer": 1,
  "explanation": "The lone load balancer and lone database each take the whole system down if they fail; the app tier is already redundant."
}
```

```quiz
{
  "question": "The standard way to remove a SPOF is:",
  "options": [
    "Make the single component bigger",
    "Add redundancy (more than one) plus automatic failover to a healthy backup",
    "Add more logging",
    "Reduce traffic to it"
  ],
  "answer": 1,
  "explanation": "Redundancy + failover means no single component's failure is fatal — a backup takes over automatically."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Single point of failure — key terms", "cards": [
  { "front": "Single point of failure (SPOF)", "back": "Any component whose failure takes down the system because nothing else can take over — a lone, un-backed component on the critical path." },
  { "front": "Redundancy", "back": "Running more than one of each critical component so a single instance's death isn't fatal — the cure (with failover) for a SPOF." },
  { "front": "Failover", "back": "Automatically switching to a healthy backup when a component dies — e.g. promoting a database replica to primary, with a brief failover window." },
  { "front": "Critical path", "back": "The chain of components a request must pass through; trace it and ask at each hop whether a single failure downs the system to find SPOFs." },
  { "front": "Blast radius", "back": "How much breaks when a component fails. Used (with likelihood) to prioritize which SPOFs are worth the cost of removing." },
  { "front": "Least-redundant component rule", "back": "A system is only as available as its least-redundant component on the critical path — redundancy in one tier alone isn't enough." }
] }
```

## Key takeaways

- A **SPOF** is any critical-path component whose failure downs the whole system because nothing can
  take over.
- A system is only as available as its **least-redundant critical component** — redundancy in one
  tier isn't enough.
- Remove SPOFs with **redundancy + automatic failover** (multiple app servers, redundant LB,
  primary+replica DB, multi-AZ).
- Eliminating SPOFs has **cost** — prioritize by **blast radius** and likelihood; not every SPOF is
  worth removing.

## Up next

To decide how much redundancy is "enough," you need to measure reliability. Next: **Availability,
Reliability & the "Nines"**.
