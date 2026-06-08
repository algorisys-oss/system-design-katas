---
title: "Proxies & Reverse Proxies"
slug: proxies-and-reverse-proxies
level: foundations
module: foundations-of-system-design
order: 46
reading_time_min: 12
concepts: [proxy, reverse-proxy, forward-proxy, tls-termination, anonymity, gateway]
use_cases: []
prerequisites: [load-balancing, client-server-and-anatomy-of-a-request]
status: published
---

# Proxies & Reverse Proxies

## Hook — a motivating scenario

You've already met load balancers, CDNs, and API gateways. Here's the surprise: they're all the same
underlying thing — a **reverse proxy** — wearing different hats. Understanding the proxy concept (and
which *side* it sits on) gives you one mental model that unifies half the infrastructure in this
course.

## Mental model — a middleman, on one side or the other

A **proxy** is an intermediary that sits between a client and a server and relays requests. The only
question is *whose side it represents*:

- A **forward proxy** sits in front of **clients** and represents them to the outside world. The
  server sees the proxy, not the real client. (Think: a corporate proxy all employees browse through.)
- A **reverse proxy** sits in front of **servers** and represents them to the world. The client sees
  the proxy, not the real backend. (Think: the public entry point to your services.)

```compare
{
  "options": [
    { "label": "Forward proxy (client-side)", "points": ["Acts on behalf of clients", "Server sees the proxy, not the client", "Uses: company filtering, caching, anonymity, bypassing geo-blocks", "One proxy → many destinations"] },
    { "label": "Reverse proxy (server-side)", "points": ["Acts on behalf of servers", "Client sees the proxy, not the backend", "Uses: load balancing, TLS, caching, gateway, hiding internals", "Many backends behind one proxy"] }
  ]
}
```

## Build it up — the reverse proxy unifies what you've learned

Most infrastructure you've met *is* a reverse proxy specialized for a job:

- **Load balancer** = reverse proxy that distributes across backends + health-checks them.
- **API gateway** = reverse proxy that adds auth, rate limiting, routing across services.
- **CDN edge** = reverse (caching) proxy near users.
- **TLS termination** = reverse proxy decrypting HTTPS at the edge, then talking plain HTTP to
  internal services on a trusted network.

A reverse proxy also **hides your internal architecture** (clients can't tell how many servers or
which services exist), provides **one stable public entry point**, and is a natural place for
cross-cutting concerns (caching, compression, security).

```reveal
{
  "prompt": "How can a load balancer, an API gateway, and a CDN all be 'the same thing'?",
  "answer": "They're all reverse proxies — intermediaries sitting in front of servers, relaying client requests to backends — each emphasizing a different feature set. A load balancer emphasizes distribution + health checks; an API gateway emphasizes auth/rate-limiting/routing across services; a CDN emphasizes caching content near users. The core mechanism (accept the client's request, optionally process it, forward to a backend, relay the response) is identical. Recognizing the shared pattern means you understand all of them at once, and that many products combine these roles in one box."
}
```

## In the wild

- **NGINX, HAProxy, Envoy** are reverse proxies commonly configured as load balancers, gateways, and
  TLS terminators — often several roles at once.
- **Forward proxies** appear as corporate web filters, caching proxies, and privacy tools (and VPNs
  are a related idea).
- **TLS termination at a reverse proxy** is a near-universal pattern: decrypt once at the edge, keep
  internal traffic simpler/faster on a trusted network.
- **Defense in depth:** a reverse proxy is a controlled choke point for security (WAF, rate limiting,
  hiding origin IPs).

## Common misconception — "proxy and reverse proxy are basically the same / just jargon"

Same mechanism, opposite side — and the side determines everything about its purpose.

```reveal
{
  "prompt": "Both relay requests, so why does it matter whether a proxy is 'forward' or 'reverse'?",
  "answer": "Because *whose agent it is* changes its entire role. A forward proxy serves the clients (their gateway out — filtering, anonymity, client-side caching); the destination server is unaware of the real client. A reverse proxy serves the servers (the public face — load balancing, TLS, gateway, hiding the backend); the client is unaware of the real servers. Same relay mechanism, but one protects/represents clients and the other protects/represents servers. Misidentifying which you have leads to wrong assumptions about who sees whom and where to put security and caching."
}
```

The mechanism is identical; the **side it sits on** (client vs server) defines its purpose. Reverse
proxies are the server-side workhorses behind load balancers, gateways, and CDNs.

## Self-test

```quiz
{
  "question": "A reverse proxy sits in front of and acts on behalf of:",
  "options": [
    "Clients (hiding the client from the server)",
    "Servers (hiding the backend from the client)",
    "The database only",
    "DNS resolvers"
  ],
  "answer": 1,
  "explanation": "A reverse proxy represents the servers — the client talks to it, not the real backends (load balancers, gateways, CDNs are reverse proxies)."
}
```

```quiz
{
  "question": "Which is NOT typically a reverse proxy's job?",
  "options": [
    "Load balancing across backends",
    "TLS termination",
    "Filtering which websites a company's employees can visit",
    "Caching responses near users"
  ],
  "answer": 2,
  "explanation": "Employee web filtering is a forward-proxy (client-side) job; the rest are server-side reverse-proxy roles."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Proxies & reverse proxies — key terms", "cards": [ { "front": "Proxy", "back": "An intermediary that sits between a client and a server and relays requests. Whose side it represents determines its purpose." }, { "front": "Forward proxy", "back": "Sits in front of clients and represents them to the outside world. The server sees the proxy, not the real client. Used for filtering, caching, anonymity." }, { "front": "Reverse proxy", "back": "Sits in front of servers and represents them to the world. The client sees the proxy, not the real backend. Used for load balancing, TLS, gateway, hiding internals." }, { "front": "How are a load balancer, API gateway, and CDN edge related?", "back": "They are all reverse proxies — same relay mechanism, different emphasis: distribution + health checks, auth/rate-limiting/routing, and caching near users respectively." }, { "front": "TLS termination", "back": "A reverse proxy decrypts HTTPS at the edge, then talks plain HTTP to internal services on a trusted network — decrypt once, keep internal traffic simpler and faster." }, { "front": "Why does forward vs reverse matter?", "back": "Whose agent it is changes its entire role. Forward proxies serve/protect clients; reverse proxies serve/protect servers — defining who sees whom and where to put security and caching." } ] }
```

## Key takeaways

- A **proxy** is an intermediary relaying requests; **forward proxy = client-side** (represents
  clients), **reverse proxy = server-side** (represents servers).
- The **reverse proxy unifies** load balancers, API gateways, CDN edges, and TLS terminators — same
  mechanism, different emphasis.
- Reverse proxies provide a **stable entry point, hide internal architecture**, and host cross-cutting
  concerns (TLS, caching, security).
- The deciding factor is **which side it sits on**, which determines its entire purpose.

## Up next

A single instance of anything — including a proxy — can take a system down. Next: **Single Point of
Failure**.
