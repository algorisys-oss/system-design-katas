---
title: "API Styles — REST vs RPC vs GraphQL"
slug: api-styles-rest-rpc-graphql
level: intermediate
module: architecture-and-services
order: 3
reading_time_min: 15
concepts: [rest, rpc, graphql, over-fetching, under-fetching, api-design]
use_cases: []
prerequisites: [rest-api-fundamentals, monoliths-vs-microservices]
status: published
---

# API Styles — REST vs RPC vs GraphQL

## Hook — a motivating scenario

Your mobile app loads a profile screen and makes **seven** REST calls — user, posts, followers,
settings… — each over-fetching fields it doesn't show, draining battery and feeling sluggish on a
train connection. Meanwhile two backend services chat millions of times a second and JSON-over-REST
is burning CPU. Neither problem means "REST is bad" — they mean REST isn't the right *style* for that
job. REST, RPC, and GraphQL are three answers to "how do a client and server talk," each best for
different situations.

## Mental model — three philosophies of an API

- **REST** — talk in **resources (nouns)**: `GET /users/42`, `GET /users/42/posts`. Uniform, cacheable,
  ubiquitous (recall the REST chapter).
- **RPC** — talk in **actions (verbs/functions)**: call `getUser(42)` as if it were a local function.
  Tight, efficient, action-oriented (gRPC is the modern form).
- **GraphQL** — talk in **queries**: the *client* specifies exactly the fields it wants in one
  request, and the server returns precisely that shape.

```compare
{
  "options": [
    { "label": "REST", "points": ["Resource-oriented (nouns + HTTP verbs)", "Cacheable, simple, universal", "Can over-/under-fetch; many round trips", "Default for public web APIs"] },
    { "label": "RPC (gRPC)", "points": ["Action-oriented (call a function)", "Compact (Protobuf) + fast; streaming", "Tighter coupling; less browser-friendly", "Great for internal service-to-service"] },
    { "label": "GraphQL", "points": ["Client picks exactly the fields", "One request, no over/under-fetch", "Server/caching complexity; query cost control", "Great for varied clients (mobile, web)"] }
  ]
}
```

## Build it up — the problems each one solves

**REST's pain points** (the opening scenario):
- **Over-fetching** — an endpoint returns more fields than the screen needs (wasted bytes).
- **Under-fetching** → **N+1 round trips** — one screen needs several resources, so the client makes
  many calls (the seven-call profile).

**GraphQL** fixes both: the client sends one query asking for exactly the fields across exactly the
entities it needs, and gets one right-sized response. Great when many different clients (mobile vs web)
need different shapes of the same data.

**RPC/gRPC** optimizes a different axis: **internal, high-volume service-to-service** calls where you
want compact binary (Protobuf), low latency, code-generated clients, and streaming — not human-readable
JSON over verbose HTTP.

```reveal
{
  "prompt": "A mobile profile screen makes 7 REST calls and each returns far more than it shows. Which style addresses this and how?",
  "answer": "GraphQL. Instead of 7 endpoints each over-fetching, the client sends ONE query naming exactly the fields it needs across user, posts, followers, and settings, and the server returns precisely that shape in a single response. This eliminates both under-fetching (7 round trips → 1) and over-fetching (only requested fields come back) — directly fixing the battery/latency problem on a slow connection. (You could also craft a custom REST 'aggregate' endpoint or a Backend-for-Frontend, but GraphQL makes client-driven shaping the default.)"
}
```

## Build it up — choosing a style

```match
{
  "prompt": "Match each situation to the API style that fits best.",
  "pairs": [
    { "left": "Public web API for third-party developers", "right": "REST (simple, cacheable, ubiquitous)" },
    { "left": "High-volume internal service-to-service", "right": "gRPC (compact, fast, streaming)" },
    { "left": "Mobile + web clients needing different data shapes", "right": "GraphQL (client picks fields)" },
    { "left": "Simple CRUD over standard resources", "right": "REST" }
  ]
}
```

They're not mutually exclusive: a real system often uses **REST for its public API, gRPC between
internal services, and GraphQL as a client-facing aggregation layer** — picking per boundary.

```reveal
{
  "prompt": "What new problems does GraphQL introduce that REST doesn't, despite solving over/under-fetching?",
  "answer": "Caching gets harder: REST leans on HTTP caching by URL/method, but GraphQL is typically one POST to /graphql, so you need application-level/field caching instead. You also must control query cost — a client can request deeply nested, expensive queries (an accidental or malicious DoS), so you add depth/complexity limits and rate controls. And the server is more complex (resolvers, schema, the N+1 problem moves server-side, needing dataloaders/batching). GraphQL trades client-side fetching pain for server-side caching/cost/complexity — a trade-off, not a free win."
}
```

## In the wild

- **REST** dominates public APIs (cacheable, easy, every client speaks it).
- **gRPC** is the common choice for **internal microservice communication** (Protobuf + HTTP/2,
  streaming, codegen) — recall serialization and HTTP/2.
- **GraphQL** is popular for **mobile/web frontends** and aggregation layers (GitHub, Shopify expose
  GraphQL); often implemented as a **Backend-for-Frontend** (advanced topic).
- Same system, multiple styles: public REST + internal gRPC + a GraphQL gateway is common.

## Common misconception — "GraphQL (or gRPC) replaces REST; pick the newest"

Each optimizes a different axis; none is a universal upgrade.

```reveal
{
  "prompt": "Why isn't GraphQL simply 'REST but better,' and why is gRPC a poor fit for a public browser API?",
  "answer": "GraphQL solves client-driven data shaping but sacrifices REST's simple HTTP caching and adds server complexity and query-cost risks — worse, not better, for simple cacheable CRUD or public APIs that benefit from REST's ubiquity and tooling. gRPC is compact and fast for internal calls but isn't natively browser-friendly (needs gRPC-Web/proxies), uses binary (not human-debuggable), and couples clients via generated stubs — poor for a public API consumed by arbitrary developers. Each style wins on its axis: REST on simplicity/caching/reach, gRPC on internal performance, GraphQL on flexible client queries. Choose by the boundary's needs, not by recency."
}
```

REST, gRPC, and GraphQL are complementary tools optimized for **simplicity/caching**, **internal
performance**, and **flexible client queries** respectively. Pick per boundary, not by fashion.

## Self-test

```quiz
{
  "question": "A mobile client over-fetches and makes many round trips per screen. The style designed to fix this is:",
  "options": ["More REST endpoints", "gRPC", "GraphQL (client requests exactly the fields it needs in one query)", "SOAP"],
  "answer": 2,
  "explanation": "GraphQL lets the client specify the exact fields/entities in a single query, eliminating over-fetching and N+1 round trips."
}
```

```quiz
{
  "question": "For high-volume internal service-to-service communication, the typical best fit is:",
  "options": ["GraphQL", "gRPC (compact Protobuf, HTTP/2, streaming, codegen)", "Public REST with JSON", "Webhooks"],
  "answer": 1,
  "explanation": "gRPC's binary efficiency, streaming, and generated clients suit fast internal calls — unlike verbose JSON/REST or browser-oriented GraphQL."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "API styles (REST/RPC/GraphQL) — key terms", "cards": [ { "front": "REST", "back": "A resource-oriented API style: talk in nouns over HTTP verbs (GET /users/42). Uniform, cacheable, and universal — the default for public web APIs." }, { "front": "RPC / gRPC", "back": "An action-oriented style: call a remote function as if local (getUser(42)). gRPC adds compact Protobuf over HTTP/2 with streaming and codegen — ideal for internal service-to-service calls." }, { "front": "GraphQL", "back": "A query style where the client specifies exactly the fields it wants across entities in one request, and the server returns precisely that shape." }, { "front": "Over-fetching", "back": "When an endpoint returns more fields than the screen needs, wasting bytes. GraphQL fixes it by letting the client name only the fields it wants." }, { "front": "Under-fetching (N+1 round trips)", "back": "When one screen needs several resources, forcing the client to make many calls. GraphQL collapses these into a single right-sized query." }, { "front": "GraphQL's new costs", "back": "It trades client-side fetching pain for harder caching (no URL-based HTTP caching), query-cost control (depth/complexity limits), and server complexity (resolvers, dataloaders for N+1)." } ] }
```

## Key takeaways

- **REST** = resources + HTTP (simple, cacheable, universal); **RPC/gRPC** = call functions (compact,
  fast, internal); **GraphQL** = client picks exact fields (no over/under-fetch).
- GraphQL fixes REST's **over-fetching and N+1 round trips** but adds **caching, query-cost, and
  server complexity**.
- gRPC excels at **internal high-volume** calls; it's a poor fit for public/browser APIs.
- They're **complementary** — real systems mix them per boundary (public REST + internal gRPC +
  GraphQL aggregation).

## Up next

Let's go deep on the internal-performance choice. Next: **gRPC & Protocol Buffers**.
