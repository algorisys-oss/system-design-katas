---
title: "Design a Ride-Hailing Service (Uber/Lyft)"
slug: ride-hailing
level: use-cases
module: large-scale-systems
order: 7
reading_time_min: 20
concepts: [geospatial-indexing, location-ingest, matching-dispatch, surge-pricing, websockets, regional-sharding]
use_cases: [ride-hailing]
prerequisites: [realtime-communication, database-sharding, publish-subscribe, multi-region-active-active, consistent-hashing]
status: published
---

# Design a Ride-Hailing Service (Uber/Lyft)

> **Use case:** a rider opens the app, sees nearby cars on a map, requests a ride; the system
> **matches** them to the best nearby driver, then both parties **track the trip in real time** until
> drop-off and payment.
> **Domain:** Uber, Lyft, Grab, Ola, DiDi, Bolt — and food/courier delivery, which share the same
> core ("match a mover to a request, then track it").
> **Scale:** millions of drivers each emitting a GPS ping every few seconds; tens of millions of
> trips/day; matching latency must feel instant (a few seconds end to end).
> **Core challenges:** ingesting a **firehose of driver location pings**; a **geospatial index** so
> "who's near me?" is fast; **nearest-driver search + dispatch**; **surge pricing**; **real-time trip
> tracking** over long-lived connections; a correct **trip state machine**; and **sharding by region**
> because the world is too big for one cluster.

The interesting twist versus a CRUD app: the hottest data (driver positions) changes *every few
seconds*, the query is *geometric* ("nearest, within radius"), and matching is a real-time auction —
not a database lookup.

## 1 · Clarify requirements

**Functional**
- Drivers stream **live location**; the system keeps a current position per online driver.
- Riders see **nearby available drivers** and an ETA.
- On request, **match** the rider to the best nearby driver and **dispatch** (offer → accept).
- **Track the trip** live for both sides (driver→rider→server) through pickup and drop-off.
- Compute **fare**, including **surge** multipliers in high-demand areas.

**Non-functional**
- **Low matching latency:** request → matched driver in a few seconds.
- **High write throughput:** absorb millions of location pings/sec without falling over.
- **Geo-correctness:** "nearby" must respect real distance, not just numeric lat/long proximity.
- **Availability over perfect consistency** for reads (a slightly stale car on the map is fine); the
  **trip state machine** itself must be **consistent** (no double-dispatch, no lost trips).
- **Regional isolation:** an outage in one city/region must not take down others.

```reveal
{
  "prompt": "Why is 'who are the nearest available drivers to this point?' the query that shapes the whole architecture, rather than the matching logic?",
  "answer": "Because it is run constantly, at massive scale, over data that is changing every few seconds — and a plain database cannot answer it cheaply. A naive 'SELECT drivers ORDER BY distance(lat,lng, ?, ?) LIMIT 10' scans every driver and computes a distance for each: O(N) per query, run for every map view and every ride request, against a table whose rows are all being updated several times a second. Two things fall out of that. First, you need a spatial index that turns 'within radius of point P' into 'look in these few buckets' instead of a full scan — that is what geohash/quadtree/S2 give you. Second, you cannot store fast-moving positions in a normal disk-backed, durably-replicated SQL table at millions of writes/sec; positions live in memory (Redis/in-process maps) and are intentionally ephemeral. So the geometric, high-churn read drives the data structures (spatial index), the storage tier (in-memory, sharded), and even the topology (shard by region so each index stays small). Matching — pick the closest acceptable driver and offer the ride — is comparatively simple logic layered on top of that fast 'nearest' primitive."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Driver location ingest (the firehose)",
  "inputs": [
    { "key": "drivers", "label": "Concurrent online drivers", "default": 3000000 },
    { "key": "pingEverySec", "label": "Seconds between pings", "default": 4 }
  ],
  "formula": "Math.round(drivers / pingEverySec)",
  "resultLabel": "Location updates/sec",
  "resultUnit": "writes/s"
}
```

```calc
{
  "title": "Trip history storage per day",
  "inputs": [
    { "key": "trips", "label": "Trips per day", "default": 25000000 },
    { "key": "bytesPerTrip", "label": "Bytes per trip record (+ route)", "default": 5000 }
  ],
  "formula": "trips * bytesPerTrip",
  "resultLabel": "Trip data written/day",
  "resultUnit": "bytes"
}
```

> ~750K location writes/sec from 3M drivers pinging every 4s — far too much for a durable SQL table, so
> positions live **in memory** and are **ephemeral**. Trips, by contrast, are ~25M/day at a few KB each
> (~125 GB/day): modest, durable, append-heavy — perfect for a sharded OLTP store plus cheap object
> storage for route traces. Two completely different storage problems in one system.

## 3 · API & data model

Two surfaces: a **location-ingest** path (write-heavy, fire-and-forget) and a **rider** path
(request, then a live stream).

```
// Driver app → server, every few seconds (UDP-ish, lossy-OK)
updateLocation(driverId, lat, lng, heading, status)         // status: available | on_trip | offline

// Rider app
getNearbyDrivers(lat, lng, radiusMeters) -> [ {driverId, lat, lng, etaSec} ]
requestRide(riderId, pickup, dropoff, productType) -> { tripId }

// Live, over a persistent connection (WebSocket)
subscribeTrip(tripId) -> stream of { state, driverLocation, etaSec }
```

Key data:
- **Driver location** (hot, ephemeral): `driverId → {lat, lng, status, lastSeen}` in memory, keyed into
  the **spatial index**. TTL it — a driver that stops pinging is dropped.
- **Trip** (durable): the row carrying the **state machine** (`requested → matched → ...`), rider,
  driver, fare. Sharded by `tripId`/region.
- **Trip route trace** (durable, bulk): the GPS breadcrumb, written async to object storage.

## 4 · High-level architecture

```flow
{
  "title": "Ride-hailing data flow",
  "nodes": [
    { "label": "Driver app", "detail": "Emits GPS ping every ~4s + accepts/declines ride offers." },
    { "label": "Location ingest (per region)", "detail": "Stateless gateways → write into the in-memory geospatial index; publish to a stream." },
    { "label": "Geospatial index (in-memory, sharded)", "detail": "Geohash/S2 cells → set of drivers in each cell. Answers 'nearby' fast." },
    { "label": "Matching / dispatch service", "detail": "On a ride request: query nearby cells, rank candidates, offer the ride (auction)." },
    { "label": "Trip service + DB", "detail": "Owns the trip state machine; durable, sharded by trip/region." },
    { "label": "Realtime gateway (WebSocket)", "detail": "Pushes live driver position + state to rider and driver; backed by a pub/sub bus." }
  ],
  "note": "Two paths: the high-rate location firehose feeds the index; the request/track path reads the index, drives the state machine, and streams updates."
}
```

**Storage choices**
- **Positions:** in-memory, sharded by region; never durably persisted (a lost ping is replaced 4s
  later). Redis (with its geo commands) or an in-process map per shard.
- **Trips:** durable, sharded OLTP (e.g. a sharded relational store or a wide-column store like the
  Cassandra/Schemaless family Uber uses). Strong consistency *within a trip*.
- **Routes/analytics:** append to a log (Kafka) → object storage / warehouse.
- **Surge:** a separate service computing per-cell multipliers on a short cadence, cached for reads.

## 5 · Deep dives

### 5a · The geospatial index — how "nearby" gets fast

The core trick: convert 2-D coordinates into a **1-D sortable key** so spatial proximity becomes key
proximity, lettable into a normal index. Three common schemes:

- **Geohash** — recursively split the world into a grid; encode each cell as a short string
  (e.g. `9q8yy`). Longer prefix = smaller cell. Points in the same cell **share a prefix**, so "nearby"
  ≈ "same/adjacent prefix." Simple and string-friendly; the catch is **edge cases** — two points on
  opposite sides of a cell border are physically close but share no prefix, so you must also scan the
  **8 neighboring cells**.
- **Quadtree** — a tree that recursively splits a region into 4 quadrants, subdividing only where it's
  **dense**. Adapts to density (cities get fine cells, oceans stay coarse) but is a pointer structure
  that's harder to shard than flat keys.
- **S2 (Google)** — projects the sphere onto a cube and uses a **Hilbert space-filling curve** to
  number cells, giving 1-D cell IDs with **better locality than geohash** and no lat/long distortion at
  the poles. Uber's H3 is a related idea using **hexagons** (uniform neighbor distance — every neighbor
  is the same distance away, which simplifies ranking).

```compare
{
  "options": [
    { "label": "Geohash", "points": ["Prefix of a base-32 string per cell", "Trivial to store/index (it's just a sortable string)", "Must check 8 neighbors for border cases", "Cell size jumps in fixed steps; some distortion"] },
    { "label": "Quadtree", "points": ["Tree subdividing only dense regions", "Adapts cell size to driver density", "Pointer structure: harder to distribute/rebalance", "Good in-memory, awkward across shards"] },
    { "label": "S2 / H3", "points": ["Space-filling-curve cell IDs (S2) or hex grid (H3)", "Best spatial locality; little polar distortion", "Uniform neighbors with hexagons (H3)", "More complex library; the modern production pick"] }
  ]
}
```

```reveal
{
  "prompt": "With a geohash index, why isn't it enough to look only in the rider's own cell — and what's the fix?",
  "answer": "Because the cell boundary is arbitrary relative to where the rider actually is. A rider standing 10 meters from a cell edge has the closest drivers sitting just across that edge — in a neighboring cell with a totally different prefix — while a driver in the far corner of the rider's own cell might be hundreds of meters away. If you query only the rider's cell you'll miss the genuinely nearest cars and return worse matches. The standard fix is to query the rider's cell PLUS its 8 surrounding neighbor cells (a 3x3 block) at a chosen precision, union the candidates, then compute true great-circle distance on that small set to rank them. You pick the precision so a cell is roughly your search radius; if too few drivers come back you widen by dropping a character from the geohash (a coarser, bigger cell) and retry. S2/H3 handle the same issue with explicit neighbor/ring functions, and hexagons make 'one ring out' a uniform distance in every direction, which is why H3 is convenient for exactly this neighbor-expansion step."
}
```

### 5b · Ingesting the location firehose

750K writes/sec of positions can't hit a durable, replicated database. The pattern:
- **Stateless ingest gateways** terminate the driver connections and **shard by region** — a driver in
  Chicago only ever updates the Chicago index, keeping each index small and each shard's load bounded.
- The write is **upsert-into-memory**: replace the driver's position in the spatial index and refresh a
  **TTL**; no disk, no durability (the next ping in 4s supersedes it). A driver who stops pinging falls
  out of the index automatically.
- Pings are **lossy-tolerant**: drop a few under load rather than queue them — the freshest position is
  all that matters (recall load shedding).
- Publish a lightweight position event to a **pub/sub bus** so the realtime tracking path and surge
  service can react without re-querying.

### 5c · Matching & dispatch

```sequence
{
  "title": "Request → match → dispatch",
  "actors": ["Rider", "Matching", "GeoIndex", "Driver", "TripSvc"],
  "steps": [
    { "from": "Rider", "to": "Matching", "label": "requestRide(pickup, product)" },
    { "from": "Matching", "to": "GeoIndex", "label": "drivers in pickup cell + 8 neighbors" },
    { "from": "GeoIndex", "to": "Matching", "label": "candidate list (available only)" },
    { "from": "Matching", "to": "Driver", "label": "offer ride (best candidate, ~15s to accept)" },
    { "from": "Driver", "to": "Matching", "label": "accept" },
    { "from": "Matching", "to": "TripSvc", "label": "create trip → state = matched (atomic)" },
    { "from": "TripSvc", "to": "Rider", "label": "matched: driver, ETA (via realtime gateway)" }
  ]
}
```

Ranking isn't just raw distance: real systems weight **ETA by road network** (not straight-line),
driver heading, rating, and global efficiency (sometimes the *second*-closest driver yields a better
overall assignment — batched matching every ~1–2s can optimize a whole region of riders and drivers
together instead of greedily one at a time). Dispatch is an **offer/accept auction**: a driver gets a
brief exclusive window; on decline or timeout, the offer cascades to the next candidate. The
"create trip when a driver accepts" step must be **atomic** so two riders can't both be matched to the
same driver (the same double-booking hazard a transaction prevents).

### 5d · Surge pricing

Surge is **supply/demand per area**, computed on a short cadence. For each geo cell, compare open ride
requests against available drivers; when demand outstrips supply, raise a **multiplier** (1.0 → 1.5 →
2.0…). It throttles demand (some riders wait) and pulls in supply (drivers move toward hot cells).
Crucially the price is **quoted up front and locked** for the request — you compute it once at request
time, not continuously, so the rider gets a stable fare.

### 5e · Real-time trip tracking & the state machine

Once matched, both apps need a **live stream** — that's a persistent **WebSocket** (long-lived,
bidirectional), not request/response polling. The driver's pings flow through the realtime gateway and
**fan out via pub/sub** to whoever is subscribed to that trip (the rider, support dashboards). Recall:
WebSockets keep a connection open so the server can *push*; pub/sub decouples "who produces a position"
from "who's watching it."

Every trip is a **state machine**, and that's the part that must be strictly consistent:

```flow
{
  "title": "Trip state machine",
  "nodes": [
    { "label": "requested", "detail": "Rider asked; searching for a driver. Surge locked here." },
    { "label": "matched", "detail": "A driver accepted (atomic). Driver en route to pickup." },
    { "label": "arrived", "detail": "Driver at pickup; waiting for rider." },
    { "label": "on_trip", "detail": "Rider on board; route trace recording." },
    { "label": "completed", "detail": "Drop-off; fare finalized, payment captured." },
    { "label": "canceled", "detail": "Reachable from requested/matched/arrived; cancellation policy applies." }
  ],
  "note": "Transitions are guarded and atomic — no skipping states, no double-dispatch, no trip stuck forever (timeouts move it on)."
}
```

```reveal
{
  "prompt": "Driver positions are 'eventually consistent and lossy' but the trip state machine must be strongly consistent. Why the split, and how is each enforced?",
  "answer": "Because the two kinds of data have opposite cost-of-error. A driver's dot on the map being 4 seconds stale, or a single ping being dropped, has essentially no consequence — the next ping fixes it, and overpaying for durability/consistency on 750K writes/sec would be ruinous. So positions live in memory, are TTL'd, are sharded by region, and are allowed to be slightly stale and lossy (AP-style: favor availability). The trip state, on the other hand, governs money and exclusive resources: if two riders both transition the same driver to 'matched,' or a trip is billed twice, or a completed trip silently reverts, you have real-world harm. So trip transitions are handled like ledger entries — written to a durable, sharded store with the state change done as a single atomic, guarded transition (only legal edges allowed, accept-and-create-trip done atomically so a driver can be claimed by exactly one trip). The system is deliberately heterogeneous: an AP, in-memory, ephemeral tier for fast-moving positions, and a CP, durable, transactional tier for the small amount of state that must never be wrong — and you pick the right model per data type rather than forcing one guarantee on everything."
}
```

```tradeoff
{
  "title": "How big should each geospatial cell be?",
  "axis": { "left": "Large cells (coarse)", "right": "Small cells (fine)" },
  "steps": [
    { "label": "Large cells", "detail": "Few cells, cheap index, but each holds many drivers → 'nearby' returns a big list you must distance-rank, wasting work in dense cities." },
    { "label": "City-tuned cells", "detail": "Cell size ~ your search radius so a 3x3 neighbor block covers the area with a handful of candidates — the sweet spot for matching." },
    { "label": "Small cells", "detail": "Each cell has few drivers (precise), but a search must scan many neighbor cells, and sparse rural areas return nothing without widening." },
    { "label": "Adaptive (quadtree/H3 res by density)", "detail": "Fine resolution downtown, coarse in the suburbs/countryside — best balance, at the cost of a more complex, density-aware index." }
  ]
}
```

## 6 · Trade-offs & failure modes

- **The index is a hot, in-memory SPOF per region.** Replicate each shard and rebuild from the live
  ping stream on failover — since positions are ephemeral, a fresh replica is fully populated within
  one ping interval (~seconds).
- **Lost pings / stale positions.** Accept them: TTL drops dead drivers; a missing ping is replaced
  almost immediately. Don't try to make positions durable.
- **Double-dispatch.** Two requests racing for the last nearby driver — prevented by the atomic
  accept-and-create-trip transition; the loser cascades to the next candidate.
- **Offer timeouts / black-hole trips.** A driver who never responds, or an app crash mid-trip, can
  strand a trip. Guard every state with a **timeout** that advances or cancels it, and reconcile.
- **Thundering surge feedback.** Surge pulling drivers in can over-correct (price whips up and down).
  Damp it: smooth the multiplier, update on a cadence, lock the quoted price per request.
- **WebSocket fan-out at scale.** Millions of open connections need many realtime gateway nodes; route
  by trip via the **pub/sub bus** so any gateway can serve any subscriber.

## 7 · Scaling & evolution

- **Shard by geography.** Each city/region is largely self-contained — drivers and riders match
  *locally*. So run **regional clusters** (their own index, matching, trip DB) and route a request to
  its region. This is the dominant scaling axis and gives **regional isolation** for free.
- **Multi-region active-active for resilience.** Each region serves its own traffic; failover spills a
  city's load to a nearby region. Cross-region trips (airport runs across a boundary) need a routing
  rule to pick an owning region.
- **Consistent hashing within a region** to map cells/shards to index nodes so adding capacity moves
  minimal data.
- **Batched matching** as volume grows: optimize assignments region-wide every 1–2s instead of greedy
  per-request, improving global ETA and driver utilization.
- **Predictive positioning & ETA from the road graph** (not straight-line) using a routing engine and
  historical traffic — Uber's marketplace runs on exactly this.

## Self-test

```quiz
{
  "question": "Why must a ride request query the rider's geohash cell AND its 8 neighbors?",
  "options": [
    "To save memory in the index",
    "Because the closest drivers may sit just across an arbitrary cell boundary, in a neighbor cell with a different prefix",
    "Because geohashes are not unique",
    "To make the write path faster"
  ],
  "answer": 1,
  "explanation": "Cell boundaries are arbitrary relative to the rider's position; the nearest cars can be across an edge. Query the 3x3 block, then distance-rank, widening precision if too few results."
}
```

```quiz
{
  "question": "Where should live driver positions (750K writes/sec) be stored?",
  "options": [
    "A durably-replicated SQL table, one row per driver",
    "In memory, sharded by region, TTL'd and treated as ephemeral/lossy",
    "Object storage, one file per ping",
    "A strongly-consistent global ledger"
  ],
  "answer": 1,
  "explanation": "Positions change every few seconds and a lost ping is harmless (replaced in ~4s). They live in an in-memory, regionally-sharded spatial index with a TTL — durability would be ruinously expensive and pointless."
}
```

```quiz
{
  "question": "Which part of the system genuinely needs strong consistency / atomic transitions?",
  "options": [
    "The map of nearby cars",
    "The driver location firehose",
    "The trip state machine (accept→matched, completion, payment)",
    "The surge multiplier display"
  ],
  "answer": 2,
  "explanation": "Trip state governs money and exclusive driver assignment — double-dispatch or double-billing are real harm. Positions/maps/surge can be slightly stale; trip transitions must be atomic and guarded."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Ride-hailing — key terms",
  "cards": [
    { "front": "Geohash", "back": "Encode a 2-D point as a base-32 string by recursive grid splits; nearby points share a prefix. Must also check 8 neighbor cells at boundaries." },
    { "front": "Quadtree", "back": "Tree that recursively splits a region into 4, subdividing only where dense. Adapts cell size to driver density; harder to shard than flat keys." },
    { "front": "S2 / H3", "back": "Space-filling-curve cell IDs (S2) or a hexagon grid (H3, Uber); better locality than geohash, uniform neighbor distances with hexagons." },
    { "front": "Location firehose", "back": "Millions of GPS pings/sec; absorbed into an in-memory, regionally-sharded index, TTL'd and lossy — never a durable DB." },
    { "front": "Dispatch auction", "back": "Offer the ride to the best candidate with a short exclusive accept window; on decline/timeout cascade to the next driver." },
    { "front": "Trip state machine", "back": "requested→matched→arrived→on_trip→completed (or canceled). Transitions are atomic and guarded — no double-dispatch, no stuck trips." }
  ]
}
```

## Key takeaways

- The defining query is **"nearest available drivers"** over **high-churn** data — that drives a
  **geospatial index** (geohash/quadtree/S2/H3) and an **in-memory, regionally-sharded** position tier.
- **Two storage problems in one system:** an **AP, ephemeral, lossy** tier for ~750K position
  writes/sec, and a **CP, durable, transactional** tier for the small but critical **trip state**.
- **"Nearby" needs neighbor-cell expansion + true distance ranking**, and matching is an **offer/accept
  auction** (often **batched** region-wide), not a simple closest-point lookup.
- **Surge** is per-cell supply/demand, computed on a cadence and **locked per request**; **trip
  tracking** is **WebSockets + pub/sub** fan-out.
- **Shard by region** for both scale and isolation, with **multi-region active-active** so one city's
  outage never spreads.

## Concepts exercised

This design applies, end to end: `realtime-communication` (WebSocket trip tracking + push), `database-sharding`
(positions and trips sharded — chiefly by region), `publish-subscribe` (fanning driver pings out to
trip subscribers and the surge service), `multi-region-active-active` (regional clusters with failover
and isolation), and `consistent-hashing` (mapping geo cells/shards to index nodes with minimal
movement on rebalance). It also draws on `database-transactions` (atomic accept-and-create-trip),
`backpressure-and-load-shedding` (dropping pings under load), `caching-fundamentals` + TTL (ephemeral
positions), and `single-point-of-failure` (replicating each in-memory index shard).
