---
title: "Design a Recommendation System"
slug: recommendation-system
level: use-cases
module: ai-systems
order: 21
reading_time_min: 20
concepts: [two-stage-retrieval, candidate-generation, ranking-models, embeddings, feature-pipelines, ab-testing]
use_cases: [recommendation-system]
prerequisites: [stream-processing-patterns, cqrs, caching-patterns-overview, lambda-vs-kappa-architecture]
status: published
---

# Design a Recommendation System

> **Use case:** for a given user (and context), produce a short, ordered list of items — videos,
> products, posts, songs — they are most likely to engage with, computed in tens of milliseconds.
> **Domain:** YouTube/TikTok feeds, Netflix home rows, Amazon "you may also like," Spotify
> Discover Weekly, every social timeline and store landing page.
> **Scale:** a catalog of **millions to billions** of items, hundreds of millions of users, and a
> serving budget where the full pipeline must return **within ~100 ms** for the page to feel instant.
> **Core challenges:** you cannot score billions of items per request, so you split the work into
> **candidate generation** (fast, recall-oriented) then **ranking** (slow, precision-oriented);
> **training offline** while **serving online**; **batch + streaming feature pipelines** that agree;
> **real-time signals**; **cold start**; a tight **latency budget**; and **A/B testing + feedback
> loops** that keep the models honest.

The hard part is not "which model." It is the **architecture around the model**: how to narrow
billions of items to a ranked ten in 100 ms, keep features consistent between training and serving,
and learn safely from your own outputs.

## 1 · Clarify requirements

**Functional**
- Given `(userId, context)` return an ordered list of **K items** (K ≈ 10–50).
- Respect **business rules**: don't re-show recently seen items, enforce diversity, honor blocks.
- Handle **new users and new items** (cold start) without returning garbage.
- Log every impression and outcome (click, watch time, purchase) to **train the next model**.

**Non-functional**
- **Latency:** end-to-end p99 under ~100 ms; the request fans out across stages each with a sub-budget.
- **Freshness:** newly uploaded items and a user's last few actions should influence results in
  **seconds to minutes**, not the next day.
- **Scale:** score the right ~hundreds of items per request out of a billion-item catalog.
- **Quality, measured:** improvements are proven by **online A/B tests**, not offline metrics alone.

```reveal
{
  "prompt": "Why can't we just train one big model that scores every item for a user and returns the top K? Why split into two stages at all?",
  "answer": "Because of the arithmetic. A precise ranking model uses hundreds of features per (user, item) pair and a heavy neural net or gradient-boosted tree; scoring one pair might take tens of microseconds. With a billion-item catalog that is ~10^9 scorings per request — far beyond a 100 ms budget even on a huge fleet. So you can't run the expensive model over everything. The two-stage pattern solves this by dividing labor: candidate generation is a cheap, recall-oriented retrieval that reduces a billion items to a few hundred plausible ones in single-digit milliseconds (typically approximate nearest-neighbor search over learned embeddings, plus simple sources like 'trending' and 'recently watched authors'). Then ranking runs the expensive, precision-oriented model on only those few hundred candidates, where the cost is affordable. Stage one optimizes for not missing good items (high recall) at low cost; stage two optimizes for getting the order exactly right (high precision) on a tiny set. Each stage is tuned for a different metric, and the funnel is what makes the whole thing fit the latency and compute budget."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Ranking work per request (and total scorings/sec)",
  "inputs": [
    { "key": "rps", "label": "Recommendation requests/sec (peak)", "default": 100000 },
    { "key": "candidates", "label": "Candidates passed to ranker per request", "default": 500 }
  ],
  "formula": "rps * candidates",
  "resultLabel": "Item scorings/sec by the ranker",
  "resultUnit": "scorings/s"
}
```

```calc
{
  "title": "Embedding index size for the catalog",
  "inputs": [
    { "key": "items", "label": "Items in catalog", "default": 500000000 },
    { "key": "dim", "label": "Embedding dimensions", "default": 128 },
    { "key": "bytesPerFloat", "label": "Bytes per dimension (float32)", "default": 4 }
  ],
  "formula": "items * dim * bytesPerFloat",
  "resultLabel": "Raw vector storage",
  "resultUnit": "bytes"
}
```

> At 100k req/s with 500 candidates each, the ranker does ~**50M scorings/sec** — heavy, but bounded
> (we never run it on the full catalog). The embedding index for 500M items at 128-d float32 is
> ~**256 GB raw**; in practice it is **quantized** (compressed to ~1 byte/dim) and **sharded across
> nodes**, and queried with an **approximate nearest-neighbor (ANN)** index — never a brute-force scan.

## 3 · API & where it sits

The recommender is a service the feed/page backend calls. Its core operation:

```
recommend(userId, context, k) -> [ {itemId, score, reason}, ... ]   // ordered, length k
```

`context` carries device, time, session, current page, and the **last few in-session actions**
(what you just clicked). Internally the request fans through **candidate generation → ranking →
filtering/business-rules → response**. Reads (serving) and writes (training/feature ingestion) are
**fully separate paths** — a textbook **CQRS** split: the query side is optimized for low-latency
lookups; the command/event side ingests interaction logs to rebuild models and features.

## 4 · High-level architecture

```flow
{
  "title": "Two-stage serving pipeline (with offline training feeding it)",
  "nodes": [
    { "label": "Client / Feed backend", "detail": "Calls recommend(userId, context, k)." },
    { "label": "Candidate generation", "detail": "Multiple cheap sources: ANN over embeddings, trending, follows, recent. Yields ~hundreds of items." },
    { "label": "Feature fetch", "detail": "Pull user + item + context features from the online feature store (low-latency KV)." },
    { "label": "Ranking model", "detail": "Score each candidate with the heavy model; sort by predicted engagement." },
    { "label": "Filter + business rules", "detail": "Dedup, remove seen, diversity, blocks, ad/policy injection." },
    { "label": "Response + impression log", "detail": "Return top K; log impressions to the event stream for training." }
  ],
  "note": "Offline: a training pipeline reads logged impressions/outcomes, retrains the ranker and embeddings nightly, and publishes new models + a refreshed ANN index to serving."
}
```

**Storage & data-model choices**
- **Embedding / ANN index** (e.g. FAISS-style, ScaNN, or a vector DB): item vectors for retrieval,
  sharded and replicated; rebuilt offline and hot-swapped.
- **Online feature store** (low-latency KV like Redis/Cassandra): precomputed user and item features
  keyed by id, read at serving time in single-digit ms.
- **Offline feature store / warehouse** (columnar lake/warehouse): the same feature definitions
  computed in batch over history, used to generate **training examples**.
- **Event stream** (Kafka/Kinesis): the firehose of impressions and outcomes — the source of truth
  the whole learning loop is built on.
- **Model registry**: versioned ranker + embedding artifacts, so serving can roll forward/back.

## 5 · Deep dive A — candidate generation vs ranking

The funnel runs two models tuned for opposite goals. Retrieval must be **fast and high-recall**;
ranking must be **slow and high-precision** on a small set.

```compare
{
  "options": [
    { "label": "Candidate generation (retrieval)", "points": ["Input: user/context; output: ~hundreds of items from billions", "Cheap per item; uses ANN over embeddings + simple sources", "Optimizes recall — don't miss good items", "Often a two-tower model: encode user and item separately, match by dot product"] },
    { "label": "Ranking", "points": ["Input: a few hundred candidates; output: a precise ordering", "Expensive per item; hundreds of features per (user,item) pair", "Optimizes precision — get the order exactly right", "Often gradient-boosted trees or a deep net predicting click/watch/convert probability"] }
  ]
}
```

A **two-tower model** (the common retrieval architecture) learns a *user tower* and an *item tower*
that each output a vector; relevance is their **dot product**. Because item vectors don't depend on
the user, you precompute them all offline and index them; at serving time you compute one user
vector and ask the **ANN index** for its nearest item vectors. **ANN** (approximate nearest
neighbor) trades a tiny bit of accuracy for enormous speed — instead of comparing the user vector to
all billion items, structures like **HNSW** (a navigable graph you greedily walk toward close
vectors) or **IVF** (cluster the space, search only the nearest few clusters) return the top
neighbors in milliseconds.

```sequence
{
  "title": "One recommend() request through the funnel",
  "actors": ["FeedBackend", "Retrieval", "FeatureStore", "Ranker"],
  "steps": [
    { "from": "FeedBackend", "to": "Retrieval", "label": "recommend(user, context, k=10)" },
    { "from": "Retrieval", "to": "Retrieval", "label": "user vector → ANN top-500 + trending/follows" },
    { "from": "Retrieval", "to": "FeatureStore", "label": "batch-fetch features for 500 candidates" },
    { "from": "FeatureStore", "to": "Ranker", "label": "feature vectors per candidate" },
    { "from": "Ranker", "to": "FeedBackend", "label": "scored & sorted; filter → top 10 + reasons" }
  ]
}
```

```reveal
{
  "prompt": "Within a ~100 ms budget, how should the latency be split across stages, and which stage is the usual bottleneck?",
  "answer": "A typical split is roughly: candidate generation (ANN lookup + gathering simple sources) 5–15 ms, online feature fetch for the candidates 5–20 ms, ranking inference 20–50 ms, filtering/business rules a few ms, leaving headroom for network and serialization. The ranker is usually the bottleneck because cost scales with (candidates × features × model size): doubling the candidate set or the model directly inflates inference time. Levers to stay in budget: cap the candidate count entering the ranker (e.g. 300–800), batch all candidate scorings into one vectorized model call instead of per-item calls, fetch all features in a single multi-get from the feature store rather than N round trips, quantize the model and ANN index, and run a lightweight 'pre-ranker' to trim candidates before the full ranker. The feature fetch is the sneaky second bottleneck: hundreds of candidates each needing item features can fan out into many KV reads, so co-locating features and batching the read matters as much as model speed. The architectural point is that every stage gets an explicit sub-budget, and you tune the candidate count as the master dial trading recall for latency."
}
```

## 6 · Deep dive B — offline training, online serving, and the feature pipeline

The system has two clocks. **Offline** (slow): read history, train models, build indexes, publish
artifacts. **Online** (fast): load those artifacts and serve. The danger that connects them is
**training/serving skew** — if a feature is computed one way in the training warehouse and a
different way in the serving path, the model sees inputs at serving time that don't match what it
learned on, and quality silently degrades.

The classic defense is **dual feature pipelines that share one definition** — exactly the
**lambda/kappa** problem applied to features:
- **Batch layer:** recompute features over full history nightly in the warehouse → fills the offline
  store (for training) and bulk-loads the online store. Accurate, complete, hours stale.
- **Stream layer:** consume the **event stream** with **stream processing** to update fast-moving
  features (e.g. "items this user clicked in the last 5 minutes," "video's like-rate this hour") into
  the online store within seconds. This is what makes **real-time signals** possible.

```tradeoff
{
  "title": "How fresh do features and candidates need to be?",
  "axis": { "left": "Batch only (simple, stale)", "right": "Streaming-first (fresh, complex)" },
  "steps": [
    { "label": "Nightly batch only", "detail": "All features recomputed once a day. Dead simple, no streaming infra, but a user's last hour and brand-new items are invisible until tomorrow. Fine for slow-moving catalogs." },
    { "label": "Batch + micro-batch", "detail": "Hourly jobs refresh trending and item stats; user history still batch. Hours fresh with modest extra cost — a common middle ground." },
    { "label": "Batch + streaming features", "detail": "Lambda-style: nightly batch for accuracy + a stream layer updating real-time signals in seconds. Brand-new items can be retrieved minutes after upload. More moving parts to keep consistent." },
    { "label": "Kappa / streaming-first", "detail": "One streaming pipeline is the source of truth; reprocess by replaying the log. Fewest duplicate code paths (no train/serve skew), but everything—even backfills—runs through stream processing." }
  ]
}
```

```reveal
{
  "prompt": "What is training/serving skew, and how do a shared feature definition and a feature store prevent it?",
  "answer": "Training/serving skew is when the value of a feature differs between when the model is trained and when it is served, because the two paths compute it differently. Example: at training time, an offline SQL job computes 'user's 7-day average watch time' over the warehouse with a clean windowed aggregate; at serving time a hand-written service computes the 'same' feature slightly differently (different window boundary, different handling of nulls, a units mismatch). The model learned a relationship on the offline values but receives the serving values, so its predictions drift even though nothing looks broken. The fixes are architectural. First, define each feature once and generate both the batch and streaming computations from that single definition, so they can't diverge. Second, use a feature store as the contract between training and serving: the offline store materializes features for building training examples and the online store serves the identical feature values at request time, both populated from the same pipelines. Crucially, you also use point-in-time correct joins when building training data — features must reflect what was known at the moment of the historical event, not today's values, or you leak the future into training. With one definition, one store, and point-in-time joins, the model trains and serves on the same numbers, eliminating skew."
}
```

**Cold start.** New items have no interaction history, so collaborative signals (who-watched-also-
watched) can't place them; new users have no profile.
- **New items:** lean on **content features** (the item tower can embed a brand-new video from its
  title, thumbnail, creator, category), and deliberately **explore** — inject a fraction of fresh
  items into feeds to gather first interactions, then let the data take over.
- **New users:** fall back to **popularity/trending** and context (device, locale, referrer), ask a
  quick onboarding preference, and adapt fast from the first few in-session clicks via real-time
  signals.

## 7 · Trade-offs & failure modes

- **The feedback loop poisons itself.** The model only sees outcomes for items it chose to show, so
  it reinforces its own past choices — a **popularity/rich-get-richer loop** that starves new and
  niche items and narrows diversity. Mitigate with deliberate **exploration** (show some uncertain
  items), **logging propensities** so you can debias training, and explicit **diversity** rules.
- **Stale model / index.** Serving a model or ANN index that's hours behind means new items and
  shifted tastes are missed. Mitigate with the **stream layer** for fast features and frequent index
  rebuilds; monitor freshness as a first-class SLO.
- **Feature store unavailable.** If the online feature store blips, ranking loses its inputs. Degrade
  gracefully: serve from **cached prior results** or fall back to a **trending/popularity** list
  rather than failing the page (recall caching as a resilience layer).
- **Retrieval misses (recall ceiling).** If a good item never enters the candidate set, no ranker can
  rescue it. Use **multiple complementary candidate sources** (embedding ANN + trending + follows +
  recent) so a single source's blind spot doesn't sink quality.
- **Filter bubbles & feedback latency.** Heavy personalization plus a self-reinforcing loop can trap
  users; measure long-term metrics (retention), not just immediate clicks, to avoid optimizing for
  click-bait.

## 8 · Scaling & evolution — A/B testing and the learning loop

Every change — new ranker, new candidate source, new feature — ships behind an **A/B test**: route a
small percentage of traffic to the variant, compare engagement and guardrail metrics (latency,
diversity, complaints) against control, and roll out only on a real, significant win. Offline metrics
(AUC, NDCG) are necessary but **not sufficient** — they often disagree with live behavior, so online
experiments are the source of truth. The serving path **logs impressions and outcomes** to the event
stream, the training pipeline turns those into the next model, and the cycle repeats — the
**feedback loop** that makes the system learn. Keep it healthy with consistent experiment assignment,
**holdback** groups (a slice with no personalization, to measure the system's total lift), and
**propensity logging** so training can correct for the bias in what was shown.

Further evolution: a **pre-ranker** (cheap model) between retrieval and the full ranker to trim
candidates; **per-surface models** (home feed vs search vs "up next"); **real-time / session-based
retrieval** that re-queries as the user acts; and **multi-objective ranking** that blends predicted
click, watch time, and satisfaction instead of a single target.

## Self-test

```quiz
{
  "question": "Why is recommendation split into candidate generation then ranking, rather than ranking every item?",
  "options": [
    "To use two databases",
    "Because the precise ranking model is too expensive to run over a billion-item catalog per request; retrieval cheaply narrows it to ~hundreds first",
    "To make training faster",
    "Because ANN indexes can't be sharded"
  ],
  "answer": 1,
  "explanation": "Retrieval is cheap and recall-oriented (billions → hundreds); ranking is expensive and precision-oriented but only runs on that small set, so the whole pipeline fits the latency/compute budget."
}
```

```quiz
{
  "question": "What is training/serving skew?",
  "options": [
    "When the model is bigger than the GPU memory",
    "When a feature is computed differently in the training pipeline than in the serving path, so the model sees inputs that don't match what it learned on",
    "When A/B test groups are unbalanced",
    "When the ANN index is stale"
  ],
  "answer": 1,
  "explanation": "Divergent feature computation between offline training and online serving degrades quality silently. A single feature definition, a shared feature store, and point-in-time joins prevent it."
}
```

```quiz
{
  "question": "Why must recommender changes be validated with online A/B tests, not offline metrics alone?",
  "options": [
    "Offline metrics are illegal to compute",
    "Offline metrics like AUC/NDCG often disagree with real user behavior, and the model also affects future data via the feedback loop, so only live experiments measure true impact",
    "A/B tests are cheaper than offline evaluation",
    "Because the model can't be retrained otherwise"
  ],
  "answer": 1,
  "explanation": "Offline scores are necessary but not sufficient; live experiments with guardrails and holdbacks measure actual engagement and the system's true lift, including feedback-loop effects."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Recommendation system — key terms",
  "cards": [
    { "front": "Candidate generation", "back": "Cheap, recall-oriented retrieval that narrows billions of items to ~hundreds — usually ANN over learned embeddings plus simple sources (trending, follows)." },
    { "front": "Ranking", "back": "Expensive, precision-oriented model that scores the few hundred candidates with rich per-(user,item) features and produces the final ordering." },
    { "front": "Two-tower model + ANN", "back": "Separate user and item encoders whose dot product is relevance; item vectors are precomputed and queried by approximate nearest-neighbor (HNSW/IVF) in milliseconds." },
    { "front": "Feature store", "back": "The contract between training and serving: an offline store builds training examples and an online (low-latency KV) store serves identical feature values at request time." },
    { "front": "Training/serving skew", "back": "When a feature is computed differently offline vs online, so the model receives inputs that mismatch its training data, quietly hurting quality." },
    { "front": "Feedback loop", "back": "Serving logs impressions/outcomes that train the next model; left unchecked it reinforces its own choices (popularity bias), so add exploration and propensity logging." }
  ]
}
```

## Key takeaways

- The architecture, not the model, is the design: a **two-stage funnel** (recall-oriented
  **candidate generation** → precision-oriented **ranking**) is what makes scoring a billion-item
  catalog fit a ~100 ms budget.
- Retrieval is typically a **two-tower model + ANN index**; ranking is a heavy model over a few
  hundred candidates. Give every stage an explicit **latency sub-budget** and tune candidate count.
- Keep **offline training and online serving** in sync with a **shared feature definition, a feature
  store, and point-in-time joins** — training/serving skew is the silent quality killer.
- Use **batch + streaming feature pipelines** (lambda/kappa) so **real-time signals** and brand-new
  items show up in seconds; handle **cold start** with content features, popularity, and exploration.
- Prove every change with **online A/B tests** and watch the **feedback loop** — debias with
  exploration, holdbacks, and propensity logging so the system doesn't just reinforce itself.

## Concepts exercised

This design applies, end to end: `cqrs` (the serving/query path is fully separated from the
training/command path that ingests interaction events) · `stream-processing-patterns` (the stream
layer that turns the impression firehose into real-time features and trending stats) ·
`lambda-vs-kappa-architecture` (batch + streaming feature pipelines, and the choice of replaying one
log vs running two) · `caching-patterns-overview` (the online feature store and cached prior results
as a low-latency read layer and graceful-degradation fallback). It also exercises embeddings and
approximate nearest-neighbor retrieval, feature stores, and A/B-test-driven feedback loops.
