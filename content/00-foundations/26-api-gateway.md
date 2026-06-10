---
title: "API Gateway"
slug: api-gateway
level: foundations
module: apis-and-the-web
order: 26
reading_time_min: 13
concepts: [api-gateway, reverse-proxy, cross-cutting-concerns, routing, microservices]
use_cases: []
prerequisites: [client-server-and-anatomy-of-a-request, authentication-vs-authorization]
status: published
---

# API Gateway

## Hook — a motivating scenario

Your backend grew from one app into eight services: users, orders, payments, search… Now every
service re-implements authentication, rate limiting, logging, and CORS — slightly differently, with
slightly different bugs. Mobile clients must know eight hostnames and stitch responses together. The
fix is to put **one front door** in front of everything: an **API gateway**.

## Mental model — a hotel front desk

Guests don't wander into the kitchen, housekeeping, and accounting separately. They go to the **front
desk**, which checks their identity, enforces the rules, and routes each request to the right
department. An API gateway is that front desk for your services: a single entry point that handles the
**cross-cutting concerns** once, then forwards each request to the appropriate backend.

```flow
{
  "title": "One gateway in front of many services",
  "nodes": [
    { "label": "Clients", "detail": "Web, mobile, partners — all talk to one address." },
    { "label": "API Gateway", "detail": "Auth, rate limiting, routing, logging, TLS termination — done once, centrally." },
    { "label": "Backend services (1..N)", "detail": "Each receives only valid, authenticated, rate-limited requests for its paths." }
  ],
  "note": "Clients see one API; the gateway fans out, routing /users → users svc, /orders → orders svc, etc. — these are sibling backends reached in parallel, not a chain."
}
```

## Build it up — what a gateway centralizes

A gateway is a specialized **reverse proxy** that typically handles:

- **Routing** — map paths/hosts to backend services (`/orders/*` → orders service).
- **Authentication** — verify the token once at the edge, pass identity to services.
- **Rate limiting & throttling** — protect all backends from abuse in one place.
- **TLS termination** — decrypt HTTPS at the edge; talk to internal services over the trusted network.
- **Cross-cutting extras** — request logging/metrics, CORS, request/response transformation, caching,
  retries, circuit breaking.

The payoff: services become **simpler and focused on business logic**, and policy is **consistent**
(one place to fix an auth bug or change a rate limit), and clients get **one stable interface** even
as services split or move behind it.

```reveal
{
  "prompt": "Why is it better to authenticate at the gateway than to re-implement auth in each of 8 services?",
  "answer": "Centralizing avoids 8 slightly-different implementations (and 8 chances to get it wrong), keeps policy consistent, and lets services trust that requests reaching them are already authenticated — so they focus on business logic. One place to patch a vulnerability or rotate keys. (Services may still do their own *authorization* checks, but identity verification is done once at the edge.)"
}
```

## In the wild

- **Managed gateways:** AWS API Gateway, Kong, Apigee, NGINX, Envoy — plus cloud load balancers that
  do gateway-like routing. To set expectations on scale: AWS API Gateway's default account-level
  limit is **10,000 requests/second** with a **5,000-request burst** (raisable on request).
- **BFF (Backend for Frontend):** a gateway variant tailored per client type (web vs mobile),
  aggregating multiple service calls into one response — covered in the advanced course.
- **Gateway vs service mesh:** the gateway handles **north-south** traffic (clients → system); a
  service mesh handles **east-west** traffic (service ↔ service). Different tools, different jobs
  (advanced topic).
- **Watch the single point of failure / bottleneck:** the gateway is on every request, so it must be
  highly available and scalable (it's usually run redundantly behind a load balancer).

## Common misconception — "an API gateway is just a load balancer / it makes everything faster"

They overlap but solve different problems, and a gateway adds a hop.

```reveal
{
  "prompt": "How is an API gateway different from a plain load balancer, and does adding one make requests faster?",
  "answer": "A load balancer mainly spreads traffic across identical instances of one service (L4/L7). A gateway is application-aware: it routes by path to *different* services and applies cross-cutting policy (auth, rate limiting, transformation). It adds value, not raw speed — in fact it adds a network hop and processing, so it can add a little latency. You use it for centralization, consistency, and a clean client interface, not to go faster (though caching at the gateway can help specific cases)."
}
```

A gateway centralizes policy and routing across many services; a load balancer distributes load
across instances. The gateway's benefit is **simplicity and consistency**, accepting a small latency
cost and the need to keep it highly available.

## Self-test

```quiz
{
  "question": "The primary purpose of an API gateway is to:",
  "options": [
    "Store the database",
    "Provide a single entry point that handles cross-cutting concerns (auth, rate limiting, routing) for many services",
    "Replace the need for any backend services",
    "Make the network physically faster"
  ],
  "answer": 1,
  "explanation": "It's the front door: one place for auth, rate limiting, routing, TLS, logging — so services stay focused."
}
```

```quiz
{
  "question": "A risk of introducing an API gateway is that it:",
  "options": [
    "Removes the need for authentication",
    "Becomes a single point of failure/bottleneck on every request, so it must be highly available",
    "Prevents using HTTPS",
    "Makes services unable to scale"
  ],
  "answer": 1,
  "explanation": "Since all traffic flows through it, the gateway must be redundant and scalable to avoid being a SPOF/bottleneck."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "API Gateway — key terms", "cards": [ { "front": "API gateway", "back": "A single front door (specialized reverse proxy) for many services that centralizes cross-cutting concerns and routes each request to the right backend." }, { "front": "Cross-cutting concerns", "back": "Policies needed by every service — auth, rate limiting, logging/metrics, CORS, TLS termination — handled once at the gateway instead of re-implemented per service." }, { "front": "Routing", "back": "Mapping paths or hosts to backend services, e.g. /orders/* goes to the orders service, so clients see one API." }, { "front": "TLS termination", "back": "Decrypting HTTPS at the gateway edge, then talking to internal services over the trusted network." }, { "front": "Gateway vs load balancer", "back": "A load balancer spreads traffic across identical instances; a gateway is app-aware, routing by path to different services and applying policy. It adds a hop, not speed." }, { "front": "Gateway as SPOF", "back": "Because the gateway is on every request, it can become a single point of failure or bottleneck, so it must be highly available and scalable (run redundantly behind a load balancer)." } ] }
```

## Key takeaways

- An API gateway is a **single front door** (specialized reverse proxy) that centralizes
  cross-cutting concerns: routing, **auth, rate limiting**, TLS termination, logging.
- It keeps **services simple and focused**, policy **consistent**, and gives clients **one stable
  interface**.
- It's **not** just a load balancer (app-aware routing across *different* services) and it **adds a
  hop**, not speed.
- Because it's on every request, design it for **high availability** to avoid a SPOF/bottleneck.

## Up next

One of the gateway's key jobs deserves its own chapter — protecting backends from overload. Next:
**Rate Limiting**.
