---
title: "Design an LLM Inference Serving System (ChatGPT backend)"
slug: llm-inference-serving
level: use-cases
module: ai-systems
order: 19
reading_time_min: 20
concepts: [gpu-serving, continuous-batching, kv-cache, token-streaming, autoscaling, multi-tenant-fairness]
use_cases: [llm-inference-serving]
prerequisites: [realtime-communication, backpressure-and-load-shedding, load-balancing, rate-limiting]
status: published
---

# Design an LLM Inference Serving System (ChatGPT backend)

> **Use case:** serve large-language-model completions at scale — a user sends a prompt, the system
> runs the model on a GPU and **streams the answer back token by token** with bounded latency.
> **Domain:** ChatGPT, Claude, Gemini, Copilot, and every "chat with an AI" or LLM-API product.
> **Scale:** hundreds of thousands of concurrent chats; each request occupies a **scarce, expensive
> GPU** for seconds; users expect the **first word in under a second** and a steady stream after.
> **Core challenges:** the unit of work is a **GPU**, not a CPU thread; squeezing throughput out of
> GPUs with **continuous batching**; managing the **KV-cache** (prefill vs decode); **streaming**
> tokens to clients; **autoscaling a scarce resource**; **fairness across tenants**; and **timeouts /
> backpressure** when GPUs are full.

A web service scales by adding cheap CPU boxes. An LLM service can't: the work runs on a GPU that
costs more per hour than a developer, you can't buy them on demand, and a single request holds one
for *seconds*. That inverts every assumption — the whole design is about keeping a fixed pool of
GPUs **busy but not overloaded**.

## 1 · Clarify requirements

**Functional**
- Accept a **prompt** (plus history, system prompt, sampling params like temperature) and return a
  **completion**.
- **Stream** the output token-by-token as it's generated, not one big response at the end.
- Support **multiple models** (small/fast vs large/smart) and **multiple tenants** (free vs paid).
- Enforce **per-user/per-tenant rate limits** measured in **tokens**, not just requests.

**Non-functional**
- **Bounded latency, two numbers:** **TTFT** (time-to-first-token, target < ~1 s) and **TPOT**
  (time-per-output-token / inter-token latency, target ~10–50 ms so text streams faster than you
  read).
- **High GPU utilization** — GPUs are the cost; idle GPU time is money burned.
- **Multi-tenant fairness** — one heavy user must not starve everyone else.
- **Graceful overload** — when GPUs are saturated, **shed or queue** cleanly, never melt down.

```reveal
{
  "prompt": "Why is 'the unit of work is a GPU, not a CPU request' the requirement that reshapes this whole design, compared to a normal stateless web service?",
  "answer": "A normal request-serving system assumes work is cheap, short, and horizontally infinite: each request takes a few milliseconds of a CPU you can clone on demand, so you scale by adding stateless boxes behind a load balancer and the hard problems are databases and caches. LLM serving breaks every one of those assumptions. The compute is a GPU (or a slice of one), which is 10–100x more expensive than a CPU core and genuinely scarce — you often cannot get more on demand because the whole cloud is short on them. A single request is long-lived: generating a 500-token answer is 500 sequential forward passes that take several seconds, during which that request is *resident* on the GPU holding memory (its KV-cache). And the work is autoregressive and memory-bound, so naive one-request-per-GPU serving wastes ~90% of the hardware. That means you can't just 'add more servers' to fix latency, you can't treat requests as independent and disposable, and you can't ignore per-request memory. The entire architecture — continuous batching, KV-cache management, token-based fairness, careful backpressure — exists to extract maximum useful work from a fixed, expensive, stateful pool of GPUs. The GPU, not the request, is the resource you schedule."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "GPUs needed for steady-state decode load",
  "inputs": [
    { "key": "users", "label": "Concurrent active generations", "default": 100000 },
    { "key": "tps", "label": "Tokens/sec a user needs (stream speed)", "default": 20 },
    { "key": "gpuTps", "label": "Tokens/sec one GPU sustains (batched)", "default": 2500 }
  ],
  "formula": "Math.ceil((users * tps) / gpuTps)",
  "resultLabel": "GPUs required (decode only)",
  "resultUnit": "GPUs"
}
```

```calc
{
  "title": "KV-cache memory per active request",
  "inputs": [
    { "key": "ctxTokens", "label": "Tokens in context (prompt + output)", "default": 4000 },
    { "key": "layers", "label": "Transformer layers", "default": 80 },
    { "key": "kvBytesPerTokenPerLayer", "label": "Bytes/token/layer (K+V, fp16)", "default": 2048 }
  ],
  "formula": "ctxTokens * layers * kvBytesPerTokenPerLayer",
  "resultLabel": "KV-cache for one request",
  "resultUnit": "bytes"
}
```

> 100k concurrent streams at 20 tok/s is ~2M tokens/sec; at ~2,500 batched tokens/sec/GPU that's
> **~800 GPUs just for decode**. And **each in-flight request holds ~0.5–1 GB of KV-cache** — so an
> 80 GB GPU fits only **dozens** of simultaneous sequences. **GPU memory, not compute, is usually the
> binding constraint**, and it's why batching and KV-cache management dominate the design.

## 3 · API & where it sits

The serving layer sits behind an API gateway that does **auth, token-based rate limiting, and
routing to the right model pool** (recall the gateway's cross-cutting role). The core operation is a
**streaming** call:

```
POST /v1/chat/completions   { model, messages, max_tokens, temperature, stream: true }
  -> Server-Sent Events stream:
     data: {"delta":"Hello"}
     data: {"delta":" there"}
     ...
     data: [DONE]
```

The response is **half-duplex streaming**: the client sends one request, the server pushes a stream
of token chunks. That's a natural fit for **Server-Sent Events (SSE)** — a long-lived HTTP response
the server writes to incrementally (recall realtime communication: SSE is the simplest server→client
push, websockets only needed for full bidirectional). Each chunk is one or a few tokens.

## 4 · High-level architecture

```flow
{
  "title": "Request path: gateway → queue → GPU worker → stream back",
  "nodes": [
    { "label": "Client", "detail": "Opens an SSE/HTTP stream, sends prompt + sampling params." },
    { "label": "API gateway", "detail": "Auth, token-based rate limit, pick model pool, attach priority/tenant." },
    { "label": "Scheduler / queue", "detail": "Per-model request queue; admission control + backpressure when GPUs are full." },
    { "label": "Inference worker (GPU)", "detail": "Runs the model; continuous batching engine (e.g. vLLM/TensorRT-LLM); owns the KV-cache." },
    { "label": "Token stream", "detail": "Each decode step emits tokens; pushed back through the gateway to the client as SSE chunks." }
  ],
  "note": "The scheduler/queue is the heart: it decides which requests join the running batch on each GPU, and what happens when there's no room."
}
```

- **Stateless gateway**, scaled like any web tier (load-balanced CPU boxes).
- **Stateful GPU workers**: a worker holds models in GPU memory and the live KV-caches of its
  in-flight requests. A request is **pinned to one worker** for its whole generation (its KV-cache
  lives there) — closer to a stateful session than a stateless request.
- **No database on the hot path.** State is the model weights (loaded once) and per-request KV-cache
  (lives in GPU memory for the request's lifetime, then freed). Conversation history is re-sent by
  the client (or fetched from a store) and re-encoded each turn.
- **Model routing:** a small router can send easy prompts to a cheap small model and hard ones to a
  big model, but the baseline is one pool per model.

## 5 · Deep dive A: continuous batching, prefill vs decode

A GPU is a throughput machine: it's only efficient when doing **big matrix multiplies in parallel**.
Running one request at a time leaves it ~90% idle. So we **batch** many requests into one forward
pass. But LLM generation is **autoregressive** — you produce one token, append it, and feed the whole
thing back to produce the next — so requests finish at different times and have different lengths.

A request has two phases:
- **Prefill:** process the entire input prompt in **one** parallel forward pass. Compute-heavy,
  fast, produces the KV-cache for the prompt. This determines **TTFT**.
- **Decode:** generate output tokens **one at a time**, each a tiny forward pass reusing the cache.
  Memory-bandwidth-bound and slow per token. This determines **TPOT** and dominates total time.

**Static batching** (collect N requests, run them together to completion) wastes the GPU: short
answers finish early and their slot sits idle until the longest one is done. **Continuous (dynamic)
batching** fixes this — *explained inline:* the engine forms a batch **per decode step**, and the
moment any sequence finishes, its slot is freed and a **waiting request is admitted mid-flight**.
Requests join and leave the running batch continuously instead of waiting for a whole batch to drain.
This is the single biggest throughput win in modern serving (vLLM, TensorRT-LLM).

```compare
{
  "options": [
    { "label": "One request per GPU", "points": ["Simplest", "GPU ~10% utilized — most cost wasted", "Lowest latency for that one request", "Unaffordable at scale"] },
    { "label": "Static batching", "points": ["Wait for N requests, run as a block", "Better utilization than 1-at-a-time", "Head-of-line blocking: fast requests wait for the slowest", "Idle slots as sequences finish early"] },
    { "label": "Continuous batching", "points": ["Batch re-formed every decode step", "Finished sequence frees its slot instantly; new request admitted mid-batch", "Near-max throughput + low queueing", "The production standard (vLLM, TGI, TensorRT-LLM)"] }
  ]
}
```

Drag the dial — bigger batches buy throughput but cost per-token latency:

```tradeoff
{
  "title": "How aggressively should the scheduler batch?",
  "axis": { "left": "Low latency / small batch", "right": "High throughput / big batch" },
  "steps": [
    { "label": "Small batch", "detail": "Few sequences per step → each token returns fast (low TPOT) but the GPU is underused, so cost/token is high and you serve fewer users per GPU." },
    { "label": "Balanced", "detail": "Fill the GPU until added latency is still within TPOT target. Continuous batching keeps utilization high without big queueing delays — the usual operating point." },
    { "label": "Large batch", "detail": "Pack the GPU to the memory limit → best tokens/sec/GPU (lowest cost) but each step is slower, so TPOT rises and streams feel sluggish." },
    { "label": "Prefill-heavy mix", "detail": "A burst of long prompts hogs compute on prefill, stalling decode for everyone (TTFT and TPOT both spike). Chunked prefill interleaves prefill with decode to smooth this." }
  ]
}
```

```reveal
{
  "prompt": "Why split a request into 'prefill' and 'decode', and why does decode end up dominating both cost and latency?",
  "answer": "The two phases have completely different performance profiles, so engines schedule them separately. Prefill processes the entire prompt at once: every prompt token can be computed in parallel in a single forward pass, which is compute-bound and saturates the GPU's matrix units efficiently — a 1,000-token prompt is roughly one big batched matmul. It produces the KV-cache (the stored key/value tensors for every prompt token) and yields the first output token, so it sets TTFT. Decode is the opposite: generation is autoregressive — token N+1 depends on token N — so you must run one forward pass per output token, sequentially, and each pass only processes a single new token while reading back the entire growing KV-cache from GPU memory. That makes decode memory-bandwidth-bound and badly underutilizes compute, so it's slow per token. Because a typical answer is hundreds of tokens, you do hundreds of these slow sequential decode steps versus one prefill, so decode dominates total wall-clock time and total GPU-seconds — which is exactly why throughput tricks target decode: continuous batching shares each decode step across many requests so the memory-bandwidth cost is amortized, and the KV-cache exists precisely so decode doesn't recompute attention over the whole prefix every step. Understanding the split also explains failure modes: a flood of long prompts spends GPU time on prefill and stalls everyone's decode, which is why systems use chunked prefill to interleave the two."
}
```

## 5 · Deep dive B: the KV-cache (why memory is the limit)

Each transformer layer, for each token, computes **key** and **value** vectors used by attention. In
decode, every new token must attend to **all previous tokens** — so instead of recomputing those K/V
vectors every step (O(n²) work), the engine **caches them**: the **KV-cache**. *Explained inline:*
it's the stored key/value tensors for every token seen so far, kept in GPU memory so each decode step
is cheap. The cost: KV-cache grows **linearly with context length × layers × model width**, and it
**lives in GPU memory for the whole request**. That's why an 80 GB GPU holds only dozens of
simultaneous long-context requests — **KV-cache, not weights, is what runs you out of memory**.

Two key techniques (both inline):
- **PagedAttention:** treat KV-cache like virtual memory — allocate it in fixed-size **pages** instead
  of one big contiguous block per request, so memory isn't fragmented and you can pack far more
  concurrent sequences (vLLM's core idea).
- **Prefix caching:** identical prompt prefixes (e.g. a shared long system prompt) can **share** the
  same cached K/V pages across requests, so prefill is skipped for the shared part — big win for chat
  with a fixed system prompt.

```sequence
{
  "title": "One streamed completion through a GPU worker",
  "actors": ["Client", "Gateway", "Scheduler", "GpuWorker"],
  "steps": [
    { "from": "Client", "to": "Gateway", "label": "POST /chat (stream=true)" },
    { "from": "Gateway", "to": "Scheduler", "label": "auth + token-rate check; enqueue (tenant, priority)" },
    { "from": "Scheduler", "to": "GpuWorker", "label": "admit when KV-cache memory free; run PREFILL" },
    { "from": "GpuWorker", "to": "Client", "label": "first token (TTFT) via SSE" },
    { "from": "GpuWorker", "to": "GpuWorker", "label": "DECODE step (joins continuous batch each step)" },
    { "from": "GpuWorker", "to": "Client", "label": "stream tokens (TPOT each) until EOS / max_tokens" },
    { "from": "GpuWorker", "to": "Scheduler", "label": "sequence done → free KV-cache slot for next waiter" }
  ]
}
```

## 5 · Deep dive C: streaming, fairness, and backpressure

**Streaming.** The whole UX depends on showing tokens as they're generated. The worker emits each
token; it's forwarded through the gateway to the client over the **same open SSE stream**. The gateway
must **not buffer** the full response — it pipes chunks through. If the **client is slow** to read,
TCP backpressure builds; the server should cap how far ahead it generates so a slow client can't make
a request hold a GPU slot indefinitely. If the connection drops, **stop generating immediately** and
free the KV-cache (a half-read answer still costs GPU-seconds).

**Multi-tenant fairness & rate limits.** Limits are in **tokens**, not requests — a request can be 10
tokens or 100k tokens, so "100 requests/min" is meaningless. Enforce **tokens-per-minute (TPM)** and
**requests-per-minute (RPM)** per tenant (recall rate limiting / token bucket — here the "tokens" are
literally model tokens). The scheduler then does **fair queuing** across tenants so one user's giant
batch job doesn't starve interactive chats — typically **separate priority lanes** (interactive >
batch) and weighted fair-share per tenant.

**Backpressure & timeouts.** GPUs are finite and can't be conjured, so overload is inevitable. Options
when the queue is full (recall backpressure & load shedding):
- **Admission control / load shed:** reject new requests early with **429** + `Retry-After` rather
  than accepting work that will time out anyway (cheap reject beats slow failure).
- **Queue with a deadline:** hold briefly, but drop requests whose **TTFT budget** is already blown.
- **Priority preemption:** pause/evict a low-priority (batch) sequence to admit interactive traffic —
  modern engines can **swap a sequence's KV-cache out** (to CPU/host memory) and resume it later.

```reveal
{
  "prompt": "Why are LLM rate limits and fairness measured in tokens rather than requests, and what breaks if you limit by request count?",
  "answer": "Because the cost and resource footprint of an LLM request varies by orders of magnitude depending on its token counts, while a 'request' is a meaningless unit of work. One request might be a 5-token 'hi' that finishes in a fraction of a second; another might be a 100,000-token document summarization that occupies a GPU for a minute and holds gigabytes of KV-cache the entire time. If you rate-limit by requests-per-minute, a tenant can send a handful of enormous requests and consume nearly all the GPU capacity while technically staying 'under their request limit,' starving everyone else — and conversely a tenant sending many tiny requests gets throttled despite using almost no compute. So providers meter the actual resource: tokens. They enforce tokens-per-minute (covering both input/prefill tokens and output/decode tokens, sometimes weighted differently because decode is more expensive per token) alongside a requests-per-minute cap to bound concurrency. The scheduler likewise allocates GPU time by token throughput, doing weighted fair queuing across tenants so each gets a fair share of tokens/sec rather than a fair share of request slots. Limiting by request count breaks fairness, breaks capacity planning (you can't predict GPU load from request count), and lets a few heavyweight requests blow your latency SLOs for everyone."
}
```

## 6 · Trade-offs & failure modes

- **Throughput vs latency** is the master trade-off: bigger batches and longer queues raise
  tokens/sec/GPU (lower cost) but worsen TTFT/TPOT. You tune to the latency SLO, not to max throughput.
- **GPU memory is the cliff.** Admit one request too many and the KV-cache OOMs; the engine must
  **evict or preempt** rather than crash. Long contexts are the danger — they consume cache fast.
- **Prefill stalls decode.** A burst of long prompts spends GPU cycles on prefill, freezing everyone's
  streams. **Chunked prefill** (interleave prefill chunks with decode steps) smooths it.
- **Slow/abandoned clients** can pin GPU slots; cap generation lookahead and cancel on disconnect.
- **Stateful workers** mean a worker crash kills its in-flight generations (their KV-cache is gone) —
  requests must be **retried** from the start; idempotency/replay matters for non-chat use.
- **The scarce-resource SPOF**: you literally cannot autoscale past your GPU quota. Capacity is
  planned, not elastic — overload handling is the safety valve, not "add more nodes."

```tradeoff
{
  "title": "When all GPUs are saturated, the system should…",
  "axis": { "left": "Protect latency (shed)", "right": "Maximize acceptance (queue)" },
  "steps": [
    { "label": "Load shed (429)", "detail": "Reject new requests immediately with Retry-After. Keeps admitted requests fast and honest; the cost is visible failures. Best for interactive traffic with tight SLOs." },
    { "label": "Bounded queue", "detail": "Hold requests briefly with a deadline; drop any whose TTFT budget is already exceeded. Smooths short bursts without letting the queue grow unbounded." },
    { "label": "Preempt + swap", "detail": "Evict low-priority (batch) sequences — swap their KV-cache to host memory — to admit interactive ones, resuming the batch work later. Best utilization, most complexity." }
  ]
}
```

## 7 · Scaling & evolution

- **Autoscaling scarce GPUs:** scale on **queue depth / TTFT**, not CPU. Scale-up is **slow** (acquire
  a GPU node, load tens of GB of weights → minutes), so keep **warm pools** and scale **ahead** of
  demand. Use cheaper **spot/preemptible** GPUs for batch lanes, reserved for interactive.
- **Model parallelism for giant models:** a model too big for one GPU is split — **tensor parallelism**
  (shard each layer across GPUs in a node, joined by fast NVLink) and **pipeline parallelism** (put
  different layers on different nodes). Bigger models = more GPUs *per replica*.
- **Disaggregated prefill/decode:** run prefill on one GPU pool and decode on another, since they have
  opposite resource profiles — lets each be tuned and scaled independently (emerging practice).
- **Quantization & distillation:** serve **int8/fp8** or smaller distilled models to cut memory and
  raise throughput where quality allows; route easy prompts to the cheap model.
- **Caching layers:** prefix caching for shared system prompts; an **exact/semantic response cache**
  for repeated prompts to skip the GPU entirely.
- **Speculative decoding:** a small draft model proposes several tokens that the big model verifies in
  one pass — more tokens per step, lower TPOT.

## Self-test

```quiz
{
  "question": "Why does continuous (dynamic) batching beat static batching for LLM serving?",
  "options": [
    "It uses less GPU memory per request",
    "It re-forms the batch every decode step, so a finished sequence frees its slot immediately and a waiting request is admitted mid-flight — no head-of-line blocking",
    "It avoids the KV-cache entirely",
    "It runs each request on its own GPU"
  ],
  "answer": 1,
  "explanation": "Static batching makes fast requests wait for the slowest in the block, leaving slots idle. Continuous batching admits/retires sequences per step, keeping the GPU full."
}
```

```quiz
{
  "question": "On a GPU with the model loaded, what is most often the binding limit on how many requests you can serve concurrently?",
  "options": [
    "Network bandwidth to the client",
    "CPU cores on the host",
    "GPU memory consumed by each request's KV-cache",
    "Disk IOPS"
  ],
  "answer": 2,
  "explanation": "Each in-flight request holds a KV-cache that grows with context length; it lives in GPU memory for the whole generation, so memory — not compute — usually caps concurrency."
}
```

```quiz
{
  "question": "Why do LLM APIs rate-limit by tokens-per-minute rather than requests-per-minute?",
  "options": [
    "Tokens are easier to count",
    "A single request can range from a few tokens to 100k+ tokens, so request count doesn't reflect actual GPU cost — token metering does, and it preserves fairness",
    "Requests don't matter for billing",
    "It makes streaming faster"
  ],
  "answer": 1,
  "explanation": "Request count is a meaningless unit when requests vary 10,000x in size. Metering tokens (and capping RPM for concurrency) reflects real cost and keeps tenants fair."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "LLM serving — key terms",
  "cards": [
    { "front": "TTFT vs TPOT", "back": "Time-to-first-token (set by prefill, target < ~1s) vs time-per-output-token (set by decode, ~10–50ms so text streams faster than you read)." },
    { "front": "Prefill vs decode", "back": "Prefill: process the whole prompt in one parallel, compute-bound pass (builds KV-cache, yields token 1). Decode: generate one token per pass, sequential and memory-bound — dominates time." },
    { "front": "KV-cache", "back": "Stored key/value tensors for every token so far, kept in GPU memory so decode attends to the prefix cheaply. Grows with context × layers; usually the memory bottleneck." },
    { "front": "Continuous batching", "back": "Re-form the GPU batch every decode step; a finished sequence frees its slot and a waiting request is admitted mid-flight. The main throughput win." },
    { "front": "PagedAttention / prefix caching", "back": "Allocate KV-cache in fixed pages (no fragmentation, pack more sequences); share cached pages for identical prompt prefixes (skip repeated prefill)." },
    { "front": "Token-based fairness", "back": "Rate-limit and fair-queue by tokens-per-minute (+ RPM), not request count, because requests vary 10,000x in cost; separate interactive vs batch lanes." }
  ]
}
```

## Key takeaways

- The resource you schedule is a **scarce, expensive, stateful GPU**, not a cheap stateless request —
  that inverts normal web-service scaling and makes **keeping GPUs busy but not overloaded** the whole
  game.
- **Continuous batching** is the core throughput trick: re-form the batch every decode step so finished
  sequences free their slots and new requests join mid-flight, near-fully utilizing the GPU.
- **KV-cache** makes decode cheap but **lives in GPU memory for the whole request**, so memory — not
  compute — usually caps concurrency; PagedAttention and prefix caching stretch it.
- **Stream** with SSE (don't buffer), meter and queue by **tokens** for fairness, and handle overload
  with **admission control, deadlines, and preemption** — you can't just add GPUs.
- Tune to the **latency SLO** (TTFT/TPOT), not to max throughput; autoscale on **queue depth** with
  warm pools because scaling GPUs is slow and quota-bound.

## Concepts exercised

This design applies, end to end: `realtime-communication` (SSE token streaming, why not full
websockets) · `backpressure-and-load-shedding` (admission control, 429 + `Retry-After`, deadlines,
preemption when GPUs saturate) · `load-balancing` (gateway spreading across GPU worker pools, but
pinning a request to one stateful worker) · `rate-limiting` (token-bucket limits, here metered in
*model tokens* — TPM/RPM — for multi-tenant fairness). It also exercises `caching-fundamentals` +
TTL (KV-cache, prefix/response caching), `single-point-of-failure` (scarce GPU quota as a hard
ceiling), and `hot-partitions` (a heavy tenant concentrating load — solved with fair queuing).
