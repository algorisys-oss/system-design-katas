---
title: "Observability-Driven Development"
slug: observability-driven-development
level: advanced
module: operability-and-patterns
order: 44
reading_time_min: 13
concepts: [observability-driven-development, instrument-first, wide-events, unknown-unknowns, debugging-in-production, slos]
use_cases: []
prerequisites: [observability-fundamentals, high-cardinality-data, slis-slos-error-budgets]
status: published
---

# Observability-Driven Development

## Hook — a motivating scenario

A feature ships. A week later it's misbehaving for *some* users in *some* conditions — and you have no
way to ask "which users? what conditions?" because the code wasn't instrumented to answer questions you
didn't anticipate. You're now adding logging and **redeploying just to debug**, in production, blind.
**Observability-driven development (ODD)** flips this: you build the ability to **understand the system
in production** *as part of building the feature* — not bolted on after an incident.

## Mental model — instrument as you build, to answer unknown questions

**Observability-driven development** is the practice of treating **observability as a first-class part
of development**: as you write a feature, you **instrument it** (rich traces, metrics, structured/wide
events) so you can **understand its behavior in production** — and you **validate it via that telemetry**,
not just by it "passing tests." The goal is to be able to answer **questions you didn't anticipate**
(the "unknown unknowns") **without shipping new code**.

```stepper
{
  "title": "ODD: observability woven into the dev loop",
  "steps": [
    { "title": "1 · Design with questions in mind", "body": "Ask 'how will I know this works / why it broke in prod?' before/while coding." },
    { "title": "2 · Instrument as you build", "body": "Emit wide events/traces/metrics with rich context (IDs, inputs, outcomes, timings) — part of the feature, not an afterthought." },
    { "title": "3 · Ship + watch real behavior", "body": "Validate in production via telemetry (canary, SLOs) — does it behave as expected for real traffic?" },
    { "title": "4 · Explore the unknown", "body": "When something's off, slice the wide events by any dimension to find the cause — no redeploy to add logging." }
  ]
}
```

## Build it up — known unknowns vs unknown unknowns

The deepest idea behind ODD (and "observability" vs "monitoring", recall) is the **unknown unknown**:
- **Monitoring** answers **known unknowns**: questions you predicted (dashboards/alerts for metrics you
  knew to watch — CPU, error rate). Great for "is the thing I expected to break, breaking?"
- **Observability** answers **unknown unknowns**: questions you **didn't anticipate** — "why are *these
  specific* users on *this* app version in *this* region, hitting *this* code path, slow?" Answering that
  ad-hoc requires **rich, high-cardinality, wide events** you can slice **arbitrarily** at query time
  (recall high-cardinality data) — not pre-aggregated metrics with fixed dimensions.

ODD is **building for unknown unknowns up front** — instrumenting richly enough that production becomes
**explorable**, so the next novel problem is a **query, not a redeploy**.

```reveal
{
  "prompt": "What's the difference between 'known unknowns' and 'unknown unknowns,' and why does observability-driven development specifically target the latter?",
  "answer": "Known unknowns are questions you anticipated and prepared for: you knew CPU could spike, error rate could rise, or a queue could back up, so you built dashboards and alerts for those specific metrics. Monitoring handles known unknowns well — it tells you whether the things you predicted might fail are failing. Unknown unknowns are the questions you did NOT anticipate — novel failure modes and behaviors you couldn't have predicted at design time: 'why are users on app version 4.2, in the EU, who hit the new discount code path, with a particular merchant, seeing 3s latency?' You can't pre-build a dashboard for a combination of conditions you never imagined, and pre-aggregated metrics with fixed, low-cardinality dimensions literally can't be sliced that way (and high-cardinality fields like user_id/version/merchant can't go in metrics — recall the cardinality bomb). Answering unknown-unknown questions requires the ability to ask arbitrary, ad-hoc questions of rich, high-cardinality data after the fact — i.e. wide structured events you can slice and group by any dimension at query time. Observability-driven development targets unknown unknowns because that's where modern distributed-system pain actually lives: complex systems fail in emergent, surprising ways that tests and predicted monitors miss, and by the time you hit one in production it's too late to add the instrumentation needed to investigate (you'd have to ship new code just to debug). ODD front-loads the solution: as you build each feature, you emit rich, contextual, high-cardinality telemetry (wide events/traces) so that production is EXPLORABLE — the next novel problem becomes a query against existing data rather than a redeploy to add logging. Monitoring (known unknowns) is necessary but insufficient for systems where the next outage is something nobody predicted; ODD builds the explorability needed to debug the unpredictable, which is precisely the unknown-unknown class."
}
```

## Build it up — practices and culture

- **Instrument with wide, contextual events:** emit **one rich event per unit of work** carrying many
  high-cardinality fields (user, version, feature flag, region, inputs, timings, outcome) — so you can
  slice by anything later (recall high-cardinality data / observability 2.0). Prefer wide events over
  scattered ad-hoc logs.
- **"Test in production" (responsibly):** validate behavior with **canary/percentage rollouts +
  feature flags + SLO/telemetry watching** (recall canary, SLOs, blast radius) — because some behaviors
  only appear under real traffic/data. This is *complementary* to pre-prod testing, not a replacement.
- **Make observability part of "done":** a feature isn't done when tests pass — it's done when you can
  **see it working in production** and **debug it** there. Code review includes "is this observable?"
- **Close the loop:** use the telemetry to drive SLOs, alerts on burn rate, and the next iteration
  (recall SLOs/error budgets).

```reveal
{
  "prompt": "ODD encourages 'testing in production' — how is that responsible engineering rather than recklessness, and how does it relate to pre-production testing?",
  "answer": "'Testing in production' in ODD doesn't mean skipping pre-prod testing or shipping carelessly — it means deliberately validating behavior against REAL traffic, data, and scale that staging can't faithfully reproduce, using safeguards that bound risk. It's responsible because it's done with: (1) Progressive delivery — canary/percentage rollouts and feature flags expose the change to a small, controlled slice of users first, so any problem affects few people and can be rolled back instantly by flipping the flag (small blast radius — recall failure domains/canary deploys). (2) Rich observability — you watch the new code's telemetry (SLOs, error rates, latency, wide events sliced by version/flag/region) to detect issues quickly and precisely, often before users complain. (3) Automated guardrails — error-budget/burn-rate alerts and automatic rollback if metrics regress. The reason it's necessary is that pre-production testing, while essential, fundamentally can't cover everything: staging has different (smaller, cleaner) data, lacks production's real traffic mix/concurrency/scale, third-party behaviors, edge-case inputs, and emergent interactions — so some bugs and performance characteristics ONLY appear in production. So ODD treats pre-prod tests and production validation as COMPLEMENTARY: unit/integration/e2e tests catch what they can cheaply and early (recall the test pyramid), and then controlled production rollout + observability catches the unknown-unknowns and scale/real-data issues that tests can't, with the safety of small blast radius and fast rollback. The recklessness would be deploying broadly with no canary, no flags, and no observability and hoping; the responsible version is incremental exposure plus the instrumentation to SEE what's happening and the controls to undo it fast. In short, you can't fully test a complex distributed system outside production, so you make production validation safe (canary, flags, SLO-watching, rollback) and observable (wide events) — turning 'testing in production' from a gamble into a controlled, monitored experiment that complements, not replaces, pre-prod testing."
}
```

## In the wild

- **Honeycomb / observability-2.0** popularized ODD and **wide structured events** with high-cardinality
  fields you slice arbitrarily (recall high-cardinality data); OpenTelemetry provides the instrumentation
  (recall tracing at scale).
- **Progressive delivery** (feature flags, canary — recall) + **SLO/telemetry validation** is how teams
  "test in production" safely.
- It complements the **test pyramid** (recall): tests catch known cases pre-prod; observability handles
  the **unknown unknowns** in prod.
- **"Is it observable?"** becomes a code-review / definition-of-done criterion.

## Common misconception — "add monitoring/logging later if there's a problem"

Bolting on observability after an incident means **redeploying to debug, blind**; ODD builds the ability
to ask **unanticipated** questions **up front**.

```reveal
{
  "prompt": "Why is 'we'll add logging/monitoring later when we hit a problem' a failure mode, and what does ODD do instead?",
  "answer": "Because by the time you hit a production problem, the instrumentation needed to diagnose it doesn't exist, and adding it means shipping new code to debug — slowly, reactively, and often blind. Concretely: a complex system fails in some unanticipated way for some subset of users/conditions; you go to investigate and discover the relevant context (which users, versions, inputs, code paths, timings) was never recorded, so you can't ask the question. You then add logging/metrics, redeploy, and wait for the issue to recur — a slow, painful loop performed during an incident, possibly multiple times, while the problem persists. Worse, pre-aggregated monitoring added 'later' is built for the dimensions you NOW guess matter, so it still can't answer the NEXT unanticipated question (the unknown-unknowns), and high-cardinality context can't be retrofitted into metrics anyway. 'Add it later' also tends to produce scattered, inconsistent ad-hoc logs rather than coherent, sliceable telemetry. ODD instead builds observability in as the feature is written: you emit rich, wide, high-cardinality events/traces/metrics with the context needed to answer questions you didn't anticipate, treat 'can I see and debug this in production?' as part of done, and validate behavior via telemetry (canary + SLOs) at ship time. So when a novel problem appears, investigating it is a QUERY against already-captured data (slice the wide events by any dimension) rather than a redeploy-to-add-logging exercise. The difference is proactive explorability vs reactive blindness: ODD pays a small up-front instrumentation cost to make production understandable for the unpredictable failures that WILL happen, whereas 'add it later' guarantees you're least prepared exactly when you most need to debug — and even then only equips you for the specific thing that just broke, not the next surprise. In modern distributed systems where most pain is unknown-unknowns, building observability in from the start is the correct, far cheaper-over-time approach."
}
```

**Observability-driven development** treats **observability as part of building** — instrument richly
(wide, high-cardinality events/traces/metrics) **as you code**, and validate in **production via
telemetry** (canary + SLOs). Its goal is answering **unknown unknowns** (unanticipated questions) as a
**query, not a redeploy** — the opposite of bolting on logging after an incident. A feature is "done"
when you can **see and debug it in production**.

## Self-test

```quiz
{
  "question": "Observability-driven development primarily aims to let you:",
  "options": [
    "Replace all pre-production testing",
    "Answer unanticipated questions (unknown unknowns) about production behavior without shipping new code — by instrumenting richly as you build",
    "Reduce the number of metrics",
    "Avoid using feature flags"
  ],
  "answer": 1,
  "explanation": "ODD builds in rich, high-cardinality telemetry while coding so novel production problems become a query, not a redeploy-to-add-logging."
}
```

```quiz
{
  "question": "The 'unknown unknowns' that observability (vs monitoring) targets are:",
  "options": [
    "Metrics you already dashboard and alert on",
    "Questions you didn't anticipate (e.g. 'why are THESE users on THIS version in THIS region slow?'), needing arbitrary slicing of rich high-cardinality data",
    "CPU and memory usage",
    "Scheduled maintenance windows"
  ],
  "answer": 1,
  "explanation": "Monitoring answers predicted (known) questions; observability answers unanticipated ones via wide, high-cardinality events sliced arbitrarily at query time."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Observability-driven development — key terms", "cards": [
  { "front": "Observability-driven development (ODD)", "back": "Treating observability as a first-class part of development: instrument a feature as you build it and validate it via telemetry in production, not just by passing tests." },
  { "front": "Unknown unknowns", "back": "Questions you didn't anticipate (e.g. why these users, on this version, in this region, are slow). ODD targets these — answerable only by slicing rich high-cardinality data ad-hoc." },
  { "front": "Known unknowns", "back": "Questions you predicted and prepared dashboards/alerts for (CPU, error rate). Monitoring handles these — telling you whether things you expected to break are breaking." },
  { "front": "Wide (structured) events", "back": "One rich event per unit of work carrying many high-cardinality fields (user, version, flag, region, inputs, timings, outcome) so you can slice by anything later." },
  { "front": "Test in production (responsibly)", "back": "Validating behavior against real traffic using canary/percentage rollouts, feature flags, and SLO/telemetry watching with small blast radius — complementary to pre-prod testing, not a replacement." },
  { "front": "\"Is it observable?\" as done", "back": "A feature isn't done when tests pass — it's done when you can see it working and debug it in production. Observability becomes a code-review / definition-of-done criterion." }
] }
```

## Key takeaways

- **Observability-driven development** makes **observability a first-class part of building** — instrument
  richly **as you code** and validate in **production via telemetry**, not just passing tests.
- It targets **unknown unknowns** (unanticipated questions) — monitoring answers **known** ones; ODD needs
  **wide, high-cardinality events** sliceable arbitrarily, so the next novel problem is a **query, not a
  redeploy**.
- Practices: **wide contextual events**, **responsible "test in production"** (canary/flags + SLO
  watching + small blast radius), and **"is it observable?" as part of done**.
- It **complements** the test pyramid (tests for known cases pre-prod; observability for unknowns in
  prod) and **closes the loop** with SLOs/error budgets — the alternative ("add logging later") means
  **redeploying to debug, blind**.

## Up next

The remaining chapters cover architecture patterns. First, modernizing legacy systems incrementally.
Next: **Strangler Fig Pattern**.
