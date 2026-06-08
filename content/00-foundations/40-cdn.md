---
title: "CDN — Content Delivery Network"
slug: cdn
level: foundations
module: caching-fundamentals
order: 40
reading_time_min: 13
concepts: [cdn, edge, geo-distribution, static-content, origin, cache-headers]
use_cases: []
prerequisites: [caching-fundamentals, latency-numbers, dns]
status: published
---

# CDN — Content Delivery Network

## Hook — a motivating scenario

Your servers are in Virginia. A user in Sydney loads your site, and every image, script, and
stylesheet makes a ~200 ms round trip across the Pacific — the page crawls, and your origin servers
strain under millions of identical file requests. Move copies of those files to a server *in Sydney*,
and the same page loads in ~10 ms while your origin barely notices. That's a **CDN**: caching, but
geographically.

## Mental model — local branches of a warehouse

Instead of everyone ordering from one central warehouse far away, a CDN puts **local branches (edge
servers)** in cities worldwide, each stocked with copies of your popular content. Users are served
from the **nearest edge**, turning a long cross-continent trip into a short local one. It's the
latency ladder made physical: distance is latency, so put data close to users.

```flow
{
  "title": "Serving content via a CDN",
  "nodes": [
    { "label": "User (Sydney)", "detail": "Requests an image/script/page." },
    { "label": "Nearest edge", "detail": "A CDN server in/near Sydney. HIT → serves the copy in ~ms, no cross-ocean trip." },
    { "label": "Origin (Virginia)", "detail": "Only on a MISS does the edge fetch from your origin, then cache it for the next user." },
    { "label": "User gets content", "detail": "Fast for them; your origin served it once, not millions of times." }
  ],
  "note": "First request in a region may miss (fetch from origin); the rest in that region hit the edge."
}
```

## Build it up — what to put on a CDN (and what not to)

CDNs shine for content that's **the same for everyone** and changes rarely — exactly what's cacheable:

- **Great fits:** static assets (images, CSS, JS, fonts, videos), downloads, and increasingly cached
  HTML/API responses for public, shared data.
- **Poor fits (by default):** **personalized or sensitive per-user data** (your bank balance, a
  private dashboard) — caching that at a shared edge risks serving one user's data to another.

Control is via the same **cache headers** as browser caching (`Cache-Control`, `ETag`, TTLs) — they
tell the CDN how long to cache and when to revalidate.

```reveal
{
  "prompt": "You update your site's logo, but users keep seeing the old one for days even though you redeployed. Why, and what's the standard fix?",
  "answer": "The old logo is cached at CDN edges (and browsers) under its URL until its TTL expires — your redeploy didn't touch those cached copies. Two standard fixes: (1) explicitly *invalidate/purge* the CDN cache for that asset, or (2) use **cache busting** — give the new file a new URL (e.g. logo.abc123.png with a content hash), so it's a different cache key and is fetched fresh while old URLs can stay cached forever. Hashed filenames on build are the common, robust approach for static assets."
}
```

## Build it up — how users reach the nearest edge

CDNs route you to a close edge using **DNS/anycast** (recall geo-DNS): the same hostname resolves to
different edge IPs based on your location, or anycast routing sends your packets to the nearest of
many servers sharing one IP. This is the "DNS as coarse load balancing" idea from the DNS chapter,
applied globally.

Beyond speed, CDNs also **shield the origin** (absorbing traffic and DDoS), **terminate TLS at the
edge** (faster handshakes near users), and often add compression and security features.

## In the wild

- **Cloudflare, Akamai, Fastly, CloudFront** are major CDNs; nearly every serious website uses one.
- **Static assets are almost always CDN-served** with long TTLs + content-hashed filenames (cache
  busting) — set it and forget it.
- **Edge compute** (running code at the edge) extends CDNs from caching files to running logic near
  users (an advanced topic).
- **CDN cache hit ratio** and origin offload are key metrics — a high ratio means your origin is well
  protected.

## Common misconception — "a CDN is only for big global companies / only for images"

CDNs help almost any site, and modern CDNs cache far more than static files.

```reveal
{
  "prompt": "A small app with users in one country and 'just a few images' — is a CDN pointless for them?",
  "answer": "Usually not. Even within one country, an edge closer than your origin cuts latency, and offloading static assets reduces origin load and bandwidth cost cheaply (often free tiers). CDNs also add TLS termination near users, compression, caching of HTML/API responses for public data, and DDoS protection. Modern CDNs cache much more than images — including dynamic-but-cacheable content at the edge. The 'only for giants / only images' view is outdated; a CDN is a low-effort win for most sites."
}
```

CDNs are broadly useful — for latency, origin offload, security, and TLS — and cache far more than
images. The main caution is **not caching personalized/sensitive data at shared edges** without care.

## Self-test

```quiz
{
  "question": "The primary benefit of a CDN is to:",
  "options": [
    "Store your primary database",
    "Serve cached content from edge servers near users, cutting latency and offloading the origin",
    "Encrypt the database at rest",
    "Replace the need for a backend"
  ],
  "answer": 1,
  "explanation": "A CDN caches content at globally-distributed edges, so users are served nearby — lower latency and less origin load."
}
```

```quiz
{
  "question": "Why do build tools rename static files to include a content hash (e.g. app.9f2a.js)?",
  "options": [
    "To encrypt them",
    "Cache busting — a new content = new URL = new cache key, so CDNs/browsers fetch the updated file",
    "To make them smaller",
    "To avoid using DNS"
  ],
  "answer": 1,
  "explanation": "Hashed filenames change the URL when content changes, sidestepping stale CDN/browser caches while old URLs stay cacheable."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "CDN — key terms", "cards": [
  { "front": "CDN (Content Delivery Network)", "back": "Caching applied geographically: copies of your content live on edge servers worldwide, so users are served from the nearest edge instead of a distant origin." },
  { "front": "Edge server", "back": "A CDN server in/near a user's city that holds cached copies of content. A hit serves it in milliseconds with no cross-region trip." },
  { "front": "Origin", "back": "Your source servers. The edge fetches from origin only on a miss, then caches the copy; the origin serves content once instead of millions of times." },
  { "front": "Cache busting", "back": "Giving a changed file a new URL (e.g. logo.abc123.png with a content hash) so it becomes a new cache key and is fetched fresh, while old URLs stay cached." },
  { "front": "Purge / invalidation", "back": "Explicitly clearing a cached asset at CDN edges so the next request refetches from origin — one standard fix for stale content after a redeploy." },
  { "front": "What not to cache at a shared edge", "back": "Personalized or sensitive per-user data (bank balance, private dashboards) — caching it at a shared edge risks serving one user's data to another." }
] }
```

## Key takeaways

- A **CDN** caches content on **edge servers near users**, turning long cross-region trips into short
  local ones — caching applied geographically.
- Best for **static/shared, rarely-changing content**; avoid caching **personalized/sensitive** data
  at shared edges.
- Control with **cache headers/TTLs**; handle updates via **purge/invalidation** or **content-hash
  cache busting**.
- CDNs also **offload and shield the origin**, terminate **TLS near users**, and increasingly cache
  dynamic-but-cacheable content — useful for almost any site.

## Up next

Closing the module: where else content gets cached on the path. Next: **Browser Cache vs Server
Cache**.
