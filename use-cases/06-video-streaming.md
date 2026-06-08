---
title: "Design a Video Streaming Service (YouTube/Netflix)"
slug: video-streaming
level: use-cases
module: large-scale-systems
order: 6
reading_time_min: 20
concepts: [transcoding-pipeline, adaptive-bitrate, object-storage, cdn-delivery, hot-cold-tiering, async-processing]
use_cases: [video-streaming]
prerequisites: [cdn, where-your-data-lives, message-queues, hot-warm-cold-data, edge-computing-and-caching]
status: published
---

# Design a Video Streaming Service (YouTube/Netflix)

> **Use case:** let creators **upload** video and let a global audience **watch** it smoothly on any
> device and any network — phones on 3G, TVs on fiber, everything in between.
> **Domain:** YouTube, Netflix, Twitch VOD, TikTok, any platform that stores and plays video.
> **Scale:** YouTube ingests **hundreds of hours of video every minute** and serves **billions of
> hours watched per day**; a single popular video can be requested **millions of times an hour**.
> **Core challenges:** an async **transcoding pipeline** (one upload → many bitrates/resolutions),
> splitting **video bytes (object storage)** from **metadata (DB)**, **CDN** delivery and cache
> hierarchy, **adaptive bitrate** streaming so playback survives a changing network, plus view
> counts, thumbnails, and **hot/cold content tiering**.

The defining tension here is **write-once, read-a-billion-times with enormous objects**. A video is
uploaded once but watched for years; each watch streams gigabytes; and the work that makes playback
smooth (transcoding, segmenting, CDN placement) all happens **off the playback path**. Get the
pipeline and the delivery layer right and the "play" button is almost boring.

## 1 · Clarify requirements

**Functional**
- **Upload** a source video (any common format/codec), get back a watchable URL when ready.
- **Transcode** each upload into multiple **resolutions and bitrates** (e.g. 240p → 4K).
- **Stream** with **adaptive bitrate (ABR)**: the player picks quality per few-second **segment**
  based on current bandwidth, switching mid-playback without re-buffering.
- **Browse/search** by metadata; show **thumbnails**, titles, durations, **view counts**.
- Support **seek** (jump to any timestamp) and resume.

**Non-functional**
- **Smooth playback:** low startup latency (time-to-first-frame) and minimal rebuffering — the
  metric users actually feel.
- **Global low latency:** bytes served from an **edge near the viewer**, not from a central origin.
- **Massive durable storage:** petabytes to exabytes; never lose an upload.
- **Asymmetric load:** writes (uploads) are modest; reads (views) are gigantic and **skewed** —
  a tiny fraction of videos get the vast majority of views.
- **Cost-efficient:** egress bandwidth and storage dominate the bill; cold content must be cheap.

```reveal
{
  "prompt": "Why is splitting 'video bytes' from 'video metadata' the first architectural decision, rather than just storing everything in one database?",
  "answer": "Because the two have completely different shapes, access patterns, and cost models. A video's bytes are huge (a single 1080p movie is gigabytes), immutable once transcoded, accessed as large sequential streams, and need to be served from edges all over the world — that is exactly what object/blob storage (S3, GCS) plus a CDN are built for: cheap, durable, infinitely scalable, range-readable. Metadata (title, owner, duration, thumbnail URLs, list of available renditions, view count, privacy flags) is tiny, mutable, queried in many ways (by id, by channel, by search), and needs transactional updates — that is what a database is for. Cramming multi-gigabyte blobs into a relational DB would blow up its storage, wreck its cache, make backups impossible, and you still could not serve those bytes from a CDN efficiently. So the universal pattern is: the DB stores a row that points at object-storage keys (and CDN URLs); the bytes never travel through the DB. This separation is what lets each layer scale and be priced independently."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Storage per uploaded video (all renditions)",
  "inputs": [
    { "key": "minutes", "label": "Average video length (minutes)", "default": 10 },
    { "key": "mbpsAvg", "label": "Avg bitrate across all renditions (Mbps)", "default": 8 }
  ],
  "formula": "minutes * 60 * mbpsAvg * 1000000 / 8",
  "resultLabel": "Bytes stored per video (sum of renditions)",
  "resultUnit": "bytes"
}
```

```calc
{
  "title": "Egress bandwidth at peak concurrent viewers",
  "inputs": [
    { "key": "viewers", "label": "Concurrent viewers", "default": 5000000 },
    { "key": "mbps", "label": "Avg stream bitrate served (Mbps)", "default": 3 }
  ],
  "formula": "viewers * mbps * 1000000",
  "resultLabel": "Aggregate egress",
  "resultUnit": "bits/s"
}
```

> A 10-minute video summed across renditions is roughly **half a gigabyte** of stored bytes — and
> the platform has billions of videos, so storage is **exabyte-scale** and must be tiered by
> temperature. At peak, **5M concurrent viewers × 3 Mbps ≈ 15 Tbps** of egress: no single origin or
> data center can serve that, which is why **the CDN does ~95%+ of byte delivery** and the origin
> mostly handles cache misses and cold content.

## 3 · API & where it sits

Two distinct planes — an **ingest/control plane** (small, transactional) and a **delivery plane**
(huge, served by the CDN). Core operations:

```
# Control plane (app servers + metadata DB)
POST /videos                      -> { videoId, uploadUrl }      # request an upload slot
POST <uploadUrl>  (resumable)     -> 200                          # client uploads bytes directly to object storage
GET  /videos/{id}                 -> { title, status, durations, renditions[], thumbnailUrl }
POST /videos/{id}/view            -> 202                          # fire-and-forget view event

# Delivery plane (served from the CDN, not app servers)
GET  /hls/{id}/master.m3u8        -> manifest listing all renditions
GET  /hls/{id}/{rendition}/seg_{n}.ts  -> a ~2–6s media segment
```

Note the **direct-to-object-storage upload** (a pre-signed/resumable URL): bytes never pass through
the app servers — they go straight to blob storage, which keeps the control plane lightweight. And
the manifest + segment URLs are plain **HTTP GETs the CDN can cache**, which is the whole reason ABR
streaming scales.

## 4 · High-level architecture

```flow
{
  "title": "Upload → transcode → store → deliver",
  "nodes": [
    { "label": "Uploader", "detail": "Client uploads source file directly to object storage via a resumable pre-signed URL." },
    { "label": "Raw object store", "detail": "Original mezzanine file lands here; an event/message is emitted on completion." },
    { "label": "Transcoding queue", "detail": "Message queue holds one job per upload; decouples slow encoding from the fast upload." },
    { "label": "Transcoder workers", "detail": "Pool of encoders fan out the job: split into chunks, encode each rendition (240p–4K), package into HLS/DASH segments + manifest." },
    { "label": "Processed object store", "detail": "Segments + manifests written here; metadata DB updated to status=ready with the rendition list." },
    { "label": "CDN", "detail": "Edge caches pull segments from object-storage origin on first miss, then serve millions of viewers from the edge." },
    { "label": "Player", "detail": "Fetches the master manifest, then requests segments adaptively based on measured bandwidth." }
  ],
  "note": "The upload path and the playback path share storage but otherwise never touch — uploads are async, playback is cache-served."
}
```

**Storage/data-model choices**

- **Object storage** (S3 / GCS / Blob) for the **raw upload** and every **transcoded segment**.
  Eleven-nines durability, range reads (essential for seeking), and lifecycle rules for tiering.
- **Metadata DB** (relational or wide-column) for the video row: id, owner, title, status,
  duration, thumbnail keys, and the **list of renditions** (resolution, bitrate, manifest URL).
  Small and transactional.
- **Message queue** between upload and transcoding so a burst of uploads can't overwhelm the encoder
  pool — jobs wait, workers pull at their own rate (classic producer/consumer decoupling).
- **View-count store:** a write-optimized counter path (see deep dive), not a synchronous DB
  `UPDATE` per play.

## 5 · Deep dive A — the transcoding pipeline

A raw upload is useless for streaming: it's one giant file in one format, one resolution. The
pipeline turns it into a **ladder of renditions**, each chopped into short **segments**, plus a
**manifest** that lists them.

```sequence
{
  "title": "From uploaded bytes to a ready video",
  "actors": ["Uploader", "ObjectStore", "Queue", "Worker", "MetadataDB"],
  "steps": [
    { "from": "Uploader", "to": "ObjectStore", "label": "PUT source file (resumable)" },
    { "from": "ObjectStore", "to": "Queue", "label": "object-created event → enqueue transcode job" },
    { "from": "Queue", "to": "Worker", "label": "worker pulls job (at its own pace)" },
    { "from": "Worker", "to": "Worker", "label": "split into chunks; encode 240p…4K in parallel; package HLS+DASH segments" },
    { "from": "Worker", "to": "ObjectStore", "label": "write segments + master manifest" },
    { "from": "Worker", "to": "MetadataDB", "label": "status=ready, store rendition list + thumbnail keys" }
  ]
}
```

**Why async + a queue.** Encoding a 10-minute 4K video can take many minutes of CPU/GPU. Doing it
inline would make uploads time out and tie up app servers. The queue lets uploads return instantly
("processing…") while a horizontally-scalable **worker pool** drains the backlog. Workers are
stateless and idempotent — if one dies mid-job, the message is redelivered and re-encoded.

**Why split each video into chunks for encoding.** A long video is itself parallelized: split it
into segments, encode them across many workers, then stitch. This is how a movie transcodes in
minutes instead of hours — and it's the same segmentation that ABR later uses for delivery.

**The rendition ladder.** Each upload becomes several outputs trading quality for bitrate:

```compare
{
  "options": [
    { "label": "240p / ~0.3 Mbps", "points": ["For weak mobile networks", "Tiny segments", "Avoids buffering on 3G", "Worst quality, always playable"] },
    { "label": "480p / ~1 Mbps", "points": ["Standard mobile / poor wifi", "Good size/quality balance", "Common default start rendition"] },
    { "label": "720p / ~3 Mbps", "points": ["HD baseline", "Most desktop/wifi views", "The sweet spot for many platforms"] },
    { "label": "1080p / ~6 Mbps", "points": ["Full HD", "Needs solid bandwidth", "Higher storage + egress cost"] },
    { "label": "4K / ~16+ Mbps", "points": ["Premium TVs / fiber", "Huge bytes", "Only encoded for content that warrants it"] }
  ]
}
```

```reveal
{
  "prompt": "Why encode many renditions up front and store them all, rather than transcoding on demand to whatever quality each viewer needs?",
  "answer": "Because transcoding is expensive (CPU/GPU-heavy and slow) and playback must be instant and cacheable. If you transcoded per request, every view would pay encoding latency and cost, and — critically — the output would be different per request, so the CDN could not cache it. By encoding a fixed ladder of renditions once at upload time, every segment becomes a static, immutable object with a stable URL that the CDN caches and serves millions of times for the cost of one encode. The trade-off is storage: you store every rendition of every video even if some are rarely watched. That's why platforms are selective — they may not encode 4K for an obscure clip, they tier rarely-watched renditions to cold storage, and the most advanced systems use 'per-title' encoding (analyzing each video's complexity to choose an optimal ladder) so a simple cartoon doesn't get the same heavy bitrate as a fast action scene. Net: pay the encode once, cache the bytes forever — the opposite economics of on-demand transcode."
}
```

## 5 · Deep dive B — adaptive bitrate streaming (HLS/DASH)

**Adaptive bitrate (ABR)** is how playback survives a network that changes second to second. The key
idea: don't stream one big file — stream a sequence of short **segments** (typically **2–6 seconds**
each), and let the **player** choose which rendition to fetch for each segment.

- The player first downloads a **manifest** (HLS calls it an `.m3u8` playlist; DASH calls it an
  `.mpd`). The **master manifest** lists every rendition and its bitrate; each rendition has its own
  playlist enumerating its segments in order.
- The player measures how fast the last segment arrived. If bandwidth is healthy and the buffer is
  full, it **steps up** to a higher rendition for the next segment; if a segment arrives slowly or
  the buffer drains, it **steps down**. Because every rendition is cut on the same segment
  boundaries with aligned keyframes, the player can **switch quality between segments seamlessly** —
  no reload, no gap.
- **Seeking** is just "jump to the segment covering timestamp T and start fetching there" — another
  reason segmentation matters.

**HLS vs DASH** are two manifest+segment formats that do the same job; HLS (Apple) dominates on iOS
and is widely supported, DASH is codec-agnostic and standardized. Platforms often ship both.

```tradeoff
{
  "title": "Choosing the segment length",
  "axis": { "left": "Short segments (1–2s)", "right": "Long segments (6–10s)" },
  "steps": [
    { "label": "1–2s", "detail": "Fast startup and quick quality adaptation (reacts to bandwidth almost immediately), and lower live-latency. But more HTTP requests, more manifest/overhead per byte, and worse compression efficiency." },
    { "label": "2–4s", "detail": "The common VOD sweet spot: responsive ABR with reasonable request overhead and good encoding efficiency. YouTube/Netflix sit around here." },
    { "label": "6–10s", "detail": "Best compression and fewest requests (cheap to serve), but sluggish to adapt and slow to start — and bad for low-latency live. Fine for stable, long-form VOD." }
  ]
}
```

```reveal
{
  "prompt": "Why does ABR put the quality-switching decision in the player (client) rather than on the server?",
  "answer": "Because only the client can observe the conditions that actually matter — its real download throughput, its current buffer level, the device's screen size and decoding ability, and battery/data constraints. The server has no reliable view of the last mile (the wifi getting congested, the phone moving onto a weak cell tower). So ABR flips the usual model: the server just publishes a menu of identical-length segments at different bitrates (a static manifest), and the client pulls whichever rendition fits its measured conditions for the next few seconds. This 'dumb server, smart client' design is also what makes ABR cache-friendly and infinitely scalable: every segment is a plain immutable HTTP object the CDN serves to everyone, and all the adaptation logic lives in millions of independent players. The server never has to track per-viewer state or transcode on the fly — it just serves bytes, and each player optimizes its own experience."
}
```

## 5 · Deep dive C — CDN delivery & cache hierarchy

The CDN is the reason 15 Tbps of egress is feasible. Segments are immutable, so they cache
beautifully. Delivery flows through a hierarchy so the origin is rarely touched:

```flow
{
  "title": "Cache hierarchy for a segment request",
  "nodes": [
    { "label": "Player", "detail": "Requests seg_42.ts for the 720p rendition." },
    { "label": "Edge PoP (near viewer)", "detail": "First stop. ~90%+ hit rate for popular content — served in a few ms over the last mile." },
    { "label": "Regional/mid-tier cache", "detail": "On an edge miss, a larger regional cache is checked — absorbs misses so many edges share one fetch (cache fan-in)." },
    { "label": "Origin (object storage)", "detail": "Only cold/rare segments reach here. The origin is the source of truth, shielded by the cache tiers." }
  ],
  "note": "Immutable segments + long TTLs make near-everything cacheable; only the long tail of cold content hits the origin."
}
```

- **Edge caches** sit in PoPs (points of presence) close to viewers; a hit serves bytes over a short
  network path — the dominant case for popular videos.
- A **mid-tier/regional cache** sits between edges and origin so that thousands of edge misses for
  the same trending video collapse into **one** origin fetch (prevents a thundering herd on a new
  viral upload).
- **Pre-warming / push:** for predictable spikes (a Netflix release, a scheduled premiere), the
  platform **pushes** content to edges in advance instead of waiting for misses. Netflix's Open
  Connect places appliances **inside ISP networks** for exactly this.
- **Thumbnails** are tiny images on the same CDN; they're requested far more often than videos
  (every grid view loads dozens), so they get their own aggressive caching.

## 5 · Deep dive D — view counts & hot/cold tiering

**View counts** are a high-volume write problem dressed up as a simple integer. A synchronous
`UPDATE videos SET views = views + 1` per play would hammer the DB and create a hot row on viral
videos. Instead, emit a **view event** to a queue/stream, **aggregate** it (batch increments,
approximate counters), and write back periodically. Counts are eventually consistent — nobody cares
if a count lags by seconds, and exactness isn't required (platforms openly de-dupe and delay
counts). This is the same fire-and-forget, async-aggregation pattern queues exist for.

**Hot/warm/cold tiering** controls cost across exabytes:

- **Hot:** trending and recent videos — kept in fast object-storage tiers and aggressively pushed to
  CDN edges. Tiny fraction of the catalog, vast majority of the views.
- **Warm:** the steady mid-tail — standard object storage, CDN-cached on demand.
- **Cold:** the long tail watched rarely — moved to **cheaper archival storage** (e.g. infrequent-
  access / Glacier-style tiers) via **lifecycle rules**. First view after dormancy pays a slightly
  higher fetch latency, then it re-warms in cache.

```reveal
{
  "prompt": "View distribution is extremely skewed — a few videos get most views, a huge tail gets almost none. How does that shape storage and CDN strategy?",
  "answer": "The skew (a power-law / Zipf-like distribution) means you must treat the head and the tail completely differently. The hot head — trending and recent videos — is a tiny slice of the catalog but drives the overwhelming majority of byte delivery, so it justifies expensive optimizations: encode the full rendition ladder including 4K, pre-push to many CDN edges, keep it on the fastest storage. The cold tail is the opposite: billions of videos that may get a view a month, where caching is pointless (every request is effectively a miss) and storing every rendition on premium storage would be ruinous. So the tail gets demoted by lifecycle rules to cheap archival storage, may have fewer renditions encoded, and is served from origin on the rare request (accepting higher first-byte latency). The CDN's value is concentrated on the head; the cost savings are concentrated on the tail. Getting this temperature-based tiering right is the difference between a viable and an impossibly expensive video platform — storage and egress are the dominant costs, and most of the bytes are cold."
}
```

## 6 · Trade-offs & failure modes

- **Encoding latency vs cost.** More renditions and per-title optimization = better experience but
  more CPU/GPU and storage. Platforms cap the ladder per content tier and tier rarely-used
  renditions to cold storage.
- **Storage vs on-demand transcode.** Pre-encoding everything wastes storage on never-watched
  renditions; on-demand transcoding wastes compute and breaks CDN caching. Most pick pre-encode +
  selective ladders.
- **Origin overload / thundering herd.** A brand-new viral video has nothing cached, so a flood of
  edge misses can stampede the origin. Mitigate with **mid-tier caches** (request collapsing) and
  **pre-warming**.
- **Hot object/partition.** The same trending video concentrates load — but because segments are
  immutable and CDN-cached, the CDN naturally absorbs it; the danger is concentrated **writes** (view
  counts), solved by async aggregation rather than a hot DB row.
- **Failed/poison uploads.** Corrupt or unsupported source files must fail the job cleanly (dead-
  letter queue) rather than wedge a worker; idempotent workers let redelivery retry safely.
- **Player on a flaky network.** ABR handles this by design — it steps down and keeps a buffer; the
  failure mode is degraded quality, not a stalled stream.

## 7 · Scaling & evolution

- **Per-title / per-scene encoding:** analyze each video's complexity and assign an optimal bitrate
  ladder instead of a fixed one — big bandwidth savings at the same perceived quality.
- **Newer codecs (AV1/VP9/HEVC):** smaller files at equal quality cut egress and storage, the two
  biggest costs — at the price of more encode compute.
- **ISP-embedded caches** (Netflix Open Connect): push the edge *inside* the viewer's ISP so popular
  content never crosses the public internet backbone.
- **Low-latency live:** shorten segments / use chunked transfer (LL-HLS, LL-DASH) to bring live
  latency from tens of seconds down to a few — at the cost of more requests and overhead.
- **Smarter pre-positioning:** predict regional demand (a show's premiere, a creator's release) and
  pre-warm those edges before the spike.
- **Multi-region metadata:** replicate the metadata DB and view-count aggregation regionally so
  browse/search are also served close to the viewer.

## Self-test

```quiz
{
  "question": "In adaptive bitrate (HLS/DASH) streaming, who decides which video quality to fetch for the next segment, and based on what?",
  "options": [
    "The origin server, based on the video's popularity",
    "The CDN edge, based on its cache contents",
    "The player (client), based on measured bandwidth and buffer level",
    "The transcoder, at upload time"
  ],
  "answer": 2,
  "explanation": "ABR is 'dumb server, smart client': the server publishes a static menu of equal-length segments at multiple bitrates, and each player picks the rendition that fits its own measured throughput and buffer — switching between segments seamlessly."
}
```

```quiz
{
  "question": "Why are video bytes stored in object storage with a CDN, while video metadata lives in a database?",
  "options": [
    "Databases can't store integers",
    "The two have totally different size, mutability, and access patterns — huge immutable blobs served from edges vs tiny mutable rows queried many ways",
    "Object storage is faster than a database for transactions",
    "CDNs cannot serve images"
  ],
  "answer": 1,
  "explanation": "Multi-gigabyte immutable streams belong in cheap, durable, range-readable object storage fronted by a CDN; small mutable, queryable metadata belongs in a DB whose row just points at the object keys. The bytes never travel through the DB."
}
```

```quiz
{
  "question": "Why is transcoding done asynchronously via a message queue instead of inline during upload?",
  "options": [
    "Queues encrypt the video",
    "Encoding is slow and CPU/GPU-heavy; a queue lets uploads return instantly while a scalable worker pool drains jobs and retries failures",
    "It makes the video higher quality",
    "Because the CDN requires it"
  ],
  "answer": 1,
  "explanation": "Inline encoding would time out uploads and tie up app servers. The queue decouples the fast upload from slow encoding, absorbs bursts, and enables stateless, idempotent workers that can be scaled and safely retried."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Video streaming — key terms",
  "cards": [
    { "front": "Transcoding pipeline", "back": "Async workers (fed by a queue) that turn one uploaded source into a ladder of renditions, each cut into segments + a manifest. Decouples slow encoding from the fast upload." },
    { "front": "Rendition ladder", "back": "The set of resolution/bitrate versions (e.g. 240p–4K) encoded once per video so any device/network has a playable, cacheable option." },
    { "front": "Adaptive bitrate (ABR)", "back": "Stream short segments; the player picks each segment's rendition from a manifest based on measured bandwidth and buffer — switching quality seamlessly." },
    { "front": "HLS / DASH", "back": "Two manifest+segment streaming formats (Apple's HLS, the open DASH) that do the same job: a master manifest lists renditions, each lists ordered segments." },
    { "front": "Object storage + CDN", "back": "Immutable video segments live in blob storage (durable, cheap, range-readable) and are served from CDN edges near viewers; the DB only stores metadata pointing at them." },
    { "front": "Hot/cold tiering", "back": "Views are power-law skewed: keep hot/recent content on fast storage + pushed to edges; demote the cold long tail to cheap archival storage via lifecycle rules." }
  ]
}
```

## Key takeaways

- **Separate bytes from metadata:** huge immutable video segments go in **object storage + CDN**;
  tiny mutable, queryable data goes in a **DB** whose row just points at the object keys.
- **Transcoding is an async pipeline:** a **queue** feeds a scalable, idempotent **worker pool** that
  fans one upload into a **rendition ladder** of segmented HLS/DASH outputs — pay the encode once,
  cache the bytes forever.
- **ABR is dumb-server, smart-client:** the server publishes equal-length segments at many bitrates;
  each **player** adapts per segment from its own measured bandwidth — which is what makes delivery
  cacheable and infinitely scalable.
- **The CDN does almost all delivery** through an edge → regional → origin **cache hierarchy**, with
  pre-warming and request collapsing to shield the origin from viral spikes.
- **Cost lives in storage and egress, and views are wildly skewed** — so **hot/cold tiering**,
  selective rendition ladders, and efficient codecs are what make the economics work; **view counts**
  are aggregated asynchronously, never updated synchronously per play.

## Concepts exercised

This design applies, end to end: `where-your-data-lives` (object storage for blobs vs a DB for
metadata) · `message-queues` (the async transcoding pipeline, decoupled producer/consumer with
retries and dead-lettering) · `cdn` and `edge-computing-and-caching` (the edge → regional → origin
cache hierarchy, pre-warming, request collapsing, ISP-embedded caches) · `hot-warm-cold-data` (the
power-law view skew driving tiered storage and selective encoding). It also touches
`caching-fundamentals` (immutable segments + long TTLs), `backpressure-and-load-shedding` (the queue
absorbing upload bursts; the mid-tier cache absorbing origin stampedes), and async-aggregation for
`view counts` instead of hot synchronous writes.
