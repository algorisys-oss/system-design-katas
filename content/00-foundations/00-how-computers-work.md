---
title: "How Computers Work"
slug: how-computers-work
level: foundations
module: computing-fundamentals
order: 0
reading_time_min: 18
concepts: [cpu, ram, storage, io, von-neumann, bottlenecks]
use_cases: []
prerequisites: []
status: published
---

# How Computers Work

## Hook — a motivating scenario

You press a key and a letter appears in under a millisecond. At the same time your machine is
streaming a video from a server on another continent, decoding it 60 times a second, and keeping a
dozen other programs alive. **How does a slab of metal and silicon pull this off — and, more
usefully for us, where does it get slow?**

Every scaling decision you will make later — add a cache, add a server, shard the database — is
ultimately about one of four parts hitting its limit. Learn the four parts now and the rest of the
course is just applying them at larger scale.

## Mental model — a computer is a small city

| City | Computer | Job |
|------|----------|-----|
| Mayor's office | **CPU** | Makes every decision, coordinates the rest |
| Office desks | **RAM** | Fast workspace for whatever is *active right now* |
| Archives / library | **Storage (SSD/HDD)** | Keeps everything, even when the lights go off |
| Citizens & billboards | **I/O** (keyboard, screen, network) | How the city talks to the outside |
| Roads | **Bus / motherboard** | Carries data between everything above |

The whole city runs on one rhythm: **input → processing → output**. Hold that loop in your head —
it is the smallest unit of "doing work," and a system is just this loop repeated billions of times.

## Build it up — the four parts, smallest version first

**1. CPU — the decision maker.** It runs a tight loop: *fetch* an instruction, *decode* it,
*execute* it, repeat — billions of times per second. Everything else exists to feed this loop.

**2. RAM — the workspace.** Fast (nanoseconds) but **volatile**: power off and it's gone. It holds
the programs and data currently in use. It is also limited and relatively expensive per GB.

**3. Storage — the library.** Persistent and cheap per GB, but **orders of magnitude slower** than
RAM. Files live here until something needs them.

**4. I/O — the doors.** Keyboard/mouse in, screen/speakers out, and — crucially for system
design — the **network card**, your city's road to every other city.

Now the complication that matters: these parts differ in speed by *huge* factors. Reading from RAM
is ~1000× faster than reading from an SSD, which is itself far faster than the network. **Almost
every performance problem is really a "we made the CPU wait on something slower" problem.**

```stepper
{
  "title": "Trace one action: clicking ▶ on a video",
  "steps": [
    { "title": "1 · Input", "body": "Your click becomes an electrical signal the CPU receives as an event." },
    { "title": "2 · Decide", "body": "CPU: 'play video'. It checks whether the player app is already in RAM." },
    { "title": "3 · Fetch over the network", "body": "Video bytes are requested from a server far away — the slowest hop in this whole chain." },
    { "title": "4 · Buffer in RAM", "body": "Arriving bytes are held in a RAM buffer so playback isn't starved by network jitter." },
    { "title": "5 · Decode on CPU", "body": "The CPU decompresses frames — pure processing work." },
    { "title": "6 · Output", "body": "Frames go to the screen, audio to the speakers — ~60 times every second." }
  ]
}
```

Notice where the time actually goes: step 3 (the network) dwarfs the rest. That is your first
glimpse of a **bottleneck** — the one slow part that sets the pace for everything.

## In the wild

- A modern CPU executes **billions of instructions per second** across multiple cores.
- Typical consumer RAM today is **8–32 GB**; servers reach hundreds of GB to terabytes.
- Rough access-time ladder (memorize the *shape*, not the digits): CPU register < CPU cache <
  **RAM (~100 ns)** < **SSD (~100 µs, ~1000×)** < **network round trip (~1–100 ms)**.
- This ladder is exactly why we cache, why we keep "hot" data in RAM, and why a cross-region call
  is something you design *around*, not *through*.

```compare
{
  "options": [
    { "label": "RAM", "points": ["~nanoseconds to access", "Volatile — lost on power off", "Expensive per GB", "Holds what's active now"] },
    { "label": "Storage", "points": ["~micro/milliseconds to access", "Persistent — survives power off", "Cheap per GB", "Holds everything long-term"] }
  ]
}
```

## Common misconception — "more RAM always means a faster computer"

Tempting, but wrong in general.

```reveal
{
  "prompt": "You have 8 GB RAM and your workload uses 7.5 GB. Will upgrading to 16 GB help? What about 16 → 32 GB for the same workload?",
  "answer": "8 → 16 GB: a big win. At 7.5/8 GB you were nearly full, forcing slow disk 'swap'; the upgrade lets everything live in fast RAM. 16 → 32 GB: no change. You already had headroom, so the extra capacity just sits empty. Rule: more RAM helps only when you were running out."
}
```

More RAM removes a bottleneck **only if RAM was the bottleneck.** Add capacity past what you use and
nothing speeds up — the spare desks just sit empty. This "relieve the actual bottleneck, not a
random one" instinct is the whole game in system design.

## Self-test

```quiz
{
  "question": "An app feels sluggish because the CPU keeps stalling while it waits for data. Which is the MOST likely first place to look?",
  "options": [
    "Buy a faster CPU",
    "The data is coming from a much slower tier (disk or network), so the CPU is waiting on it",
    "Add more output devices",
    "Switch keyboards"
  ],
  "answer": 1,
  "explanation": "The CPU is rarely the slow part — it's usually waiting on a slower tier (disk or network). Fix what it's waiting on, not the CPU itself."
}
```

```quiz
{
  "question": "Which statement about RAM is correct?",
  "options": [
    "RAM keeps your files after the computer is powered off",
    "RAM is slower than an SSD",
    "RAM is fast, volatile working memory for what's active right now",
    "RAM and storage are interchangeable"
  ],
  "answer": 2,
  "explanation": "RAM is fast and volatile — it holds active data and is cleared on power off. Storage is the slow, persistent tier."
}
```

```match
{
  "prompt": "Match each part to its primary job.",
  "pairs": [
    { "left": "CPU", "right": "Makes decisions / executes instructions" },
    { "left": "RAM", "right": "Fast workspace for active data" },
    { "left": "Storage", "right": "Persistent long-term data" },
    { "left": "Network card", "right": "Talks to other machines" }
  ]
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "How computers work — key terms", "cards": [ { "front": "CPU", "back": "The decision maker. Runs a tight fetch–decode–execute loop billions of times per second. Everything else exists to feed this loop." }, { "front": "RAM", "back": "Fast (nanoseconds) but volatile working memory holding the programs and data in use right now. Limited and relatively expensive per GB." }, { "front": "Storage (SSD/HDD)", "back": "The persistent library: cheap per GB and survives power off, but orders of magnitude slower than RAM. Files live here until needed." }, { "front": "I/O", "back": "The doors of the machine — keyboard/mouse in, screen/speakers out, and crucially the network card, the road to every other machine." }, { "front": "Bottleneck", "back": "The one slow part that sets the pace for everything else. Almost every performance problem is the CPU waiting on a slower tier." }, { "front": "Access-time ladder", "back": "Speed shape: CPU register < cache < RAM (~100 ns) < SSD (~100 µs, ~1000×) < network round trip (~1–100 ms). Why we cache and keep hot data in RAM." } ] }
```

## Key takeaways

- A computer is four cooperating parts — **CPU, RAM, storage, I/O** — wired together by the bus,
  all running the **input → processing → output** loop.
- The tiers differ in speed by *orders of magnitude*; **the CPU is usually waiting on a slower
  tier**, and that slow tier is your bottleneck.
- **RAM is fast but volatile; storage is slow but persistent.** This single trade-off reappears at
  every layer of system design.
- Optimizing means **relieving the actual bottleneck** — adding capacity elsewhere does nothing.

## Up next

We saw data move as electrical signals. Next we look at *what those signals encode* — **Binary &
Data Representation** — the language underneath every number, image, and video.
