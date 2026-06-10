---
title: "Global Load Balancing"
slug: global-load-balancing
level: advanced
module: global-scale
order: 28
reading_time_min: 14
concepts: [global-load-balancing, geo-dns, anycast, latency-routing, geo-routing, failover]
use_cases: []
prerequisites: [load-balancing, cdn, dns]
status: published
---

# Global Load Balancing

## Hook — a motivating scenario

You've deployed your app in datacenters on three continents for low latency and resilience. But how
does a user in Tokyo automatically reach the Tokyo region (not Virginia), and how does traffic shift
**away from a whole region** when it goes down? A normal load balancer distributes across servers
*within* a datacenter. **Global load balancing** operates one level up — directing users **across
regions/datacenters worldwide** by location, latency, and health.

## Mental model — route users to the right region, globally

**Global server load balancing (GSLB)** decides **which region/datacenter** a user's request goes to,
based on:
- **Geography/latency:** send users to the **closest/lowest-latency** region (Tokyo users → Asia).
- **Health:** route **away from failed regions** (whole-region failover).
- **Capacity/policy:** balance load across regions, respect data-residency rules, do weighted/canary
  rollouts.

**Analogy:** think of a national support line. The phone system first routes your call by area code
to the **nearest branch** (the global tier picking a region), and only then does that branch hand you
to an **available agent** (the regional tier picking a server). If a whole branch is closed, the system
reroutes your call to the next-nearest open one — exactly what whole-region failover does.

It's the **inter-region** tier above the **intra-region** load balancers you already know (which then
spread requests across servers in that region).

```flow
{
  "title": "Two tiers: global (between regions) → local (within a region)",
  "nodes": [
    { "label": "User (Tokyo)", "detail": "Resolves your domain / hits an anycast IP." },
    { "label": "Global LB (GSLB)", "detail": "Picks the best region by geo/latency/health → Asia region." },
    { "label": "Regional LB", "detail": "Within Asia, spreads the request across healthy servers (recall load balancing)." },
    { "label": "Server", "detail": "Handles the request close to the user." }
  ],
  "note": "Global LB chooses the region; the regional LB chooses the server. Two layers."
}
```

## Build it up — how it's implemented: DNS vs Anycast

Two main mechanisms route users globally:
- **GeoDNS / DNS-based:** the **DNS** resolver returns a **different IP per user location/latency** (the
  nearest region's address). Simple and widely used, but it inherits **DNS caching/TTL lag** — when a
  region fails, clients/resolvers caching the old IP keep hitting it until the TTL expires, slowing
  failover (so use **low TTLs** + health checks).
- **Anycast:** the **same IP** is announced from **many locations**; the **network (BGP)** routes each
  user to the **topologically nearest** announcement. Failover is **fast** (routes reconverge when a
  location withdraws) and there's no DNS-cache lag — used by **CDNs and large DNS/edge providers**.
  More complex (needs BGP/network control).

```reveal
{
  "prompt": "Why does DNS-based global load balancing fail over slowly, and how does Anycast avoid that problem?",
  "answer": "DNS-based GSLB works by handing out a region-specific IP address in the DNS response, and DNS responses are cached for their TTL all along the chain (the client OS, the browser, and intermediate resolvers). When a region goes down, the global LB can start returning a healthy region's IP, but every client/resolver that already cached the failed region's IP will keep using it until its cached record expires — and many resolvers honor (or even extend) TTLs imperfectly. So users keep hitting the dead region for seconds to minutes (however long the TTL plus caching misbehavior lasts), making failover slow and partial. You mitigate it with very low TTLs and health-check-driven DNS updates, but low TTLs increase DNS query load and you can't fully control downstream caching, so there's always lag. Anycast avoids this entirely by not changing the address: the SAME IP is advertised (via BGP) from many locations, and the internet's routing fabric delivers each user's packets to the nearest advertising location. If a location fails and withdraws its BGP announcement, routers reconverge and automatically send traffic to the next-nearest location holding that same IP — typically within seconds and with no dependence on DNS caches, because the client keeps using the identical IP; only the network path changes. So Anycast gives fast, cache-independent regional failover (and natural proximity routing) at the cost of needing BGP/network-level control, which is why CDNs and large edge/DNS providers use it; DNS-based GSLB is simpler to run but inherently laggy on failover due to caching."
}
```

Choosing the routing mechanism is a dial between operational simplicity and failover speed:

```tradeoff
{
  "title": "GeoDNS or Anycast for global routing?",
  "axis": { "left": "GeoDNS (simple, laggy failover)", "right": "Anycast (fast failover, complex)" },
  "steps": [
    { "label": "GeoDNS, normal TTL", "detail": "Return a region-specific IP per location. Simplest to run, but cached IPs mean a failed region keeps getting hit until the TTL expires." },
    { "label": "GeoDNS, low TTL + health checks", "detail": "Shorten TTLs so cached records expire faster, cutting failover lag — at the cost of more DNS query load, and you still can't control downstream resolver caching." },
    { "label": "Anycast", "detail": "Announce the SAME IP from many locations via BGP; the network routes each user to the nearest one. Failover is fast and cache-independent, but needs BGP/network control." }
  ]
}
```

## Build it up — what it gives you (and pairing with CDNs)

- **Low latency:** users hit the **nearest** region (recall: latency is dominated by distance/round
  trips) — the same proximity principle as a **CDN**, applied to dynamic app traffic, not just static
  assets.
- **High availability / disaster recovery:** **whole-region failover** — if a region dies, traffic
  shifts to others (the region-level version of LB health checks → failover; recall SPOF). Enables
  active-active or active-passive multi-region (next chapters).
- **Compliance/geo policy:** keep EU users' traffic in EU regions (data residency).
- **Pairs with CDNs/edge:** CDNs already do anycast + geo-routing for static content at the edge; GSLB
  extends region selection to your **origin/app** tier.

```reveal
{
  "prompt": "How is global load balancing conceptually similar to a CDN, and what does it add beyond what a CDN does?",
  "answer": "Both exploit the same core principle: latency is dominated by physical distance / number of network round trips, so serving each user from a nearby location is far faster than from one central place — and both route users to the nearest healthy location (typically via anycast and/or geo-aware DNS). A CDN applies this to cacheable, mostly-static content: it places copies at edge PoPs worldwide and serves them from the closest edge, with origin fetch on miss. Global load balancing applies the same proximity-and-health routing to your DYNAMIC application/origin tier: it directs each user's (uncacheable, stateful) requests to the nearest healthy REGION running your services, then the regional load balancer picks a server. What GSLB adds beyond a CDN: (1) it routes to full application regions that run business logic and own data, not just edge caches of static assets; (2) it provides whole-region failover and disaster recovery for your app (shift traffic off a dead region), enabling active-active/active-passive multi-region deployments; (3) it can enforce capacity balancing, weighted/canary rollouts, and data-residency/compliance routing across regions. So a CDN handles 'serve static content from the edge'; GSLB handles 'send dynamic requests to the best app region.' They're complementary layers of the same geo-distribution idea: the CDN absorbs and accelerates static/cacheable traffic at the edge, while GSLB steers the dynamic traffic that must reach your regional backends — and they're often used together (CDN in front for assets and edge termination, GSLB selecting the origin region)."
}
```

## In the wild

- **Providers:** AWS Route 53 / Global Accelerator, Google Cloud Global LB, Cloudflare, Azure Front
  Door / Traffic Manager — offering GeoDNS and/or anycast global routing + health checks.
- **CDNs** (recall) use **anycast + geo-routing** at the edge; GSLB extends region selection to the app
  origin.
- It's the enabling layer for **multi-region active-active / active-passive** (next chapters) and
  **disaster recovery** (region failover).
- **Low DNS TTLs + health checks** are standard for DNS-based GSLB to limit failover lag; **anycast**
  where fast failover matters.
- **Concrete numbers:** DNS-based GSLB typically uses **low TTLs of ~30–60s**, so failover still takes
  **tens of seconds to a few minutes** as cached records expire (and some resolvers honor TTLs
  imperfectly). **Anycast** failover is **network-level** — BGP reconverges to the next-nearest
  location in **seconds**, with no DNS-cache dependence. AWS Route 53 health checks default to a
  **30-second interval** (with a 10-second "fast" option), and treat an endpoint as unhealthy after a
  small number of consecutive failed checks.

## Common misconception — "a load balancer already handles this" / "global LB makes failover instant"

A normal LB is **intra-region**; global LB is **inter-region** — and DNS-based failover is **not
instant**.

```reveal
{
  "prompt": "Why isn't a regular (regional) load balancer enough for a multi-region deployment, and why is 'add a global LB and failover is instant' misleading?",
  "answer": "A regular load balancer operates WITHIN a single region/datacenter: it spreads incoming requests across the healthy servers behind it and fails over between those servers, but it has no concept of routing users to a different region or shifting traffic off a whole failed region. In a multi-region deployment you need a layer ABOVE the regional LBs that decides which region each user should reach (by geography/latency for low latency, and by health for whole-region failover) and that can steer traffic away from an entire dead region — that's global load balancing (GSLB), via geo-DNS and/or anycast. Without it, you'd have great per-region balancing but no way to send Tokyo users to Asia or to evacuate a failed region, defeating the point of multi-region. As for 'failover is instant': it depends on the mechanism. DNS-based GSLB is NOT instant — clients and resolvers cache the region's IP for its TTL (and may honor TTLs poorly), so after a region fails, cached clients keep hitting it until the record expires, giving seconds-to-minutes of degraded failover even with low TTLs and health checks. Anycast gives much faster, cache-independent failover (BGP reconverges to the next-nearest location holding the same IP, typically within seconds) but needs network-level control. So adding a global LB is necessary for multi-region routing/failover, but you must understand its failover latency characteristics — DNS-based has inherent caching lag, anycast is fast — rather than assuming 'global LB = instant failover.' Set expectations and TTLs accordingly, and choose the mechanism to match your failover-time requirements."
}
```

**Global load balancing (GSLB)** routes users **across regions** by **geo/latency, health, and policy**
— the inter-region tier above your regional LBs. It's implemented via **GeoDNS** (simple, but
**TTL/cache failover lag**) or **Anycast** (fast, cache-independent failover, needs BGP). It delivers
**low latency + whole-region failover** (like a CDN, for dynamic app traffic) and enables
**multi-region** deployments.

## Self-test

```quiz
{
  "question": "Global load balancing differs from a normal load balancer in that it:",
  "options": [
    "Distributes requests across servers within one datacenter",
    "Routes users across regions/datacenters worldwide (by geo/latency/health), above the regional load balancers",
    "Only works for static content",
    "Replaces DNS entirely"
  ],
  "answer": 1,
  "explanation": "GSLB is the inter-region tier (pick the region by location/latency/health); regional LBs then pick the server within that region."
}
```

```quiz
{
  "question": "Compared to DNS-based global load balancing, Anycast provides faster failover because:",
  "options": [
    "It uses a different IP per region",
    "It announces the SAME IP from many locations, so the network reroutes to the nearest healthy one with no DNS-cache lag",
    "It disables health checks",
    "It caches responses longer"
  ],
  "answer": 1,
  "explanation": "Anycast failover is network-level (BGP reconverges) using one IP, avoiding the TTL/caching lag that slows DNS-based failover."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Global load balancing — key terms", "cards": [
  { "front": "Global server load balancing (GSLB)", "back": "The inter-region tier that decides which region/datacenter a request reaches, based on geography/latency, health, and capacity/policy — above the regional LBs that pick a server." },
  { "front": "GeoDNS / DNS-based GSLB", "back": "DNS returns a different region IP per user location/latency. Simple and common, but inherits DNS caching/TTL lag, slowing failover; mitigated with low TTLs plus health checks." },
  { "front": "Anycast", "back": "The same IP is announced from many locations; BGP routes each user to the topologically nearest one. Fast, cache-independent failover, but needs network/BGP control." },
  { "front": "Whole-region failover", "back": "Shifting traffic away from an entire failed region to others — the region-level version of LB health checks and failover, enabling multi-region availability and disaster recovery." },
  { "front": "GSLB vs CDN", "back": "Both route users to the nearest healthy location by the proximity principle. A CDN serves static/cacheable content at the edge; GSLB steers dynamic app requests to the nearest healthy region." },
  { "front": "Why DNS failover isn't instant", "back": "Clients and resolvers cache the region IP for its TTL (often imperfectly), so they keep hitting a dead region until the record expires — seconds to minutes of lag even with low TTLs." }
] }
```

## Key takeaways

- **Global load balancing (GSLB)** routes users **across regions/datacenters** by **geography/latency,
  health, and capacity/policy** — the **inter-region** tier above your **regional** load balancers.
- Implemented via **GeoDNS** (simple, but **DNS TTL/caching failover lag** — use low TTLs + health
  checks) or **Anycast** (same IP everywhere; **fast, cache-independent** failover; needs BGP).
- It delivers **low latency** (nearest region — like a CDN for dynamic traffic) and **whole-region
  failover / DR**, enabling **multi-region** deployments.
- It's **not** a regular LB (that's intra-region), and **DNS-based failover isn't instant** (caching
  lag).

## Up next

Running multiple regions that all serve writes is the hardest version of this. Next: **Multi-Region
Active-Active**.
