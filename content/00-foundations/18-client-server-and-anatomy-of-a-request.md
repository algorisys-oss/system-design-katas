---
title: "Client–Server Model & Anatomy of a Web Request"
slug: client-server-and-anatomy-of-a-request
level: foundations
module: apis-and-the-web
order: 18
reading_time_min: 16
concepts: [client-server, request-lifecycle, dns, tcp, tls, load-balancer, response]
use_cases: []
prerequisites: [how-the-internet-works, dns, tcp, tls-https, http-fundamentals]
status: published
---

# Client–Server Model & Anatomy of a Web Request

## Hook — a motivating scenario

You type a URL, press Enter, and ~200 ms later a page appears. In that blink, a dozen systems
cooperated: a name was resolved, a secure connection negotiated, a request routed to one of many
servers, a database queried, a response assembled and sent back. This is the chapter where every
piece you've learned so far snaps together into one picture — the picture you'll mentally replay
every time you debug "why is this slow / failing."

## Mental model — customers and a restaurant

The **client** (browser, mobile app, another service) is a customer who makes requests. The
**server** is the restaurant that fulfills them. The customer doesn't cook; the kitchen doesn't
decide what you want. They cooperate through a clear interface (the menu = the API): **request →
work → response**. Crucially, one restaurant can serve many customers, and (as we'll see) many
identical kitchens can serve one stream of customers.

## Build it up — the full journey of a request

Here is everything from the last two modules, in order, for `GET https://algoroq.io/dashboard`:

```flow
{
  "title": "Anatomy of a web request (and back)",
  "nodes": [
    { "label": "Browser", "detail": "Builds the HTTP request. First needs the server's IP." },
    { "label": "DNS", "detail": "Resolve algoroq.io → IP (cached at many levels; ~ms or instant)." },
    { "label": "TCP + TLS", "detail": "Open a connection (handshake) and negotiate encryption (HTTPS). Round-trip setup cost." },
    { "label": "Load balancer", "detail": "Public entry point; routes the request to one healthy server among many." },
    { "label": "App server", "detail": "Runs your code: auth, business logic, builds the response." },
    { "label": "Database / cache", "detail": "Server fetches data — cache first (fast), DB if missed." },
    { "label": "Response", "detail": "Server returns HTTP status + headers + body; browser renders it." }
  ],
  "note": "Click each hop. Every concept so far lives on this path — and every one is a place latency or failure can hide."
}
```

Then walk the lifecycle as discrete stages:

```stepper
{
  "title": "Request lifecycle, stage by stage",
  "steps": [
    { "title": "1 · Resolve", "body": "Browser resolves the hostname to an IP via DNS (often cached)." },
    { "title": "2 · Connect", "body": "TCP three-way handshake, then TLS handshake for HTTPS — round trips before any data." },
    { "title": "3 · Request", "body": "Browser sends the HTTP request: method, path, headers (incl. auth cookie/token), maybe a body." },
    { "title": "4 · Route", "body": "A load balancer picks one healthy app server (since HTTP is stateless, any server can handle it)." },
    { "title": "5 · Process", "body": "The server authenticates, runs business logic, reads cache/DB, and builds a response." },
    { "title": "6 · Respond", "body": "HTTP status + headers + body travel back; the browser parses and renders, possibly firing more requests (CSS, JS, images, API calls)." }
  ]
}
```

The single most important structural fact: because HTTP is **stateless** and the app servers are
**interchangeable**, a load balancer can spread requests across many of them — the basis of scaling,
which the rest of the course builds on.

```reveal
{
  "prompt": "A page loads slowly only on the very first request after opening the app, then feels fast. Which stages explain the one-time cost?",
  "answer": "The cold path pays for DNS resolution (uncached), the TCP handshake, and the TLS handshake — all one-time round trips that get reused/cached afterward (keep-alive connections, cached DNS). Subsequent requests skip most of stages 1–2, so they feel fast. This is why connection reuse and DNS/TLS caching matter."
}
```

## In the wild

- **Where time goes:** DNS (cached → ~0), connection setup (one-time), server processing (your code +
  DB), and network transfer. Browser dev tools' "waterfall" shows exactly this breakdown.
- **The load balancer** is the public face; behind it, many stateless app servers and shared
  data stores. This shape recurs in nearly every web architecture.
- **One page = many requests:** the initial HTML triggers requests for CSS, JS, images, fonts, and
  API calls — each its own mini-journey. Fewer/parallel requests = faster pages.
- **Failure isolation:** each hop can fail (DNS down, TLS cert expired, LB unhealthy, DB timeout) —
  knowing the path tells you where to look.

## Common misconception — "the server remembers me between requests"

The connection and the server are not where your identity lives.

```reveal
{
  "prompt": "If a load balancer can send your next request to a different server than your last one, how does the app still know who you are?",
  "answer": "Identity travels with each request (a session cookie or token), and shared state lives in a common store (DB/cache) — not in any single server's memory. Because HTTP is stateless and servers are interchangeable, the request carries proof of identity and any server can validate it. That's exactly what makes load balancing across many servers possible."
}
```

There's no sticky 'memory' in the server or the connection — each request is self-contained, which is
the property that lets the architecture scale horizontally.

## Self-test

```quiz
{
  "question": "Put the early stages of a typical HTTPS request in order:",
  "options": [
    "TLS handshake → DNS → TCP handshake → HTTP request",
    "DNS resolve → TCP handshake → TLS handshake → HTTP request",
    "HTTP request → DNS → TCP → TLS",
    "Load balancer → DNS → HTTP request → TCP"
  ],
  "answer": 1,
  "explanation": "Resolve the name (DNS), open the connection (TCP), secure it (TLS), then send the HTTP request."
}
```

```quiz
{
  "question": "What property of HTTP lets a load balancer route each request to any available app server?",
  "options": [
    "HTTP is encrypted",
    "HTTP is stateless — each request is self-contained, so servers are interchangeable",
    "HTTP uses UDP",
    "HTTP compresses responses"
  ],
  "answer": 1,
  "explanation": "Statelessness + identity carried per request means any server can handle any request — enabling load balancing and scaling."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Anatomy of a web request — key terms", "cards": [
  { "front": "Client–server model", "back": "A client (browser, app, service) makes requests; a server fulfills them over an agreed interface (the API): request → work → response. One server can serve many clients." },
  { "front": "Request lifecycle (order)", "back": "Resolve (DNS) → Connect (TCP + TLS) → Request → Route (load balancer) → Process (server logic, cache/DB) → Respond (status + headers + body)." },
  { "front": "Why the first request is costly", "back": "The cold path pays one-time round trips: uncached DNS resolution, the TCP handshake, and the TLS handshake. Later requests reuse connections and cached DNS, so they feel fast." },
  { "front": "Load balancer", "back": "The public entry point that routes each request to one healthy app server among many — the basis of horizontal scaling." },
  { "front": "HTTP statelessness", "back": "Each request is self-contained, so app servers are interchangeable. This lets a load balancer send any request to any server and is the structural basis for scaling." },
  { "front": "Where identity lives", "back": "Not in the server or connection. Identity travels with each request (session cookie or token); shared state lives in a common store (DB/cache) any server can read." }
] }
```

## Key takeaways

- The **client–server model** is request → work → response over an agreed interface (the API).
- A web request's journey: **DNS → TCP → TLS → load balancer → app server → cache/DB → response** —
  every earlier concept lives on this path.
- The **first request is costly** (DNS/TCP/TLS setup); reuse and caching make the rest fast.
- **Statelessness + interchangeable servers** behind a load balancer is the structural basis for all
  scaling ahead.

## Up next

We keep saying "the API." Now we define it properly: **REST API Fundamentals** — how clients and
servers agree on resources and operations.
