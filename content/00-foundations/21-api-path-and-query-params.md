---
title: "API Path & Query Parameters"
slug: api-path-and-query-params
level: foundations
module: apis-and-the-web
order: 21
reading_time_min: 11
concepts: [path-params, query-params, filtering, encoding, api-design]
use_cases: []
prerequisites: [rest-api-fundamentals]
status: published
---

# API Path & Query Parameters

## Hook — a motivating scenario

You're designing the endpoint to fetch "all delivered orders for user 42, sorted by date, page 2."
Does the user ID go in the URL path? The filters? The page number? Put them in the wrong place and
your API becomes inconsistent, uncacheable, or impossible to extend. Path vs query is a small choice
you'll make on *every* endpoint — worth getting the rule right once.

## Mental model — the address vs the instructions

- **Path parameters** are part of the resource's **address** — they identify *which* thing.
  `/users/42/orders/7` → user 42, order 7. Change them and you're pointing at a different resource.
- **Query parameters** are **instructions about the request** — filtering, sorting, paginating,
  searching over a collection. `/orders?status=delivered&sort=date&page=2`. They don't change *which*
  collection, just *how* you want it returned.

> Rule of thumb: **path = identity** ("which resource"), **query = modifiers** ("how to filter/shape
> the result").

```compare
{
  "options": [
    { "label": "Path parameter", "points": ["Identifies a specific resource", "/users/42, /orders/7", "Hierarchical, required", "Different value = different resource"] },
    { "label": "Query parameter", "points": ["Filters/sorts/paginates a collection", "?status=open&sort=date&page=2", "Optional, order-independent", "Same resource, different view"] }
  ]
}
```

## Build it up — applying the rule

- "Get order 7" → the order is identified → **path**: `GET /orders/7`.
- "Get open orders, newest first, page 2" → filtering/sorting/paging a collection → **query**:
  `GET /orders?status=open&sort=-date&page=2`.
- "Get user 42's orders" → 42 identifies whose orders (identity) → **path**:
  `GET /users/42/orders`, then add filters via **query**.

```reveal
{
  "prompt": "Should `page` and `limit` for pagination be path or query parameters? Why?",
  "answer": "Query parameters: `GET /orders?page=2&limit=20`. They don't identify a different resource — they shape how the same collection is returned (which slice, how many). Putting them in the path (`/orders/page/2`) implies they're part of the resource's identity, which they're not, and it bloats the URL hierarchy. Identity → path; result-shaping → query."
}
```

**One detail that bites:** query values must be **URL-encoded** (spaces → `%20`, `&`/`=`/`+` have
special meaning). Sending raw special characters breaks parsing — libraries handle this if you let
them build the query rather than concatenating strings.

## In the wild

- **Filtering, sorting, pagination, search** are the canonical query-param use cases across virtually
  every API.
- **GET requests carry inputs in path + query, not a body** — so caches and CDNs can key on the full
  URL (a GET with the same URL is cacheable; this is partly why GETs avoid request bodies).
- **Sensitive data doesn't belong in URLs:** query strings land in server logs, browser history, and
  proxies — put secrets/tokens in headers, not query params.
- **Stable, predictable params** make an API easy to cache and to evolve (add new optional query
  params without breaking anyone).

## Common misconception — "it doesn't matter where parameters go as long as the server reads them"

It matters for caching, logging, security, and consistency.

```reveal
{
  "prompt": "A team passes an auth token as `?token=abc123` in the query string and it 'works'. What's the hidden problem?",
  "answer": "URLs are logged and cached everywhere — web server access logs, proxies, CDNs, browser history, analytics. A token in the query string leaks into all of those, a real security exposure, and may get cached and reused. Credentials belong in the Authorization header (or a secure cookie), which isn't logged/cached the same way. 'It works' hides a credential-leak waiting to happen."
}
```

Parameter placement affects cacheability (URL is the cache key), security (URLs get logged), and
API consistency — not just whether the server can read the value.

## Self-test

```quiz
{
  "question": "Which belongs in a PATH parameter?",
  "options": [
    "The page number for pagination",
    "A sort order",
    "The ID of the specific resource being addressed",
    "A search keyword"
  ],
  "answer": 2,
  "explanation": "Path = identity (which resource). Pagination/sort/search shape the result → query parameters."
}
```

```quiz
{
  "question": "Why should you avoid putting an auth token in a query string?",
  "options": [
    "Query strings are slower",
    "URLs are logged/cached in many places, leaking the credential",
    "Tokens can't be URL-encoded",
    "It violates TCP"
  ],
  "answer": 1,
  "explanation": "URLs end up in logs, history, proxies, and caches — secrets belong in headers, not the URL."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "API path & query parameters — key terms", "cards": [ { "front": "Path parameter", "back": "Part of a resource's address — identifies which thing. /users/42/orders/7. Change it and you point at a different resource. Hierarchical and required." }, { "front": "Query parameter", "back": "Instructions about the request — filtering, sorting, paginating, searching over a collection. Same resource, different view. Optional and order-independent." }, { "front": "Rule of thumb: path vs query", "back": "Path = identity (which resource); query = modifiers (how to filter/sort/paginate/shape the result returned)." }, { "front": "Where do page and limit go?", "back": "Query parameters: /orders?page=2&limit=20. They shape how the same collection is returned, not which resource it is — so they aren't part of identity." }, { "front": "URL encoding of query values", "back": "Query values must be URL-encoded (spaces become %20; &, =, + have special meaning). Raw special characters break parsing; let libraries build the query." }, { "front": "Why secrets don't belong in URLs", "back": "Query strings land in server logs, browser history, proxies, and caches. A token there leaks everywhere and may be reused. Put credentials in headers instead." } ] }
```

## Key takeaways

- **Path = identity** (which resource); **query = modifiers** (filter/sort/paginate/search the same
  collection).
- Pagination, filtering, sorting, and search are **query parameters**; resource IDs are **path
  parameters**.
- **URL-encode** query values, and never put **secrets** in the URL (it's logged and cached).
- Correct placement improves **caching, security, and consistency**, not just functionality.

## Up next

Returning a huge collection in one response is a problem of its own. Next: **API Pagination**.
