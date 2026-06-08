---
title: "Design a Distributed Job Scheduler"
slug: distributed-job-scheduler
level: use-cases
module: real-time-and-data-intensive
order: 15
reading_time_min: 20
concepts: [job-scheduling, leader-election, fencing-tokens, at-least-once-delivery, retries-and-backoff, dead-letter-queue]
use_cases: [distributed-job-scheduler]
prerequisites: [leader-election, distributed-locks, message-queues, idempotency-and-safe-methods]
status: published
---

# Design a Distributed Job Scheduler

> **Use case:** a service that runs **scheduled jobs** (cron-style recurring, or one-off "at this
> time") reliably across a fleet of workers — send the 9am digest, retry the failed payment in 5
> minutes, expire the trial tonight.
> **Domain:** every backend with background work — billing, notifications, data pipelines, cleanup
> jobs, cron-as-a-service (think AWS EventBridge Scheduler, Google Cloud Scheduler, Quartz, Airflow).
> **Scale:** millions of registered schedules, tens of thousands of jobs becoming **due per second**
> at peaks (top-of-the-hour spikes), executed across hundreds of workers that crash, restart, and
> partition.
> **Core challenges:** discovering **due jobs** efficiently; **electing one coordinator** to assign
> work without duplicating it; **at-least-once execution + idempotency**; **fencing tokens** so a
> stalled worker can't double-run; **retries/backoff + a dead-letter queue**; **fairness and
> priority**; and **observability** into a fundamentally asynchronous system.

A scheduler is deceptively simple — "run this later" — but it forces you to confront wall-clock time,
crashes mid-execution, and the brutal truth that in a distributed system you cannot have *both*
"never run twice" *and* "never miss a run." This design is where leader election, locks, queues, and
idempotency all meet.

## 1 · Clarify requirements

**Functional**
- Register **recurring** schedules (cron expression, e.g. `0 9 * * *`) and **one-off** jobs (run at
  timestamp T).
- Run each due job by dispatching it to a worker that executes the **job payload** (an HTTP call, a
  queue message, a function).
- **Retry** failed jobs with backoff; after N attempts, route to a **dead-letter queue (DLQ)**.
- Support **pause / cancel / update** of a schedule, and **priority/fairness** across tenants.

**Non-functional**
- **At-least-once execution:** a due job must eventually run even if a worker crashes mid-run.
- **No (or rare) double-runs** of *effects*: at-least-once delivery means duplicates happen, so
  execution must be **idempotent** or guarded by **fencing**.
- **Timeliness:** fire close to the scheduled time (within seconds), even under top-of-hour spikes.
- **Horizontally scalable & fault-tolerant:** no single worker or coordinator is a SPOF.

```reveal
{
  "prompt": "Why can't a distributed scheduler guarantee both 'exactly once' and 'never miss a run' at the same time?",
  "answer": "Because a job runs in two parts that can't be made atomic across the network: dispatching the job and confirming it finished. Suppose a coordinator hands job J to worker W and W starts executing. Then W goes silent — maybe it crashed before doing the work, maybe it finished the work but crashed before acking, or maybe it's just slow / network-partitioned and still running. The coordinator cannot tell these apart; all it sees is 'no ack.' If it re-dispatches J to another worker (to never miss a run), and W had actually completed, J runs twice — duplicate. If it does NOT re-dispatch (to never double-run), and W had actually crashed before doing the work, J never runs — missed. This is the same impossibility behind exactly-once delivery in messaging: you must choose at-most-once (may miss) or at-least-once (may duplicate). Real schedulers choose at-least-once for reliability and then push the duplicate problem up to the execution layer, where idempotency keys and fencing tokens make a second run a harmless no-op. So you get 'exactly-once effects' — not exactly-once delivery."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Due-job dispatch rate at a top-of-hour spike",
  "inputs": [
    { "key": "schedules", "label": "Total registered schedules", "default": 50000000 },
    { "key": "fracHourly", "label": "Fraction firing on the same hour mark", "default": 0.1 },
    { "key": "spikeSeconds", "label": "Seconds to drain the spike", "default": 60 }
  ],
  "formula": "(schedules * fracHourly) / spikeSeconds",
  "resultLabel": "Dispatches/sec during the spike",
  "resultUnit": "jobs/s"
}
```

```calc
{
  "title": "Storage for the schedule + run-history table",
  "inputs": [
    { "key": "schedules", "label": "Registered schedules", "default": 50000000 },
    { "key": "bytesPerRow", "label": "Bytes per schedule row", "default": 500 },
    { "key": "runsKept", "label": "Recent runs kept per schedule", "default": 50 },
    { "key": "bytesPerRun", "label": "Bytes per run record", "default": 300 }
  ],
  "formula": "schedules * (bytesPerRow + runsKept * bytesPerRun)",
  "resultLabel": "Total storage",
  "resultUnit": "bytes"
}
```

> ~83k dispatches/sec at the hour mark (everyone loves `0 * * * *`) and ~775 GB for schedules plus a
> rolling run history. The spike — not the average — sizes the system: jobs cluster on round times, so
> the dispatcher must **smooth bursts** (jitter, sharded queues) and history must be **partitioned and
> TTL'd**, not kept forever.

## 3 · Data model & API

Two tables (or two column families) carry most of the design:

```
schedules:  id, owner, cron|run_at, payload, status(active|paused),
            next_fire_time, priority, idempotency_prefix
job_runs:   run_id, schedule_id, scheduled_for, attempt, state(pending|
            running|succeeded|failed|dead), lease_owner, fence_token,
            lease_expiry, started_at, finished_at, last_error
```

API surface:

```
POST /schedules            { cron|run_at, payload, priority }  -> schedule_id
PATCH /schedules/{id}      pause | resume | update
DELETE /schedules/{id}
GET  /schedules/{id}/runs  -> recent run history + states
```

The hot field is **`next_fire_time`**: an index on it turns "find due jobs" into a cheap range scan
(`WHERE next_fire_time <= now()`), the heartbeat of the whole system.

## 4 · High-level architecture

```flow
{
  "title": "Scheduler control + execution plane",
  "nodes": [
    { "label": "API / store", "detail": "Schedules table (next_fire_time index) + job_runs table in a durable DB (Postgres / DynamoDB / Cassandra)." },
    { "label": "Coordinator (leader)", "detail": "One elected leader polls due jobs, creates job_run rows, and enqueues them. Standbys wait to take over." },
    { "label": "Dispatch queue", "detail": "Durable queue(s), partitioned by tenant/priority, with visibility timeout for at-least-once handoff." },
    { "label": "Worker fleet", "detail": "Stateless workers pull a job, take a lease + fence token, execute the payload, ack on success." },
    { "label": "Retry / DLQ", "detail": "Failures re-enqueued with backoff; after N attempts move to a dead-letter queue for inspection." }
  ],
  "note": "The coordinator decides WHAT is due and enqueues it exactly once per due instant; the queue + workers handle reliable execution. Separating these planes is the key structural move."
}
```

**Why split coordination from execution?** Deciding *what is due* needs a single consistent view of
time and the schedule table (a coordination problem). *Running the work* needs throughput and crash
tolerance (a queue + stateless workers). Conflating them — every worker scanning the table — causes
the same job to be picked up by many workers at once.

**Storage choice.** Schedules need an ordered index on `next_fire_time`, point updates, and
durability — a partitioned relational DB or a wide-column store (Cassandra/DynamoDB with a time-
bucketed partition key) both work. The queue is a real broker (Kafka, SQS, RabbitMQ) so handoff to
workers is durable and supports redelivery.

## 5 · Deep dives

### 5.1 Due-job discovery: don't scan the world

Polling `SELECT ... WHERE next_fire_time <= now()` every second is fine until 50M rows. Two refinements:

- **Time-bucketing:** partition jobs into per-minute (or per-second) buckets keyed by fire time, so the
  coordinator reads only the *current* bucket — an O(due) read, not an O(all) scan. This is how
  high-volume schedulers (and timer wheels inside a single process) avoid re-examining far-future jobs.
- **Jitter:** when computing the next fire time for `0 * * * *`-style crons, add a small random offset
  (e.g. ±a few seconds, or hash the schedule id into the minute) so 83k jobs don't all land on the same
  millisecond. Spreads the spike from §2 across the window.

```reveal
{
  "prompt": "If a coordinator is down for 3 minutes and comes back to find thousands of jobs whose fire time already passed, what should it do — and what's the danger?",
  "answer": "It must decide a misfire policy per schedule. The danger is a 'thundering herd of the past': blindly firing every missed instance at once both overloads workers and may run jobs whose moment is gone (e.g. firing 180 copies of a 'send minute-by-minute metric' job). Common policies: (1) fire-once / coalesce — for recurring jobs, run a single catch-up instance and skip the rest (you don't need 180 stale metric pushes, just the latest state); (2) fire-all — for jobs where each missed instance matters (e.g. per-customer billing runs), enqueue all of them but rate-limit the catch-up so workers aren't swamped; (3) skip — drop missed runs entirely if lateness makes them useless (a '9am digest' fired at noon may be worse than not sending it). The scheduler stores last_fire_time durably so on recovery it knows exactly which instants it owes, and the misfire policy plus a bounded catch-up rate prevents the recovery itself from causing an outage. Quartz formalizes exactly these misfire instructions; this is a required design decision, not an edge case."
}
```

### 5.2 One coordinator, not many: leader election

Only **one** coordinator should scan-and-enqueue at a time, or the same due job gets enqueued
repeatedly. Elect a leader via a coordination service (ZooKeeper/etcd/Consul) or a database lease row.
The leader holds a **lease with a TTL** and renews it (heartbeats); if it dies, the lease expires and a
standby wins the next election and takes over. This is exactly the leader-election + distributed-lock
machinery — and it has the same gotcha we exploit below: leases expire, so a *paused* leader can
believe it's still leader.

To avoid the leader becoming a throughput bottleneck, **shard the schedule space**: partition by a hash
of `schedule_id`, run one leader per shard (each elected independently), so coordination scales
horizontally while each shard still has a single decider.

### 5.3 At-least-once execution, fencing, and the double-run trap

This is the crux. Walk a job through, including the failure that bites everyone:

```sequence
{
  "title": "Execution with lease + fencing token",
  "actors": ["Coordinator", "Queue", "WorkerA", "Store", "WorkerB"],
  "steps": [
    { "from": "Coordinator", "to": "Queue", "label": "enqueue run(J), fence=7" },
    { "from": "Queue", "to": "WorkerA", "label": "deliver J (visibility timeout 30s)" },
    { "from": "WorkerA", "to": "Store", "label": "claim lease(J), check fence>=7" },
    { "from": "WorkerA", "to": "WorkerA", "label": "long GC pause / network stall (>30s)" },
    { "from": "Queue", "to": "WorkerB", "label": "redeliver J (timeout expired), fence=8" },
    { "from": "WorkerB", "to": "Store", "label": "claim lease(J), bump fence to 8, execute" },
    { "from": "WorkerA", "to": "Store", "label": "WAKES, writes result with fence=7 -> REJECTED (7<8)" }
  ]
}
```

- **Visibility timeout / lease:** when a worker pulls a job, the queue hides it for a timeout (or the
  worker takes a DB lease with `lease_expiry`). If the worker doesn't ack/renew in time, the job becomes
  visible again and is redelivered — that's the at-least-once guarantee.
- **The trap:** Worker A wasn't dead — just paused (GC, slow disk, partition). Its lease expired, B
  took over, and now **both** are "running" J. Without protection, both write side effects: a **double
  charge**.
- **Fencing token:** every lease acquisition increments a monotonic counter (the fence token) stored
  with the job. The worker carries its token to **every** side-effecting write, and the resource (DB,
  payment API, idempotent endpoint) **rejects any write with a token lower than the highest it has
  seen**. A's stale token (7) is refused because B already advanced it to 8. This is the canonical fix
  for the "expired lock but the holder is still alive" problem — a lock alone is *not* enough.
- **Idempotency key:** each run also carries a stable key (e.g. `schedule_id:scheduled_for:attempt`),
  so even a legitimate duplicate delivery to the *same* downstream collapses to one effect. Fencing
  stops a *stale* writer; idempotency makes *any* repeat a no-op. Use both.

```compare
{
  "options": [
    { "label": "Lease / lock only", "points": ["Worker holds a TTL lease while running", "Stops two healthy workers grabbing the same job", "FAILS if the holder pauses past TTL and another takes over — both write", "Necessary but not sufficient"] },
    { "label": "Fencing token", "points": ["Monotonic number bumped on each lease handover", "Carried to every side-effecting write", "Resource rejects lower tokens -> stale writer is fenced out", "Defeats the paused/partitioned-but-alive worker"] },
    { "label": "Idempotency key", "points": ["Stable key per run; downstream dedupes", "Makes a repeat delivery a harmless no-op", "Doesn't need the resource to track tokens", "Best combined with fencing for full safety"] }
  ]
}
```

```reveal
{
  "prompt": "A teammate says 'we already take a distributed lock before running each job, so we can't double-run.' Why is that wrong?",
  "answer": "Because a lock guarantees mutual exclusion only as long as everyone agrees who holds it — and distributed locks are leases with a TTL, not permanent ownership. The classic failure: Worker A acquires the lock, then suffers a stop-the-world GC pause (or a network partition, or its VM is descheduled) for longer than the lock's TTL. The lock service, seeing no renewal, expires A's lock and grants it to Worker B. Now A wakes up, still believing it holds the lock, and proceeds to write — at the same time as B. Two writers, one lock, double effect. The lock did its job (A renewed nothing, the TTL is what protects you) but the *window* between expiry and A noticing is unguardable by the lock alone. The fix is a fencing token: the lock service hands out a strictly increasing number with each grant, and every protected write must include its token; the storage/resource remembers the highest token it has accepted and rejects anything lower. A's write carries the old token and is refused. So the lock provides liveness/coordination, but only the fencing token enforces correctness when a lease-holder is paused-but-alive — which is precisely the case a lock cannot rule out."
}
```

### 5.4 Retries, backoff, and the DLQ

A job that fails (worker exception, downstream 500, timeout) is re-enqueued for another attempt — but
not immediately:

- **Exponential backoff with jitter:** wait `base * 2^attempt` plus randomness, so a failing downstream
  isn't hammered and retries from many jobs don't synchronize into a retry storm.
- **Bounded attempts:** after N tries (e.g. 5), stop and move the run to a **dead-letter queue** with
  its error history. The DLQ is for poison jobs — bad payloads, permanently-broken downstreams — that
  would otherwise retry forever and clog the pipeline. Engineers inspect, fix, and replay from the DLQ.
- **Distinguish retryable vs terminal:** a 503 is retryable; a 400 (malformed payload) should go
  straight to DLQ — retrying it just wastes capacity.

### 5.5 Fairness & priority

One noisy tenant submitting a million jobs must not starve everyone else (the classic multi-tenant
"noisy neighbor"). Two levers:

- **Per-tenant queues + weighted fair scheduling:** give each tenant (or priority tier) its own queue
  and pull round-robin / weighted-round-robin across them, so a flood in one queue can't monopolize
  workers.
- **Priority lanes:** separate high/normal/low queues; workers drain high first but reserve some
  capacity for lower lanes to avoid starvation of low-priority work.

```tradeoff
{
  "title": "How strictly should the scheduler enforce priority?",
  "axis": { "left": "Pure FIFO (simple, fair-ish)", "right": "Strict priority (responsive, risky)" },
  "steps": [
    { "label": "Single FIFO queue", "detail": "One queue, first-come-first-served. Dead simple; but a million low-priority jobs ahead of an urgent one block it for ages. No tenant isolation." },
    { "label": "Per-tenant fair queues", "detail": "One queue per tenant, weighted round-robin pull. Prevents noisy-neighbor starvation; priority is coarse. The common multi-tenant default." },
    { "label": "Priority lanes + reservation", "detail": "High/normal/low lanes; high drains first but low keeps a reserved share. Responsive to urgent work while avoiding starvation of the rest." },
    { "label": "Strict global priority", "detail": "Always run the highest-priority job available. Most responsive for VIP work, but a steady stream of high-priority jobs can starve everything below it indefinitely." }
  ]
}
```

### 5.6 Observability

Async systems fail silently, so visibility is a first-class feature, not an afterthought:

- **Per-run lifecycle records** (pending → running → succeeded/failed/dead) with timestamps and the
  owning worker + fence token — the audit trail for "did my 9am job run?"
- **Scheduling-lag metric:** `actual_fire_time - scheduled_for`, alert when the p99 grows (the
  coordinator is falling behind the spike).
- **DLQ depth & retry rate:** rising DLQ depth = a downstream is broken; spiking retries = something is
  flapping.
- **Heartbeats / dashboards** for leader identity, per-shard backlog, and worker liveness.

## 6 · Trade-offs & failure modes

- **At-least-once means duplicates are normal.** You don't prevent them at the delivery layer; you make
  them harmless with idempotency + fencing. Designs that try to prevent duplicates instead risk
  *missing* runs.
- **Coordinator as bottleneck/SPOF.** Mitigate with leader election (HA failover) plus sharding the
  schedule space so no single leader carries all dispatch.
- **Clock skew.** Workers and coordinators must agree on time within a tolerance; rely on NTP and put
  *time decisions* in the coordinator (single clock), not scattered across workers.
- **Top-of-hour herd.** Cron expressions cluster on round times; jitter and bucketed dispatch are
  mandatory, not optional.
- **Misfire after downtime.** A recovering coordinator can stampede on backlog — the misfire policy and
  bounded catch-up rate (§5.1) are part of correctness, not polish.
- **Poison jobs.** Without a DLQ and retryable/terminal classification, one bad payload retries forever
  and degrades the whole fleet.

## 7 · Scaling & evolution

- **Shard everything by `schedule_id`:** independent leader + queue + worker pool per shard, so
  capacity grows linearly and a hot shard is isolated.
- **Two-tier timers:** a coarse durable store for far-future jobs + an in-memory **timer wheel** per
  node for the near-term (next few minutes) — promote jobs from store to wheel as they approach. Cuts
  hot-path DB reads to near zero.
- **Decouple via the broker:** as throughput grows, lean on Kafka/SQS partitions for parallel,
  ordered-enough delivery; the coordinator just publishes due jobs.
- **Tenant quotas & rate caps:** to keep fairness as you onboard more tenants, cap per-tenant
  dispatch rate and surface backlog so heavy users self-throttle.
- **Exactly-once-effect downstreams:** push idempotency keys all the way into downstream APIs (payment,
  email) so the whole pipeline tolerates the inevitable retries.

## Self-test

```quiz
{
  "question": "A worker pulls a job, takes a 30s lease, then suffers a 40s GC pause. The queue redelivers the job to a second worker. What single mechanism prevents the first worker — now awake — from writing a duplicate side effect?",
  "options": [
    "A longer visibility timeout",
    "A fencing token: the resource rejects writes carrying a lower token than the current lease holder's",
    "Running the job on a faster machine",
    "Switching the queue to FIFO ordering"
  ],
  "answer": 1,
  "explanation": "The lease expired and the second worker advanced the monotonic fence token. The first worker's stale, lower token is rejected by the resource on its write. A lock/lease alone can't stop a paused-but-alive holder; the fencing token can."
}
```

```quiz
{
  "question": "Why do production schedulers choose at-least-once execution and then push the duplicate problem to the execution layer?",
  "options": [
    "Because at-least-once is cheaper to store",
    "Because you cannot guarantee both 'never miss' and 'never duplicate' across crashes/partitions, so they pick reliability (never miss) and make duplicates harmless via idempotency + fencing",
    "Because exactly-once delivery is illegal",
    "Because workers are stateless"
  ],
  "answer": 1,
  "explanation": "When a worker goes silent the coordinator can't tell 'crashed before work' from 'finished but didn't ack.' Re-dispatching risks duplicates; not re-dispatching risks misses. At-least-once + idempotent/fenced execution gives exactly-once *effects*."
}
```

```quiz
{
  "question": "50M schedules, ~10% of them set to '0 * * * *', all firing at the top of the hour. What is the primary technique to keep this spike from overwhelming workers?",
  "options": [
    "Store schedules in a faster database",
    "Add jitter to fire times and dispatch from time-bucketed queues so the burst is spread over a window",
    "Elect more leaders",
    "Increase the retry count"
  ],
  "answer": 1,
  "explanation": "Cron expressions cluster on round times. Jittering each schedule's exact fire instant and reading bucketed dispatch queues spreads ~83k due jobs across the window instead of one millisecond, smoothing the herd."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Distributed job scheduler — key terms",
  "cards": [
    { "front": "Due-job discovery", "back": "Finding jobs whose fire time has arrived. Use an index on next_fire_time + time-bucketing so you read only the current bucket, not all rows." },
    { "front": "Coordinator / leader election", "back": "One elected node scans-and-enqueues due jobs so each is dispatched once. A TTL lease + heartbeats fails over to a standby if the leader dies; shard by schedule_id to scale." },
    { "front": "At-least-once execution", "back": "A due job is guaranteed to eventually run (via redelivery on missing ack), accepting that duplicates can occur — made safe by idempotency + fencing." },
    { "front": "Fencing token", "back": "A monotonic number bumped on each lease handover and attached to every write; the resource rejects lower tokens, fencing out a paused-but-alive worker. Fixes what a lock alone cannot." },
    { "front": "Backoff + DLQ", "back": "Retry failures with exponential backoff + jitter, bounded to N attempts; then route poison jobs to a dead-letter queue for inspection and replay." },
    { "front": "Misfire policy", "back": "What to do with runs missed during downtime: coalesce to one catch-up, fire-all (rate-limited), or skip — chosen per schedule so recovery doesn't stampede." }
  ]
}
```

## Key takeaways

- **Separate coordination from execution:** one elected coordinator decides *what is due* and enqueues
  it once; a durable queue + stateless workers handle reliable, parallel execution.
- **You can't have both 'never miss' and 'never duplicate'** — choose **at-least-once** and make
  duplicates harmless with **idempotency keys + fencing tokens**. A lock alone does not prevent
  double-runs when a holder is paused-but-alive.
- **Spikes, not averages, size the system:** cron jobs cluster on round times, so **jitter +
  time-bucketed dispatch** are mandatory; a recovering coordinator needs a **misfire policy** to avoid
  a backlog stampede.
- **Reliability needs retries with backoff + a DLQ**, and multi-tenant deployments need **fair queuing
  / priority lanes** so a noisy tenant can't starve the rest.
- **Observability is a feature:** per-run lifecycle records, scheduling-lag, and DLQ depth turn a silent
  async system into an answerable one ("did my 9am job run?").

## Concepts exercised

This design applies, end to end: `leader-election` (the single coordinator that scans and enqueues due
jobs, with TTL-lease failover and per-shard leaders) · `distributed-locks` (per-job leases — and the
hard lesson that a lock's TTL window forces **fencing tokens** for correctness) · `message-queues`
(durable dispatch queues, visibility timeouts for at-least-once handoff, retries, and the dead-letter
queue) · `idempotency-and-safe-methods` (stable idempotency keys so any redelivered run collapses to a
single effect). It also exercises **at-least-once vs exactly-once** delivery, **exponential backoff +
jitter**, **hot-partition / thundering-herd** smoothing, **multi-tenant fairness**, and
**observability** for asynchronous systems.
