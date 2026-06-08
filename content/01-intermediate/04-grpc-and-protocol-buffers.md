---
title: "gRPC & Protocol Buffers"
slug: grpc-and-protocol-buffers
level: intermediate
module: architecture-and-services
order: 4
reading_time_min: 15
concepts: [grpc, protobuf, http2, streaming, idl, codegen]
use_cases: []
prerequisites: [api-styles-rest-rpc-graphql, data-serialization, http-fundamentals]
status: published
---

# gRPC & Protocol Buffers

## Hook — a motivating scenario

Two internal services exchange millions of messages a second over REST/JSON. Profiling shows a
shocking amount of CPU is spent *parsing JSON* and bandwidth is wasted repeating field names in every
message. You don't need REST's universality here — both ends are yours. Switching this hot internal
path to **gRPC + Protocol Buffers** cuts message size several-fold, slashes parse CPU, and gives you a
typed contract and streaming for free. This is the default for serious internal service-to-service
communication.

## Mental model — typed function calls over a fast wire

**gRPC** makes a call to a remote service look like calling a **local, typed function** —
`userService.GetUser(id)` — while underneath it sends a compact binary message over **HTTP/2**. Two
pieces make it work:
- **Protocol Buffers (Protobuf)** — a schema language (an IDL) where you define your messages and
  service methods in a `.proto` file. It's the compact, schema-driven binary format from the
  serialization chapter.
- **Code generation** — from the `.proto`, gRPC generates typed client and server stubs in each
  language, so both sides share one contract.

```
service UserService {
  rpc GetUser(GetUserRequest) returns (User);
}
message User { int32 id = 1; string name = 2; }
```

## Build it up — why it's fast, and what it adds

```compare
{
  "options": [
    { "label": "REST + JSON", "points": ["Text, self-describing (field names repeated)", "Human-readable, universal, cacheable", "Slower to parse; larger payloads", "Request/response only (HTTP/1.1)"] },
    { "label": "gRPC + Protobuf", "points": ["Compact binary (tag numbers, no field names)", "Generated typed stubs from one .proto", "Faster parse, smaller payloads", "HTTP/2: multiplexing + 4 streaming modes"] }
  ]
}
```

gRPC rides on **HTTP/2** (recall HTTP fundamentals), which gives it:
- **Multiplexing** — many calls over one connection (no head-of-line blocking at the HTTP layer).
- **Streaming** — four modes: unary (1→1), server-streaming (1→many), client-streaming (many→1), and
  bidirectional — great for feeds, uploads, and live data, which plain REST can't express cleanly.
- **A strict contract** — the `.proto` is the single source of truth; codegen keeps client and server
  in sync and gives compile-time type safety.

```reveal
{
  "prompt": "Why is gRPC+Protobuf so much more efficient than REST+JSON on a hot internal path?",
  "answer": "Two big wins. Size: Protobuf encodes fields by numeric tag in binary and omits field names/whitespace, so messages are typically several times smaller than the equivalent JSON (which repeats field names as text in every message). Speed: parsing compact binary by tag is far cheaper than tokenizing and parsing JSON text, cutting CPU. Add HTTP/2 multiplexing (many calls share one connection) and you reduce connection overhead too. Across millions of messages, smaller payloads + cheaper parsing = major bandwidth and CPU savings — exactly the bottleneck in the scenario."
}
```

## Build it up — the trade-offs

gRPC isn't free or universal:
- **Not natively browser-friendly** — browsers can't speak raw gRPC; you need **gRPC-Web** + a proxy.
  So gRPC is mainly for **internal** service-to-service, not public browser APIs.
- **Binary = not human-readable** — you can't just `curl` and eyeball it; you need tooling
  (`grpcurl`, reflection).
- **Tighter coupling + build step** — clients depend on generated stubs and the shared `.proto`; you
  add codegen to the build.
- **Schema evolution still applies** — add fields with new tag numbers; don't reuse/renumber tags
  (recall serialization compatibility).

```reveal
{
  "prompt": "Your public-facing browser app needs to call a backend. Is gRPC the right choice? Why or why not?",
  "answer": "Usually no, not directly. Browsers can't make native gRPC calls (it needs HTTP/2 framing browsers don't expose), so you'd require gRPC-Web plus a translating proxy — extra moving parts. Public clients also benefit from REST's human-debuggability, caching, and universal tooling. The common pattern is REST (or GraphQL) at the public/browser edge and gRPC strictly between your internal services, where both ends are yours and performance matters. Use gRPC where its strengths (speed, streaming, typed contracts) apply and its weaknesses (browser support, debuggability) don't bite."
}
```

## In the wild

- **gRPC is the de-facto standard for internal microservice communication** at scale (Google, and
  much of the cloud-native ecosystem).
- **Protobuf schemas** double as the contract and the serialization format; schema registries enforce
  compatibility.
- **Streaming** powers real-time internal data (telemetry, feeds) without bolting on a separate
  protocol.
- At the edge, pair gRPC with a **REST/GraphQL gateway** (or gRPC-Web) so external clients can still
  reach your services.

## Common misconception — "gRPC is just a faster REST you can use everywhere"

It's a different model with a different sweet spot.

```reveal
{
  "prompt": "Beyond speed, how is gRPC fundamentally different from REST — and why does that limit where you use it?",
  "answer": "gRPC is action/contract-oriented (call generated, typed methods defined in a .proto) over binary HTTP/2 with streaming — versus REST's resource-oriented, text, cacheable, universally-reachable model. That contract + binary + HTTP/2 design is what makes it fast and powerful internally, but it's also why it doesn't drop in 'everywhere': browsers can't speak it natively, it's not human-debuggable or HTTP-cacheable by URL, and it couples clients to generated stubs and a shared schema. So it's not 'REST but faster' — it's a tighter, performance-oriented model best confined to internal, controlled service-to-service boundaries, with REST/GraphQL kept for public/browser access."
}
```

gRPC trades REST's universality and simplicity for **internal performance, streaming, and typed
contracts**. Use it between your own services; keep REST/GraphQL at the public edge.

## Self-test

```quiz
{
  "question": "gRPC achieves smaller, faster messages than REST/JSON primarily by:",
  "options": [
    "Encrypting everything",
    "Using compact binary Protobuf (tag numbers, no repeated field names) over HTTP/2",
    "Caching responses in the browser",
    "Avoiding the network"
  ],
  "answer": 1,
  "explanation": "Protobuf's binary tag-based encoding is smaller and cheaper to parse than text JSON, and HTTP/2 adds multiplexing/streaming."
}
```

```quiz
{
  "question": "gRPC is generally NOT the right choice for:",
  "options": [
    "Internal service-to-service calls",
    "A public API called directly from web browsers",
    "Streaming telemetry between services",
    "High-throughput internal RPCs"
  ],
  "answer": 1,
  "explanation": "Browsers can't speak native gRPC (need gRPC-Web + proxy); public/browser APIs are better served by REST/GraphQL."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "gRPC & Protocol Buffers — key terms", "cards": [ { "front": "gRPC", "back": "A contract-first RPC framework: calling a remote service looks like a local typed function call, sending compact binary messages over HTTP/2." }, { "front": "Protocol Buffers (Protobuf)", "back": "A schema language (IDL) where you define messages and service methods in a .proto file; the compact, schema-driven binary serialization format gRPC uses." }, { "front": "Code generation (stubs)", "back": "From the .proto, gRPC generates typed client and server stubs in each language so both sides share one contract with compile-time type safety." }, { "front": "HTTP/2 multiplexing", "back": "Many calls share one connection without head-of-line blocking at the HTTP layer, reducing connection overhead." }, { "front": "gRPC streaming modes", "back": "Four modes: unary (1 to 1), server-streaming (1 to many), client-streaming (many to 1), and bidirectional — good for feeds, uploads, and live data." }, { "front": "gRPC-Web", "back": "Browsers can't speak raw gRPC, so a gRPC-Web client plus a translating proxy is needed for browser access; gRPC is mainly for internal service-to-service." } ] }
```

## Key takeaways

- **gRPC** = typed, contract-first RPC over **HTTP/2** using **Protobuf** binary — compact, fast, with
  generated client/server stubs.
- It adds **streaming** (4 modes) and **multiplexing**, and a strict `.proto` contract with
  compile-time safety.
- Best for **internal, high-volume service-to-service**; **not** for public/browser APIs (needs
  gRPC-Web; not human-debuggable/cacheable).
- Schema evolution rules from serialization still apply — add fields with new tag numbers, never
  reuse them.

## Up next

For client-facing APIs that need flexible data shaping, the other modern style. Next: **GraphQL**.
