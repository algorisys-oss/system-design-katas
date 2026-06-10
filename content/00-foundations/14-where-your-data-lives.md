---
title: "Where Your Data Lives"
slug: where-your-data-lives
level: foundations
module: storage-fundamentals
order: 14
reading_time_min: 13
concepts: [storage, persistence, volatility, blob-storage, durability, tiers]
use_cases: []
prerequisites: [memory-hierarchy]
status: published
---

# Where Your Data Lives

## Hook — a motivating scenario

Your app saves a user's profile photo and their session token and a log line, all in one request.
Months later you're asked: "why did the photo survive a server reboot but the session didn't, and why
did last week's logs cost almost nothing to keep but the database is expensive?" Same request, three
very different *places* the data went. Knowing where data lives — and why — is the start of every
storage decision.

## Mental model — desk, filing cabinet, and off-site warehouse

Reusing the memory hierarchy intuition, every byte your system holds lives in one of a few homes,
trading speed for persistence and cost:

```layers
{
  "title": "Where data can live (fast/ephemeral on top → cheap/durable below)",
  "layers": [
    { "label": "In-memory (RAM / cache)", "detail": "Fastest, but volatile — gone on restart. Sessions, caches, hot computations.", "meta": "ns, ephemeral" },
    { "label": "Local disk (SSD on the server)", "detail": "Persistent to that machine, fast-ish. But tied to one server's life.", "meta": "µs–ms" },
    { "label": "Database (managed store)", "detail": "Durable, queryable, backed up. The system of record for structured data.", "meta": "ms" },
    { "label": "Object/blob storage (S3-like)", "detail": "Cheap, near-infinite, durable storage for files/blobs. Not for low-latency queries.", "meta": "cheap, durable" }
  ]
}
```

## Build it up — match the data to its home

The three questions that decide where data belongs:

1. **Must it survive a restart/crash?** If no (a cache, a session you can rebuild) → memory is fine.
   If yes → a durable store (database, object storage).
2. **Is it structured and queried, or a big opaque blob?** Rows you filter/join → a database. Photos,
   videos, backups, large files → **object/blob storage** (far cheaper per GB; you store a *URL* to
   it in the database, not the bytes).
3. **How hot is it, and how long must it live?** Hot + queried → DB/cache. Cold + rarely read (old
   logs, archives) → cheap cold storage tiers.

```reveal
{
  "prompt": "Why store a profile photo in object storage and keep only its URL in the database, instead of putting the image bytes in a DB column?",
  "answer": "Databases are optimized for structured, queried data and are expensive per GB; stuffing large binaries in them bloats backups, slows queries, and wastes costly storage. Object storage is built for cheap, durable, large blobs served directly (often via a CDN). So you keep the bytes in object storage and store a small URL/key in the DB — the right tool for each job."
}
```

This is also why the photo survived the reboot (durable store) but the session didn't (it was in
volatile memory) and the logs were cheap (cold object storage), all in your opening scenario.

## In the wild

- **Object storage** (Amazon S3, GCS, Azure Blob) is the default home for files, images, backups,
  and data lakes — cheap, durable (many "nines"), and CDN-friendly.
- **Databases** are the **system of record** for structured, transactional data.
- **Caches** (Redis/Memcached) hold hot, rebuildable data in memory — fast but not the source of truth.
- **Storage tiers**: hot → infrequent-access → archive (e.g. Glacier) trade retrieval speed for cost,
  matching the hot/warm/cold idea (covered soon in Hot, Warm & Cold Data).
- **Ephemeral vs persistent disks** in the cloud: local instance storage vanishes when the VM stops;
  attached/network volumes persist — a frequent footgun.

## Common misconception — "the database is where everything goes"

The DB is one home among several, and often the wrong one for big or ephemeral data.

```reveal
{
  "prompt": "A team stores user-uploaded videos as base64 strings in their main database. What goes wrong as they grow?",
  "answer": "The database balloons: backups become huge and slow, every query and replica carries dead weight, costs spike (DB storage is pricey), and serving videos hammers the DB instead of a CDN. Videos are large, opaque, and rarely queried — textbook object-storage data. Putting them in the DB misuses an expensive, query-optimized store for cheap blob storage's job."
}
```

A database is for structured data you query and must keep consistent — not a dumping ground for
large files or for ephemeral state. Pick the home by the data's shape, durability need, and access
pattern.

## Self-test

```quiz
{
  "question": "Where should large user-uploaded files (images/videos) usually live?",
  "options": [
    "As binary columns in the main relational database",
    "In object/blob storage, with a URL/key kept in the database",
    "In server RAM",
    "In the application's source code"
  ],
  "answer": 1,
  "explanation": "Object storage is cheap, durable, and CDN-friendly for blobs; the DB just holds a reference."
}
```

```quiz
{
  "question": "Data kept only in RAM is best described as:",
  "options": [
    "Durable and the system of record",
    "Fast but volatile — lost on restart",
    "The cheapest place to store everything long-term",
    "Automatically backed up"
  ],
  "answer": 1,
  "explanation": "RAM is fast but volatile; it's for caches/ephemeral state, not durable storage."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Where your data lives — key terms", "cards": [
  { "front": "Volatile storage", "back": "Data kept only in RAM/cache: fastest access but lost on restart or crash. Good for sessions, caches, and hot computations you can rebuild." },
  { "front": "Object/blob storage", "back": "Cheap, near-infinite, durable storage (S3/GCS/Azure Blob) for files, images, backups, and data lakes. Not for low-latency queries; often served via CDN." },
  { "front": "System of record", "back": "The durable, authoritative store for structured, queried, transactional data — the database. Caches and copies are not the source of truth." },
  { "front": "Storing blobs the right way", "back": "Put large files in object storage and keep only a small URL/key in the database, instead of stuffing image/video bytes into a DB column." },
  { "front": "Storage tiers", "back": "Hot → infrequent-access → archive (e.g. Glacier) trade retrieval speed for lower cost, matching how often data is read and how long it must live." },
  { "front": "Ephemeral vs persistent disk", "back": "Local instance storage vanishes when the VM stops; attached/network volumes persist. A frequent cloud footgun." }
] }
```

## Key takeaways

- Every byte lives somewhere on a **speed ↔ durability ↔ cost** spectrum: memory → local disk →
  database → object storage.
- Decide by three questions: **must it survive?**, **structured rows or big blob?**, **how hot / how
  long?**
- **Blobs go in object storage** (cheap, durable, CDN-friendly); the database keeps a **reference**,
  not the bytes.
- The **database is the system of record for structured data** — not a home for ephemeral state or
  large files.

## Up next

We listed memory vs disk repeatedly — let's make that distinction precise. Next: **Memory vs Disk**.
