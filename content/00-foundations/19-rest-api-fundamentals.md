---
title: "REST API Fundamentals"
slug: rest-api-fundamentals
level: foundations
module: apis-and-the-web
order: 19
reading_time_min: 9
concepts: [rest, resources, http-methods, statelessness, api-design, crud]
use_cases: []
prerequisites: [http-fundamentals, client-server-and-anatomy-of-a-request]
status: published
---

# REST API Fundamentals

## Hook — a motivating scenario

Two teams design APIs for the same feature. Team A ships endpoints like `/getUserData`,
`/updateUserNow`, `/deleteUserAccountForReal`. Team B ships `GET /users/42`, `PATCH /users/42`,
`DELETE /users/42`. Six months later, Team B's API is predictable, cacheable, and easy to extend;
Team A's is a sprawl of one-off verbs no one can guess. The difference is **REST** — a small set of
conventions that make APIs feel consistent.

## Mental model — nouns and standard verbs

REST treats your system as a collection of **resources** (nouns): users, orders, products. You act
on them with the **standard HTTP verbs** you already know (GET/POST/PUT/PATCH/DELETE) instead of
inventing a new verb per action. The URL names the *thing*; the method says what you're *doing* to it.

> `GET /orders/7` — read order 7. `DELETE /orders/7` — delete it. You can guess the whole API from a
> few examples.

## Build it up — resources, methods, and the CRUD mapping

A resource has a **URL** (its identity), and the method maps to an operation:

```compare
{
  "options": [
    { "label": "Collection", "points": ["GET /users — list users", "POST /users — create a user", "Plural noun", "Operates on the set"] },
    { "label": "Item", "points": ["GET /users/42 — read one", "PUT /users/42 — full replace (idempotent)", "PATCH /users/42 — partial update (not necessarily idempotent)", "DELETE /users/42 — remove", "Operates on one resource"] }
  ]
}
```

The four CRUD operations map cleanly onto methods and URLs:

```match
{
  "prompt": "Match the operation to its RESTful request.",
  "pairs": [
    { "left": "Create a new order", "right": "POST /orders" },
    { "left": "Read order 7", "right": "GET /orders/7" },
    { "left": "Replace/update order 7", "right": "PUT or PATCH /orders/7" },
    { "left": "Delete order 7", "right": "DELETE /orders/7" }
  ]
}
```

REST also leans on properties you've met: it's **stateless** (each request self-contained), uses HTTP
**status codes** to signal outcomes, and benefits from method **semantics** (GET cacheable/safe;
PUT/DELETE idempotent). Good REST design = consistent nouns + correct verbs + correct status codes.

```reveal
{
  "prompt": "Why prefer `GET /users/42/orders` over `GET /getOrdersForUser?userId=42`?",
  "answer": "The first models a clear resource hierarchy (a user's orders), is predictable, cacheable (GET on a clean URL), and consistent with the rest of the API — you can guess related endpoints. The verb-style endpoint is a one-off RPC name: not cacheable by convention, inconsistent, and unguessable. REST's value is the *consistency* that lets clients and tooling reason about your API."
}
```

## In the wild

- **Resource-oriented URLs + standard methods** are the backbone of most public web APIs (Stripe,
  GitHub, etc.). GitHub's REST API, for example, paginates collection endpoints at **30 items per
  page by default (max 100)** via a `per_page` query parameter — a concrete, predictable convention
  that flows from modeling collections as resources.
- **Statelessness** lets any server handle any request (load balancing/scaling) — REST inherits it
  from HTTP.
- **REST isn't the only style:** GraphQL (client-specified queries) and gRPC (binary RPC, Protobuf)
  are alternatives covered later — REST wins on simplicity, ubiquity, and cacheability.
- **HATEOAS / richer constraints** exist in REST theory, but in practice "RESTful" usually means
  resource URLs + proper verbs + status codes.

## Common misconception — "REST just means a JSON API over HTTP"

Returning JSON doesn't make an API RESTful; following the resource+verb conventions does.

```reveal
{
  "prompt": "An API exposes POST /api/doEverything that takes an 'action' field in JSON and returns JSON. Is it RESTful? Why does it matter?",
  "answer": "No — it's an RPC tunneled over one POST endpoint. It ignores resources (no addressable URLs per thing), ignores method semantics (everything is POST, so nothing is cacheable, safe, or idempotent by convention), and can't use HTTP status codes meaningfully. It works, but loses REST's benefits: predictability, caching, and tooling that understands resources and verbs. JSON-over-HTTP ≠ REST."
}
```

REST is a set of *conventions* (resources, standard verbs, status codes, statelessness) that buy
consistency, cacheability, and tooling — not merely the use of JSON.

## Self-test

```quiz
{
  "question": "Which is the most RESTful way to delete user 42?",
  "options": ["POST /deleteUser?id=42", "GET /users/42/delete", "DELETE /users/42", "POST /users/deleteNow"],
  "answer": 2,
  "explanation": "The resource is /users/42 and the action is the DELETE method — resource (noun) + standard verb."
}
```

```quiz
{
  "question": "A core REST principle inherited from HTTP is:",
  "options": [
    "Every request must open a new TCP connection",
    "Statelessness — each request carries everything needed; no server-side session memory required",
    "Responses must be XML",
    "All operations use POST"
  ],
  "answer": 1,
  "explanation": "REST is stateless: requests are self-contained, enabling interchangeable servers and scaling."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "REST API fundamentals — key terms", "cards": [ { "front": "Resource", "back": "The noun a REST API exposes (users, orders, products), each with a URL that names the thing. You act on it with standard HTTP verbs rather than custom action endpoints." }, { "front": "CRUD-to-method mapping", "back": "Create = POST /orders, Read = GET /orders/7, Update = PUT (full replace, idempotent) or PATCH (partial change, not necessarily idempotent) /orders/7, Delete = DELETE /orders/7. The URL names the resource; the method says what you're doing to it." }, { "front": "Statelessness (in REST)", "back": "Each request is self-contained, carrying everything needed; no server-side session memory required. Inherited from HTTP, it lets any server handle any request, enabling load balancing and scaling." }, { "front": "Collection vs item URLs", "back": "A collection (GET /users, POST /users) uses a plural noun and operates on the set; an item (GET/PUT/PATCH/DELETE /users/42) operates on one resource." }, { "front": "Why JSON-over-HTTP is not REST", "back": "Returning JSON doesn't make an API RESTful. REST is the conventions: resource URLs, correct verbs, status codes, and statelessness — which buy predictability, cacheability, and tooling." }, { "front": "REST vs GraphQL vs gRPC", "back": "Alternatives to REST: GraphQL uses client-specified queries; gRPC is binary RPC over Protobuf. REST wins on simplicity, ubiquity, and cacheability." } ] }
```

## Key takeaways

- REST models the system as **resources (nouns)** acted on by **standard HTTP verbs** — not custom
  action endpoints.
- URLs identify resources (`/users/42`); methods map to **CRUD** (POST/GET/PUT-PATCH/DELETE).
- It builds on HTTP's **statelessness, status codes, and method semantics** for consistency and
  cacheability.
- **JSON-over-HTTP ≠ REST** — the value is the conventions, which make APIs predictable and tool-friendly.

## Up next

REST signals outcomes with status codes — let's learn to read and choose them. Next: **HTTP Status
Codes**.
