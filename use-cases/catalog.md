# Use-Case Catalog — "Design X" walkthroughs

End-to-end, interview-style **system-design walkthroughs** that compose the concept chapters
(`content/`) into the real systems every bootcamp teaches. Each is a standalone file here, surfaced in
the app as the **Use Cases** section (after Advanced). Format follows the capstone recipe:
requirements → estimation → API → architecture → deep dives → trade-offs → scaling → self-test →
recap → concepts exercised. See ../plan.md §4 for the use-case-driven philosophy.

> Status legend: ✅ authored · 🔗 already covered as a capstone in `content/` (linked, not duplicated).
> **23 standalone walkthroughs authored** + 5 linked capstones.

## Already covered (capstones in content/)
- 🔗 **URL shortener** — `content/00-foundations/51-capstone-design-a-url-shortener.md`
- 🔗 **News feed** — `content/01-intermediate/38-capstone-design-a-news-feed.md`
- 🔗 **Chat / messaging** — `content/01-intermediate/39-capstone-design-a-chat-system.md`
- 🔗 **Distributed key-value store (Dynamo)** — `content/02-advanced/48-capstone-distributed-key-value-store.md`
- 🔗 **Payment system** — `content/02-advanced/49-capstone-payment-system.md`

## Module A — Core building blocks (`core-building-blocks`)
- ✅ **00 · rate-limiter** — token-bucket / sliding-window; distributed atomic counters, fail-open.
- ✅ **01 · distributed-unique-id-generator** — Snowflake IDs; ordering, clock skew, no coordination.
- ✅ **02 · notification-system** — push/SMS/email fan-out; queues, retries, idempotency, DLQ.
- ✅ **03 · typeahead-autocomplete** — <100ms suggestions; tries, caching, top-k ranking.
- ✅ **04 · distributed-cache** — Redis-like cluster; eviction, consistent hashing, hot keys.
- ✅ **05 · distributed-message-queue** — Kafka-like log; partitioning, ordering, consumer groups.

## Module B — Large-scale systems (`large-scale-systems`)
- ✅ **06 · video-streaming** — YouTube/Netflix; blob storage, transcoding, CDN, adaptive bitrate.
- ✅ **07 · ride-hailing** — Uber/Lyft; geospatial indexing, real-time matching, surge.
- ✅ **08 · file-storage-and-sync** — Dropbox/Drive; chunking, dedup, sync/conflict.
- ✅ **09 · web-crawler** — Google-scale crawl + index; frontier, politeness, dedup, inverted index.
- ✅ **10 · proximity-service** — Yelp/nearby; geohash/quadtree/S2, range queries, read-heavy.
- ✅ **11 · e-commerce-flash-sale** — Amazon + flash sale; inventory concurrency, oversell, thundering herd.

## Module C — Real-time & data-intensive (`real-time-and-data-intensive`)
- ✅ **12 · collaborative-editor** — Google Docs; OT vs CRDT, presence.
- ✅ **13 · leaderboard** — real-time ranking; sorted sets, top-k, hot keys.
- ✅ **14 · ad-click-aggregator** — clickstream analytics; windowing, exactly-once, lambda/kappa.
- ✅ **15 · distributed-job-scheduler** — cron at scale; leader election, at-least-once, fencing.
- ✅ **16 · metrics-monitoring-system** — Prometheus-like; TS ingest, cardinality, downsampling, alerting.

## Module D — Correctness & booking (`correctness-and-booking`)
- ✅ **17 · ticketing-system** — Ticketmaster; seat holds, concurrency, fairness queue.
- ✅ **18 · hotel-flight-booking** — Booking.com; availability search, holds, overbooking, payment saga.

## Module E — Modern AI systems (`ai-systems`)
- ✅ **19 · llm-inference-serving** — ChatGPT backend; GPU batching, token streaming, KV-cache, queueing.
- ✅ **20 · rag-vector-search** — RAG + vector DB; embeddings, ANN (HNSW/IVF), hybrid search, freshness.
- ✅ **21 · recommendation-system** — feed/product recs; candidate gen + ranking, offline/online.
- ✅ **22 · feature-store** — real-time personalization; online/offline parity, point-in-time correctness.

## Concept ↔ use-case matrix

Primary concept chapters each use case **applies** (its `prerequisites` + closely-exercised concepts).
Ensures no use case relies on an untaught concept and that high-value concepts are reinforced across
several systems. Authoritative per-file list is each walkthrough's "Concepts exercised" section.

| Use case | Primary concepts exercised |
|----------|----------------------------|
| rate-limiter | rate-limiting · caching/TTL · consistent-hashing · transactions (atomic RMW) · SPOF · load-shedding · hot-partitions |
| distributed-unique-id-generator | logical-clocks · consistent-hashing · leader-election |
| notification-system | message-queues · publish-subscribe · dead-letter-queues · idempotency · transactional-outbox |
| typeahead-autocomplete | caching-patterns · database-sharding · high-cardinality-data · cdn |
| distributed-cache | caching-fundamentals · cache-eviction-policies · consistent-hashing · hot-partitions · replication-strategies |
| distributed-message-queue | event-streaming-and-kafka · partitioning-strategies · replication-strategies · lsm-trees · dead-letter-queues |
| video-streaming | cdn · where-your-data-lives · message-queues · hot-warm-cold-data · edge-computing |
| ride-hailing | realtime-communication · database-sharding · publish-subscribe · multi-region-active-active · consistent-hashing |
| file-storage-and-sync | where-your-data-lives · merkle-trees · consistency-models · cdn · database-sharding |
| web-crawler | bloom-filters · message-queues · database-sharding · consistent-hashing · lsm-trees |
| proximity-service | database-sharding · partitioning-strategies · caching-patterns · database-indexing |
| e-commerce-flash-sale | database-transactions · optimistic-vs-pessimistic-locking · idempotency · thundering-herd · cap-theorem |
| collaborative-editor | crdts · causal-consistency · realtime-communication · event-sourcing |
| leaderboard | caching-fundamentals · caching-patterns · database-sharding · hot-partitions |
| ad-click-aggregator | stream-processing-patterns · lambda-vs-kappa · event-streaming-and-kafka · time-series-databases |
| distributed-job-scheduler | leader-election · distributed-locks · message-queues · idempotency |
| metrics-monitoring-system | time-series-databases · high-cardinality-data · metrics · slis-slos-error-budgets |
| ticketing-system | database-transactions · optimistic-vs-pessimistic-locking · saga-pattern · idempotency |
| hotel-flight-booking | saga-pattern · two-phase-commit · database-transactions · caching-patterns |
| llm-inference-serving | realtime-communication · backpressure-and-load-shedding · load-balancing · rate-limiting |
| rag-vector-search | database-sharding · caching-patterns · replication-strategies · high-cardinality-data · lambda-vs-kappa |
| recommendation-system | stream-processing-patterns · cqrs · caching-patterns · lambda-vs-kappa |
| feature-store | cqrs · time-series-databases · caching-patterns · event-sourcing · polyglot-persistence |
