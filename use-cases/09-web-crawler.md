---
title: "Design a Web Crawler + Search Index (Google)"
slug: web-crawler
level: use-cases
module: large-scale-systems
order: 9
reading_time_min: 20
concepts: [url-frontier, politeness, content-dedup, inverted-index, crawl-freshness, distributed-fetchers]
use_cases: [web-crawler]
prerequisites: [bloom-filters, message-queues, database-sharding, consistent-hashing, lsm-trees-and-compaction]
status: published
---

# Design a Web Crawler + Search Index (Google)

> **Use case:** continuously **crawl** the web — fetch pages, extract links, parse text — and build a
> **searchable inverted index** so a query like `distributed systems` returns relevant pages in tens
> of milliseconds.
> **Domain:** search engines (Google, Bing), web archives (Wayback Machine), price/SEO scrapers, and
> any system that mirrors a large external corpus.
> **Scale:** tens of **billions** of pages, **trillions** of links; fetch on the order of **tens of
> thousands of pages/sec** sustained, store petabytes, and keep the index **fresh** (news in minutes,
> the long tail in weeks).
> **Core challenges:** the **URL frontier** (what to fetch next, in what order), **politeness** (don't
> hammer a host; obey `robots.txt`), **dedup** (the same URL and the same content appear endlessly),
> **distributed fetchers/parsers**, the **inverted index** build, **freshness/recrawl**, and avoiding
> **crawler traps**.

A crawler is the canonical "firehose" system: a tiny seed of URLs explodes into a self-feeding graph
traversal that must run forever, be polite to strangers' servers, never get stuck, and feed a search
index that's queried by the world. Almost every hard distributed-systems theme shows up at once.

## 1 · Clarify requirements

**Functional**
- Start from a **seed set** of URLs; discover new URLs by **extracting links** from fetched pages.
- **Fetch** each page over HTTP, respecting `robots.txt` and crawl-delay (**politeness**).
- **Parse** pages: extract text + outlinks; **deduplicate** URLs and near-duplicate content.
- Build a queryable **inverted index** (term → list of pages) supporting boolean + ranked search.
- **Recrawl** pages periodically to keep the index **fresh**.

**Non-functional**
- **Massive throughput:** tens of thousands of pages/sec, scaling horizontally with worker count.
- **Politeness above all:** never overwhelm a host; one misbehaving crawler gets IP-banned and
  poisons everyone's data. This is a hard constraint, not a nice-to-have.
- **Robust & restartable:** the crawl runs for months; any node can die without losing or re-doing
  large amounts of work. The frontier must survive restarts.
- **Storage-efficient:** the web is mostly duplicates and junk; don't store or index the same content
  twice.

```reveal
{
  "prompt": "Why is 'politeness' (not raw speed) the constraint that shapes the whole architecture?",
  "answer": "A naive crawler that just fans out as fast as possible will send hundreds of concurrent requests to a single small web server, effectively DDoS-ing it. The operator notices, blocks your IP range, complains, and you lose access to that site (and damage the project's reputation — this is exactly how crawlers get the whole search engine banned). So a hard rule emerges: at most a small number of concurrent requests per host, with a delay between them, and obey each site's robots.txt and crawl-delay. The catch is that this rule operates per HOST while the work arrives as a flat stream of URLs from all over the web. You cannot simply put every URL in one big queue and have workers pull greedily, because two workers might grab two URLs for the same host and hit it simultaneously. The frontier therefore has to be organized BY host — typically a two-tier design where front queues impose priority/freshness ordering and back queues each map to a single host with its own next-allowed-fetch timestamp. That host-partitioned structure, plus a robots cache and per-host rate state, is dictated entirely by politeness. Speed then comes from crawling MANY hosts in parallel, not any one host fast."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Fetch rate to crawl the web on a schedule",
  "inputs": [
    { "key": "pages", "label": "Pages to (re)crawl", "default": 30000000000 },
    { "key": "days", "label": "Target crawl cycle (days)", "default": 30 }
  ],
  "formula": "Math.round(pages / (days * 86400))",
  "resultLabel": "Sustained fetch rate",
  "resultUnit": "pages/sec"
}
```

```calc
{
  "title": "Raw storage for fetched pages (compressed)",
  "inputs": [
    { "key": "pages", "label": "Pages stored", "default": 30000000000 },
    { "key": "kbPerPage", "label": "Avg compressed HTML (KB)", "default": 30 }
  ],
  "formula": "Math.round(pages * kbPerPage / 1e9)",
  "resultLabel": "Page store size",
  "resultUnit": "TB"
}
```

> To touch ~30B pages monthly you need on the order of **~11,500 pages/sec** sustained — so call it
> tens of thousands at peak with retries and recrawls. Compressed HTML alone is **~900 TB**; with the
> inverted index, link graph, and historical versions the real footprint is **petabytes**. Conclusion:
> everything is **sharded and distributed**, storage uses **append-friendly** formats, and we cannot
> afford to fetch, store, or index the same content twice — **dedup is a first-class requirement**.

## 3 · Components & interfaces

The crawler is a pipeline of services that pass work through queues. The key interfaces:

```
frontier.next() -> url            # politeness-respecting "what to fetch next"
frontier.add(urls, priority)      # enqueue newly discovered URLs (after dedup)
fetcher.fetch(url) -> { status, headers, body }
parser.parse(url, body) -> { text, outlinks, contentHash }
index.add(docId, terms)           # update the inverted index
search.query(terms) -> [docId...] # serve queries (separate read path)
```

The **write path** (crawl → index) and the **read path** (query → results) are decoupled: crawling
produces an index artifact; search serves a recently-built copy of it. This separation lets each side
scale and fail independently.

## 4 · High-level architecture

```flow
{
  "title": "Crawl-to-index pipeline",
  "nodes": [
    { "label": "Seed URLs", "detail": "Initial set (sitemaps, known sites) injected into the frontier." },
    { "label": "URL frontier", "detail": "Priority + politeness-ordered queue of URLs to fetch; sharded by host. Survives restarts." },
    { "label": "Fetchers", "detail": "Distributed workers: pull a URL, check robots cache + per-host delay, HTTP GET, store raw page." },
    { "label": "Page store", "detail": "Append-only blob store of compressed HTML keyed by URL hash; cheap and immutable." },
    { "label": "Parsers", "detail": "Extract text + outlinks; compute content fingerprint; normalize URLs." },
    { "label": "Dedup filters", "detail": "URL-seen Bloom filter + content-fingerprint check drop duplicates before re-enqueue/index." },
    { "label": "Indexer", "detail": "Tokenize text, build inverted index (term -> postings) via LSM-style merges." },
    { "label": "Search servers", "detail": "Read path: load index shards, answer queries with ranking." }
  ],
  "note": "New outlinks loop back into the frontier, so the whole thing is a self-feeding cycle: parse -> dedup -> frontier -> fetch -> parse."
}
```

**Storage & data-model choices:**
- **URL frontier:** durable, host-partitioned queues — built on a **message queue / log** so work
  survives restarts and back-pressures naturally. Partition (shard) **by host** via consistent
  hashing so each host's URLs land on one worker group.
- **Page store:** append-only blob store (think a distributed file system / object store) keyed by a
  hash of the normalized URL. Immutable versions; cheap sequential writes.
- **Dedup:** a giant **Bloom filter** for "have I seen this URL?" (memory-cheap, no false negatives)
  plus content fingerprints for "have I seen this content?".
- **Inverted index:** the classic search structure — for each term, a **posting list** of the
  document IDs that contain it (plus positions/frequencies for ranking). Built with **LSM-style**
  sorted segments that merge/compact in the background, exactly like a write-optimized store.

## 5 · Deep dive A — the URL frontier (BFS + priority + politeness)

The frontier is the brain. It answers one question on a loop: *what URL should a fetcher pull next?*
Three forces pull on the answer.

```compare
{
  "options": [
    { "label": "Pure BFS queue", "points": ["FIFO from seeds outward", "Naturally finds high-value pages near seeds first", "No notion of importance or politeness", "Workers can collide on the same host"] },
    { "label": "Priority frontier", "points": ["Score URLs (PageRank-ish, freshness, depth)", "Crawl important/changing pages sooner", "Needs a priority queue per shard", "Still must layer politeness on top"] },
    { "label": "Two-tier frontier", "points": ["Front queues = priority/order; back queues = one per host", "Back queue holds a host's next-fetch time", "Decouples WHAT to crawl from WHEN politeness allows it", "The standard production design"] }
  ]
}
```

The production answer is the **two-tier frontier**. **Front queues** order URLs by priority (a blend
of estimated importance, freshness need, and crawl depth — roughly BFS but weighted). A router then
assigns each URL to a **back queue**, where there is exactly one back queue **per host**. Each back
queue carries a **next-allowed-fetch timestamp**. A fetcher only pulls from a back queue whose timer
has elapsed, so two fetchers can never hit the same host at once and the per-host delay is enforced
structurally.

```sequence
{
  "title": "A fetch, politely",
  "actors": ["Fetcher", "Frontier", "RobotsCache", "WebServer", "Parser"],
  "steps": [
    { "from": "Fetcher", "to": "Frontier", "label": "next() -> URL whose host timer elapsed" },
    { "from": "Fetcher", "to": "RobotsCache", "label": "is host/path allowed? crawl-delay?" },
    { "from": "RobotsCache", "to": "Fetcher", "label": "allowed, delay=10s" },
    { "from": "Fetcher", "to": "WebServer", "label": "HTTP GET (one conn per host)" },
    { "from": "WebServer", "to": "Fetcher", "label": "200 + HTML" },
    { "from": "Fetcher", "to": "Frontier", "label": "set host next-fetch = now + delay" },
    { "from": "Fetcher", "to": "Parser", "label": "hand off page for parse + link extraction" }
  ]
}
```

```reveal
{
  "prompt": "Why partition the frontier by host rather than spreading a host's URLs across all workers?",
  "answer": "Politeness is a per-host invariant: at most a small number of concurrent connections to one host, with a crawl-delay between requests. If a single host's URLs were scattered across all fetcher workers, enforcing 'one request to this host every 10 seconds' would require global coordination — every worker checking a shared, hot, constantly-updated per-host timer before each fetch, which is a synchronization nightmare and a bottleneck. Instead, route all of a host's URLs to ONE back queue owned by ONE worker (assign hosts to workers via consistent hashing so the mapping is stable and rebalances cheaply when workers join/leave). Now the per-host rate state lives locally with the single owner of that host: that worker just keeps a next-allowed-fetch timestamp per back queue and sleeps until it elapses. No cross-worker coordination is needed for politeness — it's enforced by the partitioning itself. The trade-off is balance: hosts vary wildly in size (one giant site vs millions of tiny ones), so you assign MANY hosts per worker and may split a huge host's load carefully, but the principle holds — co-locate a host's work so its rate limit is a local decision."
}
```

Tune how aggressively the frontier prioritizes:

```tradeoff
{
  "title": "How should the frontier order URLs?",
  "axis": { "left": "Pure breadth (simple, fair)", "right": "Heavily prioritized (smart, complex)" },
  "steps": [
    { "label": "Plain BFS", "detail": "FIFO from seeds. Simple and gives broad coverage, but wastes capacity re-crawling junk and is slow to reach important deep pages." },
    { "label": "BFS + depth cap", "detail": "Breadth-first but stop following links past a depth limit. Cheap defense against infinite link chains; still ignores page importance." },
    { "label": "Priority by importance", "detail": "Score URLs by estimated rank (inlinks, host reputation) and crawl high-value pages first. Better index quality; needs a priority queue and scoring." },
    { "label": "Priority + freshness", "detail": "Add a recrawl signal so frequently-changing important pages (news) jump the queue. Best index freshness; most moving parts." }
  ]
}
```

## 5 · Deep dive B — dedup: URLs and content

The web is overwhelmingly redundant. Two distinct dedup problems:

**1. URL-seen dedup.** Before adding a discovered URL to the frontier, ask "have I already enqueued
this?" With tens of billions of URLs, a hash set in memory is impossibly large. Use a **Bloom
filter**: a probabilistic set that says "definitely never seen" or "probably seen" using a few bits
per URL. It can produce **false positives** (rarely skip a genuinely new URL) but **never false
negatives** (never re-crawl something it claims is new), which is the safe direction — occasionally
missing a page is far cheaper than infinite re-crawling. First, **normalize** the URL (lowercase host,
strip default ports, sort/strip tracking query params, resolve `.`/`..`) so trivially different
strings for the same page collapse to one key.

**2. Content dedup.** Different URLs often serve identical or near-identical content (mirrors, session
IDs in the path, printer-friendly pages). Compute a **content fingerprint**: a cryptographic hash
(e.g. SHA-256) of the normalized text catches **exact** duplicates; a **SimHash** or **MinHash**
(fingerprints that stay close when documents are only slightly different) catches **near**-duplicates.
SimHash maps a document to a 64-bit value where similar documents differ in only a few bits, so you
detect "almost the same page" with a cheap bit-distance check. Drop duplicates before indexing so the
index and storage stay lean.

```reveal
{
  "prompt": "Why is a Bloom filter's one-sided error (false positives, never false negatives) exactly the right trade-off for URL-seen dedup?",
  "answer": "A Bloom filter trades a small, bounded false-positive rate for enormous memory savings: a few bits per element instead of storing whole URLs, so billions of URLs fit in RAM that a real hash set never could. Its errors are one-sided — it may say 'probably seen' for a URL it has actually never seen (false positive), but it will NEVER say 'not seen' for one it has seen (no false negatives). Map those to crawler outcomes: a false positive means you skip enqueuing a genuinely new URL — you miss one page, which on a web of tens of billions is negligible and often reachable via another link anyway. A false negative, which CANNOT happen, would mean re-enqueuing a URL you've already crawled — and since crawling discovers more links that get checked again, false negatives would risk loops and unbounded re-crawl work. So the filter errs only in the cheap, self-correcting direction (occasionally under-crawl) and never in the expensive, runaway direction (re-crawl forever). You tune the bit-array size and number of hash functions to keep the false-positive rate low (say <1%), accepting that tiny coverage loss in exchange for fitting the seen-set in memory. That asymmetry is the whole reason Bloom filters are a staple of crawlers."
}
```

## 5 · Deep dive C — building the inverted index

Search needs the opposite of a page store. Given a page you have its words; given a **word** you need
its pages. The **inverted index** maps each term to a **posting list**: the document IDs containing
that term, with per-doc data (term frequency, positions) used for ranking.

Building it at web scale is a write-heavy, sort-and-merge job — the same shape as a write-optimized
storage engine:
- **Parsers tokenize** each page (split into terms, lowercase, optionally stem) and emit
  `(term, docId, freq, positions)` records.
- These stream into the indexer, which writes small **sorted segments** to disk, then **merges and
  compacts** them in the background into larger sorted index files — an **LSM**-style design (recall
  log-structured merge trees and compaction). Writes are sequential and cheap; reads hit a few merged
  segments.
- The index is **sharded by term** (or by document, in a document-partitioned design) across many
  search servers so any single query fans out to shards and merges results.

```compare
{
  "options": [
    { "label": "Term-partitioned index", "points": ["Each shard owns a subset of TERMS (whole posting lists)", "A query for term T hits one shard for that term", "Multi-term queries fan out to several shards", "Hot terms ('the') create skew/hot shards"] },
    { "label": "Document-partitioned index", "points": ["Each shard owns a subset of DOCS, indexes all their terms", "Every query hits EVERY shard, then merges", "Load is even; scales by adding shards", "More network fan-out per query (the common choice at scale)"] }
  ]
}
```

```reveal
{
  "prompt": "Why build the inverted index with LSM-style sorted segments and background compaction instead of updating one big index in place?",
  "answer": "Index building is massively write-heavy: parsers continuously emit billions of (term, docId) postings, and updating a single large on-disk index in place would mean random writes scattered across a huge file — slow on disk, and contended because new postings for a term must be inserted into the middle of that term's posting list. The LSM pattern sidesteps this exactly as it does for write-optimized databases: buffer incoming postings in memory, then flush them as an immutable, SORTED segment with sequential writes (fast). Many small sorted segments accumulate, and a background COMPACTION process merges them into fewer, larger sorted segments — again purely sequential I/O. Queries read by merging across the current set of segments. This gives you high sustained write throughput (sequential, append-only), no in-place mutation hazards, and naturally immutable index files that are trivial to replicate and serve read-only on search nodes. The cost is read amplification (a query may touch several segments until they compact) and the background CPU/IO of compaction — the same trade-offs LSM trees make, which is why the search index and a write-optimized key-value store share the same architecture."
}
```

## 5 · Deep dive D — freshness, recrawl, and traps

**Freshness/recrawl.** A page crawled once goes stale. Recrawl frequency should match **how often a
page actually changes** and **how important it is**: a news homepage recrawled every few minutes, a
static reference page every few weeks. Estimate change rate from observed history (did the content
fingerprint change between crawls?) and feed an **importance × staleness** score back into the
frontier's priority. This makes the frontier a perpetual mix of *new* URLs and *due-for-recrawl*
URLs.

**Trap avoidance.** Some sites (accidentally or maliciously) generate **infinite** URL spaces — a
calendar with a "next month" link forever, faceted-search filters in every combination, or session
IDs that make every URL unique. A crawler that follows blindly gets stuck spending all its budget on
one trap. Defenses: a **depth/URL-count budget per host**, **URL normalization** (strip session IDs
and known infinite-pagination params), **content dedup** (if the "new" pages are near-identical,
stop), and **per-host crawl quotas** so no single site can monopolize fetchers.

## 6 · Trade-offs & failure modes

- **Politeness vs throughput.** Strict per-host limits cap how fast you can crawl any one site; total
  throughput comes from **many hosts in parallel**. A few giant sites can still bottleneck their own
  coverage — mitigate with negotiated higher rates or sitemap-driven crawling.
- **Frontier is the critical state.** If it's lost, you forget what to crawl next. Back it with a
  **durable, replicated queue/log** so a worker crash just means another worker resumes its
  partition (recall message-queue durability and consumer groups).
- **Bloom filter false positives** silently drop new URLs; size the filter for an acceptable rate and
  shard it as the seen-set grows.
- **Hot shards.** Term-partitioned indexes get hammered on common words; document-partitioning
  spreads load but fans every query out. Page-store and frontier shards skew toward giant hosts —
  rebalance via consistent hashing.
- **Read/write decoupling.** Search serves a periodically rebuilt index snapshot; there's an inherent
  **lag** between crawling a page and it appearing in results. Acceptable, and tunable per priority.
- **Getting banned.** A bug that ignores `robots.txt` or floods a host can blacklist your IP ranges —
  an operational, not just technical, failure. Conservative defaults and a global per-host governor
  are the safety net.

## 7 · Scaling & evolution

- **Add fetcher/parser workers horizontally**; the host-partitioned frontier rebalances via consistent
  hashing as workers join/leave, so capacity scales near-linearly with hosts crawled.
- **Geo-distribute fetchers** near the sites they crawl to cut latency and respect regional content.
- **Incremental indexing:** instead of periodic full rebuilds, stream updates into the LSM index so
  freshness lag shrinks toward real-time for high-priority pages.
- **Smarter priority:** learn change-rate and importance models so the frontier spends its finite
  budget where it matters (this is much of what separates a good crawler from a naive one).
- **JS rendering tier:** modern pages render content with JavaScript, so add a headless-browser
  rendering stage for pages whose raw HTML is empty — expensive, so reserve it for pages that need it.

## Self-test

```quiz
{
  "question": "Why is the URL frontier partitioned by host (all of a host's URLs routed to one back queue / worker)?",
  "options": [
    "To make the index smaller",
    "So per-host politeness (rate limit / crawl-delay) is a LOCAL decision needing no cross-worker coordination",
    "Because hosts are alphabetical",
    "To avoid using Bloom filters"
  ],
  "answer": 1,
  "explanation": "Politeness is a per-host invariant. Co-locating a host's URLs on one owner lets that worker keep a local next-fetch timer instead of all workers contending on shared per-host state."
}
```

```quiz
{
  "question": "A Bloom filter is used for URL-seen dedup. What is the consequence of its error profile?",
  "options": [
    "It may re-crawl already-seen URLs forever (false negatives)",
    "It may occasionally skip a genuinely new URL (false positive), but never re-enqueues a seen one",
    "It stores every URL exactly, using huge memory",
    "It guarantees zero errors"
  ],
  "answer": 1,
  "explanation": "Bloom filters have false positives but no false negatives. The error direction is safe: occasionally miss a new page (cheap) rather than loop re-crawling (expensive)."
}
```

```quiz
{
  "question": "Why is the inverted index built with LSM-style sorted segments plus background compaction?",
  "options": [
    "To allow random in-place edits to posting lists",
    "Because indexing is write-heavy; sequential immutable segment writes + background merges give high write throughput and easy read-only replication",
    "To avoid sharding the index",
    "Because terms must be stored unsorted"
  ],
  "answer": 1,
  "explanation": "Billions of postings stream in; buffering and flushing sorted immutable segments (sequential writes) then compacting them avoids slow random in-place updates — the same trade-off LSM trees make."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "Web crawler + search index — key terms",
  "cards": [
    { "front": "URL frontier (two-tier)", "back": "The to-fetch queue. Front queues order by priority/freshness (BFS-ish); back queues = one per host with a next-fetch timer, enforcing politeness structurally." },
    { "front": "Politeness", "back": "Limit concurrent connections + delay per host and obey robots.txt/crawl-delay. The hard constraint that shapes the architecture; violating it gets you IP-banned." },
    { "front": "URL-seen Bloom filter", "back": "Probabilistic set answering 'enqueued this URL before?' in a few bits each. False positives (rarely skip new) but no false negatives (never re-crawl) — the safe direction." },
    { "front": "Content fingerprint", "back": "Hash of page text. SHA-256 catches exact duplicates; SimHash/MinHash catch near-duplicates so mirrors and session-id pages aren't indexed twice." },
    { "front": "Inverted index", "back": "term -> posting list of doc IDs (with freq/positions). Built LSM-style: sorted immutable segments merged by background compaction; sharded by term or by document." },
    { "front": "Crawler trap", "back": "An infinite/auto-generated URL space (endless calendar, faceted filters, session IDs). Defend with depth budgets, URL normalization, content dedup, and per-host quotas." }
  ]
}
```

## Key takeaways

- A crawler is a **self-feeding graph traversal**: seeds → fetch → parse → extract links → dedup →
  frontier → fetch. The **frontier** is the brain and the critical durable state.
- **Politeness, not speed, dictates the design.** Partition the frontier **by host** (two-tier: front
  priority queues + per-host back queues with timers) so rate limits are enforced locally, and crawl
  many hosts in parallel for throughput.
- **Dedup twice:** a **Bloom filter** for seen URLs (cheap, one-sided error) and **content
  fingerprints** (SHA-256 for exact, SimHash for near-duplicates) so you never store or index the same
  content twice.
- The **inverted index** is built like a write-optimized store — **LSM** sorted segments + background
  **compaction**, **sharded** across search servers — and served on a **decoupled read path** with
  inherent freshness lag.
- Keep it **fresh** with importance×change-rate recrawl scoring, and **safe** with depth budgets,
  normalization, and per-host quotas to escape **traps**.

## Concepts exercised

This design applies, end to end: `bloom-filters` (URL-seen dedup with a safe one-sided error) ·
`message-queues` (the durable, restartable URL frontier and the parser/indexer handoffs, with
consumer-group-style work distribution) · `database-sharding` (frontier, page store, and inverted
index all partitioned to spread load) · `consistent-hashing` (stable host→worker and key→shard
assignment that rebalances cheaply as workers join/leave) · `lsm-trees-and-compaction` (building the
inverted index from sorted immutable segments merged in the background). It also touches
`rate-limiting` (per-host politeness governors), caching (`robots.txt` cache), and read/write-path
decoupling between crawling and search serving.
