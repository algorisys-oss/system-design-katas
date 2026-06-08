---
title: "Hot, Warm & Cold Data Tiering"
slug: hot-warm-cold-data
level: foundations
module: storage-fundamentals
order: 16
reading_time_min: 12
concepts: [data-tiering, hot-warm-cold, lifecycle, cost-optimization, archival]
use_cases: []
prerequisites: [where-your-data-lives, memory-vs-disk]
status: published
---

# Hot, Warm & Cold Data Tiering

## Hook — a motivating scenario

Your storage bill quietly tripled. Digging in, you find 95% of it is data nobody has read in over a
year — old orders, audit logs, years-old user uploads — sitting on the same fast, expensive storage
as today's active data. You don't need to delete it (compliance!), but you're paying premium prices
to store cold archives next to hot, live data. **Tiering** is how you stop doing that.

## Mental model — your desk, a drawer, and the basement

Think about your own stuff:

- **Hot** = on your desk: used constantly, must be instantly reachable.
- **Warm** = in a drawer: occasional use, a short reach away.
- **Cold** = in the basement: rarely touched, slow to retrieve, but cheap to keep.

Data has the same access pattern, and storage tiers mirror it: **faster access costs more, so put
data on the cheapest tier that still meets its access needs.**

```layers
{
  "title": "Data temperature → storage tier",
  "layers": [
    { "label": "Hot — accessed constantly", "detail": "Today's active data. Lives in memory/cache + fast SSD/DB. Most expensive, lowest latency.", "meta": "ms, $$$" },
    { "label": "Warm — accessed occasionally", "detail": "Recent-but-not-current data. Cheaper standard storage; fine if slightly slower.", "meta": "ms–s, $$" },
    { "label": "Cold — rarely accessed", "detail": "Archives, old logs, compliance data. Very cheap; retrieval is slow (minutes to hours; instant-retrieval tiers exist but cost more).", "meta": "minutes–hours, $" }
  ]
}
```

## Build it up — lifecycle, not a one-time choice

Data **cools over time**: today's order is hot, last month's is warm, a three-year-old order is cold.
So tiering is usually a **lifecycle policy**, not a single placement: "after 30 days move to warm,
after 1 year to archive, after 7 years delete." Cloud object stores automate this with lifecycle
rules.

The trade-off you accept on colder tiers is **retrieval latency and cost**: archive tiers are dirt
cheap to *store* but can take minutes to hours (and a fee) to *read back*. That's fine for data you
almost never need — and a disaster if you put hot data there.

```reveal
{
  "prompt": "Audit logs must be kept 7 years for compliance but are queried maybe once a year. Which tier, and why not just keep them in the database?",
  "answer": "Cold/archive object storage. They're huge, write-once, and almost never read, so paying hot-tier (database) prices for 7 years is enormous waste — and they'd bloat DB backups and queries. Archive storage keeps them durable for pennies; the occasional slow, paid retrieval is perfectly acceptable for a yearly audit. Match the tier to the access pattern, not just the retention requirement."
}
```

## In the wild

- **Cloud storage classes:** e.g. S3 Standard (hot) → Standard-IA / One Zone-IA (warm) → Glacier /
  Deep Archive (cold), each cheaper to store but slower/pricier to retrieve. **Lifecycle rules**
  transition objects automatically.
- **Databases** tier too: hot rows in the in-memory buffer pool, older partitions on disk, ancient
  data exported to cheap storage (or dropped via partition pruning).
- **Logs/metrics** are classic tiered data: recent logs hot and searchable, old logs compressed and
  archived.
- **Caching** is the hottest tier of all (memory) — covered in its own module.

As data cools, you slide it down the tiers — each step cheaper to store but slower and costlier to read back:

```tradeoff
{ "title": "Where should this dataset live as it ages?", "axis": { "left": "Hot tier", "right": "Cold tier" }, "steps": [ { "label": "Hot", "detail": "Today's active data in memory/cache + fast SSD/DB. Millisecond access, most expensive per GB. Right for data read constantly." }, { "label": "Warm", "detail": "Recent-but-not-current data on cheaper standard storage. Slightly slower is fine; moderate cost. Good for occasional access." }, { "label": "Cold / archive", "detail": "Rarely-read archives, old logs, compliance data. Dirt cheap to store, but retrieval is slow (minutes to hours) and may charge a per-GB fee." } ] }
```

## Common misconception — "storage is cheap, so just keep everything on fast storage"

Cheap-per-GB still adds up at scale, and the *wrong* tier multiplies the bill.

```reveal
{
  "prompt": "If cold storage is ~10–20× cheaper per GB than hot storage, what's the catch that stops you putting everything there?",
  "answer": "Retrieval. Cold/archive tiers charge (and delay) reads — sometimes minutes to hours plus per-GB retrieval fees. For data accessed often, those retrieval costs and latency dwarf any storage savings and ruin user experience. So you tier by access frequency: hot data stays fast, only rarely-read data goes cold. The savings come from moving the *right* data, not all of it."
}
```

Tiering isn't "cheaper is always better" — it's matching each dataset's **access frequency** to the
cheapest tier that still serves it acceptably. Put hot data cold and you pay in latency and retrieval
fees; keep cold data hot and you overpay on storage.

## Self-test

```quiz
{
  "question": "Which data is the best candidate for a cold/archive storage tier?",
  "options": [
    "The current user session store",
    "Today's active transactions",
    "7-year-old audit logs read about once a year",
    "The homepage's product list"
  ],
  "answer": 2,
  "explanation": "Rarely-read, must-retain data fits cold/archive: cheap to store, and slow/paid retrieval is acceptable."
}
```

```quiz
{
  "question": "The main downside of cold/archive storage tiers is:",
  "options": [
    "They lose data over time",
    "Slow and/or costly retrieval when you do need to read the data",
    "They can't store large files",
    "They aren't durable"
  ],
  "answer": 1,
  "explanation": "Archive tiers are cheap and durable to store, but reading back is slow and may incur retrieval fees."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Hot, warm & cold data tiering — key terms", "cards": [ { "front": "Data tiering", "back": "Placing each dataset on the cheapest storage tier that still meets its access needs, so cold archives don't sit on the same fast, expensive storage as hot, live data." }, { "front": "Hot data", "back": "Data accessed constantly — today's active data. Lives in memory/cache plus fast SSD/DB. Lowest latency (ms) but most expensive per GB." }, { "front": "Warm data", "back": "Recent-but-not-current data, accessed occasionally. Kept on cheaper standard storage; a bit slower is acceptable for the lower cost." }, { "front": "Cold / archive data", "back": "Rarely-read archives, old logs, compliance data. Very cheap to store but retrieval is slow (minutes to hours) and may carry a per-GB fee." }, { "front": "Lifecycle policy", "back": "A rule that automatically transitions data to colder tiers (and eventually deletes it) as it cools — e.g. warm after 30 days, archive after 1 year, delete after 7." }, { "front": "Retrieval cost/latency trade-off", "back": "Colder tiers trade cheap storage for slow and/or costly reads. Great for data you almost never need; a disaster if hot data is placed there." } ] }
```

## Key takeaways

- Data has a **temperature** (hot/warm/cold) set by **access frequency**; match each to the cheapest
  tier that still serves it.
- Tiering is a **lifecycle**: data cools over time, so automate transitions (and deletion) with
  policies.
- Colder tiers trade **cheap storage for slow/costly retrieval** — great for archives, terrible for
  hot data.
- At scale, putting data on the **wrong tier** is a major, avoidable cost (or latency) sink.

## Up next

We've covered where and how durably data lives. Before storing or sending it, we must *encode* it.
Next: **Data Serialization Formats**.
