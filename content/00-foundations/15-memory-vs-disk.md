---
title: "Memory vs Disk"
slug: memory-vs-disk
level: foundations
module: storage-fundamentals
order: 15
reading_time_min: 13
concepts: [ram, disk, ssd, volatility, durability, persistence, write-durability]
use_cases: []
prerequisites: [where-your-data-lives, memory-hierarchy]
status: published
---

# Memory vs Disk

## Hook — a motivating scenario

A payment service confirms "payment recorded" to the user, then the server loses power a second
later. After reboot, the payment is gone. The code "saved" it — but only to memory, which evaporated.
The line between *fast* and *permanent* is the line between memory and disk, and crossing it correctly
is the difference between a cache and a system of record.

## Mental model — a whiteboard vs a notebook

- **Memory (RAM)** is a **whiteboard**: instant to read and write, but wiped the moment the power
  (your attention) goes. Great for working notes you can recreate.
- **Disk (SSD/HDD)** is a **notebook**: slower to write, but the ink stays even after you leave the
  room. The place for anything you must not lose.

The two defining axes: **speed** (memory wins by ~1000× vs SSD, far more vs HDD) and **persistence** (disk wins — it
survives restarts). Almost every storage decision trades along these two.

```compare
{
  "options": [
    { "label": "Memory (RAM)", "points": ["~100 ns access (very fast)", "Volatile — lost on power off/restart", "Expensive per GB, limited size", "For caches, working data, hot state"] },
    { "label": "Disk (SSD/HDD)", "points": ["~100 µs–10 ms (much slower)", "Persistent — survives restarts", "Cheap per GB, large capacity", "For durable storage / system of record"] }
  ]
}
```

## Build it up — why "saved" must mean "on disk (and flushed)"

When you "write" data, it often passes through several buffers before it's truly safe:

1. App writes → 2. OS page cache (in memory) → 3. disk's own cache → 4. physical media.

A crash before step 4 loses the data, even though the write "succeeded." That's why durable systems
explicitly **flush/fsync** to force data to stable storage before confirming success — and why the
payment above was lost: it never reached durable media.

```reveal
{
  "prompt": "Your code calls write() and it returns success, then the machine loses power and the data is gone. How is that possible?",
  "answer": "write() returning often only means the data reached an OS/disk buffer in memory, not the physical platter/flash. Until it's flushed (fsync) to stable storage, a power loss erases it. Durable systems fsync (or use write-ahead logs) before acknowledging a commit. 'Saved' must mean 'persisted to stable storage', not 'handed to a buffer'."
}
```

This is also the tension behind databases: keeping data in memory is fast, but a database must
guarantee durability, so it carefully flushes a log to disk on commit (more in ACID, later).

## In the wild

- **In-memory stores** (Redis) are blazing fast precisely because they skip disk — and accept that
  data is volatile (with optional persistence to disk for durability).
- **Databases** keep a hot **buffer pool in memory** for speed but persist a **write-ahead log** to
  disk for durability — getting both, deliberately.
- **SSD vs HDD:** SSDs (flash) have no moving parts — fast random reads; HDDs are cheaper per GB but
  slow on random seeks. Most hot data lives on SSD now.
- **"Durable" is a spectrum:** single-disk → replicated across machines → replicated across regions.
  More copies = survives more failures (next chapter on tiers; durability deepened in databases).

## Common misconception — "if my program wrote it, it's safely stored"

A successful write is not a durability guarantee.

```reveal
{
  "prompt": "Why might an in-memory cache that 'persists to disk every 60 seconds' still lose data in a crash?",
  "answer": "Anything written in the last <60 s since the previous snapshot is only in memory when the crash hits — it never made it to disk. Periodic persistence narrows the loss window but doesn't eliminate it. For zero-loss durability you need to persist (and flush) each change before acknowledging it, e.g. an append-only log per write — which trades some speed for safety."
}
```

Durability requires the data to actually reach stable storage *before* you treat it as saved.
Memory-first systems are fast but make explicit, bounded trade-offs about how much recent data they
might lose.

## Self-test

```quiz
{
  "question": "The defining difference between RAM and disk for system design is:",
  "options": [
    "RAM is cheaper per GB",
    "RAM is fast but volatile; disk is slower but persistent",
    "Disk is faster than RAM",
    "They are interchangeable"
  ],
  "answer": 1,
  "explanation": "RAM = fast + volatile; disk = slower + persistent. Speed vs persistence is the core trade-off."
}
```

```quiz
{
  "question": "To guarantee a committed write survives a crash, a database must:",
  "options": [
    "Keep it in the in-memory buffer pool",
    "Flush it to stable storage (e.g. write-ahead log) before acknowledging the commit",
    "Compress it",
    "Cache it in Redis"
  ],
  "answer": 1,
  "explanation": "Durability means the data reaches stable storage before the commit is acknowledged — hence fsync/WAL."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Memory vs disk — key terms", "cards": [
  { "front": "Volatile (RAM)", "back": "Memory loses all its contents when power is cut or the machine restarts. Fast to read/write (~100 ns) but cannot be trusted to keep data across restarts." },
  { "front": "Persistent (disk)", "back": "Disk (SSD/HDD) keeps data even after power loss or restart. Slower than RAM (~100 µs–10 ms) and cheaper per GB, so it holds durable storage / the system of record." },
  { "front": "fsync / flush", "back": "Forcing buffered data to actually reach stable storage. A successful write() may only land in an OS or disk buffer; durable systems fsync before acknowledging a commit." },
  { "front": "Write-ahead log (WAL)", "back": "An on-disk append-only log a database flushes on commit, so an acknowledged write survives a crash even though the hot data lives in an in-memory buffer pool." },
  { "front": "Buffer pool", "back": "A database's in-memory cache of hot data, kept for speed; paired with an on-disk WAL so the system gets both fast access and durability deliberately." },
  { "front": "Durability is a spectrum", "back": "Ranges from single-disk → replicated across machines → replicated across regions. More copies survive more failures." }
] }
```

## Key takeaways

- **Memory = fast + volatile; disk = slower + durable.** Speed vs persistence is the central trade-off.
- A successful `write()` may only reach a **buffer**; true durability requires a **flush/fsync** to
  stable storage before acknowledging.
- Databases deliberately combine both: **in-memory buffer pool** for speed + **on-disk log** for
  durability.
- "Saved" must mean **persisted**, not "handed to memory" — get this wrong and you lose
  acknowledged data.

## Up next

Not all durable data is equal — some is read constantly, some almost never. Next: **Hot, Warm & Cold
Data Tiering**.
