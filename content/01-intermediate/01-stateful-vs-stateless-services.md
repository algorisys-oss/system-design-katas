---
title: "Stateful vs Stateless Services"
slug: stateful-vs-stateless-services
level: intermediate
module: architecture-and-services
order: 1
reading_time_min: 14
concepts: [stateless, stateful, session-state, externalized-state, scaling, sticky-sessions]
use_cases: []
prerequisites: [monoliths-vs-microservices, http-fundamentals]
status: published
---

# Stateful vs Stateless Services

## Hook — a motivating scenario

You scale your service from one instance to five behind a load balancer. Suddenly users get randomly
logged out, half-finished uploads vanish, and a shopping cart empties itself. Nothing in the business
logic changed — but each instance was secretly *remembering* things in its own memory, and the load
balancer keeps sending the user to a different instance that doesn't have those memories. Whether a
service is **stateful** or **stateless** determines whether it can scale at all.

## Mental model — the interchangeable clerk vs the one clerk who knows you

- A **stateless** service is like a counter of interchangeable clerks: any clerk can serve any
  customer because everything needed is on the ticket the customer hands over (or looked up in a
  shared system). Lose a clerk, add a clerk — no problem.
- A **stateful** service is the one clerk who "remembers your order in their head." Fast and personal,
  but only *that* clerk can serve you, and if they go home, your order is lost.

A service is **stateless** when it keeps **no client-specific state between requests in its own
memory** — each request carries or looks up everything it needs (recall HTTP statelessness). The
state still exists; it just lives **outside** the service instance.

```compare
{
  "options": [
    { "label": "Stateless service", "points": ["No per-client state in local memory", "Any instance serves any request", "Scales horizontally + fails over freely", "State lives in DB/cache/token"] },
    { "label": "Stateful service", "points": ["Keeps client/session state in memory", "A client is tied to a specific instance", "Hard to scale/replace; instance loss = data loss", "Sometimes necessary (e.g. real-time connections)"] }
  ]
}
```

## Build it up — externalize the state

The fix for the opening scenario is to **move state out of the instance** into a shared store, so all
instances see it:

- **Sessions/auth** → a shared cache (Redis) or a signed token the client carries (recall
  authn/authz). The tradeoff: a signed token avoids a shared store but is hard to revoke before it
  expires (and its payload is readable — only tamper-evident, not secret), whereas a shared session
  store lets you revoke instantly at the cost of a lookup per request.
- **Shopping cart / workflow state** → a database or cache, keyed by user/session ID.
- **Uploaded file in progress** → object storage, not local disk.

Now any instance can handle any request by reading shared state — the precondition for horizontal
scaling, load balancing, and failover (recall those foundations).

```reveal
{
  "prompt": "A service stores user sessions in each instance's local memory. Why does this break horizontal scaling, and what's the fix?",
  "answer": "The load balancer can route a user's next request to a different instance, which has no record of their session — so they appear logged out (and a crashed instance loses all its sessions). The fix is to externalize session state: keep it in a shared store (e.g. Redis) or in a signed token the client sends each request. Then every instance is interchangeable and any can serve the user. Local in-memory state ties a client to one instance, defeating scaling and failover."
}
```

## Build it up — sticky sessions vs truly stateless

A tempting shortcut is **sticky sessions** (session affinity): the load balancer pins each user to
the instance that holds their state. It works, but it's a crutch:
- It unbalances load (some instances get the heavy users).
- It breaks failover — if that instance dies, the user's state is gone anyway.
- It complicates deploys and autoscaling (you can't freely add/remove instances).

Prefer **truly stateless + externalized state**. Reserve stickiness for cases where it's genuinely
hard to avoid.

**When state is unavoidable:** some services are inherently stateful — a WebSocket/real-time server
holds live connections, a game server holds match state, a database *is* the state. The pattern is to
**push as much state as possible out**, keep the genuinely-stateful part small and explicit, and give
it its own scaling/replication strategy (e.g. sticky routing for live connections, or a shared
pub/sub backplane — later chapters).

```reveal
{
  "prompt": "Why are sticky sessions considered a workaround rather than a real solution?",
  "answer": "They keep the state in instance memory and just route the user back to the same instance — so the underlying problem (per-instance state) remains. Consequences: load can become uneven (heavy users stuck on one box), failover still loses the user's state if that instance dies, and you lose the freedom to add/remove instances during deploys and autoscaling. They make a stateful design 'work' without giving you the real benefits of statelessness. Externalizing state to a shared store removes the constraint entirely; stickiness only masks it."
}
```

## In the wild

- **Web/API tiers are designed stateless** so they sit behind a load balancer and autoscale —
  the standard architecture from the foundations course.
- **Session stores** (Redis/Memcached) and **JWT tokens** are the two common ways to externalize auth
  state. A Redis `GET` for a session is typically sub-millisecond on an AZ-local instance, while a
  compact JWT is usually a few hundred bytes to ~1 KB carried on every request.
- **Stateful workloads** (databases, message brokers, real-time servers) get dedicated scaling
  approaches (replication, partitioning, backplanes) — most of this module.
- **Twelve-Factor App** guidance: keep processes stateless and store state in backing services.

## Common misconception — "stateless means the application has no state"

Stateless is about *where* state lives, not whether it exists.

```reveal
{
  "prompt": "If a service is 'stateless', where did all the state (logins, carts, data) go?",
  "answer": "It still exists — it's just stored *outside* the service instance, in shared backing services (databases, caches) or carried by the client (cookies/tokens). 'Stateless' means the service keeps no client-specific state in its own memory between requests, so each request is self-contained and any instance can handle it. The application absolutely has state; it's externalized so the compute tier stays interchangeable. Confusing 'stateless service' with 'no state anywhere' misses the point: it's a deployment property of the instances, not the absence of data."
}
```

Statelessness is a property of the **service instance** (no per-client memory between requests), not
of the system. The state lives in shared stores or the client — which is exactly what makes instances
interchangeable and scalable.

## Self-test

```quiz
{
  "question": "What makes a service 'stateless'?",
  "options": [
    "It stores nothing anywhere",
    "It keeps no client-specific state in its own memory between requests; state lives in shared stores or the client",
    "It never uses a database",
    "It always uses sticky sessions"
  ],
  "answer": 1,
  "explanation": "Stateless = no per-client state in the instance's memory, so any instance can serve any request (state is externalized)."
}
```

```quiz
{
  "question": "Why are stateless services essential for horizontal scaling?",
  "options": [
    "They use less CPU",
    "Any instance can handle any request, so you can add/remove instances and fail over freely behind a load balancer",
    "They don't need a network",
    "They cache everything locally"
  ],
  "answer": 1,
  "explanation": "Interchangeable instances are the precondition for load balancing, autoscaling, and failover."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Stateful vs stateless services — key terms", "cards": [ { "front": "Stateless service", "back": "A service that keeps no client-specific state in its own memory between requests; each request is self-contained, so any instance can serve any request." }, { "front": "Stateful service", "back": "A service that keeps client/session state in memory, tying a client to a specific instance; hard to scale or replace, and instance loss means data loss." }, { "front": "Externalized state", "back": "Moving state out of the instance into a shared store (DB/cache) or a client-carried token, so all instances see it and stay interchangeable." }, { "front": "Sticky sessions (session affinity)", "back": "The load balancer pins each user to the instance holding their state. A workaround: it unbalances load, breaks failover, and complicates deploys and autoscaling." }, { "front": "Why stateless enables horizontal scaling", "back": "Interchangeable instances let you add/remove instances and fail over freely behind a load balancer — the precondition for load balancing and autoscaling." }, { "front": "\"Stateless\" misconception", "back": "It does not mean the system has no state. State still exists — it lives outside the instance, in shared stores or carried by the client. It's a property of the instance." } ] }
```

## Key takeaways

- **Stateless** = no per-client state in the instance's memory between requests; **stateful** = it
  remembers, tying a client to one instance.
- **Externalize state** (shared cache/DB, or a client-carried token) to make instances interchangeable
  — the precondition for horizontal scaling and failover.
- **Sticky sessions** are a workaround (uneven load, no real failover); prefer truly stateless.
- "Stateless" means *where* state lives (outside the instance), not that the system has no state.

## Up next

Services communicate to get work done — and *how* they wait for each other shapes resilience and
scale. Next: **Synchronous vs Asynchronous Communication**.
