---
title: "GraphQL"
slug: graphql
level: intermediate
module: architecture-and-services
order: 5
reading_time_min: 15
concepts: [graphql, schema, resolvers, over-fetching, n-plus-1, query-cost]
use_cases: []
prerequisites: [api-styles-rest-rpc-graphql, rest-api-fundamentals]
status: published
---

# GraphQL

## Hook — a motivating scenario

Your web app and mobile app share a backend but need different slices of the same data — and the REST
team is drowning in one-off endpoints (`/profile-for-mobile`, `/profile-with-posts`, `/feed-lite`…)
to satisfy each screen without over-fetching. Every new screen means new backend work. GraphQL flips
this: the **client** asks for exactly the data each screen needs, in one request, against one
endpoint — no new backend endpoint required.

## Mental model — a query language for your API

REST gives you fixed endpoints that return fixed shapes. **GraphQL** gives you a single endpoint and a
**typed schema** of what's available; clients send a **query** describing exactly the fields and
relationships they want, and get back that exact shape.

```
query {
  user(id: 42) {
    name
    posts(last: 3) { title }
    followersCount
  }
}
```

→ returns just `name`, the 3 latest post titles, and a follower count — nothing more, in one round
trip. The **schema** (types + fields) is the contract; **resolvers** are the server functions that
fetch each field.

## Build it up — what GraphQL solves

- **No over-fetching** — you get only the fields you asked for.
- **No under-fetching / N+1 round trips** — one query can traverse relationships (user → posts →
  comments) in a single request.
- **One evolving schema, many clients** — mobile and web query the same graph differently; new screens
  need no new endpoints. Fields can be **deprecated** rather than versioned (often avoiding REST-style
  `/v2`).
- **Introspection** — the schema is self-documenting and powers great tooling.

```reveal
{
  "prompt": "How does GraphQL let mobile and web clients with different data needs share one backend without endpoint sprawl?",
  "answer": "Both clients hit the same single endpoint and the same schema, but each sends its own query selecting exactly the fields it needs — mobile asks for a lean set, web asks for more, all without the server defining separate endpoints. The server exposes the graph once (types + resolvers); the clients shape their own responses. New screens just write new queries against existing fields, so the backend stops minting per-screen REST endpoints. The contract is the schema, not a fixed response shape."
}
```

## Build it up — the costs GraphQL introduces

Flexibility on the client becomes complexity on the server:

- **Caching is harder.** REST caches by URL+method via HTTP; GraphQL is usually one `POST /graphql`,
  so simple HTTP/CDN caching doesn't apply — you need persisted queries or app/field-level caching.
- **Query cost / abuse.** A client can request deeply nested, expensive queries (intentional or not) —
  a potential DoS. You add **depth limits, complexity analysis, and rate limiting**.
- **The N+1 problem moves server-side.** A query over a list where each item resolves a relationship
  can fire one DB query per item; you fix it with **batching/dataloaders** (recall the N+1 idea from
  pagination/latency).
- **More server complexity** — schema, resolvers, and the above safeguards.

```reveal
{
  "prompt": "GraphQL removed the client's N+1 round trips — why can an N+1 problem reappear on the server, and how is it fixed?",
  "answer": "Resolvers run per field. A query like `users { posts { ... } }` may call the 'posts' resolver once per user — so 100 users triggers 100 separate post queries to the database (N+1), even though the client made a single request. The fix is batching: a dataloader collects all the per-item lookups within a tick and issues one batched query (e.g. WHERE user_id IN (...)), plus caching within the request. So GraphQL moves the N+1 from the network (client round trips) to the data layer (resolver calls), where you solve it with dataloaders rather than letting each resolver hit the DB independently."
}
```

## In the wild

- **GitHub, Shopify, Meta** (which created GraphQL) expose GraphQL APIs; it's popular for
  **mobile/web frontends** with diverse data needs.
- Often deployed as a **Backend-for-Frontend / gateway** that aggregates underlying REST/gRPC services
  into one graph (advanced topic).
- **Apollo / Relay** (client) and dataloader libraries are the common ecosystem; **persisted queries**
  restore CDN-style caching.
- Pairs with the other styles: **GraphQL at the edge, gRPC/REST between internal services.**

## Common misconception — "GraphQL is strictly better than REST; migrate everything"

It moves complexity rather than removing it, and isn't ideal for every API.

```reveal
{
  "prompt": "When is REST the better choice over GraphQL, despite GraphQL's flexibility?",
  "answer": "For simple, resource-shaped CRUD and public APIs that benefit from HTTP caching, CDN edge caching, and universal tooling, REST is simpler and faster to operate — GraphQL's single POST endpoint forfeits easy HTTP caching and adds resolver/schema/query-cost machinery you don't need. REST also has a gentler learning curve and better out-of-the-box cacheability. GraphQL earns its complexity when you have many clients needing different data shapes and lots of related entities to traverse; for straightforward, cacheable endpoints it's over-engineering. Choose by client diversity and data-graph complexity, not by novelty."
}
```

GraphQL trades client-side fetching pain for **server-side caching, query-cost, and resolver
complexity**. It shines for diverse clients over a rich data graph; REST remains better for simple,
cacheable, public CRUD.

## Self-test

```quiz
{
  "question": "The core thing GraphQL changes versus REST is:",
  "options": [
    "It encrypts requests",
    "The client specifies exactly which fields/relationships it wants in one query against one endpoint",
    "It removes the need for a database",
    "It only works over UDP"
  ],
  "answer": 1,
  "explanation": "GraphQL is a query language: clients request the precise shape they need from a typed schema, avoiding over-/under-fetching."
}
```

```quiz
{
  "question": "A genuine new challenge GraphQL introduces (vs REST) is:",
  "options": [
    "It can't return JSON",
    "Harder caching and query-cost control (expensive nested queries), plus server-side N+1 needing dataloaders",
    "It requires sticky sessions",
    "It can't traverse relationships"
  ],
  "answer": 1,
  "explanation": "One POST endpoint breaks simple HTTP caching; clients can craft expensive queries; resolvers can N+1 the DB — all server-side concerns."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "GraphQL — key terms", "cards": [ { "front": "GraphQL", "back": "A query language for APIs: a single endpoint plus a typed schema where clients send queries describing exactly the fields and relationships they want and get back that exact shape." }, { "front": "Schema", "back": "The typed contract of a GraphQL API — the types and fields available. It is self-documenting via introspection and powers tooling." }, { "front": "Resolvers", "back": "Server functions that fetch each field in a query. They run per field, which is why a server-side N+1 problem can arise." }, { "front": "Over-fetching / under-fetching", "back": "GraphQL eliminates both: you get only the fields you ask for (no over-fetch), and one query can traverse relationships in a single request (no N+1 round trips)." }, { "front": "Server-side N+1", "back": "A query over a list where each item resolves a relationship can fire one DB query per item. Fixed with batching/dataloaders that collect lookups into one batched query." }, { "front": "Schema evolution via deprecation", "back": "Instead of versioning with /v2, GraphQL deprecates individual fields, letting one evolving schema serve many clients without new endpoints." } ] }
```

## Key takeaways

- **GraphQL** = a typed schema + client-written **queries**: ask for exactly the fields/relationships
  you need in one request to one endpoint.
- It eliminates **over-/under-fetching** and **endpoint sprawl**, and supports **schema evolution via
  deprecation** instead of `/v2`.
- Costs: **harder caching** (no URL-based HTTP cache), **query-cost/DoS control**, and **server-side
  N+1** (fix with **dataloaders/batching**).
- Best for **diverse clients over a rich data graph**; REST stays better for simple, cacheable, public
  CRUD.

## Up next

Not all integration is the client pulling data — sometimes the server must push events out. Next:
**Webhooks**.
