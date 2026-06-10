---
title: "Capstone — Design a URL Shortener"
slug: capstone-design-a-url-shortener
level: foundations
module: foundations-of-system-design
order: 51
reading_time_min: 22
concepts: [system-design, estimation, hld, lld, caching, scaling, cap, capstone]
use_cases: []
prerequisites: [hld-vs-lld, back-of-the-envelope-estimation, cap-theorem, caching-fundamentals, load-balancing]
status: published
---

# Capstone — Design a URL Shortener

## The payoff

This is where it all comes together. We'll design a URL shortener (like bit.ly) end-to-end —
requirements → estimation → high-level design → key low-level details → trade-offs → failure modes —
reusing every concept from this course. Follow the *method* here; it's the same one you'll use for any
design problem (and interview).

## Mental model

A URL shortener is essentially a giant, durable **hash map**: the key is the short code, the value is
the long URL. Almost everything else is supporting cast — 99% of the work is making that one lookup
*fast* and *always available*. Hold onto this picture; it's why the read path dominates every decision
below.

## 1 · Clarify requirements

Always start here (recall HLD vs LLD: requirements first).

**Functional:**
- Create a short URL from a long URL (e.g. `algoroq.io/aZ3x` → `https://very/long/url`).
- Redirect a short URL to the original.
- (Optional) custom aliases, expiration, basic click analytics.

**Non-functional:**
- **Very read-heavy** (redirects ≫ creations) — recall reads-vs-writes.
- Redirects must be **fast** (low latency) and **highly available**.
- Short codes must be **unique**; links **durable** (don't lose them).

```reveal
{
  "prompt": "Before designing anything, why is 'this system is extremely read-heavy' the most important requirement to establish?",
  "answer": "Because it drives the entire architecture. Reads (redirects) vastly outnumber writes (creations) — often 100:1 or more — so the design should optimize the read path above all: cache aggressively, use read replicas, and make redirects a cheap key lookup. If we'd assumed a balanced or write-heavy workload we'd over-invest in write scaling and under-invest in caching. Establishing the read/write ratio up front tells us where to spend effort — the heart of requirement-driven design."
}
```

## 2 · Estimate the scale

Rough numbers decide the design (recall back-of-the-envelope). Play with the assumptions:

```calc
{
  "title": "Storage over 5 years",
  "inputs": [
    { "key": "newPerDay", "label": "New URLs/day", "default": 1000000 },
    { "key": "bytesPerRecord", "label": "Bytes per record", "default": 500 },
    { "key": "days", "label": "Days (5 years)", "default": 1825 }
  ],
  "formula": "newPerDay * bytesPerRecord * days",
  "resultLabel": "Total storage (~5 yr)",
  "resultUnit": "bytes"
}
```

```calc
{
  "title": "Redirect (read) QPS at peak",
  "inputs": [
    { "key": "newPerDay", "label": "New URLs/day", "default": 1000000 },
    { "key": "readWriteRatio", "label": "Reads per write", "default": 100 },
    { "key": "peakFactor", "label": "Peak multiplier", "default": 5 }
  ],
  "formula": "(newPerDay * readWriteRatio * peakFactor) / 86400",
  "resultLabel": "Peak redirect QPS",
  "resultUnit": "QPS"
}
```

> ~1M writes/day → ~0.9 TB over 5 years (tiny — fits comfortably in one database, even with replicas).
> But ~5,800 **read** QPS at peak → the **read path** is what we must engineer. Estimation already told
> us: writes are easy, reads need caching + replicas.

## 3 · High-level design

Compose the shape you've built across the whole course:

```flow
{
  "title": "URL shortener architecture",
  "nodes": [
    { "label": "Client", "detail": "Browser hits a short URL or calls the create API." },
    { "label": "CDN / DNS", "detail": "Routes to a nearby region; can even cache hot redirects at the edge." },
    { "label": "Load balancer", "detail": "Spreads requests across stateless app servers; health-checks them." },
    { "label": "App servers", "detail": "Stateless: create (write) and redirect (read) logic. Scale horizontally." },
    { "label": "Cache (Redis)", "detail": "Hot short→long mappings in memory. Most redirects never touch the DB." },
    { "label": "Database", "detail": "Durable short→long store. Primary for writes + replicas for reads." }
  ],
  "note": "Read path: client → LB → app → cache (hit!) → done. The DB is the fallback, not the hot path."
}
```

The redirect (read) path, step by step:

```sequence
{
  "title": "A redirect request (read path)",
  "actors": ["Client", "App", "Cache", "DB"],
  "steps": [
    { "from": "Client", "to": "App", "label": "GET /aZ3x" },
    { "from": "App", "to": "Cache", "label": "lookup aZ3x" },
    { "from": "Cache", "to": "App", "label": "HIT → long URL (µs)" },
    { "from": "App", "to": "Client", "label": "301/302 redirect" },
    { "from": "App", "to": "DB", "label": "(on MISS only) read + populate cache" }
  ]
}
```

## 4 · Key low-level decisions

**How to generate the short code?** Two main approaches:

```compare
{
  "options": [
    { "label": "Hash the URL (e.g. base62 of a hash)", "points": ["Same URL → same code (dedup)", "Must handle hash collisions", "Codes look random", "Needs collision check on write"] },
    { "label": "Counter + base62 encode", "points": ["Unique by construction (no collisions)", "Needs a distributed unique ID source", "Codes are sequential-ish (can be obfuscated)", "Simple, scales with an ID generator"] }
  ]
}
```

**Base62** (`a-z A-Z 0-9`) keeps codes short: 62⁷ ≈ 3.5 trillion codes in just 7 characters. Our
estimate creates ~1M URLs/day × 1,825 days ≈ **1.8 billion** codes over 5 years — so a 7-character
base62 space (3.5 trillion) leaves roughly 2,000× headroom. The store is a simple key-value mapping `short_code → long_url`
(+ metadata), so even a relational DB indexed on `short_code` works; the access pattern (lookup by
key) also fits a key-value store perfectly.

```reveal
{
  "prompt": "Should a redirect return 301 (permanent) or 302 (temporary), and what's the trade-off?",
  "answer": "301 (permanent) lets browsers and intermediaries cache the redirect, so subsequent visits may skip your server entirely — great for latency and load, but you lose the ability to count those clicks and can't easily change the target. 302 (temporary) routes every visit through your server — enabling analytics and target changes, at the cost of more load. If click analytics matter, use 302 (and lean on your own cache for speed); if raw performance/offload matters most and the mapping is fixed, 301. It's a classic latency/cacheability vs control trade-off (recall status codes + caching)."
}
```

The redirect status code is a dial between offloading work to clients and keeping control on your server:

```tradeoff
{ "title": "301 (permanent) vs 302 (temporary) for redirects?", "axis": { "left": "301 — cacheable / fast", "right": "302 — controlled / measurable" }, "steps": [
  { "label": "301 permanent", "detail": "Browsers and intermediaries cache the redirect, so repeat visits may skip your server entirely — best latency and load, but you can't count those clicks or easily change the target." },
  { "label": "301 + own cache", "detail": "Lean on a permanent redirect for offload when the mapping is fixed and raw performance matters most; suitable when analytics aren't needed." },
  { "label": "302 + own cache", "detail": "Route visits through your server for control while serving the mapping from your own cache for speed — a middle ground when you want both analytics and low latency." },
  { "label": "302 temporary", "detail": "Every visit hits your server, enabling click analytics and target changes, at the cost of more load. The right call when click analytics matter." }
] }
```

## Show it in the wild

Real shorteners confirm these choices. **TinyURL** and classic **bit.ly** links resolve via an HTTP
**301 (permanent) redirect** — the cacheable option that offloads repeat visits from their servers.
bit.ly leans the other way only when it wants measurement: its *tracking* links return **302/307**
so every click flows through their analytics pipeline (bit.ly reports handling on the order of
billions of clicks per month). The codes themselves are short base62-style strings (a `bit.ly/...`
slug is typically ~7 characters), exactly the address-space math above. Same hash-map shape, same
301-vs-302 dial we just reasoned through.

## 5 · Apply the trade-offs you've learned

- **Caching (the big one):** because it's read-heavy, a cache fronting the DB serves the vast majority
  of redirects from memory — recall a high hit rate slashes DB load. Watch for cold-cache and
  thundering-herd on viral links (single-flight, TTL jitter).
- **Scaling:** app servers are **stateless** → scale horizontally behind the LB. The DB scales reads
  via **replicas**; writes are low volume, so a single primary is fine (no sharding needed at this
  scale — estimation proved it).
- **CAP:** redirects favor **availability** — better to serve a (near-certainly current) cached
  mapping than to error. Creation can be more consistent. Mappings rarely change, so staleness is a
  non-issue → an **AP-leaning** read path is the right call.
- **SPOF / availability:** redundant LB, multiple app servers, primary+replica DB across AZs (recall
  SPOF + the nines) → no single component downs redirects.

```reveal
{
  "prompt": "A single shortened link goes viral — millions of redirects in minutes. Which concepts from this course keep it up?",
  "answer": "Caching: the hot mapping sits in cache (and possibly the CDN edge), so nearly all those redirects are served from memory without touching the DB. Thundering-herd protection: if that key expires, single-flight/locking ensures only one request reloads it instead of millions stampeding the DB; TTL jitter avoids synchronized expiry. Horizontal scaling + load balancing: stateless app servers absorb the request volume, with autoscaling adding capacity. Read replicas + the read-heavy design mean even cache misses are cheap. The viral link is exactly the scenario the read-optimized, cache-first design was built for."
}
```

## 6 · Putting it together (the method)

Notice the shape of what we did — it's reusable for *any* design problem:
1. **Clarify** functional + non-functional requirements (find the dominant one — here, read-heavy).
2. **Estimate** scale to decide what's hard (reads) vs trivial (storage, writes).
3. **HLD**: compose LB → stateless app servers → cache → DB(+replicas), CDN at the edge.
4. **LLD**: the parts that matter (code generation, schema, 301 vs 302).
5. **Trade-offs**: caching, scaling, CAP, SPOF — justified by the requirements and estimates.
6. **Failure modes**: viral links, cache stampede, node loss — and how the design survives them.

## Common Misconception

**"A URL shortener is a hard scaling problem, so you must shard the database from day one."**

This is the instinct that trips up most candidates — *"high traffic ⇒ shard everything."* But the
estimation already dismantled it: ~1M new URLs/day is only ~0.9 TB over 5 years, which fits
comfortably in a **single primary** (with replicas for read scaling), and the ~5,800 peak redirect
QPS is absorbed almost entirely by a **cache**, not the database. Sharding adds real cost —
cross-shard coordination, rebalancing, a harder unique-ID scheme — for a problem you don't have at
this scale. The genuinely hard part isn't write/storage scale; it's keeping the **read path** fast
and available (caching, replicas, stampede protection). Reach for sharding when the *numbers* demand
it, not because the system "sounds big."

## Self-test

```quiz
{
  "question": "Given a URL shortener is extremely read-heavy, the single most impactful design element is:",
  "options": [
    "Sharding the database for writes",
    "A cache in front of the database to serve most redirects from memory",
    "Using UDP for redirects",
    "Storing URLs in the application's source code"
  ],
  "answer": 1,
  "explanation": "Redirects dominate; a high-hit-rate cache serves most of them from memory, slashing DB load and latency — the core of the read-optimized design."
}
```

```quiz
{
  "question": "Estimation showed ~0.9 TB over 5 years but thousands of read QPS. The right conclusion is:",
  "options": [
    "Storage is the hard part; shard the database immediately",
    "Writes/storage are easy at this scale; focus engineering on the read path (cache + replicas)",
    "The system can't be built",
    "Use a single server with no redundancy"
  ],
  "answer": 1,
  "explanation": "Small storage + low write volume = a single primary suffices; the read QPS is the challenge, so optimize reads (caching, replicas)."
}
```

```quiz
{
  "question": "For redirects of rarely-changing mappings, an AP-leaning (availability-favoring) read path is reasonable because:",
  "options": [
    "Consistency never matters",
    "Mappings almost never change, so brief staleness is harmless — and serving a cached redirect beats erroring",
    "It guarantees strong consistency",
    "AP systems can't lose data"
  ],
  "answer": 1,
  "explanation": "Since a short→long mapping is effectively immutable, prioritizing availability (always redirect) over strict consistency is the right CAP call for reads."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "URL shortener capstone — key terms", "cards": [
  { "front": "Why establish 'read-heavy' first?", "back": "Redirects vastly outnumber creations (often 100:1+), so it drives the whole architecture toward optimizing the read path: cache aggressively, use replicas, make redirects a cheap key lookup." },
  { "front": "Base62 encoding", "back": "Using a-z A-Z 0-9 to keep codes short: 62⁷ ≈ 3.5 trillion codes in just 7 characters — far more than a 5-year estimate needs." },
  { "front": "Hash vs counter for short codes", "back": "Hashing the URL dedups same URLs but must handle collisions; a counter + base62 is unique by construction but needs a distributed unique ID source." },
  { "front": "301 vs 302 redirect", "back": "301 (permanent) is cacheable by browsers — fast, less load, but no click counting. 302 (temporary) routes every visit through your server — enables analytics and target changes at higher load." },
  { "front": "Why an AP-leaning read path?", "back": "Short→long mappings rarely change, so brief staleness is harmless; serving a cached redirect always beats erroring. Favoring availability over strict consistency is the right CAP call for reads." },
  { "front": "Thundering herd on a viral link", "back": "When a hot cache key expires, millions of requests can stampede the DB. Mitigate with single-flight/locking (one reload) and TTL jitter (avoid synchronized expiry)." }
] }
```

## Key takeaways

- The **method** is the lesson: **requirements → estimation → HLD → LLD → trade-offs → failure
  modes** — reusable for any system.
- **Estimation drives design:** here it proved storage/writes are trivial and the **read path** is the
  real work.
- The architecture is the course's recurring shape: **CDN → LB → stateless app servers → cache → DB
  (+replicas)**, read-optimized with caching.
- Every major concept showed up — **statelessness, horizontal scaling, caching (hit rate, stampede),
  replicas, CAP, SPOF/availability, status codes** — composed into one coherent design.

## You've completed the Foundations path 🎉

You can now reason about a system end-to-end: how data is stored and moved, how APIs and databases
work, how caching and scaling keep systems fast and available, and how to compose it all under real
trade-offs. The **Intermediate** path builds on this — replication, sharding, messaging, and
distributed patterns applied to real-world systems.
