---
title: "Back-of-the-Envelope Estimation"
slug: back-of-the-envelope-estimation
level: foundations
module: foundations-of-system-design
order: 43
reading_time_min: 15
concepts: [estimation, qps, storage-sizing, bandwidth, powers-of-ten, capacity-planning]
use_cases: []
prerequisites: [latency-numbers, hld-vs-lld]
status: published
---

# Back-of-the-Envelope Estimation

## Hook — a motivating scenario

Someone proposes "let's cache all user data in memory." Is that 2 GB (trivial) or 2 PB (absurd)? You
can answer in 30 seconds with rough math: `users × bytes-per-user`. Estimation turns hand-wavy
debates ("that won't scale!") into concrete numbers ("that's 40 TB/day, so no") — and it's a
centerpiece of system-design interviews and real capacity planning alike.

## Mental model — rough, fast, order-of-magnitude

Back-of-the-envelope estimation isn't about precision; it's about getting the **order of magnitude**
right (is it thousands, millions, or billions?) using round numbers you can do in your head. Being
off by 2× is fine; being off by 1000× changes the whole design. Round aggressively — `86,400` seconds/
day → just call it **~100,000 (10⁵)**.

Three quantities you'll estimate constantly:
1. **QPS** (queries/sec) — the load.
2. **Storage** — how much data, growing over time.
3. **Bandwidth** — data in/out per second.

## Build it up — estimating QPS

QPS = (daily actions) ÷ (seconds/day). Use **~100,000 s/day** (really 86,400) for easy math, and
remember **peak ≫ average** — multiply average by a peak factor (often 2–10×) for headroom.

```calc
{
  "title": "Estimate average write QPS",
  "inputs": [
    { "key": "dau", "label": "Daily active users", "default": 10000000 },
    { "key": "actionsPerUser", "label": "Writes per user/day", "default": 5 },
    { "key": "secondsPerDay", "label": "Seconds per day", "default": 86400 }
  ],
  "formula": "(dau * actionsPerUser) / secondsPerDay",
  "resultLabel": "Average writes/sec",
  "resultUnit": "QPS"
}
```

> 10M users × 5 writes ÷ 86,400 ≈ **~580 writes/sec average**; at 5× peak that's **~3,000 QPS** to
> design for. Suddenly "can one database handle it?" has a concrete answer.

## Build it up — estimating storage and bandwidth

**Storage** = items × size-per-item, then multiply by retention/growth. Keep the powers-of-ten units
handy: 1 KB ≈ 10³, 1 MB ≈ 10⁶, 1 GB ≈ 10⁹, 1 TB ≈ 10¹², 1 PB ≈ 10¹⁵ bytes.

```calc
{
  "title": "Estimate yearly storage growth",
  "inputs": [
    { "key": "writesPerDay", "label": "New records per day", "default": 50000000 },
    { "key": "bytesPerRecord", "label": "Bytes per record", "default": 1000 },
    { "key": "days", "label": "Days (1 year)", "default": 365 }
  ],
  "formula": "writesPerDay * bytesPerRecord * days",
  "resultLabel": "Storage per year",
  "resultUnit": "bytes"
}
```

> 50M records/day × 1 KB × 365 ≈ **~18 TB/year** — now you can reason about partitioning, tiering, and
> cost instead of guessing.

**Bandwidth** = QPS × bytes-per-response. (E.g. 3,000 QPS × 50 KB ≈ 150 MB/s out — which informs CDN
and egress-cost decisions.)

```reveal
{
  "prompt": "Why is using 100,000 instead of 86,400 seconds/day perfectly fine for these estimates?",
  "answer": "Because you're after the order of magnitude, not a precise figure. 86,400 vs 100,000 is a ~16% difference — negligible when your inputs (DAU, actions/user, bytes/record) are themselves rough guesses that could be off by 2×. Rounding to a power of ten keeps the arithmetic mental and the answer just as useful for the decision ('thousands of QPS, tens of TB/year'). Spending effort on exactness here is false precision; the inputs dominate the error."
}
```

## In the wild

- **Interviews** expect estimation up front: state assumptions out loud, compute QPS/storage/
  bandwidth, then design to those numbers. Showing the *method* matters more than exactness.
- **Capacity planning** is the same math: provision servers, DB size, and cache memory from estimated
  load + growth, with peak headroom.
- **Sanity-checking proposals:** "cache everything in RAM" or "store full video in the DB" are settled
  in seconds by an estimate.
- **Know your anchors:** ~10⁵ s/day, the byte-unit ladder (KB→PB), and the latency numbers from
  earlier — these make estimates fast.

## Common misconception — "estimation needs to be accurate to be useful"

Precision is not the point — and chasing it wastes time and hides the real driver.

```reveal
{
  "prompt": "Two engineers estimate storage: one spends 10 minutes computing 18.25 TB, the other says '~20 TB' in 20 seconds. Why is the second often the better engineer here?",
  "answer": "They both reach the same decision-relevant conclusion ('tens of TB/year — needs partitioning and tiering') but the second got there 30× faster and didn't fool themselves into false confidence. The inputs (DAU, bytes/record) are guesses that could easily be 2× off, so a 18.25 vs 20 TB distinction is meaningless precision. Good estimation optimizes for *fast, correct order of magnitude* and clearly-stated assumptions — not decimal places. Knowing what precision is worth is itself the skill."
}
```

Estimation is a **decision tool**, not an accounting exercise. Round hard, state assumptions, get the
order of magnitude, and move on — the goal is a confident "thousands of QPS / tens of TB," not a
spuriously exact figure.

## Self-test

```quiz
{
  "question": "Roughly how many seconds are in a day (the handy estimation value)?",
  "options": ["~1,000", "~10,000", "~100,000 (≈86,400)", "~1,000,000"],
  "answer": 2,
  "explanation": "86,400 s/day ≈ 100,000 (10^5) — round to that for fast mental QPS math."
}
```

```quiz
{
  "question": "1 million users each generating 10 actions/day is about how many actions per second (average)?",
  "options": ["~1 QPS", "~100 QPS", "~10,000 QPS", "~1,000,000 QPS"],
  "answer": 1,
  "explanation": "10,000,000 actions/day ÷ ~100,000 s/day ≈ 100 QPS average (multiply by a peak factor for design)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Back-of-the-envelope estimation — key terms", "cards": [
  { "front": "Order of magnitude", "back": "The goal of estimation: getting whether an answer is thousands, millions, or billions right. Being off by 2x is fine; being off by 1000x changes the design." },
  { "front": "QPS", "back": "Queries (or actions) per second — the load. Estimated as daily actions divided by seconds/day, then multiplied by a peak factor for headroom." },
  { "front": "Seconds per day anchor", "back": "86,400 s/day, rounded aggressively to ~100,000 (10^5) so the arithmetic stays mental. The ~16% error is negligible against rough inputs." },
  { "front": "Storage estimate", "back": "items x size-per-item, then multiplied by retention/growth. E.g. 50M records/day x 1 KB x 365 ~= 18 TB/year." },
  { "front": "Bandwidth estimate", "back": "QPS x bytes-per-response. E.g. 3,000 QPS x 50 KB ~= 150 MB/s out, informing CDN and egress-cost decisions." },
  { "front": "Peak vs average", "back": "Peak load is much greater than average, so multiply the average by a peak factor (often 2-10x) to size systems with headroom." }
] }
```

## Key takeaways

- Estimate to get the **order of magnitude**, not precision — round to powers of ten (use **~10⁵
  s/day**) and state assumptions.
- The three staples: **QPS** (load ÷ seconds), **storage** (items × size × retention), **bandwidth**
  (QPS × bytes); always add **peak headroom**.
- Know the **byte-unit ladder** (KB→MB→GB→TB→PB) and reuse the **latency numbers** as anchors.
- Estimation is a **decision tool** — fast and roughly right beats slow and falsely precise.

## Up next

Once you know the load, you decide how to grow. Next: **Vertical vs Horizontal Scaling**.
