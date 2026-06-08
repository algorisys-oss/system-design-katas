---
title: "CPU Basics"
slug: cpu-basics
level: foundations
module: computing-fundamentals
order: 3
reading_time_min: 15
concepts: [fetch-decode-execute, clock, cores, ipc, pipelining, throughput]
use_cases: []
prerequisites: [how-computers-work, memory-hierarchy]
status: published
---

# CPU Basics

## Hook — a motivating scenario

Marketing wants a bigger number: "make the service handle 2× the traffic." One engineer says "buy a
faster CPU." Another says "add more cores." A third says "the CPU is barely busy — we're waiting on
the database." All three are talking about the CPU, and only one is right for this workload.

To make that call you need a working model of what a CPU actually *does* every nanosecond.

## Mental model — a very fast, very literal chef

A CPU core is a chef who follows a recipe one instruction at a time, blindingly fast but utterly
literal. The recipe is your program (compiled to machine instructions). The chef repeats one tiny
loop, billions of times a second:

> **fetch** the next instruction → **decode** what it means → **execute** it → repeat.

That loop is the heartbeat of all computing. Everything — your web framework, the database, this
page — is ultimately this loop running over a list of instructions.

```stepper
{
  "title": "The fetch–decode–execute cycle",
  "steps": [
    { "title": "Fetch", "body": "The CPU reads the next instruction from memory, using the program counter to know where it is." },
    { "title": "Decode", "body": "It figures out what the instruction means: add? load from memory? jump?" },
    { "title": "Execute", "body": "It performs the operation — arithmetic in the ALU, or a memory read/write." },
    { "title": "Advance & repeat", "body": "The program counter moves to the next instruction, and the loop begins again — billions of times per second." }
  ]
}
```

## Build it up — clock speed, cores, and why neither is the whole story

Two numbers describe a CPU's raw capacity:

- **Clock speed (GHz)** — how many cycles per second. 3 GHz ≈ 3 billion cycles/sec. More cycles =
  more work per second *for a single stream of instructions* (single-threaded speed).
- **Cores** — how many independent chefs. 8 cores can run 8 streams of instructions truly at once.

But raw cycles aren't raw work. Modern CPUs use **pipelining** (working on several instructions'
fetch/decode/execute stages at once, like an assembly line) and execute multiple instructions per
cycle. And a cycle spent *waiting on memory* (a cache miss, ch. 2) does no useful work at all.

```compare
{
  "options": [
    { "label": "Faster clock", "points": ["Speeds up a single instruction stream", "Helps single-threaded / latency-bound work", "Diminishing returns; heat + power limits", "Won't help if you're waiting on I/O"] },
    { "label": "More cores", "points": ["Runs more streams in parallel", "Helps throughput when work splits cleanly", "Useless for inherently serial work", "Needs concurrency to exploit (next chapter)"] }
  ]
}
```

```reveal
{
  "prompt": "Your web server's CPU sits at 15% while response times are terrible. Will a faster CPU or more cores help?",
  "answer": "Probably neither. Low CPU usage with high latency means the CPU is mostly idle — waiting on something slower (database, disk, a downstream API). The bottleneck is I/O, not compute. Adding CPU just adds idle capacity."
}
```

## In the wild

- A modern core runs at **~3–5 GHz** and, thanks to pipelining + multiple execution units, retires
  **several instructions per cycle** — billions of instructions/second per core.
- **Servers** ship with many cores (tens to hundreds across sockets); horizontal scaling later is
  "more machines × more cores."
- **"CPU-bound" vs "I/O-bound"** is the first question in any performance investigation: is the core
  actually computing, or waiting? Tools report this as CPU utilization.
- **Context switching** (the OS swapping which stream a core runs) has real cost — thousands of
  cycles — which is why spawning unbounded threads can make things *slower* (next chapter).

## Common misconception — "higher GHz always means faster"

GHz only measures cycles, not delivered work.

```reveal
{
  "prompt": "Why can a 3 GHz CPU outperform an older 3.5 GHz one on the same task?",
  "answer": "Work done = instructions-per-cycle × cycles-per-second, minus stalls. A newer 3 GHz chip can retire more instructions per cycle (better pipelining, wider execution, bigger caches that avoid memory stalls), beating an older 3.5 GHz chip despite fewer cycles/sec. GHz compares clocks, not architectures."
}
```

Clock speed only compares chips of the *same* design. Across designs, instructions-per-cycle and
cache behavior often matter more. And for many real services, neither matters — the work is waiting,
not computing.

## Self-test

```quiz
{
  "question": "What is the fundamental loop every CPU core repeats?",
  "options": [
    "Read → Write → Delete",
    "Fetch → Decode → Execute",
    "Connect → Send → Close",
    "Map → Reduce → Shuffle"
  ],
  "answer": 1,
  "explanation": "Fetch the instruction, decode its meaning, execute it — repeated billions of times per second."
}
```

```quiz
{
  "question": "A task is fully parallelizable and you want to finish it faster. The best lever is usually:",
  "options": [
    "More cores (run independent chunks at once)",
    "A slightly higher clock speed",
    "A larger monitor",
    "More disk space"
  ],
  "answer": 0,
  "explanation": "Parallelizable work scales with cores. Clock bumps give small single-stream gains; cores multiply throughput."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "CPU basics — key terms", "cards": [ { "front": "Fetch–decode–execute cycle", "back": "The core loop every CPU repeats billions of times a second: read the next instruction, figure out what it means, perform it, then advance and repeat." }, { "front": "Clock speed (GHz)", "back": "How many cycles per second a core runs; 3 GHz is ~3 billion cycles/sec. More cycles speed up a single instruction stream (single-threaded work)." }, { "front": "Cores", "back": "Independent chefs in one CPU. Eight cores can run eight streams of instructions truly at once, adding parallel throughput when work splits cleanly." }, { "front": "Pipelining", "back": "Working on several instructions' fetch/decode/execute stages at once, like an assembly line, so a core can retire multiple instructions per cycle." }, { "front": "CPU-bound vs I/O-bound", "back": "The first performance question: is the core actually computing, or idle waiting on something slower (database, disk, downstream API)? Adding CPU only helps the former." }, { "front": "Why GHz alone isn't speed", "back": "Real work = instructions-per-cycle x cycles-per-second, minus stalls. A newer 3 GHz chip can beat an older 3.5 GHz one via better IPC and caches." } ] }
```

## Key takeaways

- A core endlessly runs **fetch → decode → execute**; that loop is all of computing.
- **Clock speed** boosts a single instruction stream; **cores** add parallel streams — different
  levers for different workloads.
- Real throughput = instructions-per-cycle × clock − stalls; **GHz alone doesn't measure speed**.
- Always ask **CPU-bound or I/O-bound first** — adding compute to an I/O-bound system does nothing.

## Up next

Cores let us do many things at once — but "at once" hides a lot. Next: **Processes, Threads &
Concurrency vs Parallelism**, and why more threads isn't always faster.
