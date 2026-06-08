---
title: "Processes, Threads & Concurrency vs Parallelism"
slug: processes-threads-concurrency
level: foundations
module: computing-fundamentals
order: 4
reading_time_min: 17
concepts: [process, thread, concurrency, parallelism, context-switch, blocking, async]
use_cases: []
prerequisites: [cpu-basics]
status: published
---

# Processes, Threads & Concurrency vs Parallelism

## Hook — a motivating scenario

Your API handles one request at a time and feels snappy in testing. In production, 200 users hit it
at once and everyone waits in a long line — even though each request is mostly *idle*, waiting on the
database. The CPU is bored; the users are furious. How can the machine be doing nothing yet serving
no one?

The answer is how a server juggles many tasks at once — the difference between **concurrency** and
**parallelism**.

## Mental model — a kitchen with chefs and orders

- A **process** is a whole restaurant kitchen: its own pantry (memory), its own equipment. Two
  processes are isolated — one crashing doesn't spill into the other.
- A **thread** is a chef working *inside* one kitchen, sharing that kitchen's pantry with the other
  chefs. Threads are cheaper than processes but share memory (which is powerful and dangerous).
- **Concurrency** is *one* chef juggling several orders — start the pasta boiling, and while it
  boils, chop the salad. Progress on many tasks by switching during waits.
- **Parallelism** is *several* chefs cooking different orders at the same instant. Truly
  simultaneous — needs multiple cores.

Concurrency is about **structure** (dealing with many things at once); parallelism is about
**execution** (doing many things at the same instant). You can have one without the other.

```compare
{
  "options": [
    { "label": "Concurrency", "points": ["One worker, interleaves tasks", "Progress during waits (I/O)", "Works on a single core", "About structure / dealing with many things"] },
    { "label": "Parallelism", "points": ["Many workers at the same instant", "Needs multiple cores", "Speeds up CPU-bound work", "About execution / doing many things at once"] }
  ]
}
```

## Build it up — why the idle server stalls, and how to fix it

A request that calls the database spends most of its time **blocked** — waiting for bytes to come
back. If a worker sits and waits, that worker (and its core) does nothing useful meanwhile.

```stepper
{
  "title": "One blocking worker vs many concurrent requests",
  "steps": [
    { "title": "Request A arrives", "body": "Worker starts it, calls the DB, and blocks waiting ~20 ms for the result." },
    { "title": "Requests B…Z arrive", "body": "With one blocking worker, they queue. Each waits for A's DB call to finish before even starting." },
    { "title": "The CPU is idle", "body": "During A's 20 ms DB wait, the core does nothing — yet no one else is being served. That's the stall." },
    { "title": "The fix: concurrency", "body": "Let the worker start B (and C, D…) while A waits on the DB. Many requests make progress during each other's idle time." },
    { "title": "Add parallelism", "body": "Spread that concurrent work across multiple cores/workers to also speed up the CPU-bound parts." }
  ]
}
```

The two common ways to get concurrency:
- **Many threads/workers** — each handles a request; while one blocks, the OS runs another. Simple,
  but threads cost memory and **context switches**, so thousands of them get expensive.
- **Async / non-blocking I/O** — a single thread starts many I/O operations and is notified when each
  completes, never sitting idle. Scales to huge connection counts cheaply (the model behind Node.js,
  nginx; Go's goroutines achieve similar cheap concurrency atop a multi-threaded scheduler).

```reveal
{
  "prompt": "If requests are mostly waiting on the database, does adding CPU cores fix the stall?",
  "answer": "Not by itself. The stall is idle waiting, not compute. You need concurrency — let other requests run during the waits (more workers or async I/O). Cores help the CPU-bound portion, but an I/O-bound server first needs to stop blocking."
}
```

## In the wild

- **Web servers** serve thousands of concurrent connections by *not* blocking a thread per request —
  via thread pools, event loops, or lightweight tasks (goroutines, async/await).
- **Processes vs threads:** browsers use separate *processes* per tab for isolation (a crash takes
  one tab, not all); a web server uses *threads/tasks* within a process for cheap sharing.
- **Context switching** costs thousands of cycles; spawning unbounded threads can make a system
  *slower* as it thrashes between them — hence bounded pools and async models.
- **Shared memory is the catch:** threads sharing data can corrupt it without coordination (race
  conditions) — the price of their cheapness.

## Common misconception — "more threads = faster"

Past a point, threads add overhead, not speed.

```reveal
{
  "prompt": "A service is CPU-bound on an 8-core box. Someone bumps the thread pool from 8 to 800 and it gets slower. Why?",
  "answer": "Only 8 threads can truly run at once (8 cores). 800 threads for CPU-bound work just pile up, and the OS burns cycles context-switching between them and thrashing caches. For CPU-bound work, ~#cores threads is ideal. (For I/O-bound work, more helps — but async usually beats huge thread counts.)"
}
```

More threads help only when threads spend time **waiting** (I/O-bound). For **CPU-bound** work, more
threads than cores just adds switching overhead. Match the concurrency model to the workload.

## Self-test

```quiz
{
  "question": "Concurrency vs parallelism — which statement is correct?",
  "options": [
    "They mean the same thing",
    "Concurrency is dealing with many tasks (even on one core); parallelism is executing many at the same instant (needs multiple cores)",
    "Parallelism works on a single core; concurrency needs many cores",
    "Concurrency requires multiple processes"
  ],
  "answer": 1,
  "explanation": "Concurrency = structure for many tasks (interleaving); parallelism = simultaneous execution on multiple cores."
}
```

```quiz
{
  "question": "An I/O-bound server (mostly waiting on a DB) handles few concurrent users. The best first fix is:",
  "options": [
    "A faster single-core CPU",
    "Stop blocking — use more workers or async I/O so requests progress during waits",
    "A bigger disk",
    "Fewer cores"
  ],
  "answer": 1,
  "explanation": "The bottleneck is idle waiting; concurrency lets other requests run during each other's I/O waits."
}
```

```quiz
{
  "question": "Which pair correctly maps process vs thread?",
  "options": [
    "Processes share memory; threads are fully isolated",
    "Processes are isolated (own memory); threads share their process's memory",
    "Threads are heavier than processes",
    "Processes can't run in parallel"
  ],
  "answer": 1,
  "explanation": "Processes have isolated memory; threads within a process share memory (cheaper, but needs coordination)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Processes, threads & concurrency — key terms", "cards": [
  { "front": "Process", "back": "A whole isolated execution context with its own memory. Two processes don't share memory, so one crashing doesn't corrupt the other — but isolation makes them heavier." },
  { "front": "Thread", "back": "A unit of execution running inside a process and sharing that process's memory with sibling threads. Cheaper than a process, but shared memory needs coordination." },
  { "front": "Concurrency", "back": "Dealing with many tasks by interleaving them — making progress on several during each other's waits. About structure; works even on a single core." },
  { "front": "Parallelism", "back": "Executing many tasks at the same instant. About execution; requires multiple cores and speeds up CPU-bound work." },
  { "front": "Blocking", "back": "A worker sitting idle while waiting for I/O (e.g. a DB call) to return. The core does nothing useful, yet no one else is served — the cause of the stall." },
  { "front": "Context switch", "back": "The OS swapping one thread off a core for another, costing thousands of cycles. Too many threads cause excessive switching and cache thrashing, slowing things down." }
] }
```

## Key takeaways

- **Process** = isolated memory; **thread** = shares its process's memory (cheaper, riskier).
- **Concurrency** (interleaving, even on one core) ≠ **parallelism** (simultaneous, needs cores).
- I/O-bound stalls are fixed with **concurrency** (more workers or async I/O), not more CPU.
- **More threads ≠ faster:** for CPU-bound work, ~#cores is ideal; excess threads add context-switch
  overhead.

## Up next

We keep citing numbers — "20 ms DB call," "100 ns RAM." Next: **Latency Numbers Every Engineer
Should Know**, the quantitative intuition behind every trade-off so far.
