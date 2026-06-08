---
title: "Health Checks & Heartbeats"
slug: health-checks-and-heartbeats
level: intermediate
module: observability
order: 31
reading_time_min: 13
concepts: [health-check, liveness, readiness, heartbeat, failure-detection, self-healing]
use_cases: []
prerequisites: [load-balancing, single-point-of-failure, observability-fundamentals]
status: published
---

# Health Checks & Heartbeats

## Hook — a motivating scenario

A new instance boots and the load balancer immediately sends it traffic — but it hasn't connected to
the database yet, so every request 500s. Elsewhere, an instance is "up" (the process runs) but
permanently wedged (deadlocked), and nothing restarts it because it never crashed. Both are failures
the system *should* have detected and routed around automatically. **Health checks** and
**heartbeats** are how infrastructure knows which instances can actually serve — and self-heals when
they can't.

## Mental model — "are you alive?" vs "are you ready?"

A **health check** is an endpoint (e.g. `/healthz`) that infrastructure probes to ask "should I use
this instance?" The crucial distinction is between two questions:

```compare
{
  "options": [
    { "label": "Liveness — 'are you alive?'", "points": ["Is the process functional (not deadlocked/wedged)?", "Fail → RESTART the instance", "Should be cheap + not depend on others", "Detects hangs a crash wouldn't"] },
    { "label": "Readiness — 'are you ready for traffic?'", "points": ["Are dependencies/warmup done (DB connected, cache warm)?", "Fail → REMOVE from load-balancer rotation (don't restart)", "May check critical dependencies", "Prevents routing to not-yet-ready instances"] }
  ]
}
```

Confusing the two causes the opening bugs: the booting instance needed a **readiness** check (don't
send traffic yet); the wedged instance needed a **liveness** check (restart it).

## Build it up — health checks (pull) and heartbeats (push)

- **Health checks are pull-based:** the **load balancer / orchestrator** periodically calls the
  instance's health endpoint; pass → keep/route to it, fail (N times) → remove from rotation or
  restart (recall load balancing's health checks → high availability).
- **Heartbeats are push-based:** the instance periodically **sends a signal** ("I'm alive") to a
  coordinator; if heartbeats **stop**, the coordinator declares it dead and acts (failover, reassign
  work). Used in clusters/leader election and distributed coordination (recall MQTT's keepalive/LWT —
  the same idea).

Together they enable **automatic failure detection + self-healing**: unhealthy instances are pulled
from traffic or restarted with no human in the loop.

```reveal
{
  "prompt": "Why must liveness and readiness be separate checks, and what goes wrong if you only have one combined health check?",
  "answer": "They trigger different responses to different failures. Liveness = 'is the process wedged/deadlocked?' → the fix is restart. Readiness = 'are dependencies ready (DB connected, caches warm, migrations done)?' → the fix is remove from load-balancer rotation until ready (NOT restart). With a single combined check you get harmful behavior: if the check includes dependencies (readiness-style) and is used for liveness, then a brief database blip makes the check fail and the orchestrator RESTARTS healthy instances — turning a transient dependency hiccup into a restart storm/outage. Conversely, a pure 'process alive' check used for readiness will route traffic to an instance that's up but not yet connected to the DB, causing errors during startup. Separating them lets you restart truly-dead processes while merely deferring traffic to not-ready ones — correct, targeted reactions instead of one blunt action."
}
```

## Build it up — designing good checks

- **Liveness should be cheap and self-contained** — ideally not depend on external systems, or a
  downstream outage will cause mass restarts (the failure mode above).
- **Readiness can check critical dependencies** — but be careful: if readiness depends on a shared
  dependency, an outage there can drain *all* instances from rotation at once (cascading). Sometimes
  you deliberately keep serving (degraded) rather than removing everything.
- **Tune thresholds** — require N consecutive failures + timeouts before acting, so a single blip
  doesn't flap instances in and out.
- **Health ≠ a meaningful signal of correctness** — a 200 from `/healthz` means "reachable," not "all
  features work"; pair with metrics/SLOs (previous chapters).

```reveal
{
  "prompt": "A team makes their liveness check verify the database connection. During a brief DB outage, the whole service goes down hard. Why?",
  "answer": "Because they coupled liveness to an external dependency. When the DB blips, every instance's liveness check fails simultaneously, so the orchestrator concludes all instances are 'dead' and restarts them all at once — a mass restart storm. The restarts don't fix anything (the DB is the problem), they add load and churn, drop in-flight work, and turn a recoverable transient outage into a full, prolonged outage. Liveness should answer only 'is THIS process itself functional?' (not deadlocked) and stay independent of downstream systems, so a dependency failure doesn't trigger restarts of healthy processes. Dependency status belongs in readiness (remove from rotation, don't restart) — and even there you must consider that a shared-dependency outage could drain all instances, so you may choose to keep serving degraded rather than yank everything. Keep liveness cheap and self-contained."
}
```

## In the wild

- **Kubernetes** formalizes this: **liveness probes** (restart on fail), **readiness probes** (remove
  from Service endpoints), and startup probes — the canonical model.
- **Load balancers** use health checks to route only to healthy backends (recall load balancing) — the
  basis of failover/HA.
- **Heartbeats** drive **cluster membership, leader election, and failure detection** in distributed
  systems (ZooKeeper/etcd, databases promoting a replica when the primary's heartbeat stops).
- Our own backend exposes `/healthz` (from the foundations build) — the same pattern.

## Common misconception — "a health check just means the server returns 200 / one check is enough"

Health checks encode *what action to take*, and liveness vs readiness are different actions.

```reveal
{
  "prompt": "Why is 'health check = returns HTTP 200' an incomplete way to think about it?",
  "answer": "Because the value of a health check is the action infrastructure takes based on it, and that requires distinguishing liveness from readiness — a single '200 = healthy' check can't express both. A 200 from a trivial endpoint says 'the process is reachable,' which isn't the same as 'ready to serve' (dependencies/warmup done) or 'truly functional' (not deadlocked behind the HTTP handler). You need a readiness check (gates traffic: remove from LB when not ready) and a liveness check (gates restart: restart when wedged), each returning health for its specific question, with tuned thresholds. You also shouldn't over-stuff checks (coupling liveness to dependencies causes restart storms). So it's not 'does it return 200' — it's 'which question is this check answering, and what should the orchestrator/LB do when it fails?' Health checking is about correct automated reactions, not a single status code."
}
```

Health checks/heartbeats power **automatic failure detection and self-healing** — but you must
distinguish **liveness (restart)** from **readiness (drain traffic)**, keep liveness **self-contained**,
and tune thresholds. They're about the *right reaction*, not just a 200.

## Self-test

```quiz
{
  "question": "An instance is up but hasn't connected to its database yet. Which check should keep traffic away, and what's the action?",
  "options": [
    "Liveness — restart the instance",
    "Readiness — remove it from load-balancer rotation until ready (don't restart)",
    "No check is needed",
    "Liveness — return 200"
  ],
  "answer": 1,
  "explanation": "Not-ready-for-traffic is a readiness failure → drain from rotation until dependencies/warmup complete; restarting wouldn't help."
}
```

```quiz
{
  "question": "Why should a liveness check avoid depending on external systems (like the database)?",
  "options": [
    "It's faster to type",
    "A downstream outage would fail liveness on all instances, triggering a mass restart storm that doesn't fix the problem",
    "Liveness checks can't make network calls",
    "It improves encryption"
  ],
  "answer": 1,
  "explanation": "Coupling liveness to a dependency turns a transient outage into restarts of healthy processes — keep liveness self-contained."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Health checks & heartbeats — key terms", "cards": [
  { "front": "Health check", "back": "An endpoint (e.g. /healthz) that infrastructure probes to decide whether to use an instance. Pull-based: the LB/orchestrator periodically calls it." },
  { "front": "Liveness check", "back": "Asks 'is this process functional (not deadlocked/wedged)?' Fail action: RESTART the instance. Should be cheap and self-contained, not dependent on other systems." },
  { "front": "Readiness check", "back": "Asks 'are dependencies/warmup done (DB connected, cache warm)?' Fail action: REMOVE from load-balancer rotation until ready — do not restart." },
  { "front": "Heartbeat", "back": "Push-based: an instance periodically sends an 'I'm alive' signal to a coordinator. If heartbeats stop, the coordinator declares it dead and acts (failover, reassign work)." },
  { "front": "Restart storm", "back": "Coupling liveness to an external dependency: a brief DB outage fails liveness on all instances, so the orchestrator restarts them all at once — turning a transient blip into an outage." },
  { "front": "Threshold tuning", "back": "Requiring N consecutive failures plus timeouts before acting, so a single blip doesn't flap instances in and out of rotation." }
] }
```

## Key takeaways

- **Health checks** (pull, by LB/orchestrator) and **heartbeats** (push, to a coordinator) enable
  **automatic failure detection + self-healing**.
- Distinguish **liveness** ("alive?" → **restart** on fail) from **readiness** ("ready for traffic?" →
  **drain from LB** on fail) — they need different reactions.
- Keep **liveness cheap and self-contained** (don't couple to dependencies → restart storms); tune
  thresholds to avoid flapping.
- A health check encodes **what action to take**, not just a 200 — pair with metrics/SLOs for true
  health.

## Up next

To debug a request across many services, you need to follow it end to end. Next: **Distributed
Tracing**.
