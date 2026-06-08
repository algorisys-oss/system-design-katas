---
title: "Availability, Reliability & the Nines"
slug: availability-and-the-nines
level: foundations
module: foundations-of-system-design
order: 48
reading_time_min: 13
concepts: [availability, reliability, nines, sla, slo, downtime, redundancy-cost]
use_cases: []
prerequisites: [single-point-of-failure, load-balancing]
status: published
---

# Availability, Reliability & the "Nines"

## Hook — a motivating scenario

A vendor promises "99.9% uptime." Sounds basically perfect — until you realize that's **~8.7 hours of
downtime a year**, and if those hours land during your Black Friday sale, it's a catastrophe. To make
reliability decisions (and read SLAs without being fooled), you need to translate fuzzy words like
"highly available" into concrete numbers — the **nines**.

## Mental model — availability is a percentage of time that's up

**Availability** = the fraction of time a system is working and reachable, usually quoted as a
percentage of "nines." The trick is that each extra nine is **10× harder** (and roughly 10× less
downtime). Memorize the rough downtime-per-year for each level:

```match
{
  "prompt": "Match each availability level to its approximate downtime per year.",
  "pairs": [
    { "left": "99% (two nines)", "right": "~3.65 days/year" },
    { "left": "99.9% (three nines)", "right": "~8.7 hours/year" },
    { "left": "99.99% (four nines)", "right": "~52 minutes/year" },
    { "left": "99.999% (five nines)", "right": "~5 minutes/year" }
  ]
}
```

> Rule of thumb: each nine ≈ divide downtime by 10. Three nines ≈ hours; four ≈ tens of minutes; five
> ≈ minutes — per *year*.

## Build it up — availability vs reliability, SLA vs SLO

Related but distinct terms:
- **Availability** — is it up *right now / what fraction of the time*? (uptime)
- **Reliability** — does it work *correctly and consistently* over time (not just up, but right)?
  A system can be "up" while returning errors — available but unreliable.

And the agreements:
- **SLA (Service Level Agreement)** — a *promise to customers* with consequences (e.g. refunds) if
  missed. "99.9% or we credit you."
- **SLO (Service Level Objective)** — your *internal target* (usually stricter than the SLA) that you
  measure and alert on.
- **SLI (Service Level Indicator)** — the actual *measurement* (e.g. % of successful requests) you
  compare against the SLO.

```reveal
{
  "prompt": "How can a service be 100% 'available' (up) yet still be failing its users?",
  "answer": "Availability often only measures 'responding', not 'responding correctly'. A service can be up but returning 500s, serving stale/wrong data, or timing out under load — available by a naive ping check, yet unreliable from the user's perspective. That's why mature teams define SLIs around *successful* requests and latency (e.g. % of requests served correctly under X ms), not mere reachability. 'Up' and 'working' are different; reliability captures correctness, not just presence."
}
```

## Build it up — the cost of more nines

Each nine demands more redundancy, automation, and operational rigor — at rising cost. So you choose a
target that matches the **business need**, not "as high as possible":

- More nines → more redundancy (multi-AZ, multi-region), faster automated failover, rigorous testing,
  on-call maturity.
- **Dependencies multiply down:** if your service depends on three components each at 99.9%, your
  *combined* availability is roughly 99.9%³ ≈ 99.7% — worse than any single one. Chains of
  dependencies erode availability.

```reveal
{
  "prompt": "Your service is 99.99%, but it calls three downstream services each at 99.9%. What's your realistic ceiling, and why?",
  "answer": "Roughly 99.9%³ ≈ 99.7% (about a day/year of downtime), because if any dependency is down, you're effectively down — availabilities of serial dependencies multiply, always lowering the total. Your own 99.99% is capped by the weakest chain of things you rely on. To do better you must add redundancy/fallbacks around those dependencies (retries, caching, graceful degradation, circuit breakers) or reduce hard dependencies — you can't exceed your dependency chain by wishing. This is why 'five nines' is extraordinarily hard: every dependency must be near-perfect too."
}
```

Reliability is an economic dial — slide the target up and watch the cost and downtime trade off:

```tradeoff
{ "title": "How many nines should you target?", "axis": { "left": "Fewer nines (cheaper)", "right": "More nines (costlier)" }, "steps": [
  { "label": "99% (two nines)", "detail": "~3.65 days/year downtime. Cheap and simple — fine for low-stakes services where occasional outages don't hurt the business." },
  { "label": "99.9% (three nines)", "detail": "~8.7 hours/year. Needs more redundancy and automation; typical lower bound for cloud SLAs and many user-facing apps." },
  { "label": "99.99% (four nines)", "detail": "~52 minutes/year. Multi-AZ redundancy, fast automated failover, rigorous testing — justified when downtime is costly, e.g. payments." },
  { "label": "99.999% (five nines)", "detail": "~5 minutes/year. Multi-region active-active and near-perfect dependencies; extraordinarily hard since every dependency must be near-perfect too." }
] }
```

## In the wild

- **Cloud SLAs** are typically 99.9%–99.99%; read them as *downtime budgets*, and note what's excluded
  (maintenance windows, etc.).
- **Error budgets** (from SLOs): 99.9% target = 0.1% "budget" to spend on risk/deploys — a key SRE
  concept (advanced course) balancing reliability vs velocity.
- **Higher nines = real money:** multi-region active-active, rigorous automation — justified only when
  downtime is very costly.
- **Measure with SLIs:** % successful requests and latency percentiles, not just "is the server
  pingable."

## Common misconception — "we should aim for 100% / five nines availability"

100% is impossible and over-targeting nines is wasteful.

```reveal
{
  "prompt": "Why is targeting 100% availability the wrong goal, even setting cost aside?",
  "answer": "100% is unachievable — hardware fails, networks partition, deploys happen, dependencies break — so promising it sets you up to fail and to over-invest with diminishing returns. Each extra nine costs ~10× more effort, and beyond a point you're spending heavily to shave minutes of yearly downtime users won't notice. The right approach is to pick a target that matches the business impact of downtime (e.g. a blog at 99.9% vs payments at 99.99%+), express it as an SLO with an error budget, and spend reliability effort where it actually matters. 'As available as the business needs', not 'as available as physically possible'."
}
```

Reliability is an **economic trade-off**: pick a target matched to business impact, express it as an
SLO with an error budget, and stop there. 100% is a myth, and each nine is exponentially pricier.

## Self-test

```quiz
{
  "question": "Approximately how much downtime per year does 99.9% (three nines) availability allow?",
  "options": ["~5 minutes", "~52 minutes", "~8.7 hours", "~3.65 days"],
  "answer": 2,
  "explanation": "99.9% ≈ 8.7 hours/year of downtime. Each additional nine cuts downtime ~10× (four nines ≈ 52 min)."
}
```

```quiz
{
  "question": "An SLA differs from an SLO in that:",
  "options": [
    "An SLA is your internal target; an SLO is the customer promise",
    "An SLA is a customer-facing promise (with consequences); an SLO is your internal target (usually stricter)",
    "They are identical",
    "An SLO has legal penalties; an SLA does not"
  ],
  "answer": 1,
  "explanation": "SLA = external promise with consequences; SLO = internal objective you target/alert on, typically stricter than the SLA."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Availability & the nines — key terms", "cards": [
  { "front": "Availability", "back": "The fraction of time a system is working and reachable, usually quoted as a percentage of nines (e.g. 99.9% uptime)." },
  { "front": "The 'nines' rule of thumb", "back": "Each extra nine is ~10x harder and roughly 10x less downtime: 99.9% ≈ 8.7 h/yr, 99.99% ≈ 52 min/yr, 99.999% ≈ 5 min/yr." },
  { "front": "Availability vs reliability", "back": "Availability asks 'is it up?'; reliability asks 'does it work correctly and consistently?' A system can be up but returning errors — available yet unreliable." },
  { "front": "SLA", "back": "Service Level Agreement: a customer-facing promise with consequences (e.g. refunds/credits) if missed, like '99.9% or we credit you.'" },
  { "front": "SLO vs SLI", "back": "SLO = your internal target, usually stricter than the SLA. SLI = the actual measurement (e.g. % successful requests) you compare against the SLO." },
  { "front": "Dependencies multiply down", "back": "Serial dependencies' availabilities multiply: three components each at 99.9% combine to ~99.9%³ ≈ 99.7% — worse than any single one." }
] }
```

## Key takeaways

- **Availability** (% uptime) is quoted in **nines**; each extra nine ≈ **10× less downtime** (99.9% ≈
  8.7 h/yr, 99.99% ≈ 52 min/yr).
- **Availability ≠ reliability:** a system can be up but returning errors — measure *successful*
  requests (SLIs), not mere reachability.
- **SLA** (customer promise) vs **SLO** (internal target) vs **SLI** (measurement); serial
  **dependencies multiply down** your availability.
- More nines cost exponentially more — **target the business need** (SLO + error budget), not 100%.

## Up next

Availability is one quality metric; performance is another, and they're often confused. Next:
**Latency vs Throughput**.
