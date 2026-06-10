---
title: "HTTP Fundamentals"
slug: http-fundamentals
level: foundations
module: networking-fundamentals
order: 13
reading_time_min: 15
concepts: [http, methods, headers, request-response, statelessness, http2-http3]
use_cases: []
prerequisites: [tcp, tls-https]
status: published
---

# HTTP Fundamentals

## Hook — a motivating scenario

Every web page, mobile app, and API call your systems make speaks the same language: HTTP. When a
request mysteriously fails — a 401, a CORS error, a cache that won't update, a POST that runs twice —
the answer is almost always in the HTTP **method**, **headers**, or **status code**. Fluency in HTTP
is the single most reused networking skill you'll have.

## Mental model — a structured request and a structured reply

HTTP is a simple, text-shaped conversation over the secure, reliable channel we just built: the
client sends a **request**, the server sends back a **response**. Each has the same three parts: a
**start line** (the request line carries method + path; the response line carries the status code),
**headers** (metadata key-values), and an optional **body** (the data).

```sequence
{
  "title": "One HTTP request/response",
  "actors": ["Client", "Server"],
  "steps": [
    { "from": "Client", "to": "Server", "label": "GET /users/42  + headers" },
    { "from": "Server", "to": "Client", "label": "200 OK + headers + JSON body" },
    { "from": "Client", "to": "Server", "label": "POST /orders  + body" },
    { "from": "Server", "to": "Client", "label": "201 Created + Location header" }
  ]
}
```

## Build it up — methods, headers, and statelessness

**Methods (verbs)** describe intent. Their *semantics* matter — proxies, caches, and browsers treat
them differently:

```compare
{
  "options": [
    { "label": "GET", "points": ["Read a resource", "Safe (no side effects) + cacheable", "No body", "Retried freely"] },
    { "label": "POST", "points": ["Create / submit", "Not safe, not idempotent by default", "Has a body", "Don't blindly retry"] },
    { "label": "PUT / PATCH", "points": ["Update (replace / modify)", "PUT is idempotent; PATCH may not be", "Has a body", "Used for edits"] },
    { "label": "DELETE", "points": ["Remove a resource", "Idempotent", "Usually no body", "—"] }
  ]
}
```

**Headers** carry metadata that controls behavior: `Content-Type` (body format), `Authorization`
(credentials), `Cache-Control` (caching rules), `Accept` (what the client wants back), `Cookie`,
`User-Agent`, CORS headers, and many more. A huge share of "why isn't this working" bugs live here.

**Statelessness** is HTTP's defining trait: each request is **independent** — the server keeps no
memory of previous requests. Anything that must persist (who you are, a shopping cart) is carried
*explicitly* each time, via cookies/tokens or stored server-side keyed by an ID. This is what lets
any server handle any request, which is the foundation of horizontal scaling (later chapters).

```reveal
{
  "prompt": "If HTTP is stateless, how does a site 'remember' you're logged in across requests?",
  "answer": "It doesn't — the request carries the proof each time. After login the server issues a token/session ID (often in a cookie); the browser sends it with every subsequent request, and the server validates it per request. State lives in the token or in a store keyed by it, not in the connection. That's why any server behind a load balancer can handle your next request."
}
```

## In the wild

- **HTTP/1.1 → HTTP/2 → HTTP/3:** same semantics (methods, headers, status), better transport.
  HTTP/2 multiplexes many requests over one TCP connection; HTTP/3 runs over QUIC/UDP to dodge TCP
  head-of-line blocking. You design against the *semantics*, which are stable.
- **Idempotency & retries** hinge on method semantics — safely retry GET/PUT/DELETE, be careful with
  POST (its own chapter later).
- **Caching** is driven by `Cache-Control`/`ETag` headers and method (GET is cacheable) — the basis
  of CDNs and browser caches.
- **CORS, auth, content negotiation** are all just headers — learning to read them in dev tools is a
  superpower.

## Common misconception — "GET vs POST is just about where the data goes"

The real difference is **semantics**, which infrastructure relies on.

```reveal
{
  "prompt": "Why is using GET to perform an action (like GET /deleteUser?id=42) a genuinely bad idea?",
  "answer": "GET is defined as safe and cacheable, so the whole ecosystem assumes it has no side effects: browsers prefetch links, proxies/CDNs cache responses, crawlers follow GETs, and clients retry them freely. A side-effecting GET can be triggered by a prefetch or crawler, cached, or retried — deleting data unexpectedly. Actions belong on POST/PUT/DELETE precisely because of these semantics, not just to hide params from the URL."
}
```

Methods are a *contract* the whole web relies on. GET = safe/cacheable read; mutations go on
POST/PUT/PATCH/DELETE. Violating that invites caching and prefetch disasters.

## Self-test

```quiz
{
  "question": "What does it mean that HTTP is 'stateless'?",
  "options": [
    "The server stores all client state automatically",
    "Each request is independent; the server keeps no memory of prior requests",
    "It can't use cookies",
    "It can only return text"
  ],
  "answer": 1,
  "explanation": "Each request stands alone; any continuity (auth, cart) must be carried explicitly via tokens/cookies or a keyed store."
}
```

```quiz
{
  "question": "Which method is 'safe' (no side effects) and cacheable, and should not be used to change data?",
  "options": ["POST", "GET", "DELETE", "PATCH"],
  "answer": 1,
  "explanation": "GET is defined as safe and cacheable; the ecosystem assumes it has no side effects, so mutations must use POST/PUT/PATCH/DELETE."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "HTTP fundamentals — key terms", "cards": [ { "front": "HTTP request/response structure", "back": "Each message has three parts: a line (verb/status), headers (metadata key-values), and an optional body (the data). Client sends a request, server sends a response." }, { "front": "Statelessness", "back": "Each request is independent; the server keeps no memory of prior requests. Anything that must persist is carried explicitly each time via cookies/tokens or a store keyed by an ID." }, { "front": "Safe method", "back": "A method with no side effects, like GET. The ecosystem assumes safe methods can be prefetched, cached, and retried freely, so they must not change data." }, { "front": "Idempotent method", "back": "Repeating the request has the same effect as doing it once. GET, PUT, and DELETE are idempotent and safe to retry; POST is not idempotent by default." }, { "front": "Headers", "back": "Metadata key-values that control behavior: Content-Type, Authorization, Cache-Control, Accept, Cookie, CORS headers, and more. The home of most everyday HTTP bugs." }, { "front": "HTTP/1.1 to HTTP/2 to HTTP/3", "back": "Same semantics (methods, headers, status), better transport. HTTP/2 multiplexes over one TCP connection; HTTP/3 runs over QUIC/UDP to dodge TCP head-of-line blocking." } ] }
```

## Key takeaways

- HTTP is a **stateless request/response** protocol: each message has a line, **headers**, and an
  optional **body**.
- **Methods carry semantics** the whole web relies on (GET safe/cacheable; POST/PUT/PATCH/DELETE for
  changes) — not just "where the data goes."
- **Headers** drive auth, caching, content type, and CORS — the home of most everyday bugs.
- **Statelessness** (carry identity per request) is what makes servers interchangeable and enables
  horizontal scaling.

## Up next

That completes networking. Now we shift from moving bytes to **storing** them — starting with
**Where Your Data Lives**.
