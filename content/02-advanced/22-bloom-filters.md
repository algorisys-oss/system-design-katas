---
title: "Bloom Filters"
slug: bloom-filters
level: advanced
module: storage-internals
order: 22
reading_time_min: 14
concepts: [bloom-filter, probabilistic, false-positive, no-false-negative, space-efficient, membership]
use_cases: []
prerequisites: [lsm-trees-and-compaction, binary-and-data-representation, caching-fundamentals]
status: published
---

# Bloom Filters

## Hook — a motivating scenario

Before doing an expensive lookup — checking 10 SSTables for a key, querying the database for a cache
miss, or asking "have we seen this URL before?" across billions — you'd love a near-instant, tiny
pre-check that says "definitely not there, don't bother." Storing the full set to answer that would
cost gigabytes. A **Bloom filter** answers **"is this item possibly in the set?"** using a fraction of
the memory — by accepting a small, controllable rate of false positives.

## Mental model — a tiny probabilistic "definitely not / maybe yes"

A **Bloom filter** is a space-efficient probabilistic set membership structure: a **bit array** plus
**k hash functions**. To **add** an item, hash it k ways and set those k bits to 1. To **query**, hash
it k ways and check those bits:
- If **any** of the k bits is 0 → the item is **definitely not** in the set (**no false negatives**).
- If **all** k bits are 1 → the item is **probably** in the set (could be a **false positive** —
  those bits may have been set by other items).

So a Bloom filter never says "no" wrongly, but can say "yes" wrongly. That asymmetry is exactly what you
want as a cheap pre-filter: a "definitely not" lets you **skip** the expensive operation with certainty;
a "maybe" means fall back to the real check.

```stepper
{
  "title": "Bloom filter: add then query",
  "steps": [
    { "title": "Add 'cat'", "body": "Hash 'cat' with k functions → set bits at positions, say, 2, 5, 9 to 1." },
    { "title": "Query 'dog'", "body": "Hash 'dog' → check positions 1, 5, 7. Position 1 is 0 → 'dog' is DEFINITELY NOT in the set." },
    { "title": "Query 'cat'", "body": "Positions 2,5,9 all 1 → 'cat' is PROBABLY in the set (do the real lookup to confirm)." },
    { "title": "False positive", "body": "Query 'cow' → its bits happen to all be 1 (set by others) → says 'maybe' though it was never added." }
  ]
}
```

## Build it up — tuning the false-positive rate

The false-positive rate is **tunable** by sizing the bit array (m) and choosing the number of hash
functions (k) for the expected number of items (n). More bits per item → fewer false positives. You
trade **memory for accuracy**, and even very low rates (e.g. 1%) cost only a handful of **bits per
item** — vastly less than storing the items themselves. Key properties:
- **No false negatives** (never misses a real member) — the property that makes it safe as a skip-check.
- **No deletions** in a standard Bloom filter (clearing bits could break other items); variants like
  **counting Bloom filters** support deletes, and **cuckoo filters** offer deletes + better space.
- **Tiny + fast:** O(k) hashing per op, constant memory regardless of item size.

```reveal
{
  "prompt": "Why is the 'no false negatives' property the crucial one that makes a Bloom filter useful as a pre-filter, even though it has false positives?",
  "answer": "Because the way you use a Bloom filter is to AVOID expensive work, and that's only safe if a 'no' is always correct. The pattern is: ask the filter first; if it says 'definitely not in the set,' skip the expensive operation entirely (don't read the SSTable, don't query the DB, don't fetch the page). For that to be correct, the filter must NEVER say 'not present' for something that actually is present — i.e., no false negatives — otherwise you'd skip work for an item that really exists and return a wrong answer (miss data). Bloom filters guarantee exactly that: if any of the k bits is 0, the item was definitely never added. False positives, by contrast, are merely an efficiency cost, not a correctness problem: when the filter says 'maybe present' but the item isn't, you do the real lookup and find nothing — you wasted one check, but you never return a wrong result. So the asymmetry aligns perfectly with the use case: the answer you act on aggressively ('no' → skip) is guaranteed correct, while the answer that just triggers a fallback ('maybe' → verify) is allowed to be occasionally wrong. If it were the other way around (false negatives possible), you couldn't trust a 'no' to skip work, and the filter would be useless for this purpose. That's why 'no false negatives, tunable false positives' is the precise contract that makes Bloom filters a safe, cheap pre-filter."
}
```

Slide the bit-array size (bits per item) to feel the memory-vs-accuracy dial:

```tradeoff
{
  "title": "How many bits per item should the filter use?",
  "axis": { "left": "Fewer bits (less memory)", "right": "More bits (fewer false positives)" },
  "steps": [
    { "label": "Very few bits", "detail": "Smallest possible footprint, but the bit array saturates fast, so the false-positive rate climbs high — many 'maybe' answers fall through to the expensive real lookup." },
    { "label": "Moderate bits", "detail": "A balanced point: a few bits per item already buys low false-positive rates (e.g. around 1%) while staying vastly smaller than storing the items themselves." },
    { "label": "Many bits", "detail": "Very low false-positive rate, so almost every 'maybe' is a true hit, but you spend more memory per item for diminishing accuracy gains." }
  ]
}
```

## Build it up — where they save the day

- **LSM-tree / SSTable reads** (previous chapter): each SSTable has a Bloom filter; a read checks it
  first and **skips** SSTables that definitely don't contain the key — turning a multi-file scan into
  usually one lookup.
- **Cache / DB miss avoidance:** a Bloom filter of existing keys lets you answer "this key doesn't
  exist" without hitting the database — directly mitigating **cache penetration** (lots of misses for
  nonexistent keys hammering the DB; recall caching).
- **"Have I seen this?" at scale:** dedup (seen URLs in a crawler, seen events), spam/blocklist
  pre-checks, distributed systems avoiding redundant work — all where a tiny probabilistic check beats
  storing/querying the full set.

```reveal
{
  "prompt": "How does a Bloom filter help prevent 'cache penetration' — repeated requests for keys that don't exist hammering the database?",
  "answer": "Cache penetration happens when clients repeatedly request keys that exist in neither the cache nor the database (e.g. random/invalid IDs, or a malicious scan): each request misses the cache, falls through to the database, finds nothing, and so nothing gets cached to stop the next identical miss — so every such request pounds the DB. A Bloom filter of all keys that actually exist in the database fixes this cheaply: before doing a cache/DB lookup, you check the filter; if it says 'definitely not present,' you immediately return 'not found' without touching the database at all, because the no-false-negatives guarantee means a real key would never be reported absent. Only the small fraction of false positives ('maybe present' for a nonexistent key) fall through to the DB, and legitimate existing keys proceed normally. So the filter absorbs the flood of nonexistent-key requests with a tiny in-memory check instead of database queries, protecting the DB from penetration. The filter is small (bits per key) so it fits in memory even for huge key sets, and it's updated as keys are added (and, since standard Bloom filters can't delete, you periodically rebuild it or use a counting/cuckoo variant when keys are removed). It complements other anti-penetration tactics (like caching the negative 'not found' result with a short TTL), but the Bloom filter is the canonical way to reject known-nonexistent keys before they reach the database."
}
```

## In the wild

- **LSM stores** (RocksDB, Cassandra, HBase, LevelDB) attach Bloom filters to SSTables to cut read
  amplification (recall LSM).
- **Databases/CDNs** use them to avoid lookups for nonexistent keys (cache penetration), and **caches**
  use them as existence pre-checks.
- **Big-data/dedup:** web crawlers (seen URLs), Bigtable, distributed query engines, blockchain light
  clients, spell-checkers, malware/URL blocklists.
- **Variants:** **counting Bloom filters** (support deletes), **cuckoo filters** (deletes + better
  space/locality) — used where membership changes.

## Common misconception — "a Bloom filter can give wrong answers, so it's unreliable"

Its errors are **one-sided and bounded** — "maybe" can be wrong, "no" never is — which makes it
perfectly reliable for its purpose.

```reveal
{
  "prompt": "If a Bloom filter can return false positives, why is it considered reliable and safe to use in production databases and systems?",
  "answer": "Because its inaccuracy is one-sided, bounded, and aligned with how it's used. The only error it can make is a false positive ('maybe present' for something not in the set); it never produces a false negative — a 'definitely not present' is always correct. Systems use it precisely so that the correct-by-guarantee answer ('no') is the one they act on to skip expensive work, while the possibly-wrong answer ('maybe') only triggers a fallback to the authoritative check (the SSTable, the database), which then gives the true result. So a false positive costs at most one unnecessary lookup — pure efficiency loss, never a wrong final answer or lost data. Moreover, the false-positive rate is tunable and known in advance: by sizing the bit array and hash count for the expected item count, you choose an acceptable rate (e.g. 1%) at a tiny memory cost (a few bits per item). So you get predictable, controllable behavior, not unpredictable wrongness. 'Can give wrong answers' misframes it: the Bloom filter is an optimization layer in front of a source of truth, contributing only safe 'skip it' decisions and occasional harmless 'double-check' decisions. That's why it's trusted in RocksDB/Cassandra reads, cache-penetration defense, crawlers, and more — the design guarantees correctness of the final result while the filter just removes most of the expensive work. Reliability here means 'never causes an incorrect outcome,' which the no-false-negatives property ensures, not 'always answers membership exactly,' which it deliberately trades away for huge space savings."
}
```

A **Bloom filter** is a tiny probabilistic set: **k hashes into a bit array**, answering **"definitely
not"** (never wrong) or **"maybe"** (tunable false-positive rate). Its **no-false-negative** guarantee
makes it a safe, space-efficient **pre-filter** to skip expensive lookups (LSM SSTables, cache
penetration, dedup at scale). Standard ones **can't delete** (use counting/cuckoo variants).

## Self-test

```quiz
{
  "question": "A Bloom filter query can return:",
  "options": [
    "Both false positives and false negatives",
    "'Definitely not in the set' (never wrong) or 'probably in the set' (possible false positive) — no false negatives",
    "Only exact yes/no answers",
    "False negatives but no false positives"
  ],
  "answer": 1,
  "explanation": "If any of the k bits is 0 → definitely absent (no false negatives); all 1 → maybe present (could be a false positive). The asymmetry is the point."
}
```

```quiz
{
  "question": "Why are Bloom filters used in front of LSM-tree SSTable reads and to prevent cache penetration?",
  "options": [
    "They store the full data compactly",
    "A 'definitely not present' answer lets you safely SKIP the expensive lookup (SSTable scan / DB query), since there are no false negatives",
    "They guarantee exact membership",
    "They make writes faster"
  ],
  "answer": 1,
  "explanation": "The guaranteed-correct 'no' lets you skip the costly check; only the rare false-positive 'maybe' falls through to the real lookup."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Bloom filters — key terms", "cards": [
  { "front": "Bloom filter", "back": "A space-efficient probabilistic set membership structure: a bit array plus k hash functions, answering 'definitely not' or 'maybe' in O(k) time and constant memory." },
  { "front": "No false negatives", "back": "A Bloom filter never wrongly says 'not present' — if any of the k bits is 0, the item was definitely never added. This makes a 'no' safe to act on." },
  { "front": "False positive", "back": "An 'all bits 1' result for an item never added, because those bits were set by other items. It is the only error a Bloom filter can make, and it is tunable." },
  { "front": "Tuning m and k", "back": "Size the bit array (m) and pick hash-function count (k) for expected items (n). More bits per item lowers the false-positive rate — trading memory for accuracy." },
  { "front": "Cache penetration defense", "back": "A Bloom filter of existing keys answers 'this key doesn't exist' in memory, so requests for nonexistent keys never hammer the database." },
  { "front": "Counting / cuckoo filters", "back": "Variants that support deletion (standard Bloom filters can't delete); cuckoo filters also offer better space and locality." }
] }
```

## Key takeaways

- A **Bloom filter** is a **space-efficient probabilistic set** (bit array + k hashes) answering
  **"definitely not"** (never wrong) or **"maybe"** (false positives possible).
- **No false negatives** is the key guarantee — it makes a "no" safe to act on, so you can **skip
  expensive lookups** with certainty.
- The **false-positive rate is tunable** (more bits/item → fewer FPs) at a few **bits per item** — far
  less than storing the set; standard Bloom filters **can't delete** (use counting/cuckoo variants).
- Used for **LSM SSTable read skipping, cache-penetration defense, and large-scale dedup/membership**.

## Up next

A category of database specialized for a fast-growing, time-stamped data shape. Next: **Time-Series
Databases**.
