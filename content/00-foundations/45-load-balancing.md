---
title: "Load Balancing"
slug: load-balancing
level: foundations
module: foundations-of-system-design
order: 45
reading_time_min: 14
concepts: [load-balancer, round-robin, health-checks, l4-l7, sticky-sessions, distribution]
use_cases: []
prerequisites: [vertical-vs-horizontal-scaling, client-server-and-anatomy-of-a-request]
status: published
---

# Load Balancing

## Hook — a motivating scenario

You scaled out to five app servers — but how does a user's request reach one of them? You can't put
five addresses on a business card. And when one server crashes at 3 a.m., something must stop sending
it traffic *before* users notice. Both jobs belong to a **load balancer**: the single front door that
spreads requests across your servers and routes around the dead ones.

## Mental model — the host who seats diners

A load balancer is a restaurant host standing at the door. Diners (requests) arrive at one place; the
host distributes them across available tables (servers) so no table is overwhelmed and empty tables
get used — and the host stops seating anyone at a table that's "closed" (an unhealthy server). It
turns "many servers" into "one address that's always available."

```flow
{
  "title": "A load balancer in front of app servers",
  "nodes": [
    { "label": "Clients", "detail": "All hit one public address (the load balancer)." },
    { "label": "Load balancer", "detail": "Picks a healthy server per request and forwards it; routes around failures." },
    { "label": "Server pool (1..N, interchangeable)", "detail": "Each request goes to ONE healthy server; servers are stateless → interchangeable. Add/remove them freely behind the LB." }
  ],
  "note": "One address out front; many interchangeable servers behind. This is a fan-out, not a chain: the LB sends each request to ONE of the N parallel servers (not server-to-server in sequence). The LB is how horizontal scaling actually works."
}
```

## Build it up — how it distributes and how it detects failure

**Distribution algorithms** decide which server gets the next request:

```compare
{
  "options": [
    { "label": "Round robin", "points": ["Rotate through servers in order", "Simple, even when requests are uniform", "Ignores actual server load", "The common default"] },
    { "label": "Least connections", "points": ["Send to the server with fewest active requests", "Adapts to uneven/long requests", "Slightly more state to track", "Good for varied workloads"] },
    { "label": "Hashing (by key/IP)", "points": ["Same key → same server (consistent routing)", "Useful for affinity/cache locality", "Can unbalance if keys skew", "Basis of sticky sessions"] }
  ]
}
```

**Health checks** are the other half: the LB periodically pings each server (e.g. a `/healthz`
endpoint — recall our backend has one) and **stops routing to any that fail**, then resumes when they
recover. This is what gives horizontal scaling its fault tolerance — a dead server is simply removed
from rotation.

```reveal
{
  "prompt": "How do health checks turn a server crash into a non-event for users?",
  "answer": "The load balancer regularly probes each server's health endpoint. When a server stops responding (crash, hang, deploy), it fails the check and the LB removes it from the pool — new requests go only to healthy servers. Users never get routed to the dead one, so instead of errors they just hit a working server. When the server recovers and passes checks again, the LB adds it back. Combined with multiple instances, this means one server dying causes no visible outage — the core of high availability."
}
```

## Build it up — L4 vs L7, and sticky sessions

- **L4 (transport) load balancing** routes by IP/port — fast, protocol-agnostic, no insight into the
  request.
- **L7 (application) load balancing** routes by HTTP details (path, host, headers) — e.g. `/api/*` to
  one pool, `/images/*` to another. (Recall the L4/L7 vocabulary from the layers chapter.)
- **Sticky sessions** pin a user to the same server (via hashing/cookies) — a crutch for apps that
  kept local state. Prefer **stateless + shared state** instead, so any server works and you keep full
  flexibility.

## In the wild

- **Every horizontally-scaled web tier** sits behind a load balancer (cloud LBs, NGINX, HAProxy,
  Envoy); the LB itself is run redundantly so it isn't a single point of failure.
- **The LB is also where TLS terminates** and where global routing/geo-DNS hands off to regional pools
  (recall DNS + CDN).
- **Health checks + multiple instances = high availability** — the practical payoff of horizontal
  scaling.
- **Autoscaling registers/deregisters** instances with the LB automatically as it adds/removes them.

## Common misconception — "a load balancer just splits traffic evenly"

Even distribution is only half the job — and 'even' isn't even always what you want.

```reveal
{
  "prompt": "Beyond spreading requests, what critical job does a load balancer do — and why is naive 'split evenly' sometimes wrong?",
  "answer": "Its critical second job is health-aware routing: detecting unhealthy servers and routing around them, which is what delivers availability — pure even-splitting would keep sending 1/N of traffic to a dead server. And 'even' isn't always right: requests vary in cost, so round-robin can overload a server stuck with several slow requests while others idle; least-connections (or load-aware) distribution adapts better. A load balancer is about *healthy, sensible* distribution, not blind equal splitting."
}
```

A load balancer provides **availability (health checks/failover)** and **smart distribution**, not
just equal splitting. The health-routing half is what makes a fleet of servers actually reliable.

## Self-test

```quiz
{
  "question": "Besides distributing requests, the load balancer's other essential role is to:",
  "options": [
    "Encrypt the database",
    "Detect unhealthy servers via health checks and stop routing to them",
    "Store user sessions permanently",
    "Generate primary keys"
  ],
  "answer": 1,
  "explanation": "Health checks + failover route traffic only to healthy servers — the source of high availability."
}
```

```quiz
{
  "question": "Which load-balancing approach best handles requests that vary a lot in duration?",
  "options": [
    "Round robin",
    "Least connections (send to the server with the fewest active requests)",
    "Random with no health checks",
    "Always the first server"
  ],
  "answer": 1,
  "explanation": "Least-connections adapts to uneven load, avoiding piling slow requests on a server that round-robin would still pick."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Load balancing — key terms", "cards": [
  { "front": "Load balancer", "back": "The single front door that spreads requests across many servers and routes around dead ones, turning many servers into one always-available address." },
  { "front": "Round robin", "back": "Rotate through servers in order. Simple and the common default, but ignores actual server load." },
  { "front": "Least connections", "back": "Send the next request to the server with the fewest active requests. Adapts to uneven or long-running requests at the cost of tracking more state." },
  { "front": "Health checks", "back": "The LB periodically probes each server (e.g. a /healthz endpoint) and stops routing to any that fail, resuming when they recover — the source of high availability." },
  { "front": "L4 vs L7 load balancing", "back": "L4 routes by IP/port: fast, protocol-agnostic, no request insight. L7 routes by HTTP details (path, host, headers), e.g. /api/* to one pool." },
  { "front": "Sticky sessions", "back": "Pinning a user to the same server via hashing or cookies — a crutch for apps with local state. Prefer stateless plus shared state instead." }
] }
```

## Key takeaways

- A **load balancer** is the single front door that **distributes requests** across many servers and
  **routes around unhealthy ones** — making horizontal scaling work.
- Algorithms: **round robin** (simple default), **least connections** (adapts to uneven load),
  **hashing** (affinity/sticky sessions).
- **Health checks + multiple instances = high availability**; a dead server is just removed from the
  pool.
- Know **L4 vs L7** routing; prefer **stateless + shared state** over sticky sessions; run the LB
  itself redundantly.

## Up next

We keep mentioning "single point of failure." Let's tackle it head-on. Next: **Single Point of
Failure**.
