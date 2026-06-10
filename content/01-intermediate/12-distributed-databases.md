---
title: "Distributed Databases"
slug: distributed-databases
level: intermediate
module: replication-and-partitioning
order: 12
reading_time_min: 15
concepts: [distributed-databases, nodes, consistency-models, newsql, eventual-consistency, fault-tolerance]
use_cases: []
prerequisites: [database-replication, database-sharding, cap-theorem]
status: published
---

# Distributed Databases

## Hook — a motivating scenario

You've combined replication (copies for reads/HA) and sharding (slices for write scale) — and now
your "database" is actually a dozen machines pretending to be one. A query might touch several;
a node can die mid-write; two clients might read different versions for a moment. A **distributed
database** packages all of this — partitioning, replication, fault tolerance, and a chosen consistency
model — behind one interface. Understanding what it does (and the guarantees it gives up) is essential
to using one well.

## Mental model — many machines acting as one database

A distributed database spreads data across **many nodes** and coordinates them to behave (mostly) like
a single logical database. It combines the two scaling axes you've learned:
- **Partitioning (sharding)** to scale writes/storage across nodes.
- **Replication** to provide availability and read scaling for each partition.

On top of that it must handle the realities of distributed systems: **node failures, network
partitions, and concurrent access** — which (recall CAP) force trade-offs no single-node database
faces.

```reveal
{
  "prompt": "Why does going distributed inevitably force you to reason about consistency models, when a single-node ACID database 'just works'?",
  "answer": "On one node there's a single copy and a single clock/order, so reads always see the latest committed write (strong consistency) for free. Distribute the data and you have multiple replicas/partitions that can't update instantaneously together — replication takes time, and network partitions can isolate nodes (CAP). Now 'what does a read return?' has many possible answers: the latest write everywhere (strong, but slower/less available), or possibly-stale data that converges later (eventual, fast/available). The database must pick a consistency model, and you must understand which one you're getting — because it changes correctness of your application. Distribution turns consistency from a given into a design choice."
}
```

## Build it up — the consistency spectrum

Distributed databases sit somewhere on a spectrum between strong and eventual consistency (recall CAP
and quorums):

```compare
{
  "options": [
    { "label": "Strong consistency", "points": ["Reads always see the latest write", "Easier to reason about (acts single-node)", "Higher latency; less available under partition (CP)", "Spanner, etcd, CockroachDB"] },
    { "label": "Eventual consistency", "points": ["Replicas converge over time; reads may be stale", "High availability + low latency (AP)", "App must tolerate staleness/conflicts", "Cassandra, DynamoDB (tunable), Riak"] }
  ]
}
```

Many real systems offer **tunable consistency** (per-operation quorums, recall R+W>N) so you choose
per query. Others (the **NewSQL** family — Spanner, CockroachDB, YugabyteDB) work hard to offer
**SQL + strong consistency at horizontal scale**, using consensus protocols (advanced course) — the
line between "SQL" and "distributed" is blurring.

```reveal
{
  "prompt": "What is NewSQL trying to achieve, and why was it historically considered hard?",
  "answer": "NewSQL aims to give you the best of both worlds: relational SQL semantics with ACID transactions and strong consistency, but with the horizontal scalability (sharding across many nodes) that traditionally required giving up those guarantees (the NoSQL trade). Historically this was hard because coordinating transactions and strong consistency across distributed, partitioned, replicated nodes requires consensus (e.g. Raft/Paxos), careful clock handling (Spanner's TrueTime), and distributed transaction protocols — all of which add latency and complexity. Systems like Google Spanner, CockroachDB, and YugabyteDB make this practical, so you no longer automatically sacrifice consistency to scale. It's 'hard' because it fights the very trade-offs CAP/replication impose, and pays for it in engineering and some latency."
}
```

Slide along the consistency dial to see what each setting buys and costs:

```tradeoff
{ "title": "Where on the consistency spectrum should this query sit?", "axis": { "left": "Strong consistency (CP)", "right": "Eventual consistency (AP)" }, "steps": [ { "label": "Strong consistency", "detail": "Reads always see the latest write and the system acts single-node, but you pay higher latency and lose availability under a network partition. Used by Spanner, etcd, CockroachDB." }, { "label": "Tunable quorums", "detail": "Choose per operation via R+W>N: raise quorums toward strong reads, lower them toward fast/available reads. Cassandra (and Riak) expose this per-operation quorum dial; DynamoDB instead lets you request a strongly-consistent read per query (rather than a configurable R/W quorum)." }, { "label": "Eventual consistency", "detail": "Replicas converge over time, giving high availability and low latency (AP), but reads may be stale and your app must tolerate staleness and conflicts." } ] }
```

## Build it up — what the database handles for you

A good distributed database hides a lot of the machinery from earlier chapters:
- **Routing** queries to the right shard(s) and replicas.
- **Replication + failover** within each partition (promote a replica on node death).
- **Rebalancing** when nodes are added/removed (often via consistent hashing/vnodes).
- **Conflict handling / consistency** per its chosen model (quorums, LWW, consensus).
- **Fault tolerance** — surviving node and zone failures.

Your job is to **model data and pick a consistency level that matches each use case** (recall: payments
strong, feeds eventual) and design around the constraints (limited cross-shard transactions, possible
staleness).

## In the wild

- **AP / wide-column / key-value:** Cassandra, Riak — massive scale, tunable/eventual consistency,
  leaderless quorums. (Amazon DynamoDB is a managed member of this family but is leader/Paxos-based
  with a per-read strong-vs-eventual choice, not configurable R/W quorums.)
- **NewSQL (strong + scalable SQL):** Google Spanner, CockroachDB, YugabyteDB — consensus-backed.
- **Document/distributed:** MongoDB (sharded clusters with replica sets).
- Managed services hide much of the ops, but **you still choose the consistency level and shard/
  partition key** — the levers from this whole module.

## Common misconception — "a distributed database removes all the trade-offs; it just scales"

It packages the machinery, but the fundamental trade-offs remain — they're now *your* configuration.

```reveal
{
  "prompt": "Using a managed distributed database, a team assumes 'it scales and stays consistent automatically.' Why is that dangerous?",
  "answer": "Because the database can hide the operational machinery (sharding, replication, failover, rebalancing) but it cannot repeal CAP or the cost of coordination — those trade-offs become *your settings*. If you pick an eventually-consistent/AP configuration (or low quorums) for speed/availability, reads can be stale and concurrent writes can conflict, and your app logic must handle that; if you pick strong consistency, you pay latency and reduced availability under partitions. You also still choose the shard/partition key (bad choice → hotspots) and live with limited cross-shard transactions. 'It just scales and stays consistent' ignores that you've been handed the CAP dial — and assuming the wrong setting leads to subtle data bugs. The DB automates mechanism, not the decisions."
}
```

A distributed database **automates the mechanism** (partitioning, replication, failover) but **hands
you the trade-offs** (consistency level, shard key). The CAP and quorum decisions from this module are
now configuration you own.

## Self-test

```quiz
{
  "question": "A distributed database fundamentally combines which two techniques, plus fault tolerance?",
  "options": [
    "Caching and indexing",
    "Partitioning (sharding) for write/storage scale and replication for availability/read scale",
    "Encryption and compression",
    "Backups and logging"
  ],
  "answer": 1,
  "explanation": "It spreads data via sharding and keeps copies via replication, coordinating nodes to act like one database despite failures."
}
```

```quiz
{
  "question": "NewSQL databases (Spanner, CockroachDB) aim to provide:",
  "options": [
    "Eventual consistency only",
    "SQL + strong consistency + ACID at horizontal scale (via consensus)",
    "Caching without a database",
    "No replication"
  ],
  "answer": 1,
  "explanation": "NewSQL targets relational/strong-consistency guarantees while scaling out horizontally, using consensus protocols."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Distributed databases — key terms", "cards": [ { "front": "Distributed database", "back": "Data spread across many nodes coordinated to behave like one logical database, combining partitioning, replication, fault tolerance, and a chosen consistency model behind one interface." }, { "front": "Strong consistency", "back": "Reads always see the latest committed write; easier to reason about (acts single-node) but higher latency and less available under partition (CP). Used by Spanner, etcd, CockroachDB." }, { "front": "Eventual consistency", "back": "Replicas converge over time, so reads may be stale; high availability and low latency (AP), but the app must tolerate staleness and conflicts. Used by Cassandra, DynamoDB, Riak." }, { "front": "Tunable consistency", "back": "Per-operation choice of consistency via quorums (recall R+W>N), letting you pick strong or eventual behavior per query." }, { "front": "NewSQL", "back": "Family (Spanner, CockroachDB, YugabyteDB) offering SQL plus strong consistency and ACID at horizontal scale, using consensus protocols — blurring the SQL-vs-distributed line." }, { "front": "What the DB automates vs hands you", "back": "It automates the mechanism (routing, replication, failover, rebalancing) but hands you the trade-offs: you still pick the consistency level and shard/partition key." } ] }
```

## Key takeaways

- A **distributed database** = **partitioning + replication + fault tolerance** behind one interface,
  coordinating many nodes to act like one.
- Distribution forces a **consistency-model choice** (strong vs eventual, often **tunable** via
  quorums) — a CAP trade you can't escape.
- **NewSQL** (Spanner, CockroachDB) delivers **SQL + strong consistency at scale** via consensus,
  blurring SQL-vs-NoSQL.
- It **automates the mechanism but hands you the trade-offs** — you still pick the consistency level
  and shard key.

## Up next

That completes data at scale. Next module revisits caching as deliberate *patterns* for keeping cache
and database in sync. Next: **Caching Patterns Overview**.
