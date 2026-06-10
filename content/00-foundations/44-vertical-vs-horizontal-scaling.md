---
title: "Vertical vs Horizontal Scaling"
slug: vertical-vs-horizontal-scaling
level: foundations
module: foundations-of-system-design
order: 44
reading_time_min: 13
concepts: [vertical-scaling, horizontal-scaling, stateless, elasticity, single-point-of-failure]
use_cases: []
prerequisites: [back-of-the-envelope-estimation, http-fundamentals]
status: published
---

# Vertical vs Horizontal Scaling

## Hook — a motivating scenario

Traffic doubled and your server is maxed out. Two paths: rent a **bigger** server (more CPU/RAM), or
run **more** servers behind a load balancer. The first is a one-click fix that buys you time; the
second is more work but the only way to keep growing past one machine — and to survive that machine
dying. Choosing between "bigger" and "more" is the central scaling decision, and the answer shapes
your whole architecture.

## Mental model — a bigger truck vs more trucks

To move more cargo you can buy a **bigger truck** (vertical) or **more trucks** (horizontal):

- **Vertical scaling (scale up):** make one machine more powerful — more CPU, RAM, faster disk.
  Simple (no code changes), but there's a **ceiling** (the biggest machine you can buy) and it's
  still **one machine** (a single point of failure).
- **Horizontal scaling (scale out):** add more machines and spread load across them with a load
  balancer. Near-unlimited growth and fault tolerance, but requires your app to run as **many
  interchangeable instances** — which means **stateless** (recall HTTP statelessness).

```compare
{
  "options": [
    { "label": "Vertical (scale up)", "points": ["One bigger machine (more CPU/RAM)", "Simple — often no code changes", "Hard ceiling + still a single point of failure", "Good first step / for hard-to-distribute parts (DBs)"] },
    { "label": "Horizontal (scale out)", "points": ["More machines behind a load balancer", "Near-unlimited growth + fault tolerance", "Requires stateless, distributable design", "The path for large-scale web tiers"] }
  ]
}
```

## Build it up — why horizontal needs statelessness

Horizontal scaling only works if **any instance can handle any request**. If a server stores session
state in its own memory, a user's next request (routed to a different server) won't find it. So you
push state out of the app servers into shared stores (database, cache) and keep the servers
**stateless** — exactly the property from the HTTP/anatomy chapters that makes load balancing possible.

```reveal
{
  "prompt": "An app stores logged-in user sessions in each server's local memory. Why does adding a second server (horizontal scaling) suddenly break logins?",
  "answer": "The load balancer may send a user's next request to a different server than the one holding their session in memory, so that server sees them as logged out — leading to random logouts. The fix is to make servers stateless: store sessions in a shared place (a database or a cache like Redis, or a signed token the client carries). Then any server can serve any request. Local in-memory state is the enemy of horizontal scaling."
}
```

## Build it up — the usual progression

Real systems combine both, in a typical order:
1. **Start vertical** — one decent server; simplest, and fine until you outgrow it.
2. **Go horizontal for the stateless tiers** — multiple app servers behind a load balancer (cheap,
   fault-tolerant, elastic — add/remove instances with traffic).
3. **Scale the stateful parts carefully** — databases are harder to scale horizontally (writes must be
   coordinated, recall reads-vs-writes), so they're often scaled **up** first, then **out** via
   replicas/sharding when necessary.

```reveal
{
  "prompt": "Why are stateless web servers easy to scale horizontally, but databases much harder?",
  "answer": "Stateless servers hold no unique data — every instance is interchangeable, so you just add more behind a load balancer and even auto-scale with traffic. Databases hold the authoritative state: scaling reads is doable (replicas), but scaling writes means coordinating consistency across machines (sharding/partitioning), which is complex (cross-shard queries, rebalancing, distributed transactions). So the common pattern is: scale the stateless app tier out freely, and scale the stateful data tier up first, then out with care."
}
```

## In the wild

- **Cloud auto-scaling** adds/removes stateless instances based on load (elasticity) — pay for what
  you use, handle spikes automatically. **AWS Auto Scaling groups**, for example, launch and
  terminate EC2 instances against a target metric (e.g. average CPU).
- **Vertical scaling is the easy first lever** and remains common for databases and components that
  are hard to distribute — but the ceiling is real. Even AWS's largest single instances top out:
  the **EC2 High Memory U7i** instances reach roughly **896 vCPUs and 32 TiB of RAM**, and once a
  workload outgrows that, "bigger" is no longer an option — you must go horizontal.
- **Horizontal scaling brings fault tolerance for free:** if one of many instances dies, the load
  balancer routes around it (no single point of failure for that tier) — the topic of the next chapter.
- **Cost shape differs:** big machines get disproportionately expensive (vertical), while commodity
  machines scale more linearly (horizontal).

## Common misconception — "horizontal scaling is always better / just add servers"

Horizontal scaling has real prerequisites and costs; it isn't a magic switch.

```reveal
{
  "prompt": "A team tries to 'just add servers' to scale, but throughput barely improves and bugs appear. What did they likely overlook?",
  "answer": "Adding servers only helps if the app is actually distributable: it must be stateless (no local session/state), and the real bottleneck must be the tier you're scaling — often it's the shared database, which more app servers just hammer harder. They may also have ignored the new distributed-systems problems horizontal scaling introduces (consistency, the shared store becoming the bottleneck, coordination). Horizontal scaling requires designing for it; bolting more servers onto a stateful or DB-bound system adds cost and bugs without throughput. Identify the bottleneck and make the tier stateless first."
}
```

Horizontal scaling is powerful but conditional: the workload must be **distributable and stateless**,
and you must scale the **actual bottleneck** (often the database). Vertical scaling remains the right,
simple choice in many cases — especially as a first step and for hard-to-distribute components.

## Self-test

```quiz
{
  "question": "Horizontal scaling (adding more servers) primarily requires the application to be:",
  "options": [
    "Written in a specific language",
    "Stateless, so any instance can handle any request",
    "Running on a single big machine",
    "Free of any database"
  ],
  "answer": 1,
  "explanation": "Interchangeable instances behind a load balancer need statelessness (shared state in DB/cache, not local memory)."
}
```

```quiz
{
  "question": "A key limitation of vertical scaling (a bigger machine) is:",
  "options": [
    "It requires a load balancer",
    "There's a hard ceiling and it remains a single point of failure",
    "It needs stateless servers",
    "It can't use more RAM"
  ],
  "answer": 1,
  "explanation": "You can only buy so big (a ceiling), and one machine is still a single point of failure — unlike scaling out."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Vertical vs horizontal scaling — key terms", "cards": [ { "front": "Vertical scaling (scale up)", "back": "Make one machine more powerful — more CPU, RAM, faster disk. Simple, often no code changes, but has a hard ceiling and remains a single point of failure." }, { "front": "Horizontal scaling (scale out)", "back": "Add more machines and spread load across them with a load balancer. Near-unlimited growth and fault tolerance, but requires a stateless, distributable design." }, { "front": "Why does horizontal scaling require statelessness?", "back": "Any instance must handle any request. If a server keeps session state in local memory, the load balancer may route the next request elsewhere and it won't find that state." }, { "front": "Elasticity / auto-scaling", "back": "Adding or removing stateless instances based on load, so you pay for what you use and handle spikes automatically." }, { "front": "Typical scaling progression", "back": "Start vertical, then scale stateless app tiers out behind a load balancer, then scale the stateful database up first and out (replicas/sharding) only when necessary." }, { "front": "Why are databases harder to scale horizontally?", "back": "They hold authoritative state. Scaling reads via replicas is doable, but scaling writes needs coordinating consistency across machines (sharding, distributed transactions, rebalancing)." } ] }
```

## Key takeaways

- **Vertical = bigger machine** (simple, no code change, but a ceiling + single point of failure);
  **horizontal = more machines** behind a load balancer (near-unlimited growth + fault tolerance).
- Horizontal scaling **requires stateless** instances — push state to shared stores so any server
  handles any request.
- Typical path: **start vertical → scale stateless tiers out → scale stateful (DB) up, then out
  carefully**.
- Horizontal isn't automatically better — it's **conditional** (distributable workload, right
  bottleneck); vertical is often the right first step.

## Up next

Spreading load across servers needs something to distribute it. Next: **Load Balancing**.
