---
title: "Design RAG + a Vector Database (Semantic Search)"
slug: rag-vector-search
level: use-cases
module: ai-systems
order: 20
reading_time_min: 20
concepts: [embeddings, approximate-nearest-neighbor, hnsw-ivf, hybrid-search, chunking, retrieval-augmented-generation]
use_cases: [rag-vector-search]
prerequisites: [database-sharding, caching-patterns-overview, replication-strategies, high-cardinality-data, lambda-vs-kappa-architecture]
status: published
---

# Design RAG + a Vector Database (Semantic Search)

> **Use case:** answer a user's question by **retrieving the most relevant chunks** from a private
> corpus (docs, tickets, code, PDFs) and feeding them to an LLM as context — so the model answers
> from *your* data instead of hallucinating from its frozen training set. This is **RAG**:
> retrieval-augmented generation.
> **Domain:** every "chat with your docs," internal knowledge assistant, support copilot, and
> semantic site search.
> **Scale:** tens to hundreds of millions of chunks; queries must find the top-k relevant chunks in
> **tens of milliseconds** so the slow part (the LLM call) dominates, not retrieval.
> **Core challenges:** turning text into **embeddings** and **chunking** it well; an **approximate
> nearest-neighbor (ANN) index** (HNSW / IVF) that searches millions of vectors fast; an
> **ingestion/indexing pipeline**; **hybrid search** (vectors + keyword/BM25); **freshness &
> re-indexing**; **prompt assembly**; **sharding/replicating** the vectors; and the central tension —
> **recall vs latency**.

RAG is the canonical "AI system" interview because the LLM is the easy, bought part. The real
engineering is a **search system over a high-cardinality embedding space** with a streaming ingestion
pipeline bolted on — classic distributed-systems work wearing an AI hat.

## 1 · Clarify requirements

**Functional**
- Ingest documents, **split into chunks**, embed each chunk, and index the vectors.
- Given a query, return the **top-k most semantically similar chunks** (k ≈ 5–20).
- Assemble retrieved chunks into a **prompt** and call the LLM to generate a grounded answer, ideally
  with **citations** back to source chunks.
- Support **metadata filters** (tenant, doc type, date, ACLs) alongside similarity.
- Reflect **updates/deletes** (a doc changed → stale chunks must go).

**Non-functional**
- **Retrieval latency:** p99 in the tens of ms so it's a rounding error next to the ~1–5 s LLM call.
- **Recall:** retrieval should find *almost all* of the truly relevant chunks — bad recall means the
  LLM never sees the right context and answers wrong.
- **Freshness:** new/changed docs queryable within minutes, not hours.
- **Multi-tenant isolation:** tenant A must never retrieve tenant B's chunks.
- **Cost-aware:** embeddings and LLM tokens cost money; don't re-embed or over-stuff context.

```reveal
{
  "prompt": "Why is 'recall' — not raw latency or throughput — the requirement that quietly decides whether the whole RAG system works?",
  "answer": "RAG's answer quality is capped by what the retriever puts in front of the LLM. The model can only ground its answer in the chunks you retrieve; if the chunk that actually contains the answer isn't in the top-k, the LLM either makes something up (hallucination) or says it doesn't know — and no amount of prompt engineering fixes a missing fact. Recall is the fraction of the truly-relevant chunks that retrieval actually returns. Two things erode it. First, the ANN index is approximate: to search millions of vectors in milliseconds it skips most of them, so it can miss a near neighbor — you trade recall for speed via tunable knobs (ef_search in HNSW, nprobe in IVF). Second, embeddings + chunking lose information: a badly chunked document can split the answer across two chunks so neither scores well, and a weak embedding model can fail to place a paraphrased question near its answer in vector space. So you can have a blazing-fast, perfectly available system that gives wrong answers because recall is low. Latency and throughput are necessary; recall is what makes the product correct, which is why teams obsess over retrieval-quality eval (recall@k, MRR) before they touch the LLM."
}
```

## 2 · Estimate the scale

How big is the index, and how many embeddings must we compute?

```calc
{
  "title": "Vector storage (raw embeddings)",
  "inputs": [
    { "key": "docs", "label": "Documents", "default": 5000000 },
    { "key": "chunksPerDoc", "label": "Chunks per doc", "default": 20 },
    { "key": "dims", "label": "Embedding dimensions", "default": 768 },
    { "key": "bytesPerDim", "label": "Bytes per dim (float32)", "default": 4 }
  ],
  "formula": "docs * chunksPerDoc * dims * bytesPerDim",
  "resultLabel": "Raw vector storage",
  "resultUnit": "bytes"
}
```

```calc
{
  "title": "One-time embedding compute for ingestion",
  "inputs": [
    { "key": "chunks", "label": "Total chunks to embed", "default": 100000000 },
    { "key": "chunksPerSec", "label": "Embeddings/sec (one GPU/endpoint)", "default": 2000 }
  ],
  "formula": "chunks / chunksPerSec",
  "resultLabel": "Embedding wall-clock (one worker)",
  "resultUnit": "seconds"
}
```

> 100M chunks × 768 dims × 4 bytes ≈ **~300 GB of raw vectors** — that's *before* the ANN index
> overhead (HNSW graph links can add 50–100%), so plan for **~0.5 TB in RAM** and therefore
> **sharding across nodes**. Embedding 100M chunks on a single worker is ~14 hours, so ingestion must
> **fan out across many embedding workers**. Takeaway: vectors are big and memory-resident, and
> ingestion is an embarrassingly parallel batch job — both push you toward a fleet.

## 3 · API & where it sits

The vector DB sits behind a **retrieval service**; the LLM call lives behind an **orchestrator**
(the "RAG service") that the client talks to.

```
# Ingestion (write path)
upsert(tenant, doc_id, chunks[ {id, text, embedding[768], metadata} ]) -> ok
delete(tenant, doc_id) -> ok

# Retrieval (read path)
search(tenant, query_embedding[768], k=10, filter={doc_type:"faq"}) -> [ {chunk_id, score, text, metadata} ]

# Orchestration (what the client calls)
ask(tenant, question) -> { answer, citations[] }
```

`ask` = embed the question → `search` for top-k → assemble prompt → call LLM → return answer +
citations. Retrieval is read-heavy and latency-critical; ingestion is write-heavy and throughput-
critical — **two different workloads**, which is why the read and write paths get scaled separately
(a Lambda/Kappa-style split: a bulk path for backfills, a streaming path for live updates).

## 4 · High-level architecture

```flow
{
  "title": "RAG: ingestion (write) path and query (read) path",
  "nodes": [
    { "label": "Source docs", "detail": "PDFs, wiki, tickets, code, DB rows — the corpus to ground answers in." },
    { "label": "Chunker", "detail": "Split each doc into overlapping chunks (~200–500 tokens) on semantic boundaries; attach metadata + source offsets." },
    { "label": "Embedding workers", "detail": "Batch chunks through an embedding model (e.g. text-embedding-3, bge) → a vector per chunk. Fan out across GPUs." },
    { "label": "Vector DB (sharded ANN)", "detail": "Store vector + metadata; build HNSW/IVF index per shard. Replicated for HA and read scale." },
    { "label": "Retriever", "detail": "Embed the query, run ANN search per shard, gather + re-rank top-k; optionally fuse with BM25 keyword results." },
    { "label": "Prompt assembler", "detail": "Pack top-k chunks into a context-window-budgeted prompt with the question + citation markers." },
    { "label": "LLM", "detail": "Generates the grounded answer from the supplied context; returns text + which chunks it used." }
  ],
  "note": "Left of the Vector DB is the async write path (runs continuously as docs change); right of it is the synchronous read path (per user question)."
}
```

**Storage / data-model choices:**
- **Vector store:** specialized (Pinecone, Weaviate, Milvus, Qdrant) or a vector extension on an
  existing DB (pgvector on Postgres, OpenSearch/Elasticsearch kNN). Each chunk row =
  `{id, tenant, vector[768], text, metadata}`.
- **Metadata as first-class:** filters (tenant, ACL, date, doc_type) must be applied *with* the
  vector search, not after, or you'll filter away most of your top-k.
- **Source of truth stays elsewhere:** the vector DB is a derived **index**, not the system of
  record — you can always rebuild it from the original docs (this matters for re-indexing).

## 5 · Deep dive

### 5a · Embeddings & chunking

An **embedding** maps text to a fixed-length vector (e.g. 768 floats) such that *semantically
similar* text lands *close together* (small cosine distance). "How do I reset my password?" and "I
forgot my login credentials" end up near each other even with no shared words — that's why this beats
keyword search for natural-language questions.

**Chunking** is splitting documents into retrieval units. It's the single highest-leverage,
most-underrated knob:
- **Too big** (whole doc per chunk): the vector is an average of many topics → diluted, low
  similarity to a specific question, and you blow the LLM's context budget.
- **Too small** (one sentence): you lose the surrounding context that made the sentence meaningful.
- **Sweet spot:** ~200–500 tokens, split on **semantic boundaries** (headings, paragraphs) with a
  small **overlap** (e.g. 10–20%) so an answer that straddles a boundary isn't cut in half.

```reveal
{
  "prompt": "Both the query and the documents have to be embedded with the SAME model. Why, and what breaks if you mix models?",
  "answer": "Similarity search only works because all vectors live in one shared coordinate space where 'close = similar.' An embedding model defines that space — its 768 dimensions mean specific (uninterpretable) things, learned during its training. Two different models produce vectors in two different, incompatible spaces: the same sentence gets different coordinates, and the geometric distance between a query vector from model A and a document vector from model B is meaningless noise — nearness no longer implies semantic similarity, so recall collapses. This has a critical operational consequence: when you upgrade your embedding model, you must RE-EMBED the entire corpus with the new model and rebuild the index, because old and new vectors can't be compared. You also must use the exact same model (and often the same 'query' vs 'document' prompt prefix some models require) at query time as at ingestion time. This is why the embedding model choice is sticky and why re-indexing the whole corpus is a real, budgeted operation rather than an afterthought."
}
```

### 5b · The ANN index: HNSW vs IVF

Finding the true nearest neighbors means comparing the query to *every* vector — O(N) per query,
hopeless at 100M vectors and tens of ms. So we use **ANN (approximate nearest neighbor)**: indexes
that return *almost* the right neighbors by searching only a tiny fraction of the vectors. Two
dominant families:

- **HNSW (Hierarchical Navigable Small World):** a multi-layer graph where each vector links to its
  near neighbors. Search **greedily walks the graph** from an entry point toward the query, dropping
  through coarse → fine layers (like an express → local train). Knob: **`ef_search`** — how many
  candidates to keep while walking. Higher = better recall, slower. Great recall and latency; downside
  is high memory (the graph links) and slower inserts.
- **IVF (Inverted File):** cluster all vectors into *C* centroids (k-means). At query time, find the
  nearest few centroids and only scan vectors in those **cells**. Knob: **`nprobe`** — how many cells
  to scan. Higher = better recall, slower. Cheaper memory, faster to build; recall is a bit lower
  unless you scan more cells. Often paired with **PQ (product quantization)**, which compresses each
  vector to a few bytes so the index fits in far less RAM (trading a little precision for big memory
  savings).

```compare
{
  "options": [
    { "label": "HNSW (graph)", "points": ["Greedy graph walk, no training step", "Excellent recall at low latency", "High memory (graph links ~+50–100%)", "Inserts are costly; deletes are awkward (tombstones)", "Default for most vector DBs"] },
    { "label": "IVF (clustering)", "points": ["Cluster into cells; scan nearest cells", "Lower memory, esp. with PQ compression", "Needs a training step (k-means) on a sample", "Recall drops if data drifts from centroids", "Good for huge, batch-built indexes"] },
    { "label": "Flat (brute force)", "points": ["Compare to every vector — exact", "100% recall, zero approximation", "O(N) per query — only viable for small sets", "No index build", "Use as ground truth for recall eval"] }
  ]
}
```

The whole game is one dial: search more of the index → higher recall but higher latency.

```tradeoff
{
  "title": "ANN search effort: recall vs latency",
  "axis": { "left": "Fast / lower recall", "right": "Slow / higher recall" },
  "steps": [
    { "label": "Low ef_search / nprobe", "detail": "Visit few candidates/cells. Single-digit ms, but you'll miss some true neighbors — recall@10 maybe 0.85. Fine if chunks are redundant." },
    { "label": "Tuned middle", "detail": "The production sweet spot: recall@10 ≈ 0.95–0.98 at ~10–30 ms. Tune on a labeled query set against a brute-force ground truth." },
    { "label": "High ef_search / nprobe", "detail": "Visit many candidates. Recall approaches exact but latency climbs and CPU per query rises — wasteful past the point where the LLM no longer benefits." },
    { "label": "Flat / brute force", "detail": "Exact 100% recall but O(N) — only for small or per-tenant tiny indexes. Use it to MEASURE the recall of your ANN settings." }
  ]
}
```

### 5c · Hybrid search (vector + keyword/BM25)

Pure vector search is great at *meaning* but weak at *exact tokens* — product codes (`X1-9000`),
rare names, error codes, acronyms. **BM25** (the classic keyword-relevance score behind Lucene /
Elasticsearch) nails those but misses paraphrases. **Hybrid search** runs both and **fuses** the
result lists — commonly with **RRF (Reciprocal Rank Fusion)**, which scores each chunk by `1/(k +
rank)` in each list and sums, so a chunk ranking well in *either* method floats to the top. Hybrid
typically beats either alone on real corpora, especially ones full of jargon and identifiers.

```reveal
{
  "prompt": "Give a concrete query where pure vector search fails but keyword/BM25 saves it — and the reverse.",
  "answer": "Vector fails / keyword wins: a user searches for error code 'ORA-00942' or a SKU like 'X1-9000-B'. These are near-arbitrary token strings with little semantic content; the embedding model has no meaningful notion of where 'ORA-00942' sits in concept space, so the nearest vectors are often unrelated text that happens to mention databases or errors. BM25 matches the exact token immediately and ranks the right doc first. Keyword fails / vector wins: a user asks 'how do I stop the app from logging me out so fast?' and the relevant doc is titled 'Configuring session timeout duration.' They share almost no words, so BM25 scores it low — but in embedding space the question and the doc are close because they mean the same thing, so vector search retrieves it. Hybrid search runs both and fuses the ranks (e.g. RRF), so the system is robust to both failure modes: exact identifiers are caught by BM25, paraphrased intent is caught by vectors, and a result strong in either signal surfaces. This is why production RAG over technical corpora almost always uses hybrid rather than vectors alone."
}
```

### 5d · Retrieval → prompt assembly

Once you have fused top-k chunks, an optional **re-ranker** (a cross-encoder that scores each
(query, chunk) pair jointly — more accurate but slower, so it only re-scores the ~50 candidates ANN
already shortlisted) reorders them. Then the **prompt assembler** packs them into the LLM's
**context window** under a token budget: system instructions + the question + the chunks (with source
IDs for citations) + room for the answer. Order and dedup matter — drop near-duplicate chunks, put
the strongest context where the model attends best, and never overflow the window (overflow either
errors or silently truncates the most important context).

### 5e · Sharding & replicating the vectors

At ~0.5 TB in RAM the index can't live on one node:
- **Shard** by vector (or by tenant for strict isolation). A query **fans out to all shards**, each
  returns its local top-k, and the retriever **merges** them into a global top-k — scatter-gather.
  Because ANN scores are comparable across shards, the merge is a simple top-k by score.
- **Replicate** each shard for **HA and read throughput** — replicas serve queries in parallel; lose
  one and the shard stays up. Since the index is a *derived* store, a lost replica can also just be
  rebuilt from the source of truth.
- **Big-tenant skew:** one giant tenant can dominate a shard (a hot-partition problem on
  high-cardinality tenant keys) — split that tenant across shards or give it dedicated ones.

```sequence
{
  "title": "A user question end to end (read path)",
  "actors": ["Client", "RAGService", "Embedder", "VectorDB", "LLM"],
  "steps": [
    { "from": "Client", "to": "RAGService", "label": "ask(tenant, question)" },
    { "from": "RAGService", "to": "Embedder", "label": "embed(question) → query vector" },
    { "from": "RAGService", "to": "VectorDB", "label": "search(vector, k=10, filter=tenant) — scatter to shards" },
    { "from": "VectorDB", "to": "RAGService", "label": "merged top-k chunks + scores + metadata" },
    { "from": "RAGService", "to": "LLM", "label": "prompt = instructions + question + chunks" },
    { "from": "LLM", "to": "RAGService", "label": "grounded answer + which chunks were used" },
    { "from": "RAGService", "to": "Client", "label": "answer + citations" }
  ]
}
```

## 6 · Trade-offs & failure modes

- **Recall vs latency** is the master trade-off (5b): every speedup (lower `ef_search`/`nprobe`, more
  PQ compression, fewer shards probed) costs recall, which costs answer quality.
- **Garbage retrieval → confident wrong answers.** If the right chunk isn't retrieved, the LLM still
  answers — fluently and wrongly. Mitigate with hybrid search, re-ranking, recall eval, and letting
  the model say "not found" when top scores are weak (a relevance threshold).
- **Stale index.** A doc was edited or deleted but its old chunks still rank → the model cites
  outdated/wrong info. Needs a freshness pipeline (next section) and **tombstones** for deletes (HNSW
  can't truly delete a node cheaply, so it marks it dead and skips it; periodic compaction reclaims it).
- **Embedding-model upgrade = full re-index.** Old and new vectors are incomparable (5a), so changing
  models means re-embedding everything — expensive and must be planned (blue/green index swap).
- **Cache the LLM, and the embeddings.** Identical/again-asked questions can return cached answers;
  query embeddings and even retrieval results are cacheable (read-through cache) to cut the LLM bill,
  the dominant cost. Invalidate the answer cache when underlying chunks change.
- **Multi-tenant leakage.** A missing tenant filter on one query path can return another tenant's
  data — enforce the filter inside retrieval, ideally with per-tenant shards for hard isolation.

## 7 · Scaling & evolution

- **Two ingestion paths (Lambda/Kappa thinking):** a **batch backfill** for the initial corpus and
  re-indexes (massively parallel embedding jobs), and a **streaming path** for live edits — a CDC/queue
  feed (doc changed → re-chunk → re-embed → upsert) that keeps the index **fresh within minutes**.
- **Re-indexing strategy:** build the new index **alongside** the live one (blue/green), validate
  recall on a held-out query set, then **atomically swap** reads over — never re-index in place.
- **Quantization for scale:** PQ / scalar quantization shrinks vectors (e.g. float32 → int8) so far
  more fit in RAM per node, cutting shard count and cost — at a small, measurable recall hit.
- **Tiered storage:** hot/recent vectors in RAM, cold archives in a compressed on-disk index queried
  less often.
- **Better retrieval over time:** add re-ranking, query rewriting (let an LLM expand the query),
  and metadata-aware routing (send a "billing" question only to billing shards).

## Self-test

```quiz
{
  "question": "Your RAG system is fast (p99 retrieval 12 ms) and highly available, but users complain answers are often wrong or 'made up.' What's the most likely root cause?",
  "options": [
    "The LLM is too small",
    "Low retrieval recall — the relevant chunk isn't in the top-k, so the LLM has nothing correct to ground on",
    "The vector DB needs more replicas",
    "Latency is too low"
  ],
  "answer": 1,
  "explanation": "RAG answer quality is capped by retrieval. If the right chunk isn't retrieved (low recall — from bad chunking, weak embeddings, or too-aggressive ANN settings), the LLM hallucinates regardless of speed or availability."
}
```

```quiz
{
  "question": "A user searches for the exact error code 'ORA-00942' and pure vector search returns irrelevant results. What's the standard fix?",
  "options": [
    "Increase the embedding dimensions",
    "Add hybrid search — fuse vector results with a keyword/BM25 search that matches the exact token",
    "Lower ef_search to go faster",
    "Re-embed with a different model"
  ],
  "answer": 1,
  "explanation": "Embeddings are weak on near-arbitrary tokens like error codes/SKUs. BM25 matches them exactly; hybrid search fuses both (e.g. RRF) so identifiers and paraphrases both work."
}
```

```quiz
{
  "question": "You upgrade your embedding model from v1 to v2 for better quality. What must you do to the existing index?",
  "options": [
    "Nothing — vectors are interchangeable across models",
    "Just re-embed the queries at search time",
    "Re-embed the ENTIRE corpus with v2 and rebuild the index, because v1 and v2 vectors live in incompatible spaces",
    "Increase nprobe"
  ],
  "answer": 2,
  "explanation": "Each model defines its own coordinate space; distances between v1 and v2 vectors are meaningless. Changing models requires re-embedding everything and rebuilding (ideally a blue/green swap)."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "RAG + vector search — key terms",
  "cards": [
    { "front": "Embedding", "back": "A fixed-length vector (e.g. 768 floats) for a piece of text, placed so semantically similar text is geometrically close. Query and docs must use the SAME model." },
    { "front": "Chunking", "back": "Splitting docs into ~200–500-token retrieval units on semantic boundaries with small overlap. The highest-leverage knob for recall." },
    { "front": "ANN (HNSW / IVF)", "back": "Approximate nearest-neighbor index. HNSW = greedy graph walk (great recall, high memory); IVF = scan nearest k-means cells (cheaper, needs training). Both trade recall for latency." },
    { "front": "Recall vs latency", "back": "Search more of the index (higher ef_search/nprobe) → find more true neighbors but slower. The master trade-off of vector search." },
    { "front": "Hybrid search", "back": "Run vector + keyword/BM25 and fuse the ranks (e.g. RRF). Vectors catch paraphrases; BM25 catches exact tokens like codes/SKUs." },
    { "front": "Re-indexing / freshness", "back": "Keeping the derived index current: streaming upserts for live edits, tombstones for deletes, and blue/green full rebuilds for model upgrades." }
  ]
}
```

## Key takeaways

- RAG's quality is **capped by retrieval recall** — the LLM is the easy bought part; the system is a
  **search engine over a high-cardinality embedding space**.
- **Embeddings + chunking** decide what's *findable*; **ANN indexes (HNSW/IVF)** decide how *fast and
  complete* the search is — every speed knob (`ef_search`, `nprobe`, quantization) trades **recall for
  latency**.
- Use **hybrid search** (vectors + BM25, fused) so both paraphrased intent and exact identifiers work,
  and optionally a **re-ranker** before prompt assembly.
- The vector DB is a **derived index**: **shard** it (scatter-gather top-k), **replicate** it for HA
  and read scale, and treat **re-indexing/freshness** (streaming upserts, tombstones, blue/green model
  upgrades) as first-class.
- **Cache** query embeddings and answers to cut the dominant LLM cost; enforce **tenant filters**
  inside retrieval.

## Concepts exercised

This design applies, end to end: `database-sharding` (sharding the vector index by vector/tenant and
merging shard-local top-k via scatter-gather) · `replication-strategies` (replicating each shard for
HA and read throughput on the latency-critical read path) · `caching-patterns-overview` (read-through
caches for query embeddings, retrieval results, and LLM answers, with invalidation when chunks
change) · `high-cardinality-data` (millions of tenants/chunks as keys, and the big-tenant hot-partition
skew it creates) · `lambda-vs-kappa-architecture` (the split between a batch backfill/re-index path
and a streaming live-update path for freshness). It also leans on approximate-indexing (HNSW/IVF) and
information-retrieval fusion (BM25 + RRF) as the domain-specific machinery.
