---
title: "Capstone — Design a Chat System"
slug: capstone-design-a-chat-system
level: intermediate
module: intermediate-capstones
order: 39
reading_time_min: 21
concepts: [chat, websockets, pub-sub-backplane, message-storage, delivery, presence, fan-out]
use_cases: []
prerequisites: [realtime-communication, publish-subscribe, database-sharding, stateful-vs-stateless-services]
status: published
---

# Capstone — Design a Chat System

## The payoff

The final intermediate capstone: a real-time **chat system** (like WhatsApp/Slack/Messenger). It
composes nearly everything in this module — **WebSockets** for real-time delivery, a **pub/sub
backplane** to route across servers, **stateful connection** handling, **sharded storage** for message
history, **queues** for offline delivery, and the delivery-guarantee + idempotency ideas. It's the
canonical "real-time" design. Same method as always.

## 1 · Clarify requirements

**Functional:** 1:1 and group messaging; **real-time delivery** to online recipients; **message
history** (persisted, scrollable); **offline delivery** (messages wait until you reconnect); ideally
**delivery/read receipts** and **presence** (online/typing).

**Non-functional:**
- **Low-latency, bidirectional** delivery (recall real-time: this needs server push, not polling).
- **Highly available**; messages **must not be lost** (durability) and shouldn't be **duplicated/
  reordered** confusingly.
- Scale: hundreds of millions of users, **massive numbers of concurrent persistent connections**.

```reveal
{
  "prompt": "Why does 'real-time, bidirectional, with huge numbers of concurrent connections' immediately point to WebSockets + a connection-server tier, and what new problem does that create?",
  "answer": "Chat needs the server to push messages to clients the instant they arrive and clients to send anytime — full-duplex, low-latency — which rules out request/response polling and points to WebSockets (recall real-time communication: SSE is one-way, polling is laggy/wasteful, WebSockets are bidirectional persistent). At scale you need many connection servers, each holding a subset of the millions of long-lived, stateful connections. The new problem: these servers are stateful (a user's live socket lives on ONE specific server), which collides with the stateless, load-balanced model — so when user A (connected to server 3) messages user B (connected to server 7), server 3 can't directly reach B. That's the core challenge a chat design must solve: routing a message to whichever server holds the recipient's connection, which is what the pub/sub backplane is for. So the requirements force WebSockets + a stateful connection tier + a backplane to bridge servers."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Concurrent connections → connection servers needed",
  "inputs": [
    { "key": "concurrent", "label": "Peak concurrent users", "default": 50000000 },
    { "key": "perServer", "label": "Connections per server", "default": 100000 }
  ],
  "formula": "concurrent / perServer",
  "resultLabel": "Connection servers (approx)",
  "resultUnit": "servers"
}
```

```calc
{
  "title": "Daily message storage",
  "inputs": [
    { "key": "messages", "label": "Messages/day", "default": 50000000000 },
    { "key": "bytes", "label": "Bytes/message (stored)", "default": 300 }
  ],
  "formula": "messages * bytes",
  "resultLabel": "Storage/day",
  "resultUnit": "bytes"
}
```

> ~500 connection servers just to hold the sockets (so you need a fleet + a way to route between
> them), and **~15 TB/day** of messages (so storage must be **sharded** and tiered). Estimation sets
> up the two big design forces: cross-server routing and large-scale message storage.

## 3 · The core challenge: routing across stateful connection servers

A user's WebSocket lives on **one** connection server. To deliver A→B, you must reach B's server. The
solution (recall real-time + pub/sub) is a **pub/sub backplane**:

```sequence
{
  "title": "Delivering a message: receive → persist → route (online) / store (offline)",
  "actors": ["UserA", "ConnSvr3", "MsgSvc", "Backplane", "ConnSvr7", "UserB"],
  "steps": [
    { "from": "UserA", "to": "ConnSvr3", "label": "send message to B (over WebSocket)" },
    { "from": "ConnSvr3", "to": "MsgSvc", "label": "persist message + assign sequence id (durable)" },
    { "from": "MsgSvc", "to": "Backplane", "label": "B online (per presence)? → publish to B's channel" },
    { "from": "Backplane", "to": "ConnSvr7", "label": "ConnSvr7 is subscribed for B → deliver" },
    { "from": "ConnSvr7", "to": "UserB", "label": "push over B's WebSocket (real-time)" },
    { "from": "MsgSvc", "to": "UserB", "label": "(B offline: no live socket → message stays durable; push notification; B syncs on reconnect)" }
  ]
}
```

A **presence/routing registry** records which user is currently connected to which server (and who's
offline) — connection servers update it as sockets open/close. The **message/routing service consults
presence** (or simply publishes to the recipient's channel, which only subscribed servers receive) to
decide **online fan-out vs the offline path**. Persistence (durable store) and routing (backplane) are
**separate concerns**: every message is persisted first, then delivered live if the recipient is online,
or left in the durable store for the recipient to sync on reconnect if not.

```reveal
{
  "prompt": "Why is a pub/sub backplane (e.g. Redis Pub/Sub, NATS, or managed realtime infra) the key to scaling chat across many connection servers, rather than servers talking to each other directly?",
  "answer": "Because any connection server may need to reach a recipient on any other server, and direct server-to-server messaging would be an N×N mesh that's brittle and doesn't scale (each server must know and connect to every other, handle churn, etc.). A pub/sub backplane decouples this: the sending server just publishes the message to a channel (e.g. per-user or per-conversation), and the server(s) holding the relevant recipients subscribe and receive it, then push it down the right WebSockets. Senders don't need to know which server holds whom — the backplane fans out. This is exactly the pub/sub fan-out pattern applied to routing across a stateful connection fleet (recall real-time communication). It also naturally supports group chat (publish once to a conversation channel; all servers with members in that conversation get it) and lets you add/remove connection servers freely. The backplane turns 'which of 500 servers holds B?' into a publish/subscribe problem instead of a routing mesh."
}
```

## 4 · High-level design

```flow
{
  "title": "Chat system architecture",
  "nodes": [
    { "label": "Clients (WebSocket)", "detail": "Persistent full-duplex connection to a connection server." },
    { "label": "Connection servers", "detail": "Stateful: hold live WebSockets. ~500 of them; behind a connection-aware LB." },
    { "label": "Pub/sub backplane", "detail": "Routes messages to the server holding each recipient (Redis Pub/Sub / NATS). Fan-out for groups." },
    { "label": "Message service + store", "detail": "Persists every message (sharded by conversation), assigns IDs/ordering." },
    { "label": "Offline queue / push", "detail": "If recipient offline: queue for reconnect + send mobile push notification." }
  ],
  "note": "Real-time path: client → conn server → persist + publish → recipient's conn server → client. Offline → queue + push."
}
```

## 5 · Apply the trade-offs you've learned

- **Persist before/while delivering** so messages aren't lost (durability) — store every message in a
  **sharded** store (by conversation_id), with history tiered (hot recent, cold archive — recall
  tiering).
- **Stateful connections** need a **connection-aware** approach (sticky routing to the server holding
  the socket) and a **backplane** to bridge servers (recall stateful-vs-stateless + real-time).
- **Ordering & dedup:** assign a per-conversation sequence/ID so clients can order messages and
  **de-duplicate** retries — delivery is **at-least-once**, so make it **idempotent** (recall
  idempotency); clients ack receipt.
- **Offline delivery:** if the recipient isn't connected, **queue** the message (recall message queues)
  and trigger a **push notification**; deliver on reconnect (client syncs "messages since last seen").
- **Group chat = fan-out:** publish once to the conversation channel; every connection server holding a
  member delivers to its members (recall pub/sub fan-out) — avoid per-member writes for large groups
  (the celebrity/hotspot lesson from the feed capstone).

```reveal
{
  "prompt": "How does the design guarantee a message is neither lost (if the recipient is offline) nor shown twice (if delivery retries)?",
  "answer": "Not lost: the message is persisted durably (to the sharded message store) as part of sending, before/independent of real-time delivery — so even if the recipient is offline or a connection server crashes mid-delivery, the message survives. If the recipient is offline, it's also queued for delivery on reconnect and a push notification is sent; on reconnect the client syncs all messages since its last-seen sequence/ID, so nothing is missed. Not duplicated: each message carries a unique ID and a per-conversation sequence number; delivery is at-least-once (retries on unacked delivery, reconnect re-sync), so the same message can arrive more than once — but the client de-duplicates by message ID (idempotent handling) and orders by sequence. Clients ack receipt so the server knows what's delivered. So durability comes from persist-first + offline queue + reconnect sync, and exactly-once *appearance* comes from at-least-once delivery + idempotent client de-dup by ID — the same 'at-least-once + idempotency' pattern from the messaging chapters, applied to chat."
}
```

## 6 · Failure modes & method recap

- **Connection server dies:** its users' sockets drop; clients **reconnect** (to another server),
  re-register in the presence registry, and **sync missed messages** by last-seen ID. Persist-first
  means nothing is lost.
- **Backplane is critical infra** — run it HA (it's on every message path; recall SPOF).
- **Thundering reconnect** after a server/zone failure: many clients reconnect at once — use backoff +
  jitter and spread load (recall stampede/backpressure).
- **Hot group** (huge group chat) = fan-out hotspot → publish-once + per-server delivery, like the feed
  celebrity case.
- **Method recap:** requirements → estimate (connections + storage) → HLD (WebSockets + backplane +
  sharded store + offline queue) → trade-offs (durability, ordering, idempotency, fan-out) → failures.

## Self-test

```quiz
{
  "question": "In a multi-server chat system, the pub/sub backplane exists to:",
  "options": [
    "Encrypt messages",
    "Route a message to whichever connection server holds the recipient's WebSocket (and fan out to group members)",
    "Replace the database",
    "Make connections stateless"
  ],
  "answer": 1,
  "explanation": "Each user's socket lives on one server; the backplane delivers messages to the right server(s) without an N×N mesh, and fans out to groups."
}
```

```quiz
{
  "question": "To ensure messages aren't lost when the recipient is offline, the design:",
  "options": [
    "Drops the message",
    "Persists it durably and queues it for delivery on reconnect (plus a push notification)",
    "Keeps it only in the sender's memory",
    "Relies on the recipient polling"
  ],
  "answer": 1,
  "explanation": "Persist-first + offline queue + reconnect sync guarantees durability; the client de-dups by message ID for at-least-once delivery."
}
```

```quiz
{
  "question": "Why are chat connection servers a special scaling challenge compared to a stateless web tier?",
  "options": [
    "They use less memory",
    "They're stateful — each holds long-lived WebSocket connections, so a recipient lives on one specific server (needing a backplane to route)",
    "They can't use a load balancer",
    "They don't persist data"
  ],
  "answer": 1,
  "explanation": "Stateful persistent connections pin users to specific servers, unlike interchangeable stateless servers — hence the backplane + presence registry."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Design a chat system — key terms", "cards": [
  { "front": "Pub/sub backplane", "back": "Routing layer where a sending connection server publishes a message to a channel; servers holding the recipient(s) subscribe and receive it — avoids an N×N server mesh and fans out for groups." },
  { "front": "Stateful connection server", "back": "A server holding live WebSocket connections; a user's socket lives on exactly one such server, so reaching that user requires routing to its specific server." },
  { "front": "Presence/routing registry", "back": "Records which user is currently connected to which server (and who's offline); connection servers update it as sockets open/close, driving the online fan-out vs offline path decision." },
  { "front": "Persist-first delivery", "back": "Every message is durably stored (sharded by conversation_id) before/independent of live delivery, so nothing is lost even if the recipient is offline or a server crashes mid-delivery." },
  { "front": "At-least-once + idempotent dedup", "back": "Delivery may retry, so the same message can arrive twice; each carries a unique ID + per-conversation sequence, and the client de-duplicates by ID and orders by sequence for exactly-once appearance." },
  { "front": "Offline delivery path", "back": "If the recipient has no live socket, the message stays durable and queued, a push notification fires, and the client syncs all messages since its last-seen ID on reconnect." }
] }
```

## Key takeaways

- A chat system composes the module: **WebSockets** (real-time bidirectional), a **pub/sub backplane**
  (route across **stateful** connection servers), **sharded message storage**, **offline queues +
  push**, and **fan-out** for groups.
- The core challenge is **routing across stateful connection servers** — solved by a **backplane +
  presence registry**, not an N×N mesh.
- Provide **durable delivery** (persist-first + offline queue + reconnect sync) and **client-side
  dedup/order** (per-conversation IDs/sequence + **at-least-once + idempotent client de-dup**).
- Run the **backplane HA** (it's on every path), handle **reconnect storms** (backoff/jitter), and
  treat **huge groups** as a fan-out hotspot.

## You've completed the Intermediate path 🎉

You can now reason about **distributed systems**: services and their communication, replication and
partitioning, caching patterns, messaging and streaming, observability, and reliability — and compose
them into real designs (news feed, chat). The **Advanced** path goes deeper still: consensus, CRDTs,
multi-region, and fault-tolerant production systems at scale.
