---
title: "Data Serialization Formats"
slug: data-serialization
level: foundations
module: storage-fundamentals
order: 17
reading_time_min: 14
concepts: [serialization, json, protobuf, binary-formats, schema, compatibility]
use_cases: []
prerequisites: [binary-and-data-representation, http-fundamentals]
status: published
---

# Data Serialization Formats

## Hook — a motivating scenario

Two services need to exchange a `User` object. One is written in Python, the other in Go. They don't
share memory, types, or even a programming language — yet they must agree, byte-for-byte, on what a
`User` *is* on the wire. The format they choose decides how big each message is, how fast it parses,
and whether deploying a new field breaks the other service. That choice is **serialization**.

## Mental model — flat-packing furniture for shipping

An in-memory object is assembled furniture: pointers, references, types — only meaningful inside one
program's memory. To send it elsewhere you must **flat-pack** it into a linear sequence of bytes
(**serialize**), ship it, and **reassemble** it on the other side (**deserialize**). The format is
the flat-pack standard both ends agree on.

## Build it up — text vs binary, schema vs schemaless

Two big axes:

- **Text (JSON, XML)** — human-readable, self-describing, debuggable, universally supported. But
  verbose (field names repeated in every message) and slower to parse.
- **Binary (Protocol Buffers, Avro, MessagePack)** — compact and fast, often **schema-driven** (both
  sides share a `.proto`/schema definition). Not human-readable, needs tooling, but much smaller and
  faster — and the schema enables safe evolution.

```compare
{
  "options": [
    { "label": "JSON", "points": ["Human-readable text", "Self-describing, no schema needed", "Universal (web default)", "Verbose + slower to parse"] },
    { "label": "Protocol Buffers", "points": ["Compact binary", "Schema-driven (.proto)", "Fast parse, small size", "Needs codegen/tooling; not human-readable"] }
  ]
}
```

```reveal
{
  "prompt": "Why is JSON usually fine for a public web API but Protobuf is preferred for high-volume internal service-to-service calls?",
  "answer": "Public APIs value broad compatibility and debuggability — any client can read JSON, and humans can inspect it. Internal services at high volume value bytes and CPU: Protobuf messages are far smaller and parse faster, cutting bandwidth and latency across millions of calls, and a shared schema enforces the contract. Different priorities → different formats."
}
```

Where you sit on this dial depends on call volume and who reads the messages — drag from low-volume reach to high-volume efficiency:

```tradeoff
{ "title": "Text format or binary+schema?", "axis": { "left": "Text (JSON/XML)", "right": "Binary+schema (Protobuf/Avro)" }, "steps": [
  { "label": "Public web API", "detail": "JSON: broad compatibility and debuggability win. Any client can read it, humans can inspect it, no schema or codegen needed — verbosity is an acceptable cost." },
  { "label": "Config / low volume", "detail": "Still text. Readability and editing by hand matter more than bytes; the parse cost is negligible at low call rates." },
  { "label": "Internal microservices", "detail": "Lean binary+schema. Shared .proto enforces the contract; smaller, faster messages cut bandwidth and latency across many service-to-service calls." },
  { "label": "Hot, high-volume path", "detail": "Binary+schema. At 100k req/s of large nested objects, JSON's repeated field names and parse CPU become the bottleneck; Protobuf shrinks size several-fold and frees CPU." }
] }
```

## Build it up — schema evolution (the part that bites in production)

Services deploy independently, so the *real* question isn't "which is smaller" but **"what happens
when the two sides disagree on the shape?"**

- **Backward compatibility:** new code can read old data.
- **Forward compatibility:** old code can read new data (e.g. it ignores unknown fields).

Schema formats like Protobuf are designed for this: add a new *optional* field with a new tag number,
and old readers safely ignore it while new readers use it — no coordinated, simultaneous deploy
needed.

```reveal
{
  "prompt": "Service A adds a new field to a message. Service B (older) hasn't been redeployed. Why does this break with a strict format but not with Protobuf's rules?",
  "answer": "If the format/parser rejects unknown fields (or requires all fields), B errors on A's new field — forcing a lockstep deploy. Protobuf assigns each field a number and makes added fields optional, so old readers simply skip unknown field numbers (forward-compatible) and missing fields take defaults (backward-compatible). That's what lets services evolve and deploy independently."
}
```

## In the wild

- **JSON** dominates public web/REST APIs and config; **Protocol Buffers** power gRPC and internal
  microservice traffic (covered in the intermediate course).
- **Avro** is common in data pipelines (Kafka) for its strong schema-evolution story; **MessagePack**
  is "binary JSON" for compactness without a schema.
- **Size & speed matter at scale:** shrinking each message a few× cuts bandwidth, storage, and parse
  CPU across billions of calls.
- **Schema registries** (e.g. with Kafka) enforce compatibility rules so a bad schema change can't be
  deployed.

## Common misconception — "serialization is just JSON.stringify; the format barely matters"

For one call on a laptop, sure. At system scale, the format shapes cost, speed, and deploy safety.

```reveal
{
  "prompt": "A team uses JSON everywhere, including a hot internal path doing 100k req/s of large nested objects, and CPU/bandwidth are pegged. What changed by switching that path to Protobuf?",
  "answer": "Messages got several times smaller (no repeated field names, binary encoding) → less bandwidth and lower latency. Parsing got faster → lower CPU, freeing headroom. And the shared schema made the contract explicit. JSON was fine functionally, but on a hot, high-volume path the format's overhead was the bottleneck. Format is a real performance and contract decision, not a detail."
}
```

The format is a genuine design lever: text for reach/debuggability, binary+schema for size, speed,
and safe evolution on hot internal paths.

## Self-test

```quiz
{
  "question": "Compared to JSON, a schema-driven binary format like Protocol Buffers is mainly chosen for:",
  "options": [
    "Being human-readable",
    "Smaller size, faster parsing, and explicit schema-based compatibility",
    "Requiring no tooling",
    "Working only in JavaScript"
  ],
  "answer": 1,
  "explanation": "Protobuf trades readability for compactness, speed, and a schema that enables safe evolution."
}
```

```quiz
{
  "question": "Forward compatibility in serialization means:",
  "options": [
    "New code can read data written by old code",
    "Old code can safely read data written by newer code (e.g. ignoring unknown fields)",
    "Data is encrypted",
    "Messages are compressed"
  ],
  "answer": 1,
  "explanation": "Forward compatibility = older readers tolerate newer data, which lets services deploy independently."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Data serialization — key terms", "cards": [
  { "front": "Serialization", "back": "Flat-packing an in-memory object into a linear sequence of bytes so it can be shipped to another machine or language, then reassembled (deserialized) on the other side." },
  { "front": "Text vs binary formats", "back": "Text (JSON, XML) is human-readable, self-describing, universal, but verbose and slower. Binary (Protobuf, Avro, MessagePack) is compact and fast, often schema-driven, but not human-readable." },
  { "front": "Schema-driven format", "back": "A format where both sides share a schema definition (e.g. a .proto). It enables compact encoding, fast parsing, and safe evolution but needs codegen/tooling." },
  { "front": "Backward compatibility", "back": "New code can read data written by old code." },
  { "front": "Forward compatibility", "back": "Old code can safely read data written by newer code, e.g. by ignoring unknown fields. This is what lets services deploy independently." },
  { "front": "Schema registry", "back": "A service (e.g. with Kafka) that enforces compatibility rules so a bad schema change can't be deployed." }
] }
```

## Key takeaways

- **Serialization** flat-packs in-memory objects into bytes so different languages/machines can
  exchange them.
- **Text (JSON/XML)** = readable, universal, verbose; **binary+schema (Protobuf/Avro)** = compact,
  fast, evolvable.
- The decisive issue in production is **schema evolution** — backward/forward compatibility lets
  services deploy independently.
- Format is a real **performance + contract** lever: JSON for reach, binary+schema for hot,
  high-volume internal paths.

## Up next

That completes storage. Now we expose data to the world through interfaces — starting with the
**Client–Server Model & Anatomy of a Web Request**, the glue chapter that ties the whole journey
together.
