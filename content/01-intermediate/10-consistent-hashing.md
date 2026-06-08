---
title: "Consistent Hashing"
slug: consistent-hashing
level: intermediate
module: replication-and-partitioning
order: 10
reading_time_min: 16
concepts: [consistent-hashing, hash-ring, virtual-nodes, rebalancing, modulo-hashing, partitioning]
use_cases: []
prerequisites: [database-sharding, caching-fundamentals]
status: published
---

# Consistent Hashing

## Hook — a motivating scenario

You distribute cache keys across 4 servers with `server = hash(key) % 4`. It works perfectly — until
you add a 5th server. Now the formula becomes `% 5`, and **almost every key maps to a different
server**: your cache hit rate collapses to near zero, every miss stampedes the database, and the site
falls over from a *capacity upgrade*. Consistent hashing is the elegant fix that makes adding/removing
a node move only a *small fraction* of keys.

## Mental model — a clock face (the ring)

The problem with `% N` is that changing N reshuffles everything. Consistent hashing instead places
both **servers and keys on a circle** (a "ring", e.g. positions 0–360°). A key belongs to the **first
server clockwise** from its position. Add or remove a server and only the keys in *that server's arc*
are affected — everyone else stays put.

```ring
{
  "title": "Hash ring — keys go to the next server clockwise",
  "servers": [
    { "label": "A", "angle": 20 },
    { "label": "B", "angle": 140 },
    { "label": "C", "angle": 250 }
  ],
  "keys": [
    { "label": "k1", "angle": 60 },
    { "label": "k2", "angle": 95 },
    { "label": "k3", "angle": 175 },
    { "label": "k4", "angle": 215 },
    { "label": "k5", "angle": 300 },
    { "label": "k6", "angle": 340 }
  ],
  "addServer": { "label": "D", "angle": 110 }
}
```

Toggle **Add D** above: only the keys in D's arc move to it; every other key keeps its server. That's
the whole point.

## Build it up — why modulo fails and the ring wins

```compare
{
  "options": [
    { "label": "Modulo hashing (hash % N)", "points": ["Simple, even distribution", "Changing N remaps ~ALL keys", "Catastrophic cache misses / data movement on resize", "Fine only if N never changes"] },
    { "label": "Consistent hashing (ring)", "points": ["Key → first server clockwise", "Adding/removing a node moves only ~1/N keys", "Minimal disruption on resize", "Slightly more complex; needs virtual nodes for balance"] }
  ]
}
```

```reveal
{
  "prompt": "Exactly why does `hash(key) % N` remap almost every key when N changes from 4 to 5?",
  "answer": "Because the result depends on N for *every* key. hash(key) % 4 and hash(key) % 5 are unrelated values for almost all keys — a key that was on server 2 under %4 lands almost anywhere under %5. So changing N (adding/removing a server) doesn't move a small slice; it reassigns the vast majority of keys. For a cache that means ~80–90% instant misses (each missed key hits the database at once), and for a sharded store it means physically moving most of the data. Consistent hashing avoids this by making a key's owner depend only on its position relative to nearby servers on the ring — not on the total count N."
}
```

## Build it up — virtual nodes fix uneven distribution

A plain ring has a problem: with only a few servers placed at a few points, the arcs are **uneven** —
one server may own a huge slice while another owns a sliver (and when a server dies, its *entire* load
dumps onto its single clockwise neighbor). The fix is **virtual nodes (vnodes)**: place each physical
server at *many* points around the ring (e.g. 100–256 virtual positions). Now load is spread evenly,
and when a server is added or removed, its share is taken from / distributed across *all* the others,
not one neighbor.

```reveal
{
  "prompt": "How do virtual nodes give both even load distribution AND graceful handling of a server failure?",
  "answer": "By representing each physical server as many points scattered around the ring, the law of averages smooths the arcs: with 256 vnodes per server, each physical server owns ~1/N of the ring in aggregate even though no single arc is equal — so load is balanced. On failure, that server's many small arcs are each inherited by their respective clockwise neighbors, so the dead server's load spreads across ALL remaining servers (≈ evenly) instead of doubling one unlucky neighbor. Same on addition: a new server steals small arcs from many servers, so everyone sheds a little. Vnodes turn 'few big uneven arcs' into 'many small even ones,' fixing both balance and failure behavior."
}
```

## In the wild

- **Distributed caches** (Memcached clients, Redis Cluster's 16,384 hash slots are a related idea) use
  consistent hashing so scaling the cache doesn't wipe it.
- **Leaderless databases** (Cassandra, DynamoDB, Riak) place data on a consistent-hashing ring with
  **vnodes** (Cassandra defaults to 256 vnodes/node) for balanced sharding + smooth rebalancing.
- **Load balancers / CDNs** use it to route the same key to the same backend (cache locality) while
  tolerating node changes.
- It's the standard answer to "how do I shard/partition so resizing is cheap" — directly solving the
  sharding-rebalancing pain from the previous chapter.

## Common misconception — "consistent hashing perfectly balances load"

Plain consistent hashing balances *resize cost*, not necessarily *load* — and not against hotspots.

```reveal
{
  "prompt": "Consistent hashing minimizes keys moved on resize. Why might one server still be overloaded, and what helps (and what doesn't)?",
  "answer": "Two distinct issues. (1) Uneven arcs: with few placement points, servers own unequal slices — fixed by virtual nodes, which even out the arcs. (2) Hot keys: if one specific key (a 'celebrity' object) gets enormous traffic, it always maps to one server regardless of how balanced the ring is — vnodes don't help, because the skew is in request volume to a single key, not in key distribution. That needs other tactics (replicating/caching the hot key, splitting it). So consistent hashing + vnodes solves even *key* distribution and cheap rebalancing, but not access-pattern hotspots. Don't assume the ring alone guarantees even *load*."
}
```

Consistent hashing's core guarantee is **minimal key movement on resize** (~1/N); **virtual nodes**
add even key distribution; but **hot keys** (skewed access to one key) still need separate handling.

## Self-test

```quiz
{
  "question": "The main advantage of consistent hashing over `hash(key) % N` is:",
  "options": [
    "It's simpler to implement",
    "Adding/removing a node moves only ~1/N of keys, instead of remapping almost all of them",
    "It encrypts the keys",
    "It removes the need for servers"
  ],
  "answer": 1,
  "explanation": "Modulo remaps nearly all keys when N changes; the ring only reassigns the arc of the added/removed node (~1/N)."
}
```

```quiz
{
  "question": "Virtual nodes (vnodes) are used to:",
  "options": [
    "Encrypt the ring",
    "Spread each server across many ring positions for even load and graceful add/remove",
    "Eliminate the need for replication",
    "Make hot keys disappear"
  ],
  "answer": 1,
  "explanation": "Vnodes place each physical server at many points, evening out arcs and spreading a node's load across all others on change."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Consistent hashing — key terms", "cards": [ { "front": "Modulo hashing (hash % N)", "back": "Mapping a key to a server with hash(key) % N. Simple and even, but changing N remaps almost all keys — catastrophic cache misses or data movement on resize." }, { "front": "Hash ring", "back": "A circle (e.g. 0–360°) holding both servers and keys. A key belongs to the first server clockwise from its position, so resizing only affects one arc." }, { "front": "Why does the ring beat modulo on resize?", "back": "A key's owner depends only on its position relative to nearby servers, not on the total count N. Adding or removing a node moves only ~1/N of keys." }, { "front": "Virtual nodes (vnodes)", "back": "Placing each physical server at many ring points (e.g. 100–256). Evens out arcs for balanced load and spreads a node's share across all others on add/remove." }, { "front": "Hot keys", "back": "A single key with skewed, enormous access volume always maps to one server. Vnodes don't help; it needs replicating, caching, or splitting the hot key." }, { "front": "Consistent hashing's core guarantee", "back": "Minimal key movement on resize (~1/N). Vnodes add even key distribution, but access-pattern hotspots still need separate handling." } ] }
```

## Key takeaways

- `hash(key) % N` **remaps almost everything** when N changes — catastrophic for caches/shards on
  resize.
- **Consistent hashing** puts servers + keys on a **ring** (key → next server clockwise), so resizing
  moves only **~1/N** of keys.
- **Virtual nodes** give **even distribution** and spread a node's load across all others on add/
  remove.
- It minimizes **resize cost and key distribution**, but **hot keys** (skewed access) still need extra
  handling.

## Up next

Consistent hashing is one partitioning scheme; let's survey the others. Next: **Partitioning
Strategies**.
