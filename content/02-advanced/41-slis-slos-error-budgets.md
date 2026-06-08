---
title: "SLIs, SLOs & Error Budgets"
slug: slis-slos-error-budgets
level: advanced
module: operability-and-patterns
order: 41
reading_time_min: 15
concepts: [sli, slo, sla, error-budget, reliability-targets, burn-rate]
use_cases: []
prerequisites: [availability-and-the-nines, metrics-and-key-system-metrics, observability-fundamentals]
status: published
---

# SLIs, SLOs & Error Budgets

## Hook — a motivating scenario

"Make it reliable" is not a target — it's a wish. How reliable? At what cost? When is it reliable
*enough* to ship features instead of polishing uptime? Without numbers, every outage is a panic and
every reliability-vs-velocity argument is a shouting match. **SLIs, SLOs, and error budgets** turn
reliability into a **measurable, agreed target with a built-in decision rule** — the core of SRE
practice.

## Mental model — measure, target, budget

Three related terms, from measurement to decision:

```match
{
  "prompt": "Match each term to what it is.",
  "pairs": [
    { "left": "SLI (Indicator)", "right": "A measured number: the actual reliability metric (e.g. % of requests served < 300ms)" },
    { "left": "SLO (Objective)", "right": "Your internal target for the SLI (e.g. 99.9% of requests succeed)" },
    { "left": "SLA (Agreement)", "right": "A contractual promise to customers (with penalties) — usually looser than the SLO" },
    { "left": "Error budget", "right": "The allowed amount of failure: 100% − SLO (e.g. 0.1% = the budget to spend)" }
  ]
}
```

- **SLI** = what you **measure** (availability, latency, error rate — the golden signals, recall).
- **SLO** = the **target** for that SLI (your internal goal).
- **SLA** = the **contract** with customers (legal/financial), deliberately **looser** than the SLO (so
  you breach the SLO — your warning line — well before the SLA).
- **Error budget** = **100% − SLO** = how much unreliability you're **allowed** to spend.

## Build it up — the error budget as a decision tool

The **error budget** is the powerful idea: if your SLO is 99.9% availability, you're **permitted** 0.1%
unavailability — that's a **budget you can spend** on risk (deploys, experiments, planned maintenance).
It reframes reliability from "never fail" to "fail no more than X," which:
- **Resolves the reliability-vs-velocity tension with a rule:** **budget remaining → ship features
  freely** (you're reliable enough; perfection is wasteful); **budget exhausted → freeze risky changes**
  and focus on reliability until you recover. No more arguing — the budget decides.
- **Quantifies how much downtime is acceptable** so teams stop over- or under-investing in reliability.

```calc
{
  "title": "Error budget: allowed downtime per 30 days",
  "inputs": [
    { "key": "slo", "label": "SLO availability (%)", "default": 99.9 },
    { "key": "days", "label": "Window (days)", "default": 30 },
    { "key": "minsPerDay", "label": "Minutes/day", "default": 1440 }
  ],
  "formula": "(100 - slo) / 100 * days * minsPerDay",
  "resultLabel": "Allowed downtime in the window",
  "resultUnit": "minutes"
}
```

> 99.9% over 30 days → **~43 minutes** of error budget. 99.99% → ~4.3 min. That budget is what you
> "spend" on deploys/risk — and what an outage **burns**.

```reveal
{
  "prompt": "How does an error budget resolve the classic conflict between feature velocity (dev teams) and reliability (ops/SRE)?",
  "answer": "By turning reliability into a shared, quantified target with an objective spending rule, so the decision stops being a values clash and becomes data-driven. Traditionally dev teams want to ship fast (features = value) while ops/SRE want stability (changes = risk), and with no agreed target each outage or release becomes a subjective argument about 'how safe is safe enough.' An error budget reframes it: the SLO defines how reliable the service must be (say 99.9%), and 100% − SLO is the budget of allowed unreliability you're permitted to 'spend' (≈43 min/30 days at 99.9%). Both teams agree to one rule: while there's error budget remaining, the service is reliable ENOUGH, so the team is free to ship features, take deploy risk, and run experiments — chasing more reliability than the SLO would be wasted effort (and users wouldn't notice). When the budget is exhausted (too many errors/too much downtime this window), risky changes are frozen and effort shifts to reliability work (fixing bugs, improving resilience, paying down toil) until the budget recovers. This aligns incentives: devs are motivated to keep changes safe (so they don't burn the budget and trigger a freeze), and ops accept that some failure is acceptable (you're SUPPOSED to spend the budget, not hoard it — 100% reliability is the wrong target). So the budget converts 'velocity vs reliability' from an unwinnable culture war into a simple, pre-agreed feedback loop: budget left → go fast; budget gone → slow down and stabilize. It also prevents both failure modes — over-investing in reliability nobody needs, and recklessly shipping past what users tolerate — by making the acceptable amount of failure explicit and tying behavior to it."
}
```

## Build it up — choosing SLOs and watching burn rate

- **Pick SLIs that reflect user experience:** request success rate, latency percentiles (p99 — recall),
  availability — the **golden signals**, measured from the **user's perspective** (not internal proxies
  like CPU).
- **Set SLOs realistically:** **100% is the wrong target** — it's impossibly expensive and users can't
  perceive it (the network/their device fails more often than that). Choose the level users actually
  need (often 99.9%–99.99%); each extra nine costs exponentially more (recall the nines).
- **Burn rate:** monitor how **fast** you're consuming the budget. A **fast burn** (a big chunk in
  minutes) pages immediately; a **slow burn** (gradual) is a lower-urgency alert. **Alert on budget burn
  rate**, not on every blip (recall: alert on symptoms/SLOs).

```reveal
{
  "prompt": "Why is targeting 100% reliability (an SLO of 100%) a mistake, and how should you choose the right number?",
  "answer": "Targeting 100% is a mistake on every dimension. First, it's effectively impossible and exponentially costly: each additional nine of availability (99.9% → 99.99% → 99.999%) requires disproportionately more engineering, redundancy, and operational effort (recall the nines), and chasing 100% means infinite cost with diminishing or zero perceptible benefit. Second, users literally can't perceive the difference beyond a point, because the rest of the stack between you and them — their device, their Wi-Fi/ISP, the public internet, DNS — already fails far more often than, say, 99.99%; making YOUR service 99.999% vs 99.99% is invisible when the user's own connection is 99% reliable. Third, a 100% SLO eliminates the error budget entirely, which removes your ability to deploy, experiment, or take any risk (every change endangers an unachievable target) and reinstates the velocity-vs-reliability war you were trying to end. The right way to choose: pick SLIs that reflect actual user experience (success rate, p99 latency, availability measured from the user's side), then set the SLO at the level users actually NEED and notice — usually somewhere like 99.9%–99.99% for many services, higher only for genuinely critical paths — informed by what failure users will tolerate, what competitors/expectations demand, and the cost of each extra nine. The goal is 'reliable enough that users are happy and the rest of their stack is the bottleneck, not us,' deliberately leaving an error budget to spend on velocity. So you choose the lowest reliability that keeps users satisfied (not the highest you can imagine), because beyond that point you're paying exponentially more for reliability no one can perceive and giving up the flexibility the error budget provides. Reliability is a means to user happiness, not an end in itself — and 100% is both unattainable and the wrong objective."
}
```

Where you set the SLO is itself a dial between feature velocity and reliability spend:

```tradeoff
{ "title": "How high should you set the SLO?", "axis": { "left": "Lower SLO (more velocity)", "right": "Higher SLO (more reliability)" }, "steps": [
  { "label": "Too low", "detail": "A lax SLO yields a huge error budget and maximum freedom to ship, but the service fails more than users will tolerate — you're under-investing in reliability." },
  { "label": "99.9%-ish", "detail": "Often the user-perceived sweet spot: ~43 min of budget over 30 days to spend on deploys and experiments while users stay happy. Reliable enough, not wasteful." },
  { "label": "99.99%+", "detail": "Each extra nine costs exponentially more in engineering and redundancy. The shrinking budget leaves little room for risk; justified only for genuinely critical paths." },
  { "label": "100%", "detail": "The wrong target: impossibly expensive, imperceptible (users' own device/ISP fails more), and it eliminates the error budget — reviving the velocity-vs-reliability war." }
] }
```

## In the wild

- **SRE practice** (Google's SRE books) formalizes SLI/SLO/error-budget; widely adopted (Datadog,
  Nobl9, Prometheus + SLO tooling, OpenSLO).
- **SLAs** (contractual, with penalties) are set **looser** than internal SLOs so you get warned (breach
  SLO) before you owe customers (breach SLA).
- **Error-budget policies** codify the freeze rule (budget exhausted → halt feature launches); **burn-rate
  alerts** (multi-window, multi-burn-rate) page on meaningful budget consumption (recall alert on
  symptoms/SLOs).
- Builds directly on the **golden signals / percentiles** (recall metrics) and **the nines** (recall
  availability).

## Common misconception — "aim for 100% / SLA and SLO are the same / minimize all errors always"

You **budget** failure (100% is wrong), SLO (internal target) ≠ SLA (contract), and you're meant to
**spend** the budget.

```reveal
{
  "prompt": "Clear up the common confusions: SLA vs SLO, and 'we should minimize errors as much as possible.'",
  "answer": "SLA vs SLO: an SLO is your INTERNAL reliability target for an SLI (e.g. 'p99 latency < 300ms for 99.9% of requests this month'), used to drive engineering decisions and the error budget. An SLA is an EXTERNAL, contractual commitment to customers, usually with financial/legal penalties for breach (e.g. 'we guarantee 99.5% uptime or you get credits'). They're deliberately different: the SLA is set LOOSER than the SLO so that you breach your internal objective (a warning, triggering corrective action) well before you breach the customer contract (which costs money/trust). So the SLO is the early-warning line you manage to; the SLA is the worst-case promise you must not cross. Conflating them either makes your internal target as lax as the contract (no early warning) or exposes you to penalties by promising customers your aspirational internal goal. On 'minimize errors as much as possible': that's the wrong objective. Reliability has exponentially rising cost per nine and diminishing user-perceptible benefit, and a too-high target eliminates your error budget — the allowed failure you're SUPPOSED to spend on deploys, experiments, and velocity. If you're consistently far under budget (almost no errors), you're likely OVER-investing in reliability and UNDER-investing in features; the healthy state is to consume most of your error budget over time, because that means you set the SLO at the right user-perceived level and are correctly trading the headroom for velocity. So you don't minimize errors absolutely; you keep them within budget — failing no more than the SLO allows, and using the slack to move fast. The correct framings: pick a user-driven SLO below 100%, keep the SLA looser than the SLO, and treat the error budget as a resource to spend, not a number to drive to zero. 'Maximize reliability' and 'SLA = SLO' both lead to wasted effort and misaligned incentives; budgeted, user-centered reliability is the goal."
}
```

**SLI** = the measured reliability metric; **SLO** = your internal target for it; **SLA** = the
(looser) customer contract; **error budget** = **100% − SLO** = the failure you're *allowed to spend*.
The error budget turns reliability into a **decision rule** (budget left → ship; budget gone → freeze
and stabilize). **100% is the wrong target**; pick **user-perceived** SLOs and **alert on burn rate**.

## Self-test

```quiz
{
  "question": "An error budget is:",
  "options": [
    "The money spent on servers",
    "The allowed amount of unreliability (100% − SLO) — failure you can 'spend' on risk/deploys before you must freeze and stabilize",
    "The number of engineers on call",
    "The contractual penalty in an SLA"
  ],
  "answer": 1,
  "explanation": "Error budget = 100% − SLO. While budget remains, ship features; when it's exhausted, freeze risky changes and focus on reliability."
}
```

```quiz
{
  "question": "The difference between an SLO and an SLA is:",
  "options": [
    "They're the same thing",
    "SLO is your internal reliability target; SLA is the (looser) contractual promise to customers, so you breach the SLO as a warning before the SLA",
    "SLA is stricter than SLO",
    "SLO is for latency, SLA is for availability"
  ],
  "answer": 1,
  "explanation": "The SLO (internal target) is set tighter than the SLA (customer contract) so breaching it warns you before you owe customers penalties."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "SLIs, SLOs & error budgets — key terms", "cards": [
  { "front": "SLI (Service Level Indicator)", "back": "A measured number — the actual reliability metric (e.g. % of requests served under 300ms, success rate, availability), ideally measured from the user's perspective." },
  { "front": "SLO (Service Level Objective)", "back": "Your internal target for an SLI (e.g. 99.9% of requests succeed). It's the warning line you manage to and the basis of the error budget." },
  { "front": "SLA (Service Level Agreement)", "back": "A contractual promise to customers, usually with penalties. Set deliberately looser than the SLO so you breach the SLO as a warning before owing customers." },
  { "front": "Error budget", "back": "100% minus the SLO — the allowed amount of failure you're permitted to spend on deploys, experiments, and risk (e.g. 0.1% at a 99.9% SLO, ~43 min over 30 days)." },
  { "front": "Error-budget decision rule", "back": "Budget remaining → ship features freely (reliable enough). Budget exhausted → freeze risky changes and focus on reliability until it recovers." },
  { "front": "Burn rate", "back": "How fast you're consuming the error budget. Fast burn pages immediately; slow burn is a lower-urgency alert. Alert on burn rate, not every blip." }
] }
```

## Key takeaways

- **SLI** (measured metric) → **SLO** (internal target) → **SLA** (looser customer contract); **error
  budget = 100% − SLO** (the failure you're *allowed* to spend).
- The **error budget** is a **decision rule**: **budget remaining → ship features**; **budget exhausted →
  freeze risky changes and focus on reliability** — ending the velocity-vs-reliability fight.
- Pick **user-experience SLIs** (success rate, p99 latency, availability) and **realistic SLOs** — **100%
  is the wrong target** (exponential cost, imperceptible; users' own stack fails more).
- **Alert on burn rate** (how fast you spend the budget), not every blip; you're **meant to spend** the
  budget, not drive errors to zero.

## Up next

Operating reliably needs deep visibility across services. Revisiting tracing at production scale. Next:
**Distributed Tracing at Scale**.
