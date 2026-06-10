---
title: "Backend for Frontend (BFF)"
slug: backend-for-frontend
level: advanced
module: operability-and-patterns
order: 47
reading_time_min: 13
concepts: [bff, api-aggregation, client-specific-api, over-fetching, api-gateway, frontend-backend]
use_cases: []
prerequisites: [api-gateway, api-styles-rest-rpc-graphql, monoliths-vs-microservices]
status: published
---

# Backend for Frontend (BFF)

## Hook — a motivating scenario

Your mobile app, web app, and smart-TV app all consume the same generic backend API. The mobile app
over-fetches huge payloads it must trim (wasting bandwidth/battery), the web app makes 7 calls to render
one screen, and the TV needs a totally different shape. One API can't serve all three well — so each
client bloats with adaptation logic, or the shared API turns into a mess of client-specific special
cases. **Backend for Frontend (BFF)** gives **each client type its own tailored backend**.

## Mental model — one tailored backend per client experience

A **Backend for Frontend (BFF)** is a **dedicated backend layer for a specific frontend/client type**
(one for mobile, one for web, one for the TV app). Each BFF sits between its client and the downstream
services, and **aggregates, transforms, and tailors** data into **exactly the shape that client needs** —
so the client gets one efficient, purpose-fit API instead of wrestling a generic one.

```fanout
{
  "title": "A BFF per client type, fronting shared services",
  "source": { "label": "Clients", "detail": "Mobile, web, and TV clients — each client type talks only to its own BFF." },
  "targets": [
    { "label": "Mobile BFF", "detail": "Small, battery/bandwidth-friendly payloads tailored to the mobile app." },
    { "label": "Web BFF", "detail": "Richer data; aggregates many services per page." },
    { "label": "TV BFF", "detail": "Its own shape/fields for the TV client." }
  ],
  "sink": { "label": "Shared services", "detail": "Orders, users, catalog, etc. — each BFF composes its client-specific response from these same downstream services." },
  "note": "Peer BFFs (one per client type) front the SAME shared services in parallel; they do not chain into one another. Each BFF tailors aggregation/shape for ITS client."
}
```

## Build it up — what a BFF solves

A BFF addresses the mismatch between a **generic, one-size-fits-all API** and the **divergent needs of
different clients**:
- **Right-sized payloads:** the mobile BFF returns **small** responses (no over-fetching → saves
  bandwidth/battery), while the web BFF returns **richer** data for a desktop screen — fixing the
  **over-/under-fetching** problem (recall API styles; GraphQL solves this differently — see below).
- **Aggregation:** the BFF makes the **multiple downstream calls** and **combines** them, so the client
  does **one** call per screen instead of seven (recall API gateway aggregation) — fewer round trips,
  great for high-latency mobile.
- **Client-specific logic in one place:** formatting, field selection, and adaptation live in the BFF
  **owned by the frontend team**, instead of bloating the client or polluting shared services with
  client special-cases.

```reveal
{
  "prompt": "How does a BFF solve over-fetching, under-fetching, and chatty clients better than a single generic API serving everyone?",
  "answer": "A single generic API has to be a compromise across all client types, which causes exactly these problems: it returns one fixed payload shape, so a mobile client over-fetches (gets large responses full of fields it doesn't need, wasting bandwidth and battery) while a rich web client under-fetches (the generic shape lacks what a big screen wants), and because the generic API exposes resources rather than screens, clients must make many calls to assemble one view (chatty/under-fetching → N round trips), which is especially painful on high-latency mobile networks. A BFF fixes this by giving each client type its own tailored backend that returns exactly what that client needs: the mobile BFF returns small, trimmed payloads with only the fields the mobile UI uses (no over-fetching), the web BFF returns richer data suited to desktop, and each BFF AGGREGATES the multiple downstream service calls server-side and composes a single response per screen, so the client makes one call instead of seven (eliminating chattiness and round trips — the aggregation happens close to the services, over fast internal links, rather than over the slow client connection). Because each BFF is purpose-built for its client, there's no compromise shape: payload size, field selection, and call patterns are optimized per client experience. And the client-specific adaptation logic (which fields, what shape, how to combine) lives in the BFF owned by that frontend team, rather than bloating the client app or polluting shared services with per-client special cases. So instead of one API that's mediocre for everyone (over-fetching for some, under-fetching/chatty for others), you get several APIs each excellent for one client — solving over-fetch (trim to need), under-fetch (include what's needed), and chattiness (aggregate per screen) simultaneously, at the cost of running multiple BFFs."
}
```

## Build it up — BFF vs API gateway vs GraphQL, and pitfalls

- **BFF vs API gateway:** an **API gateway** (recall) is typically **one shared entry point** doing
  cross-cutting concerns (auth, rate limiting, routing) for **all** clients; a **BFF** is **one per client
  type**, doing **client-specific aggregation/shaping**. They **coexist** — a gateway can sit in front of
  BFFs (gateway = shared edge concerns; BFF = per-client tailoring).
- **BFF vs GraphQL:** **GraphQL** (recall) solves over/under-fetching by letting **each client query
  exactly the fields it wants** from one endpoint — an *alternative* way to get client-tailored responses
  **without** a separate backend per client. BFF tailors on the **server**; GraphQL tailors via the
  **query**. (Some teams even use GraphQL *as* the BFF.)
- **Pitfalls:** **duplication** across BFFs (shared logic copied into each — extract common pieces),
  **more services to run/own**, and **scope creep** (a BFF should do client adaptation/aggregation, not
  become a second home for core business logic — that belongs in the services/domain).

```reveal
{
  "prompt": "When should you reach for a BFF, and how do you decide between a BFF and GraphQL (or use both)?",
  "answer": "Reach for a BFF when you have multiple, genuinely DIFFERENT client types (mobile, web, TV, partner APIs, smartwatch) whose needs diverge enough that a single generic API serves them poorly — different payload sizes, shapes, aggregation patterns, or interaction models — and you want each frontend team to own and rapidly iterate on its own tailored API without coordinating changes to a shared backend or bloating the client. A BFF is especially valuable when clients need server-side AGGREGATION of many downstream services per screen (to cut round trips, e.g. for high-latency mobile) and when client-specific logic would otherwise pollute shared services or the client apps. It's less justified when you have a single client type or clients with very similar needs (a generic API or one gateway suffices — multiple BFFs would just add overhead). Choosing BFF vs GraphQL: both solve over/under-fetching and client-specific shaping, but differently. GraphQL lets EACH client request exactly the fields/shape it wants from a single flexible endpoint — so it can serve diverse clients WITHOUT a separate backend per client, reducing the proliferation of BFF services and the duplication among them; it's a strong fit when the main problem is field-level fetching flexibility and you're willing to adopt GraphQL's machinery (schema, resolvers, the server-side N+1/dataloader and query-complexity concerns from the GraphQL chapter). A BFF (REST/RPC) shines when tailoring needs server-side logic beyond field selection — complex aggregation/orchestration, client-specific transformations, protocol adaptation, caching strategies, or when you want clear per-client ownership and isolation — and when you don't want to impose GraphQL everywhere. They're not mutually exclusive: a common approach is to use GraphQL AS the BFF (a per-client or shared GraphQL layer that aggregates services), getting query flexibility plus aggregation. Decision drivers: number and divergence of clients (more/divergent → BFF or GraphQL over generic API), whether the need is field-flexibility (lean GraphQL) vs heavy server-side orchestration/per-client logic (lean BFF), team ownership preferences (BFF gives each frontend team its own service), and willingness to run/maintain extra services (BFFs multiply services; GraphQL can consolidate). Watch BFF pitfalls regardless: avoid duplicating shared logic across BFFs (extract common modules/services), don't let a BFF absorb core business logic (keep that in the domain services), and account for the operational cost of more services. In short: use a BFF when distinct clients need tailored, aggregated, server-shaped APIs with clear ownership; use GraphQL when flexible per-client field selection from one endpoint is the main need; and consider GraphQL-as-BFF to combine both."
}
```

## In the wild

- **BFF** was popularized by **SoundCloud/Netflix/Spotify** to serve mobile vs web well; common in
  microservice frontends where one generic API can't satisfy all clients. Netflix famously ran a
  **device-specific API layer to serve 1,000+ distinct device types** (TVs, consoles, phones, tablets),
  each needing its own response shape — a scale where one generic API simply couldn't fit them all.
- **Coexists with an API gateway** (gateway = shared edge concerns; BFFs = per-client tailoring) and is
  often built **per-client by the owning frontend team**.
- **GraphQL** is a frequent **alternative or implementation** (GraphQL-as-BFF) for client-tailored
  fetching (recall GraphQL).
- **Aggregation** (one call per screen) is the same idea as **API gateway aggregation** (recall),
  specialized per client.

## Common misconception — "one API should serve all clients" / "a BFF is just an API gateway"

A generic API compromises every client; a **BFF** is **per-client tailoring**, distinct from the
**shared** API gateway (and they coexist).

```reveal
{
  "prompt": "Why is 'just build one API for all clients' often wrong, and how is a BFF different from an API gateway?",
  "answer": "'One API for all clients' is often wrong because different client types have genuinely different needs, so a single generic API becomes a compromise that serves each client suboptimally: mobile over-fetches large payloads it doesn't need (wasting bandwidth/battery), rich web clients under-fetch (the generic shape lacks desktop data) and/or must make many calls per screen (chatty, painful on mobile latency), and the TV or partner clients want yet another shape. To cope, either the clients bloat with adaptation logic, or the shared API accretes client-specific special cases and becomes a tangled mess that's hard to evolve without breaking some client. A BFF avoids this by giving each client type its own tailored backend that returns exactly the right shape and aggregates downstream calls per screen — so every client gets an efficient, purpose-fit API and client-specific logic lives in a BFF owned by that frontend team rather than polluting shared services or the clients. As for the API-gateway confusion: they operate at different granularities and purposes. An API gateway is typically a SINGLE, SHARED entry point handling cross-cutting concerns for ALL clients/traffic — authentication, rate limiting, routing, TLS termination, maybe some generic aggregation — i.e. edge concerns common to everyone. A BFF is one backend PER CLIENT TYPE, focused on client-SPECIFIC aggregation, transformation, and shaping of data for that particular frontend's needs. So a gateway is about shared edge/cross-cutting handling; a BFF is about per-client tailoring of the API surface. They're not the same and they coexist nicely: you commonly put an API gateway at the edge (handling auth/rate limiting/routing for all) in front of multiple BFFs (each tailoring for its client), which in turn call the shared downstream services. Treating a BFF as 'just a gateway' misses that the BFF's job is bespoke per-client composition, not shared cross-cutting concerns; and insisting on one API for all clients ignores that divergent clients are best served by tailored APIs (whether via BFFs or GraphQL). The correct framing: generic single API → mediocre for everyone; gateway → shared edge concerns; BFF → per-client tailored backend; use them together as appropriate."
}
```

A **Backend for Frontend (BFF)** is a **dedicated backend per client type** that **aggregates and
tailors** downstream data into exactly that client's needed shape — fixing **over/under-fetching and
chatty clients** that a generic API causes. It's **per-client tailoring** (distinct from the **shared**
API gateway — they coexist), and **GraphQL** is an alternative/implementation. Watch for **duplication
across BFFs** and **scope creep** (keep core logic in the services).

## Self-test

```quiz
{
  "question": "A Backend for Frontend (BFF) is:",
  "options": [
    "A single API shared by all clients",
    "A dedicated backend per client type that aggregates and tailors data into exactly that client's needed shape",
    "A type of database",
    "A caching layer at the edge"
  ],
  "answer": 1,
  "explanation": "Each client type (mobile/web/TV) gets its own BFF that shapes/aggregates downstream data for it — avoiding one generic API that serves all poorly."
}
```

```quiz
{
  "question": "How does a BFF differ from an API gateway?",
  "options": [
    "They're identical",
    "A gateway is one shared entry point for cross-cutting concerns (auth, rate limiting, routing) for all clients; a BFF is one per client type doing client-specific aggregation/shaping (they coexist)",
    "A BFF handles authentication for everyone",
    "A gateway tailors responses per client"
  ],
  "answer": 1,
  "explanation": "Gateway = shared edge/cross-cutting concerns for all traffic; BFF = per-client tailored aggregation/shaping. A gateway often sits in front of BFFs."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Backend for Frontend — key terms", "cards": [
  { "front": "Backend for Frontend (BFF)", "back": "A dedicated backend layer per client type (mobile/web/TV) that aggregates, transforms, and tailors downstream data into exactly the shape that client needs." },
  { "front": "Over-fetching / under-fetching", "back": "A generic API returns one fixed shape: mobile over-fetches large payloads it doesn't need, while rich web clients under-fetch. A BFF returns right-sized payloads per client." },
  { "front": "BFF aggregation", "back": "The BFF makes the multiple downstream service calls and combines them server-side, so the client makes one call per screen instead of seven — cutting round trips, great for high-latency mobile." },
  { "front": "BFF vs API gateway", "back": "A gateway is one shared entry point for cross-cutting concerns (auth, rate limiting, routing) for all clients; a BFF is one per client type doing client-specific aggregation/shaping. They coexist." },
  { "front": "BFF vs GraphQL", "back": "GraphQL lets each client query exactly the fields it wants from one endpoint — tailoring via the query, not a separate backend. BFF tailors on the server; some teams use GraphQL as the BFF." },
  { "front": "BFF pitfalls", "back": "Duplication of shared logic across BFFs (extract common pieces), more services to run/own, and scope creep — keep core business logic in the domain services, not the BFF." }
] }
```

## Key takeaways

- A **BFF** is a **dedicated backend per client type** (mobile/web/TV) that **aggregates and tailors**
  downstream data into **exactly that client's shape** — fixing the generic-API compromise.
- It solves **over-/under-fetching** (right-sized payloads) and **chatty clients** (one aggregated call
  per screen), with client-specific logic **owned by the frontend team**, not bloating clients/shared
  services.
- **Distinct from an API gateway** (shared edge concerns for all) — they **coexist** (gateway in front of
  BFFs); **GraphQL** is an alternative/implementation (per-client field selection).
- Pitfalls: **duplication across BFFs** (extract shared logic), **more services to run**, and **scope
  creep** (keep core business logic in the domain services).

## Up next

That completes the advanced concepts. Time to compose them into a full design. Next: **Capstone — Design
a Distributed Key-Value Store**.
