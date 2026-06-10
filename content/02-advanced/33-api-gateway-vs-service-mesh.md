---
title: "API Gateway vs Service Mesh"
slug: api-gateway-vs-service-mesh
level: advanced
module: global-scale
order: 33
reading_time_min: 14
concepts: [api-gateway, service-mesh, north-south, east-west, sidecar, mtls]
use_cases: []
prerequisites: [api-gateway, monoliths-vs-microservices, load-balancing]
status: published
---

# API Gateway vs Service Mesh

## Hook — a motivating scenario

You have an **API gateway** handling client traffic — auth, rate limiting, routing into your services.
But inside the cluster, your 40 microservices call *each other* constantly, and you find yourself
re-implementing retries, timeouts, mTLS, and tracing in every service, in every language. The gateway
manages traffic **coming in**; what manages traffic **between** services? That's a **service mesh** —
and the two solve **different directions** of traffic.

## Mental model — north-south vs east-west traffic

The key distinction is **which traffic** each manages:
- **API gateway → north-south traffic:** requests **entering/leaving** your system (client ↔ services).
  A single entry point at the edge of your backend handling **external** concerns: auth, rate limiting,
  routing, request aggregation, TLS termination (recall the API gateway chapter).
- **Service mesh → east-west traffic:** requests **between services inside** your system
  (service ↔ service). It manages **internal** service-to-service communication: retries, timeouts,
  circuit breaking, load balancing, **mTLS**, and observability — **transparently**, without each
  service implementing them.

```compare
{
  "options": [
    { "label": "API gateway (north-south)", "points": ["Client ↔ services (entry/exit point)", "Auth, rate limiting, routing, aggregation, TLS termination", "One edge component for external traffic", "Faces the outside world"] },
    { "label": "Service mesh (east-west)", "points": ["Service ↔ service (internal calls)", "Retries, timeouts, circuit breaking, mTLS, tracing", "Sidecar proxy next to every service (transparent)", "Faces internal traffic between services"] }
  ]
}
```

## Build it up — how a service mesh works: sidecars

A service mesh's trick is the **sidecar proxy**: a proxy (e.g. Envoy) deployed **alongside every
service instance**, intercepting all its inbound/outbound traffic. The service just makes a normal call;
the **sidecar** transparently adds retries, timeouts, circuit breaking, load balancing, mTLS
encryption, and tracing — so this logic lives **in the infrastructure, not in each service's code**
(in any language). A **control plane** configures all the sidecars centrally (policies, routing, certs).

```reveal
{
  "prompt": "Why move retries, timeouts, circuit breaking, and mTLS into a service-mesh sidecar instead of implementing them in each service's code?",
  "answer": "Because these are cross-cutting communication concerns that every service needs, and implementing them in code means re-doing the same work repeatedly, inconsistently, and per-language. In a polyglot microservice estate, each service (Java, Go, Node, Python…) would need its own library and correct configuration for retries with backoff, timeouts, circuit breakers, client-side load balancing, mTLS certificate handling/rotation, and distributed-tracing propagation — duplicated effort, drift between services, subtle bugs (e.g. a retry storm because one service lacked backoff), and a nightmare to update consistently (a fix means re-releasing every service). A sidecar proxy deployed next to each instance intercepts all traffic and applies these behaviors transparently, so the application code just makes a plain network call and the infrastructure handles resilience, security, and observability uniformly — regardless of the service's language. Benefits: consistency (one implementation/policy everywhere), separation of concerns (developers focus on business logic, not networking plumbing), centralized control (the control plane pushes policies, routing rules, and rotates certs across all sidecars without code changes), and operational agility (change timeout/retry/mTLS policy by config, not redeploys of every service). You also get automatic mTLS (encrypted, authenticated service-to-service traffic) and consistent tracing/metrics for free. The trade-offs are real — extra proxies add latency hops and resource overhead, plus operational complexity of running the mesh — so meshes pay off mainly at larger microservice scale; but the core reason to use one is to lift these universal, error-prone communication concerns out of every codebase into uniform, centrally-managed infrastructure."
}
```

## Build it up — they're complementary, not either/or

Despite the "vs," gateways and meshes **work together** — they handle different traffic:
- A typical setup: **API gateway at the edge** (north-south: external clients → cluster), and a
  **service mesh inside** (east-west: service ↔ service). The gateway is the front door; the mesh is the
  internal nervous system.
- Many resilience patterns you've learned (retries, timeouts, **circuit breakers** — recall) are exactly
  what a mesh provides **transparently** for internal calls.
- **When you need a mesh:** many services, polyglot, needing uniform mTLS/observability/resilience —
  it's **overkill for a few services** (the sidecar overhead and operational complexity aren't worth it;
  libraries or the gateway suffice). Scale justifies it.

```reveal
{
  "prompt": "Are API gateway and service mesh competitors? When is a service mesh overkill?",
  "answer": "They're not competitors — they're complementary, handling different traffic directions, and most mature microservice systems use both. The API gateway manages north-south traffic (clients entering/leaving the system): a single edge front door for external concerns like authentication, rate limiting, routing, request aggregation, and TLS termination. The service mesh manages east-west traffic (service-to-service calls inside the system): transparent retries, timeouts, circuit breaking, load balancing, mTLS, and tracing via sidecar proxies. A common architecture is a gateway at the edge plus a mesh internally — the gateway is the entrance, the mesh is the internal communication fabric; the 'vs' is misleading. A service mesh is overkill when you have only a handful of services or low internal-call complexity: the mesh adds real costs — a sidecar proxy per instance (extra latency hops, CPU/memory overhead), plus the operational burden of running and upgrading the control plane and data plane and debugging an extra network layer. For a few services, you can get the same resilience/security with lightweight libraries (or the gateway and basic client config) without the mesh's complexity. Meshes earn their keep at scale: many services, polyglot codebases (so per-language libraries are painful), and a need for uniform mTLS, consistent observability, and centrally-managed traffic policies/resilience across all internal calls. So the decision isn't gateway-or-mesh; it's 'use a gateway for external traffic, and add a mesh for internal traffic once your service count/polyglot/security needs justify the overhead.' Start with a gateway (almost always useful) and adopt a mesh when internal service-to-service complexity makes uniform, infrastructure-level handling worth its cost."
}
```

## In the wild

- **API gateways:** Kong, AWS API Gateway, NGINX, Apigee, Envoy-based gateways (recall the API gateway
  chapter) — north-south.
- **Service meshes:** Istio, Linkerd, Consul Connect, AWS App Mesh — **Envoy** sidecars + a control
  plane — east-west.
- A mesh provides **transparent mTLS, retries/timeouts/circuit breaking, load balancing, and
  observability** for internal calls — the resilience patterns (recall) as infrastructure.
- **The cost is real and measurable:** each sidecar is a full proxy process running next to every
  service instance, so a mesh adds **one extra proxy per instance** plus its CPU/memory footprint and a
  per-hop latency cost (a request that crosses two services now passes through **2 extra proxies** — the
  caller's egress sidecar and the callee's ingress sidecar). Lightweight meshes like Linkerd advertise
  **sub-millisecond** added proxy latency at the median; that overhead, multiplied across every internal
  hop, is why a mesh only pays off once you have many services.
- **Both together** is the norm at scale; a mesh is **overkill for small systems** (use libraries / the
  gateway).

## Common misconception — "an API gateway and a service mesh are the same / you pick one"

They manage **different traffic** (north-south vs east-west) and are typically used **together**.

```reveal
{
  "prompt": "Why is treating API gateway and service mesh as interchangeable (or an either/or choice) a misunderstanding?",
  "answer": "Because they operate on different traffic and at different points in the architecture, solving different problems — they overlap only partially. An API gateway handles north-south traffic: it's the edge entry/exit point between external clients and your system, focused on external-facing concerns like authentication, authorization, rate limiting, routing, request aggregation/transformation, and TLS termination. A service mesh handles east-west traffic: the internal service-to-service calls within your system, providing transparent resilience and security (retries, timeouts, circuit breaking, client-side load balancing, mTLS) and observability via sidecar proxies, lifting that logic out of each service's code. So they're not the same thing: one faces outward at a single edge, the other pervades the internal network next to every service. Treating them as interchangeable leads to gaps — e.g. expecting a gateway to give you uniform internal mTLS, per-call retries/circuit breaking, and tracing between 40 services (it can't, it's at the edge), or expecting a mesh to be your public API front door with auth/rate-limiting/aggregation for external clients (not its role). And it's not either/or: the standard mature setup uses BOTH — a gateway as the front door for external traffic and a mesh as the internal communication fabric. There is some conceptual overlap (both can do routing, load balancing, TLS, observability), and at small scale a gateway plus libraries may suffice without a mesh, but conceptually they're complementary layers for different traffic directions. The correct mental model is north-south = gateway, east-west = mesh, commonly deployed together — not 'pick the one that does service networking.'"
}
```

**API gateway** manages **north-south** (client ↔ services) traffic — auth, rate limiting, routing,
aggregation, TLS — at the **edge**. A **service mesh** manages **east-west** (service ↔ service)
traffic — retries, timeouts, circuit breaking, **mTLS**, tracing — **transparently via sidecars** +
a control plane. They're **complementary** (gateway at the edge + mesh inside), not either/or — and a
mesh is **overkill for a few services**.

## Self-test

```quiz
{
  "question": "The core difference between an API gateway and a service mesh is:",
  "options": [
    "Gateways are faster",
    "API gateway handles north-south (client↔services) traffic; service mesh handles east-west (service↔service) traffic",
    "They are the same thing with different names",
    "A mesh replaces the need for a gateway"
  ],
  "answer": 1,
  "explanation": "Gateway = external entry/exit (auth, rate limiting, routing); mesh = internal service-to-service (retries, mTLS, tracing via sidecars). Different directions."
}
```

```quiz
{
  "question": "A service mesh adds retries, mTLS, and tracing to internal calls by:",
  "options": [
    "Requiring each service to implement them in code",
    "Using a sidecar proxy next to each service that transparently handles them, configured by a central control plane",
    "Routing all traffic through the API gateway",
    "Disabling encryption"
  ],
  "answer": 1,
  "explanation": "The sidecar intercepts traffic and applies resilience/security/observability transparently, so the logic lives in infrastructure, not each service's code."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "API gateway vs service mesh — key terms", "cards": [ { "front": "North-south traffic", "back": "Requests entering or leaving the system (client ↔ services). Managed by an API gateway at the edge: auth, rate limiting, routing, aggregation, TLS termination." }, { "front": "East-west traffic", "back": "Requests between services inside the system (service ↔ service). Managed by a service mesh: retries, timeouts, circuit breaking, load balancing, mTLS, and observability." }, { "front": "Sidecar proxy", "back": "A proxy (e.g. Envoy) deployed alongside every service instance that transparently intercepts its traffic, adding resilience, mTLS, and tracing without changing the service's code." }, { "front": "Control plane", "back": "The central component of a service mesh that configures all sidecars — pushing policies, routing rules, and rotating certificates across the mesh." }, { "front": "Why a mesh over per-service code?", "back": "It lifts cross-cutting communication concerns into infrastructure: uniform, polyglot-friendly, centrally managed — instead of each service re-implementing retries, timeouts, mTLS, and tracing." }, { "front": "When is a service mesh overkill?", "back": "For a few services: the sidecar overhead and operational complexity aren't worth it. Libraries or the gateway suffice. Scale (many polyglot services) justifies it." } ] }
```

## Key takeaways

- **API gateway** = **north-south** traffic (client ↔ services) at the **edge**: auth, rate limiting,
  routing, aggregation, TLS termination.
- **Service mesh** = **east-west** traffic (service ↔ service) **inside**: retries, timeouts, circuit
  breaking, load balancing, **mTLS**, tracing — **transparently via sidecar proxies** + a control plane.
- The mesh moves cross-cutting **communication concerns into infrastructure** (uniform, polyglot,
  centrally managed) instead of each service's code.
- They're **complementary** (gateway at the edge + mesh internally), **not either/or**; a mesh is
  **overkill for small systems** (use libraries / the gateway).

## Up next

That completes global scale & topology. Next module tackles keeping huge systems alive under failure.
First: **Cascading Failure Prevention**.
