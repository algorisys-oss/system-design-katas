---
title: "Design Search Autocomplete (Typeahead)"
slug: typeahead-autocomplete
level: use-cases
module: core-building-blocks
order: 3
reading_time_min: 19
concepts: [trie, top-k, precompute-vs-query-time, popularity-ranking, log-mining-pipeline, edge-caching]
use_cases: [typeahead-autocomplete]
prerequisites: [caching-patterns-overview, database-sharding, high-cardinality-data, cdn]
status: published
---

# Design Search Autocomplete (Typeahead)

> **Use case:** as a user types into a search box, return a short list of **ranked query
> suggestions** for the current prefix — "how to" → "how to tie a tie", "how to screenshot", … —
> fast enough to feel instant.
> **Domain:** Google/Bing search bars, e-commerce product search, YouTube, app stores, IDE
> completion, any search box.
> **Scale:** billions of searches/day; each keystroke is a request, so QPS is **several times the
> search QPS**, and the response must land in **under ~100 ms** (often <50 ms) or the dropdown lags
> behind the typist.
> **Core challenges:** building a **prefix index** (trie); returning **top-k by a ranking signal**
> per prefix; **precompute-and-cache vs compute-at-query-time**; ranking by **popularity + recency**;
> refreshing suggestions from **query logs via an offline pipeline**; **sharding by prefix**; and
> **heavy edge caching** to keep latency and load down.

Typeahead is a great design because the latency budget is brutal (a keystroke every ~100–200 ms) and
the data is almost entirely **read**: the suggestion set changes slowly, so the whole problem bends
toward **precomputation and caching** rather than clever request-time computation.

## 1 · Clarify requirements

**Functional**
- Given a **prefix** (1+ chars), return the **top k suggestions** (typically k = 5–10) ranked by how
  likely the user wants each.
- Suggestions are **completions of real popular queries**, not arbitrary dictionary words.
- Match on **prefix** (and often fuzzy/typo-tolerant, but treat that as an extension).
- Suggestions **update over time** as query popularity shifts (a new movie, a breaking news term).

**Non-functional**
- **Very low latency:** p99 well under ~100 ms end to end — it's on every keystroke.
- **Huge read QPS, tiny write QPS:** reads dwarf writes; updates can lag by minutes/hours.
- **Eventual freshness is fine:** it's acceptable that a brand-new trending query takes minutes to
  appear. We trade freshness for cacheability.
- **Cheap per request:** at keystroke volume, each request must cost almost nothing.

```reveal
{
  "prompt": "Why does 'suggestions can be a few minutes stale' completely change the shape of this system compared to, say, a rate limiter?",
  "answer": "Staleness tolerance turns a read/write coordination problem into a read-only caching problem. Because the suggestion set for a prefix only needs to reflect popularity from minutes-to-hours ago, we never have to compute it on the hot path or coordinate writes against reads. Instead we can run a slow offline pipeline that mines query logs, computes the top-k completions for every prefix in bulk, and publishes a read-optimized snapshot. Serving then becomes a pure lookup of an immutable, precomputed answer — which is trivially cacheable at every layer (in-process, Redis, CDN/edge) because the same prefix returns the same bytes until the next publish. Contrast a rate limiter, where the answer depends on mutable, per-request shared state that must be atomic and fresh, so you can't cache it at all. Here, by accepting minutes of staleness, the 'hard' work (ranking, aggregation) moves entirely off the request path, and the request path becomes a key-value read that a CDN can mostly absorb. That single relaxation — freshness for cacheability — is the central design lever."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Suggestion request QPS (keystrokes, not searches)",
  "inputs": [
    { "key": "searchesPerDay", "label": "Searches/day (billions → enter as count)", "default": 5000000000 },
    { "key": "keystrokesPerSearch", "label": "Suggestion requests per search", "default": 4 },
    { "key": "peakFactor", "label": "Peak-to-average multiplier", "default": 3 }
  ],
  "formula": "Math.round((searchesPerDay * keystrokesPerSearch / 86400) * peakFactor)",
  "resultLabel": "Peak suggestion requests/sec",
  "resultUnit": "req/s"
}
```

```calc
{
  "title": "Memory for a precomputed top-k-per-prefix table",
  "inputs": [
    { "key": "prefixes", "label": "Distinct cached prefixes", "default": 100000000 },
    { "key": "bytesPerPrefix", "label": "Bytes per top-k entry (k suggestions + scores)", "default": 200 }
  ],
  "formula": "prefixes * bytesPerPrefix",
  "resultLabel": "Suggestion table size",
  "resultUnit": "bytes"
}
```

> Keystroke volume means **suggestion QPS is several times search QPS** — easily **hundreds of
> thousands of req/s at peak**. The precomputed top-k table for ~100M hot prefixes is ~**20 GB** —
> big but shardable and largely cacheable. The takeaway: this is a **read-mostly, cache-everything**
> system; the design goal is to make the common request never touch a database at all.

## 3 · API & where it sits

Typeahead is its own service behind the search front end, fronted by a **CDN/edge cache**:

```
GET /suggest?q=<prefix>&k=10&lang=en   ->  { suggestions: [ {text, score}, ... ] }
```

- **Idempotent GET** with a short cache lifetime → fully cacheable by the CDN and the browser.
- The client **debounces** (waits ~50–100 ms after the last keystroke) and **cancels** in-flight
  requests when a newer keystroke arrives, so we don't fire one request per character blindly.
- Responses are tiny (a few hundred bytes), so the bottleneck is **request count and latency**, not
  bandwidth.

## 4 · High-level architecture

Two halves: an **offline pipeline** that builds the index from logs, and an **online serving path**
that does cached lookups.

```flow
{
  "title": "Offline build pipeline + online serving path",
  "nodes": [
    { "label": "Query logs", "detail": "Every executed search is logged (query, timestamp, region, result-clicked)." },
    { "label": "Aggregation (batch/stream)", "detail": "Count query frequency over a sliding window; apply recency decay; filter spam/PII/unsafe." },
    { "label": "Top-k builder", "detail": "For each prefix, compute the k highest-scoring completions; serialize a trie / sorted table." },
    { "label": "Snapshot store", "detail": "Immutable versioned artifact pushed to serving nodes + cache (e.g. object store)." },
    { "label": "Suggest service", "detail": "Loads snapshot in memory; answers /suggest by prefix lookup. Sharded by prefix." },
    { "label": "CDN / edge cache", "detail": "Caches popular prefix responses near users; absorbs most read QPS." }
  ],
  "note": "The pipeline runs on a schedule (minutes–hours). Serving never computes ranking at request time — it reads a precomputed answer."
}
```

**Storage / data-model choices**
- **Trie (prefix tree):** each node is a character; the path from root spells a prefix. At each node
  we store the **precomputed top-k completions** for that prefix, so a lookup is "walk the prefix,
  read the cached list" — O(prefix length), no scan of children needed.
- **Or a sorted key-value table:** `prefix -> top-k JSON`, served from an in-memory store. Simpler to
  shard and ship than a live trie; the trie is mainly a build-time/conceptual structure.
- The serving snapshot is **immutable and versioned** — you build a new one offline and atomically
  swap it in, which is what makes it safe to cache aggressively.

## 5 · Deep dive: top-k, precompute-vs-query-time, and ranking

### 5a · Why store top-k at each node instead of computing it on the fly

Computing top-k at query time means: walk to the prefix node, then traverse **all** descendant
completions, score each, and partial-sort for the top k. For a short prefix like "a", that subtree is
enormous — far too slow for a 100 ms budget. So we **precompute** the top-k list and stash it **at the
prefix node** during the offline build. (Conceptually: do a bottom-up pass where each node merges its
children's top-k lists — a k-way merge of already-sorted small lists — so building all prefixes is one
sweep, not one expensive search per request.)

```compare
{
  "options": [
    { "label": "Compute top-k at query time", "points": ["Traverse the subtree under the prefix, score, partial-sort", "Always fresh", "Slow for short prefixes (huge subtree)", "No precompute storage, but blows the latency budget"] },
    { "label": "Precompute top-k per prefix (chosen)", "points": ["Top-k list stored at each prefix node/key", "Lookup is O(prefix length)", "Stale until the next build", "Extra storage (k entries per prefix) — worth it for the latency"] }
  ]
}
```

```reveal
{
  "prompt": "Precomputing top-k for every prefix sounds like it could explode storage. How is it bounded, and what's the build trick?",
  "answer": "Storage is bounded because we only keep k entries (k≈10) per prefix, not the whole subtree — so cost is k × (number of distinct prefixes we choose to cache), which is large but linear and shardable (our estimate: ~20 GB for 100M hot prefixes). We also don't index every conceivable prefix: we cap prefix length, drop prefixes whose best completion is below a popularity floor, and rely on the CDN/runtime to handle the long tail by falling back to the parent prefix. The build trick is a single bottom-up pass over the trie: a leaf's top-k is just itself; an internal node's top-k is the k-way merge of its children's already-sorted top-k lists plus any completion that ends at that node. Because each child list is already sorted and length ≤ k, merging is cheap (a bounded heap), so the whole trie's top-k tables are produced in roughly one linear sweep rather than running an expensive subtree search per prefix at query time. That's the precompute-and-cache philosophy: pay once, offline, in bulk; serve millions of times with a flat lookup."
}
```

### 5b · Ranking: popularity + recency

The score that orders completions blends signals:
- **Popularity:** how often the full query was searched, over a trailing window (e.g. 7 days).
- **Recency:** a **time-decay** so a query trending today outranks one popular last month — typically
  an exponential decay where each older day's count is multiplied by a factor < 1 (e.g. 0.9/day), so
  recent searches dominate the score.
- **Personalization / context (extension):** user language, region, prior searches, current session —
  applied as a re-rank on top of the global list, often per-shard or client-side, to keep the global
  table cacheable.

```tradeoff
{
  "title": "How fresh should suggestions be? (drives pipeline cadence + cacheability)",
  "axis": { "left": "Very fresh (stream)", "right": "Very cacheable (batch)" },
  "steps": [
    { "label": "Near-real-time stream", "detail": "Update counts continuously; trending terms appear in seconds. Costly, harder to cache (the answer keeps changing), needed for news/social." },
    { "label": "Hybrid: batch base + stream overlay", "detail": "A daily batch table for the long tail plus a lightweight streaming layer for spiking terms. The common production shape." },
    { "label": "Periodic batch (hourly/daily)", "detail": "Rebuild the whole snapshot on a schedule. Cheapest, most cacheable; trending terms lag by the rebuild interval — fine for most search boxes." }
  ]
}
```

### 5c · Updating from query logs (the offline pipeline)

Every executed search is appended to **query logs**. A batch/stream job aggregates them: count each
full query over the window, apply recency decay, then **filter** — strip PII, drop spam/bot queries,
and remove offensive or unsafe suggestions (this safety filter is mandatory; you don't want a search
box auto-completing something harmful). The cleaned, scored queries feed the **top-k builder**, which
emits a new immutable snapshot that's pushed to serving nodes and warms the caches.

## 6 · Trade-offs & failure modes

- **Sharding by prefix vs hot-shard risk.** Sharding the suggestion table by **prefix** (recall
  database sharding) keeps each lookup on one node and lets the table grow past one machine. But
  prefixes are **skewed**: short, common prefixes ("a", "th", "how") get far more traffic than rare
  ones (a **high-cardinality, long-tail** distribution). Sharding naively by first letter creates hot
  shards. Mitigate: shard by a **hash of the prefix** to spread load, and lean on caching — the hot
  prefixes are exactly the ones the CDN serves without ever hitting a shard.
- **Edge caching is doing most of the work.** Because responses are immutable per snapshot version,
  the **CDN/edge** can cache popular-prefix responses with a short TTL and absorb the bulk of QPS.
  Cache the version in the URL or `ETag` so a new snapshot invalidates cleanly. Risk: a cache flush
  (or a new, uncached snapshot) causes a **thundering herd** onto the origin — mitigate with staggered
  TTLs, request coalescing, and warming.
- **Staleness vs trending.** Pure batch misses spikes; if missing a trend matters, add the streaming
  overlay (5b).
- **Build pipeline failure.** If the pipeline stalls, you simply keep serving the **last good
  snapshot** — suggestions get stale but the service stays up. Always serve a known-good immutable
  artifact; never let serving depend on the pipeline being live.

## 7 · Scaling & evolution

- **Layered cache:** browser → CDN/edge → per-node in-memory snapshot → sharded store. Each layer
  catches the hottest fraction, so the sharded store sees only the long tail (recall caching patterns:
  read-through + cache-aside at the edge).
- **Geo-distribution:** ship the snapshot to regional serving clusters and edge POPs so lookups stay
  local — typeahead is latency-bound, so physical proximity matters.
- **Typo tolerance / fuzzy match:** add an edit-distance or n-gram layer for misspelled prefixes —
  more compute, so keep it as a fallback when the exact-prefix lookup is thin.
- **Personalized re-rank:** fetch the global top-k (cacheable), then re-rank by user/session signals
  client-side or in a thin per-user layer, preserving the shared cache.
- **Multi-language / multi-vertical:** partition tables by language and search vertical (web vs
  products vs videos), each with its own pipeline and ranking weights.

## Self-test

```quiz
{
  "question": "Why do typeahead systems precompute the top-k completions and store them at each prefix, instead of computing them when the request arrives?",
  "options": [
    "To save storage",
    "Because computing top-k at query time means scanning a huge subtree of completions for short prefixes, which blows the ~100 ms latency budget",
    "Because query logs are unavailable at request time",
    "To make suggestions always perfectly fresh"
  ],
  "answer": 1,
  "explanation": "A short prefix like 'a' has an enormous completion subtree; scoring and sorting it per request is far too slow. Precomputing top-k per prefix turns the request into an O(prefix-length) lookup. The cost is some staleness and extra storage."
}
```

```quiz
{
  "question": "Suggestions can be a few minutes stale. What is the most important consequence of that relaxation for the design?",
  "options": [
    "It forces strong consistency across shards",
    "It makes the system write-heavy",
    "It makes responses immutable per snapshot, so they're aggressively cacheable at the CDN/edge and never need request-time computation",
    "It requires a relational database"
  ],
  "answer": 2,
  "explanation": "Staleness tolerance turns serving into a pure read of a precomputed, immutable answer — trivially cacheable at every layer and computed offline, which is the whole basis of the design."
}
```

```quiz
{
  "question": "Sharding the suggestion table by the FIRST LETTER of the prefix risks what problem?",
  "options": [
    "Lost updates",
    "Hot shards — short common prefixes get vastly more traffic, so some shards are overloaded (skewed, long-tail distribution)",
    "Suggestions becoming too fresh",
    "Running out of letters"
  ],
  "answer": 1,
  "explanation": "Prefix popularity is highly skewed (high-cardinality long tail). First-letter sharding concentrates the hot prefixes on a few shards. Hashing the prefix spreads load, and the CDN absorbs the hottest prefixes anyway."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Typeahead — key terms",
  "cards": [
    { "front": "Trie (prefix tree)", "back": "Tree where each path from the root spells a prefix; each node stores that prefix's precomputed top-k completions, so lookup is O(prefix length)." },
    { "front": "Top-k per prefix", "back": "The k highest-scoring completions for a prefix, precomputed and stored at the node so requests don't scan the subtree." },
    { "front": "Precompute-and-cache", "back": "Do the expensive ranking offline in bulk and serve an immutable precomputed answer — instead of computing at query time. Trades freshness for speed + cacheability." },
    { "front": "Popularity + recency ranking", "back": "Score completions by trailing-window query frequency with a time-decay so trending queries outrank stale-popular ones." },
    { "front": "Offline log-mining pipeline", "back": "Batch/stream job that aggregates query logs, decays + filters (spam/PII/unsafe), and builds a new versioned snapshot." },
    { "front": "Shard by prefix + edge cache", "back": "Spread the table across nodes (hash the prefix to avoid hot shards) and front it with a CDN that absorbs hot-prefix QPS." }
  ]
}
```

## Key takeaways

- Typeahead is a **read-mostly, latency-bound** problem: keystroke QPS dwarfs search QPS and the
  budget is ~100 ms, so the design centers on **precomputation and caching**, not request-time work.
- Use a **trie / prefix index** with the **top-k completions precomputed at each prefix**, built in a
  single bottom-up sweep (k-way merge of children's lists) so a request is a flat O(prefix-length)
  lookup.
- Rank by **popularity + recency decay**, refreshed by an **offline pipeline** over query logs that
  also **filters spam/PII/unsafe** suggestions and publishes an **immutable versioned snapshot**.
- **Shard by a hash of the prefix** (not first letter) to dodge hot shards, and let a **CDN/edge
  cache** serve the hottest prefixes — the sharded store then sees only the long tail.
- Accepting **minutes of staleness** is the key lever: it makes answers immutable and cacheable, and
  lets you keep serving the **last good snapshot** when the pipeline fails.

## Concepts exercised

This design applies, end to end: `caching-patterns-overview` (layered browser → CDN → in-memory →
store, read-through/cache-aside, TTLs) · `cdn` (edge caching the hottest prefix responses, absorbing
most QPS) · `database-sharding` (partitioning the suggestion table, hashing the prefix to avoid hot
shards) · `high-cardinality-data` (the skewed long-tail distribution of prefixes and queries that
shapes both ranking and sharding). It also touches the trie/prefix-index data structure, top-k
selection, offline batch/stream pipelines, and immutable versioned snapshots for safe cache
invalidation.
