---
title: "DNS — Domain Name System"
slug: dns
level: foundations
module: networking-fundamentals
order: 11
reading_time_min: 14
concepts: [dns, resolution, caching, ttl, records, recursive-resolver]
use_cases: []
prerequisites: [ip-addressing, udp]
status: published
---

# DNS — Domain Name System

## Hook — a motivating scenario

You moved your website to a new server, updated the address, and... half your users still hit the old
one for hours. Nothing was broken — DNS *caching* was doing its job, just not the one you wanted.
Understanding DNS explains both how a typed name becomes a connection and why "DNS changes take time
to propagate" is a real thing you must plan around.

## Mental model — the internet's phone book (with caches everywhere)

You remember names (`algoroq.io`), but machines connect to IP addresses. **DNS** is the distributed
phone book that translates names → addresses. Crucially, the answer is **cached at every level** (your
browser, OS, router, ISP resolver) so the lookup is usually instant — and so changes take time to
spread.

## Build it up — how a name gets resolved

The first time a name is looked up (nothing cached), a **recursive resolver** walks the hierarchy:

```sequence
{
  "title": "Resolving algoroq.io (cold cache)",
  "actors": ["Browser", "Resolver", "Root", "TLD (.io)", "Authoritative"],
  "steps": [
    { "from": "Browser", "to": "Resolver", "label": "where is algoroq.io?" },
    { "from": "Resolver", "to": "Root", "label": "who handles .io?" },
    { "from": "Root", "to": "Resolver", "label": "ask the .io TLD servers" },
    { "from": "Resolver", "to": "TLD (.io)", "label": "who handles algoroq.io?" },
    { "from": "TLD (.io)", "to": "Resolver", "label": "ask algoroq.io's authoritative server" },
    { "from": "Resolver", "to": "Authoritative", "label": "address for algoroq.io?" },
    { "from": "Authoritative", "to": "Resolver", "label": "A record: 203.0.113.10" },
    { "from": "Resolver", "to": "Browser", "label": "203.0.113.10 (cached for TTL)" }
  ]
}
```

After that, the answer is cached for its **TTL** (time-to-live), so subsequent lookups skip the whole
walk. DNS runs mostly over UDP (small, fast queries) — recall why that fits.

Common **record types** you'll meet: **A** (name → IPv4), **AAAA** (→ IPv6), **CNAME** (alias to
another name), **MX** (mail servers), **TXT** (verification/SPF), **NS** (which servers are
authoritative).

```reveal
{
  "prompt": "You lowered a record's TTL to 60s a day before a migration. Why does that help the cutover?",
  "answer": "TTL controls how long resolvers cache the old answer. With a high TTL (say 24h), caches keep serving the old IP long after you change it. Dropping TTL to 60s *before* the change means caches expire quickly, so when you flip the record almost everyone picks up the new IP within a minute. Plan TTL reductions ahead of migrations."
}
```

The TTL you set is a dial: short values make changes propagate fast but push more traffic to resolvers; long values keep lookups cheap but make changes slow to spread.

```tradeoff
{
  "title": "What TTL should you set on a DNS record?",
  "axis": { "left": "Short TTL (e.g. 60s)", "right": "Long TTL (e.g. 24h)" },
  "steps": [
    { "label": "60s", "detail": "Caches expire fast, so record changes propagate within a minute — ideal right before a migration cutover. The cost: more lookups reach resolvers and lookups are less likely to be cached." },
    { "label": "5 min", "detail": "A middle ground: reasonably quick propagation while still serving most requests from cache, keeping lookup latency low for typical traffic." },
    { "label": "1 hour", "detail": "Lookups are usually instant from cache and resolver load is low, but a record change can take up to an hour to be seen everywhere." },
    { "label": "24h", "detail": "Maximum cache efficiency and minimal query load, but caches keep serving the old answer for up to a day — propagation after a change is slow." }
  ]
}
```

## In the wild

- **DNS propagation delay** is really just **caches expiring on TTL** — there's no global push. Plan
  migrations by lowering TTL in advance.
- **DNS as a building block:** CDNs and global load balancers return *different* IPs based on your
  location (geo-DNS) to send you to a nearby edge — DNS is a first, coarse layer of load balancing.
- **CNAME flattening / ALIAS** records let you point a root domain at a provider's hostname.
- **DNS resolution is part of every cold request's latency** — a few ms when cached, more on a cold
  lookup; resolvers and OS caches keep it cheap.

## Common misconception — "DNS changes take effect instantly (or take exactly 24–48h)"

Both extremes are wrong; it's governed by TTL and caches.

```reveal
{
  "prompt": "After updating a DNS record, some users see the new server immediately and others see the old one for hours. Why the inconsistency?",
  "answer": "Different resolvers/devices cached the old answer at different times, each holding it until its TTL expires. There's no instant global update and no fixed '48 hours' — propagation is just every cache independently expiring. Users behind a resolver that cached recently wait longest. The old TTL value, set before your change, dictates the worst case."
}
```

DNS changes spread as caches expire, not via a central switch. The TTL you set *before* a change
determines how fast the new value propagates.

## Self-test

```quiz
{
  "question": "What does a DNS A record map?",
  "options": [
    "A domain name to an IPv4 address",
    "An IP address to a MAC address",
    "A domain to its mail servers",
    "A port to a service"
  ],
  "answer": 0,
  "explanation": "An A record maps a hostname to an IPv4 address (AAAA does IPv6)."
}
```

```quiz
{
  "question": "Why can a DNS change take time to be seen everywhere?",
  "options": [
    "Records are encrypted and slow to decode",
    "Resolvers cache answers until the TTL expires; there's no global push",
    "DNS uses TCP which is slow",
    "The root servers are offline at night"
  ],
  "answer": 1,
  "explanation": "Caches hold the old answer for its TTL; propagation is just caches expiring independently."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "DNS — key terms", "cards": [
  { "front": "DNS", "back": "The distributed phone book that translates human-readable names (algoroq.io) into IP addresses, with answers cached at every level from browser to ISP resolver." },
  { "front": "Recursive resolver", "back": "The server that walks the DNS hierarchy on your behalf — querying root, then TLD, then authoritative servers — and returns the final answer, caching it for its TTL." },
  { "front": "TTL (time-to-live)", "back": "How long a resolver may cache a DNS answer before re-querying. It governs how fast a record change propagates and how often lookups hit resolvers." },
  { "front": "DNS propagation delay", "back": "Not a global push but simply every cache independently expiring on its TTL, so a change appears at different times for different users." },
  { "front": "A vs AAAA record", "back": "An A record maps a name to an IPv4 address; an AAAA record maps a name to an IPv6 address." },
  { "front": "CNAME record", "back": "An alias pointing one name to another name (rather than to an IP), so the target's address is resolved indirectly." }
] }
```

## Key takeaways

- DNS translates **names → IP addresses** via a cached, hierarchical lookup (root → TLD →
  authoritative), usually over **UDP**.
- Answers are **cached at every level for their TTL** — which is why lookups are fast and why changes
  take time to propagate.
- **Lower TTLs before a migration** so the cutover is quick; there's no instant global update.
- DNS is also a **coarse load-balancing layer** (geo-DNS sends users to nearby servers/CDN edges).

## Up next

DNS got us the address, TCP the connection — but the data is still in the clear. Next: **TLS &
HTTPS**, how that connection becomes private and authenticated.
