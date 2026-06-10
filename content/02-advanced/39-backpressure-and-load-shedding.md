---
title: "Backpressure & Load Shedding"
slug: backpressure-and-load-shedding
level: advanced
module: resilience
order: 39
reading_time_min: 14
concepts: [backpressure, load-shedding, flow-control, admission-control, bounded-queues, prioritization]
use_cases: []
prerequisites: [message-queues, cascading-failure-prevention, rate-limiting]
status: published
---

# Backpressure & Load Shedding

## Hook — a motivating scenario

Demand exceeds capacity — a traffic spike, a slow downstream, a flood of events. A naive system
**accepts everything**: queues grow unbounded, memory balloons, latency climbs for *all* requests, and
eventually it **crashes serving nobody**. A resilient system instead either **slows the source down**
(backpressure) or **drops some work** (load shedding) so it keeps serving the rest. When you can't do
all the work, the goal is to **fail in a controlled way**, not collapse.

## Mental model — two responses to "more work than capacity"

Picture a **busy restaurant on a packed night**. **Backpressure** is the host slowing the seating
pipe — holding tables, pacing how fast orders reach the kitchen — until the line cooks catch up; you
*can* throttle your own front door. **Load shedding** is turning walk-ins away at the door (a polite
"we're full, try later") and protecting your reservations, because you **can't** tell the street to
send fewer hungry people. Same overload, two levers: slow what you control, drop what you can't.

When inflow exceeds what you can process, you have two complementary tools:
- **Backpressure:** **signal the producer to slow down** (or stop) until you catch up — push the
  overload *upstream* to the source. Flow control: the consumer's capacity governs the producer's rate.
- **Load shedding:** when you **can't** slow the source (or can't afford to), **drop/reject excess work**
  — fast-fail low-priority or surplus requests so the accepted ones succeed. Admission control: refuse
  what you can't handle.

```compare
{
  "options": [
    { "label": "Backpressure (slow the source)", "points": ["Signal producer to reduce rate / block", "Propagates limits upstream (flow control)", "Works when the producer CAN slow down", "Bounded queues, TCP flow control, reactive streams"] },
    { "label": "Load shedding (drop excess)", "points": ["Reject/drop surplus requests fast (e.g. 503)", "Protects capacity for accepted work", "Works when you CAN'T slow the source (open internet)", "Prioritize: shed low-value load first"] }
  ]
}
```

## Build it up — backpressure and bounded queues

The enabling mechanism for backpressure is **bounded queues/buffers**. An **unbounded** queue *hides*
overload — it grows until memory dies (and adds ever-increasing latency); it provides no signal. A
**bounded** queue, when full, **forces a decision**: block the producer (backpressure) or reject
(shed). So:
- **Bounded buffers** turn "infinite backlog → crash" into a clear, early "we're full" signal (recall
  message queues: a queue absorbs spikes, but a *bounded* one also pushes back).
- **Backpressure propagates** the limit **upstream**: a slow consumer slows its producer, which slows
  *its* producer — flow control all the way back to the source (TCP does this at the network level;
  reactive-streams/Flow APIs at the app level).

```reveal
{
  "prompt": "Why is an unbounded queue dangerous, and how does a bounded queue enable backpressure or load shedding?",
  "answer": "An unbounded queue is dangerous because it hides overload instead of surfacing it: when inflow exceeds processing capacity, the queue just keeps growing, consuming ever more memory until the process OOMs/crashes — and meanwhile every queued item's latency climbs without limit (items wait behind an ever-longer backlog), so you get steadily worse performance for everyone followed by a hard collapse. Crucially, an unbounded queue provides no signal that you're overloaded and no point at which the system pushes back or sheds, so the failure is sudden and total. A bounded queue fixes this by capping the backlog, which forces an explicit decision at the moment it fills — and that decision is exactly where backpressure or load shedding happens. With backpressure: when the bounded queue is full, the producer's enqueue blocks (or is told to slow/stop), so the consumer's limited capacity propagates upstream as flow control — the producer can't outrun the consumer, memory stays bounded, and latency stays predictable. With load shedding: when the queue is full and you can't slow the producer (e.g. external clients on the open internet), you reject/drop the surplus immediately (fast-fail, e.g. return 503), protecting the capacity for the requests already accepted. Either way, the bound converts 'infinite backlog → unbounded latency → crash' into an early, controlled 'we're full' that triggers a deliberate response. Bounded queues also keep latency bounded (queue length × service time has a ceiling), which matters because a huge backlog means even successfully-processed items are stale/too-late to be useful. So bounding the queue is the foundational move: it makes overload visible and actionable, enabling you to choose flow control (backpressure) when the source can slow down, or admission control (shedding) when it can't — instead of silently accumulating toward collapse."
}
```

## Build it up — load shedding and prioritization

When you can't apply backpressure (e.g. external users on the open internet won't "slow down"), you
**shed load**: reject excess **early and cheaply** so accepted requests still meet their SLOs.
- **Fast-fail:** reject with a quick **503 / "try later"** *before* doing expensive work — a rejected
  request must be **cheap** (don't spend resources on work you'll drop).
- **Prioritize / graceful degradation:** shed **low-value** load first — drop non-critical features
  (recommendations) to protect critical paths (checkout); serve premium/critical traffic over
  best-effort (recall graceful degradation, cascading-failure prevention).
- **Admission control:** decide at the **edge/entry** whether to admit a request, based on current load —
  better to reject 10% at the door than to degrade 100% inside.
- **Relation to rate limiting:** rate limiting (recall) is *planned* per-client shedding; load shedding
  is *reactive* shedding under real-time overload. Both refuse work to protect the system.

```reveal
{
  "prompt": "Why is load shedding (deliberately dropping some requests) often the right move under overload, and what makes shedding 'good'?",
  "answer": "Because under genuine overload — inflow exceeds capacity and you can't slow the source — your real choice is not 'serve everyone' vs 'serve some'; it's 'serve some' vs 'serve no one.' If you accept everything beyond capacity, queues grow, latency explodes for ALL requests, resources exhaust, and the system collapses, so nobody gets served and the failure may cascade upstream. Deliberately shedding the excess keeps total successful throughput high: the requests you admit complete within their SLOs while the surplus is rejected quickly, which is strictly better for users in aggregate and prevents the death spiral. It also protects the system's ability to recover (it isn't being driven into the ground) and contains blast radius. What makes shedding 'good': (1) Fast and cheap rejection — shed BEFORE doing expensive work (early, at the edge/admission control), returning a quick 503/'retry later' so dropped requests consume minimal resources; shedding that happens after you've spent the work is nearly useless. (2) Prioritization — shed the least valuable load first: drop non-critical features (recommendations, related items) to protect critical paths (checkout, posting), and favor premium/critical traffic over best-effort, so the degradation is graceful and the important work survives. (3) Load-aware admission — decide based on real-time load/queue depth so you reject just enough (e.g. 10% at the door) rather than too much or too little. (4) Clear client signaling — return proper status (503 + Retry-After) so clients back off (with jitter) instead of hammering, avoiding a retry-storm that re-overloads you. (5) Combined with backpressure where the source CAN slow down (internal producers), reserving shedding for sources you can't throttle (open-internet clients). So good load shedding is early, cheap, prioritized, load-aware, and pairs with backoff signaling — turning an uncontrolled collapse into a controlled, graceful degradation that maximizes useful work and preserves the critical paths. It's choosing partial success over total failure, deliberately and intelligently."
}
```

## In the wild

- **TCP flow control** and **reactive streams** (Project Reactor, RxJava, Akka Streams, gRPC streaming)
  implement **backpressure** as a first-class concept; **bounded queues/thread pools** are the basic
  mechanism. In Reactive Streams a subscriber signals demand via `request(n)`, capping in-flight items
  to **N**; **HTTP/2** (which gRPC rides on) bounds each stream with a flow-control window whose default
  initial size is **65,535 bytes** (2¹⁶ − 1, one byte short of 64 KiB) per RFC 7540/9113 — the receiver won't accept more until it
  sends `WINDOW_UPDATE`.
- **Load shedding** is standard at gateways/load balancers and in services (return **503** when
  overloaded); **prioritized shedding** protects critical traffic (Google/Envoy-style adaptive
  shedding).
- It composes with **rate limiting/quotas** (recall), **circuit breakers/bulkheads** (recall cascading
  failures), and **autoscaling** (add capacity when possible; shed while it spins up).
- **Kafka/queues** provide buffering, but you still need **bounds + consumer lag monitoring** to avoid
  hidden unbounded backlog.

## Common misconception — "just add a big queue / buffer to handle spikes"

A bigger (or unbounded) queue **defers and worsens** collapse; you need **bounds + backpressure or
shedding**.

```reveal
{
  "prompt": "Why doesn't 'just make the queue bigger' solve overload, and what does?",
  "answer": "Because a bigger queue addresses the symptom (occasional full queue) while ignoring the cause (sustained inflow exceeding processing capacity), and it actually makes things worse when overload persists. A queue only smooths TEMPORARY bursts: it works when average inflow ≤ capacity and you just need to ride out short spikes. If demand genuinely exceeds capacity for a sustained period, a larger queue just lets the backlog grow larger before the inevitable — and in the meantime it inflates latency catastrophically, because every item waits behind an enormous backlog (queueing delay = backlog length × service time). So you get huge, ever-rising latencies (often making the responses useless by the time they're served — stale/timed-out) and then, with an unbounded or very large queue, eventual memory exhaustion and a hard crash. A bigger buffer thus DEFERS and AMPLIFIES the collapse rather than preventing it, and it hides the overload signal so you don't react in time. The real solutions match response to cause: (1) Bound the queue so 'full' becomes an explicit, early signal instead of silent growth. (2) Apply backpressure when the producer can slow down — propagate the consumer's capacity upstream so inflow is throttled to match (flow control), keeping latency and memory bounded. (3) Apply load shedding when you can't slow the source — reject excess early and cheaply (fast 503), prioritizing critical work, so accepted requests still meet SLOs. (4) Add capacity (autoscaling) when feasible, shedding/backpressuring while it spins up. (5) Pair with rate limiting, circuit breakers, and backoff signaling to prevent retry storms. The core insight: queues buffer variance, they don't add capacity — if inflow > capacity over time, no buffer size saves you; you must either reduce inflow (backpressure/shedding/rate limits) or increase capacity (scale). 'Make it bigger' trades a fast, visible failure for a slower, larger, latency-poisoned one."
}
```

When demand exceeds capacity, **backpressure** (signal the producer to **slow down** — flow control via
**bounded queues**) and **load shedding** (**reject/drop** excess early, prioritizing critical work)
keep the system serving the rest instead of collapsing. **Unbounded queues hide overload and worsen
collapse** — bound them, then backpressure (if the source can slow) or shed (if it can't). It's
choosing **controlled partial failure over total failure**.

## Self-test

```quiz
{
  "question": "Backpressure and load shedding are both responses to demand exceeding capacity. The difference is:",
  "options": [
    "They're identical",
    "Backpressure signals the producer to slow down (flow control); load shedding drops/rejects excess work when you can't slow the source",
    "Backpressure drops requests; load shedding adds servers",
    "Load shedding only applies to databases"
  ],
  "answer": 1,
  "explanation": "Backpressure pushes the limit upstream (slow the source); load shedding refuses excess (admission control) when the source can't be slowed."
}
```

```quiz
{
  "question": "Why is an unbounded queue a poor way to handle overload?",
  "options": [
    "It uses too little memory",
    "It hides overload and grows until latency explodes and the system crashes — no backpressure/shedding signal; a bounded queue forces a controlled decision",
    "It rejects too many requests",
    "It makes requests faster"
  ],
  "answer": 1,
  "explanation": "Unbounded backlog → unbounded latency → OOM/crash, with no signal. Bound the queue so 'full' triggers backpressure or shedding."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Backpressure & load shedding — key terms", "cards": [ { "front": "Backpressure", "back": "Signal the producer to slow down (or block) until the consumer catches up — push overload upstream. Flow control: the consumer's capacity governs the producer's rate." }, { "front": "Load shedding", "back": "When you can't slow the source, drop or reject excess work — fast-fail surplus/low-priority requests so accepted ones succeed. Admission control: refuse what you can't handle." }, { "front": "Bounded queue", "back": "A capped buffer that turns 'infinite backlog → crash' into an early 'we're full' signal, forcing an explicit decision: block the producer (backpressure) or reject (shed)." }, { "front": "Why unbounded queues are dangerous", "back": "They hide overload: the queue grows until memory dies and latency climbs without limit, giving no signal and ending in sudden total collapse instead of a controlled response." }, { "front": "Fast-fail / admission control", "back": "Reject excess early and cheaply (quick 503 before expensive work), deciding at the edge whether to admit — better to reject 10% at the door than degrade 100% inside." }, { "front": "Prioritized shedding / graceful degradation", "back": "Shed low-value load first: drop non-critical features (recommendations) to protect critical paths (checkout), favoring premium/critical traffic over best-effort." }, { "front": "Backpressure vs rate limiting", "back": "Rate limiting is planned per-client shedding; load shedding is reactive shedding under real-time overload. Both refuse work to protect the system." } ] }
```

## Key takeaways

- When **demand exceeds capacity**, respond with **backpressure** (signal the producer to **slow down** —
  flow control) or **load shedding** (**reject/drop** excess) — don't accept everything and collapse.
- **Bounded queues** are the enabler: unbounded ones **hide overload** and grow until latency
  explodes/crashes; a bound forces an early, controlled decision (block or reject).
- **Backpressure** propagates the limit **upstream** (works when the producer can slow); **load
  shedding** **fast-fails** excess **early and prioritized** (works when it can't — e.g. open internet).
- It's **controlled partial failure over total failure** — composes with **rate limiting, circuit
  breakers/bulkheads, and autoscaling**; **a bigger queue just defers and worsens** collapse.

## Up next

The last resilience topic: changing a live system's data/schema without downtime. Next: **Zero-Downtime
Migration**.
