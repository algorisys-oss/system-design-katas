---
title: "Design a Proximity Service (Yelp / Nearby)"
slug: proximity-service
level: use-cases
module: large-scale-systems
order: 10
reading_time_min: 19
concepts: [geospatial-indexing, geohash, quadtree, range-queries, read-heavy-caching, region-sharding]
use_cases: [proximity-service]
prerequisites: [database-sharding, partitioning-strategies, caching-patterns-overview, database-indexing]
status: published
---

# Design a Proximity Service (Yelp / Nearby)

> **Use case:** given a user's `(latitude, longitude)` and a radius, return the businesses /
> points of interest **near them**, sorted sensibly — the "search nearby" behind Yelp, Google Maps
> "restaurants near me," ride-hail driver lookup, and dating-app discovery.
> **Domain:** local search, maps, on-demand marketplaces, social discovery.
> **Scale:** ~100M+ places worldwide, hundreds of millions of users, **read-heavy** (far more
> "what's near me" lookups than place edits), with a tight latency budget (a few hundred ms end to end).
> **Core challenges:** **geospatial indexing** (a plain B-tree can't index 2-D proximity),
> answering **radius/range queries** fast, **caching** a read-heavy workload, keeping **place data
> fresh**, **ranking** by distance + rating, **sharding by region**, and the **precision-vs-recall**
> tension hidden in the index's cell size.

The whole design hinges on one fact: you cannot efficiently ask "find points within 2 km of here"
with an ordinary index. A B-tree on latitude and another on longitude each prune one dimension but
return a huge wasteful rectangle. The job is to turn **2-D proximity into something 1-D and indexable**.

## 1 · Clarify requirements

**Functional**
- `search(lat, lng, radius, filters)` → list of nearby places (within radius), each with distance.
- Filters/ranking: category (e.g. "coffee"), open-now, **rank by distance and rating**.
- CRUD on places: add / update / delete a business; updates appear reasonably soon (not real-time).

**Non-functional**
- **Read-heavy:** assume ~100:1 reads-to-writes; the search path must be cheap and cacheable.
- **Low latency:** p99 of a few hundred milliseconds including ranking.
- **Mostly-fresh, not strongly consistent:** a new restaurant showing up minutes late is fine.
- **High availability** over strict consistency — local search is a discovery feature, not a ledger.

```reveal
{
  "prompt": "Why can't we just put a B-tree index on latitude and a B-tree on longitude and call it a geo search?",
  "answer": "Because B-trees are one-dimensional: they order values along a single axis and answer range queries on that one axis efficiently. A proximity query is inherently two-dimensional — 'within 2 km of (lat, lng)' is a disk on the surface of the Earth. You can use a lat index to grab everything in a latitude band and a lng index to grab everything in a longitude band, but the database can only intersect those two huge strips, and the strips contain everything in a long horizontal and a long vertical corridor stretching around the globe — most of which is nowhere near the user. The intersection (a bounding box) still over-fetches badly, and worse, the two indexes can't be combined cheaply: the engine picks one, scans the band, and filters the rest row by row. For a metro area that's millions of candidate rows for a query that should return a few dozen. The fix is a single index that preserves 2-D locality — a space-filling curve (geohash / S2) or a tree that recursively subdivides space (quadtree) — so that 'nearby in space' becomes 'nearby in the index.'"
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Search query throughput",
  "inputs": [
    { "key": "dau", "label": "Daily active users", "default": 100000000 },
    { "key": "searchesPerUser", "label": "Searches per user per day", "default": 5 },
    { "key": "peakFactor", "label": "Peak-to-average factor", "default": 5 }
  ],
  "formula": "Math.round(dau * searchesPerUser / 86400 * peakFactor)",
  "resultLabel": "Peak search QPS",
  "resultUnit": "queries/s"
}
```

```calc
{
  "title": "Storage for the place index",
  "inputs": [
    { "key": "places", "label": "Number of places", "default": 200000000 },
    { "key": "bytesPerPlace", "label": "Bytes per indexed place (id, geocell, fields)", "default": 1000 }
  ],
  "formula": "places * bytesPerPlace",
  "resultLabel": "Place store size",
  "resultUnit": "bytes"
}
```

> Roughly **~30K peak search QPS** and **~200 GB** of place data. The place corpus changes slowly,
> the read rate is enormous, and the same hot areas (downtowns) are queried over and over — a textbook
> case for **heavy caching** and a **geospatial index that fits in memory** per shard.

## 3 · Data model & API

Two logical stores, because they have opposite access patterns:

- **Place store** (source of truth): `place_id → {name, lat, lng, category, rating, hours, …}`.
  A normal sharded relational/document DB; written on edits, read by id.
- **Geo index**: maps a **spatial cell → list of place_ids** in that cell. This is what radius
  queries hit. It can live in the same DB as an extra indexed column, or in a dedicated store (e.g.
  Redis `GEO*` commands, Elasticsearch geo, or a custom in-memory index).

```
search(lat, lng, radius_m, filters) -> [{ place_id, name, distance_m, rating, ... }]
addPlace(place)        -> place_id        # computes its geocell, indexes it
updatePlace(id, patch) -> ok              # may move it to a new cell
```

The key indexed field on each place is its **geocell** — a string/number identifying which cell of a
geospatial grid the place falls in.

## 4 · High-level architecture

```flow
{
  "title": "Read path for a nearby search",
  "nodes": [
    { "label": "Client", "detail": "sends (lat, lng, radius, filters)" },
    { "label": "Load balancer / API gateway", "detail": "routes to a search service instance" },
    { "label": "Search service", "detail": "computes covering cells, checks cache, ranks results" },
    { "label": "Cache (Redis)", "detail": "cell -> place_ids, and hot full responses" },
    { "label": "Geo index (per region shard)", "detail": "cell -> place_ids on miss" },
    { "label": "Place store", "detail": "hydrate place_ids -> full records for ranking" }
  ],
  "note": "Writes go the other way: edits update the place store and (re)index the place's geocell, then invalidate affected cell-cache entries."
}
```

Storage choices:
- **Geo index in memory** (sharded), because radius queries must be fast and the index is small
  relative to a full record (just `cell → ids`).
- **Place store** sharded by `place_id` for point reads when hydrating results.
- **Cache** in front of both: hot cells and hot full responses (downtown San Francisco at lunch).

## 5 · Deep dive: indexing 2-D space

There are two families of geospatial index. Both turn "near in space" into "near in the index."

**Geohash (space-filling curve).** Recursively halve the world: longitude, then latitude, then
longitude, alternating, encoding each bit. The resulting bit-string (Base32-encoded) is a
**geohash** — e.g. `9q8yy`. The magic: places that are close on Earth share a **long common
prefix**. So a 1-D prefix range scan (`WHERE geohash LIKE '9q8yy%'`) returns a square-ish region —
exactly what a B-tree does well. Longer prefix = smaller cell = finer precision. S2 (Google) is the
same prefix-locality idea with better-shaped cells: it maps the sphere to a Hilbert curve, so nearby
points share an index prefix (cells stay compact and roughly equal-area, within ~2×). H3 (Uber) is a
*different* shape — a hierarchical **hexagonal** grid (every neighbor is equidistant — handy for
ride-hail) — indexed by a hierarchical cell ID with parent/child containment, not a geohash-style
prefix range scan.

**Quadtree (tree subdivision).** Start with one square covering the world; whenever a cell holds
more than *K* places, split it into 4 children, recursively. Dense areas (Manhattan) subdivide
deeply into tiny cells; empty areas (ocean) stay one big cell. A query walks the tree to the leaf
cells overlapping the search disk. Quadtrees **adapt to density** (geohash cells are fixed-size at a
given precision), at the cost of a tree to maintain in memory rather than a flat sortable string.

```compare
{
  "options": [
    { "label": "Geohash / S2 (curve)", "points": ["1-D string/int — store in any B-tree or sorted set", "Trivial to shard and prefix-scan", "Fixed cell size per precision level", "Edge case: nearby points can straddle a cell boundary and share no prefix → must also query neighbor cells"] },
    { "label": "Quadtree", "points": ["Adapts cell size to density (deep where dense)", "Bounds places-per-cell → predictable query cost", "In-memory tree to build/maintain and rebalance", "Harder to shard and to update concurrently"] },
    { "label": "Naive lat/lng B-trees", "points": ["No special index needed", "Intersects two huge bands → massive over-fetch", "Can't combine both indexes efficiently", "Only acceptable for tiny datasets"] }
  ]
}
```

**The cell-size knob: precision vs recall.** This is the heart of the design. Pick cells too
**large** and a single cell covers far more than the search radius — you fetch thousands of places
and filter most away (high recall, poor precision, wasted work). Pick cells too **small** and your
2 km radius spans dozens of cells — you must fan out and query many cells, and a place just across
a boundary risks being missed unless you also scan **neighboring cells** (the boundary problem).
The standard answer: choose a cell size **close to the typical search radius**, and always query the
**target cell plus its 8 neighbors** so a result near an edge is never lost. After fetching
candidates from those cells, compute the true great-circle distance and **discard anything outside
the real radius** — the cells give you a cheap candidate set; exact distance gives correctness.

```tradeoff
{
  "title": "Geo-index cell size",
  "axis": { "left": "Large cells (coarse)", "right": "Small cells (fine)" },
  "steps": [
    { "label": "Very large cells", "detail": "One cell covers many km. Few cells to query, but each returns thousands of candidates you must distance-filter — high recall, low precision, wasted CPU and bandwidth." },
    { "label": "Cell ≈ search radius", "detail": "The sweet spot. Query the cell + its 8 neighbors; each cell holds a manageable candidate count; little over-fetch. Most production systems tune to here." },
    { "label": "Small cells", "detail": "Tight candidate sets (high precision) but a radius spans many cells → large fan-out, and boundary misses unless you carefully gather all overlapping + neighbor cells." },
    { "label": "Adaptive (quadtree / multi-resolution S2)", "detail": "Let dense areas use small cells and sparse areas large ones, so candidate count per query stays roughly constant regardless of density." }
  ]
}
```

```reveal
{
  "prompt": "Why query neighboring cells too, and why is exact distance filtering still required after the cell lookup?",
  "answer": "A grid cell is a coarse approximation of a circular search area, and the user can stand anywhere inside their cell — including right at its edge. A place 50 m away might fall in the adjacent cell, sharing no geohash prefix with the user's cell, so a single-cell lookup would silently miss it. Querying the target cell plus its 8 surrounding neighbors guarantees the candidate set covers the full neighborhood around the user regardless of where in the cell they are (this also handles the case where the search radius is larger than one cell). But the candidate set is now a square-ish blob of cells, not a circle, and at coarse cell sizes it includes many places that are technically in a nearby cell yet farther than the requested radius. So the final step is to compute the true great-circle (haversine) distance from the user to each candidate and drop anything beyond radius_m. In short: cells cheaply narrow ~100M places down to a few hundred candidates using an index scan; exact distance turns that recall-oriented candidate set into a precise, correct result — index for speed, math for correctness."
}
```

### Ranking by distance and rating

Within the candidate set, sort by a blended score, not distance alone — Yelp users want a great
place that's a bit farther over a mediocre one next door. A simple model:
`score = w_d · normalized_proximity + w_r · normalized_rating (+ popularity, sponsored, open-now)`.
Distance gives the **candidate set**; the ranker decides the **order**. Because ranking is cheap
relative to the geo lookup, it runs after fetching and distance-filtering candidates.

## 6 · Trade-offs & failure modes

- **Read-heavy → cache aggressively.** Cache `cell → place_ids` and hot full responses with a short
  TTL (minutes). Downtown cells are queried constantly; a cache hit skips both the geo index and the
  hydration step. Stale-by-a-few-minutes is acceptable here.
- **Updating place data invalidates the index.** When a place's rating changes you only update the
  place record. When a place **moves** (rare for businesses, constant for drivers) its geocell
  changes — you must remove it from the old cell and add it to the new one, then invalidate those
  cell-cache entries. For moving objects (ride-hail), this churn is the dominant write cost.
- **Hot regions / hot cells.** A dense metro cell concentrates both storage and query load. Mitigate
  with adaptive cells (quadtree / finer S2 level there) and by caching those cells hardest.
- **Boundary correctness vs cost.** Skipping neighbor cells is faster but drops edge results;
  always-fetching neighbors is correct but multiplies the candidate set. The cell-size choice
  controls how painful this trade is.
- **Eventual consistency.** New/edited places propagate through reindex + cache TTL — fine for
  discovery, wrong for anything needing read-your-writes (so a business owner's edit screen should
  read the place store directly, not the cached search path).

## 7 · Scaling & evolution

- **Shard by region.** Partition the geo index by a coarse spatial prefix (e.g. top-level S2 cell or
  short geohash) so each shard owns a contiguous area and a metro's queries hit one shard. This keeps
  related cells co-located and makes neighbor lookups local — but watch for **hot regions** (one
  shard owning Manhattan) and rebalance by splitting busy prefixes.
- **Replicate read replicas** of each region shard; the read-heavy workload scales horizontally with
  replicas behind the cache.
- **Multi-resolution index.** Maintain several S2 levels so the service can pick a cell size matching
  the request's radius — small radius uses fine cells, "search this whole city" uses coarse ones.
- **Off-the-shelf options.** Redis `GEOADD`/`GEOSEARCH` (geohash-backed sorted sets) for moderate
  scale; Elasticsearch/PostGIS for rich filtering + geo; a custom in-memory S2/quadtree index when
  you need maximum control and the lowest latency (the path large maps providers take).
- **Moving objects** (drivers): use small cells, frequent re-index on location pings, and often a
  separate, write-optimized in-memory index distinct from the slow-changing business index.

## Self-test

```quiz
{
  "question": "Why does putting a separate B-tree index on latitude and on longitude perform poorly for 'find places within 2 km'?",
  "options": [
    "B-trees can't store floating-point numbers",
    "Each index prunes only one axis, so the engine intersects two huge global bands and over-fetches massively",
    "Latitude and longitude must be stored as strings",
    "B-trees don't support range queries"
  ],
  "answer": 1,
  "explanation": "A proximity query is 2-D. Single-axis indexes return long corridors around the globe; their bounding-box intersection still contains far too many candidates, and the engine can only use one index then filter the rest. A space-filling curve or quadtree preserves 2-D locality in one index."
}
```

```quiz
{
  "question": "After looking up candidates by geocell, why is an exact great-circle distance filter still necessary?",
  "options": [
    "To convert miles to kilometers",
    "Because cells are square-ish approximations of a circular radius, so the candidate set includes places outside the requested radius",
    "Because the geohash is always wrong",
    "To re-sort the place store by id"
  ],
  "answer": 1,
  "explanation": "Cells (plus neighbors) give a cheap, recall-oriented candidate set shaped like a blob of squares, not a circle. Computing haversine distance and dropping anything beyond the radius turns that into a precise, correct result."
}
```

```quiz
{
  "question": "What is the main effect of choosing geo cells much LARGER than the typical search radius?",
  "options": [
    "Queries miss most nearby results",
    "Each cell returns many candidates you must distance-filter — high recall but low precision and wasted work",
    "The index can't be sharded",
    "Ratings stop updating"
  ],
  "answer": 1,
  "explanation": "Large cells mean few cells to scan but each holds far more than the radius covers, so you fetch and discard lots of candidates. Too-small cells cause the opposite: large fan-out and boundary-miss risk. Tuning cell size near the radius balances precision and recall."
}
```

## Recap — key terms

Flip each card, then move through the deck:

```flashcards
{
  "title": "Proximity service — key terms",
  "cards": [
    { "front": "Geohash", "back": "A space-filling-curve encoding that turns (lat, lng) into a Base32 string where nearby points share a long prefix — so 2-D proximity becomes a 1-D prefix range scan a B-tree handles well." },
    { "front": "Quadtree", "back": "A tree that recursively splits a square into 4 children when a cell exceeds K places. Adapts cell size to density (deep where dense, coarse where empty), at the cost of an in-memory tree to maintain." },
    { "front": "S2 / H3", "back": "Production geo-indexing systems. S2 (Google) maps the sphere to a Hilbert curve with compact, near-equal-area cells; H3 (Uber) uses hexagons so all neighbors are equidistant — good for moving objects." },
    { "front": "Neighbor-cell query", "back": "Always query the user's cell PLUS its 8 surrounding cells, so a result near a cell boundary (or a radius bigger than one cell) is never missed." },
    { "front": "Precision vs recall (cell size)", "back": "Large cells over-fetch (high recall, low precision, wasted work); small cells fan out and risk boundary misses. Tune cell size near the typical search radius." },
    { "front": "Shard by region", "back": "Partition the geo index by a coarse spatial prefix so a metro's queries and neighbor lookups stay on one shard; split busy prefixes to relieve hot regions." }
  ]
}
```

## Key takeaways

- The core problem is **2-D proximity over a huge, read-heavy corpus** — and an ordinary B-tree
  can't index it; you need a **space-filling curve (geohash/S2)** or a **quadtree** to make "near in
  space" become "near in the index."
- A geo query is **two phases**: a cheap **cell lookup** (target cell + 8 neighbors) for a candidate
  set, then **exact great-circle distance filtering** for correctness — recall from the index,
  precision from the math.
- **Cell size is the central knob:** too big over-fetches, too small fans out and misses edges; tune
  it near the search radius, or go **adaptive** (quadtree / multi-resolution S2) for uneven density.
- Treat it as a **read-heavy** system: **cache** hot cells and responses with short TTLs, keep the
  geo index in memory, **shard by region**, and replicate reads.
- **Rank** by a blend of **distance + rating** (and popularity/open-now), and accept **eventual
  consistency** for place updates — discovery tolerates minutes of staleness.

## Concepts exercised

This design applies, end to end: `database-indexing` (why B-trees are 1-D and what a geospatial
index buys you) · `partitioning-strategies` and `database-sharding` (sharding the geo index by
region / spatial prefix, splitting hot regions) · `caching-patterns-overview` (caching hot cells and
responses with TTLs for a read-heavy workload) — plus related ideas: hot partitions (dense metro
cells), eventual consistency (mostly-fresh place data), and read replicas (scaling the read path).
