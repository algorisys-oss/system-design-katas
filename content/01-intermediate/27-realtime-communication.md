---
title: "Real-Time Communication"
slug: realtime-communication
level: intermediate
module: messaging-and-streaming
order: 27
reading_time_min: 15
concepts: [websockets, sse, long-polling, webrtc, push, realtime]
use_cases: []
prerequisites: [http-fundamentals, tcp, publish-subscribe]
status: published
---

# Real-Time Communication

## Hook — a motivating scenario

You're building a chat app. With plain HTTP, the browser can only *ask* the server for new messages —
so you poll every second, wasting requests and still feeling laggy. But chat needs the **server to push
to the browser** the instant a message arrives. HTTP's request/response model wasn't built for that,
so a family of techniques exists to get **real-time, server-initiated updates** to clients. Picking the
right one is a common design decision for chat, live feeds, dashboards, notifications, and games.

## Mental model — beating HTTP's "client must ask" limitation

Normal HTTP is **client-pull**: the server can't speak unless asked. Real-time techniques work around
this, from hacks on top of HTTP to purpose-built protocols:

```compare
{
  "options": [
    { "label": "Short polling", "points": ["Client requests on a timer", "Simple; works everywhere", "Wasteful + laggy (mostly empty responses)", "Fine for infrequent updates"] },
    { "label": "Long polling", "points": ["Request held open until data (or timeout), then re-poll", "Near-real-time over plain HTTP", "Still per-message overhead; many open requests", "Fallback when sockets unavailable"] },
    { "label": "SSE (Server-Sent Events)", "points": ["One long-lived HTTP stream, server → client", "Simple, auto-reconnect, text events", "One-way only (server to client)", "Great for feeds/notifications/dashboards"] },
    { "label": "WebSockets", "points": ["Full-duplex persistent connection (both ways)", "Low overhead after handshake; real-time both directions", "More infra (stateful connections, scaling)", "Great for chat, games, collaboration"] }
  ]
}
```

## Build it up — choosing the technique

- **Server → client only?** (live scores, notifications, a metrics dashboard) → **SSE** — a single
  long-lived HTTP response streaming events, with built-in auto-reconnect. Simple and HTTP-friendly.
- **Both directions, interactive?** (chat, multiplayer, collaborative editing) → **WebSockets** — one
  persistent, full-duplex TCP connection; after the upgrade handshake, both sides send anytime with
  minimal overhead.
- **No socket support / legacy?** → **long polling** as a fallback (near-real-time over plain HTTP).
- **Peer-to-peer, ultra-low-latency media?** (video/voice calls, screen share) → **WebRTC** — direct
  browser-to-browser media (recall it runs over UDP for low latency), with servers only for signaling/
  NAT traversal.

```reveal
{
  "prompt": "For a live sports-score ticker (server pushes updates, client never sends anything), why is SSE often a better choice than WebSockets?",
  "answer": "Because the communication is one-way (server → client), and SSE is purpose-built for exactly that: a single long-lived HTTP response that streams events down to the client. It's simpler than WebSockets (plain HTTP, no upgrade handshake or separate protocol), works through most proxies/CDNs, has automatic reconnection built in, and needs no client→server channel you won't use. WebSockets add full-duplex capability and the operational weight of managing stateful bidirectional connections — overkill when the client never talks back. Use WebSockets when you genuinely need the client to send too (chat, games); for push-only feeds/notifications/dashboards, SSE delivers real-time updates with less complexity. Match the channel's directionality to the tool."
}
```

These techniques sit on a spectrum trading per-message overhead and lag for persistent, stateful push:

```tradeoff
{ "title": "How aggressively should the server push?", "axis": { "left": "Client pulls (stateless HTTP)", "right": "Server pushes (persistent stateful connection)" }, "steps": [
  { "label": "Short polling", "detail": "Client re-requests on a timer. Simplest and stateless; works everywhere. But wasteful and laggy — most responses are empty. Fine only for infrequent updates." },
  { "label": "Long polling", "detail": "Request held open until data (or timeout), then re-poll. Near-real-time over plain HTTP and a good fallback, but still per-message overhead and many open requests." },
  { "label": "SSE", "detail": "One long-lived HTTP stream, server → client, with auto-reconnect. Real-time push with low overhead, but one-way only — no client→server channel." },
  { "label": "WebSockets", "detail": "Persistent full-duplex connection; both sides send anytime with minimal overhead. Maximum real-time interactivity, but stateful — needing more infra and a pub/sub backplane to scale." }
] }
```

## Build it up — the scaling catch: real-time is stateful

Real-time connections are **long-lived and stateful** — each connected client holds an open connection
on some server. That collides with the **stateless, load-balanced** model you've built:
- A server can hold only so many concurrent connections (memory/file descriptors) — scaling means many
  servers, each holding a subset of clients.
- To deliver a message to a user, you must reach **whichever server holds that user's connection** —
  so you need a **pub/sub backplane** (e.g. Redis Pub/Sub or NATS) that fans a message out to all
  servers, which forward it to their connected clients (recall pub/sub + stateful-vs-stateless).

```reveal
{
  "prompt": "In a chat app across 10 WebSocket servers, user A (on server 3) sends a message to user B (on server 7). How does it get there?",
  "answer": "Server 3 can't directly reach B's socket — B's connection lives on server 7. The standard solution is a pub/sub backplane: server 3 publishes the message (e.g. to a channel/topic for B or for the chat room) to a shared broker like Redis Pub/Sub or NATS; all chat servers subscribe, so server 7 receives it and pushes it down B's WebSocket. This decouples 'which server holds which connection' from message delivery — any server can originate a message and the backplane fans it out to the server(s) holding the relevant recipients. It's the same fan-out pattern from pub/sub, applied to route real-time messages across a fleet of stateful connection servers. Without a backplane, you'd be stuck because real-time connections are sticky to one server, unlike stateless HTTP that any server can handle."
}
```

## In the wild

- **WebSockets:** chat (Slack), multiplayer games, collaborative editing (Figma/Google Docs), live
  trading.
- **SSE:** live feeds, notifications, dashboards, LLM token streaming, build/log streaming.
- **Long polling:** legacy/fallback (older Socket.IO transports).
- **WebRTC:** video/voice calls, screen sharing, P2P data (recall UDP/real-time chapters).
- All real-time fleets use a **pub/sub backplane** (Redis Pub/Sub, NATS, or managed realtime infra) to route messages across
  connection-holding servers; sticky sessions or connection-aware routing manage the stateful
  connections.

## Common misconception — "use WebSockets for all real-time; they're the modern default"

WebSockets are powerful but heavier; one-way needs are simpler with SSE, and not everything needs a
socket.

```reveal
{
  "prompt": "Why is defaulting to WebSockets for every real-time feature often the wrong call?",
  "answer": "WebSockets bring real cost: a stateful, full-duplex connection per client that pins users to specific servers, requires a pub/sub backplane to route messages across the fleet, complicates load balancing/scaling/auth, and can be harder through some proxies/CDNs. That weight is justified when you truly need bidirectional, interactive, low-latency communication (chat, games, collaboration). But for one-way push (notifications, feeds, dashboards, streaming results), SSE gives real-time updates with far less complexity (plain HTTP, auto-reconnect, no client→server channel to manage). And for infrequent updates, long/short polling may be perfectly adequate. Defaulting to WebSockets everywhere over-engineers one-way and low-frequency cases, taking on stateful-connection scaling problems you didn't need. Match the technique to directionality and frequency: SSE/polling for push-only/infrequent, WebSockets for interactive two-way, WebRTC for P2P media."
}
```

Pick by **directionality and interactivity**: SSE for server→client push, WebSockets for full-duplex
interaction, long polling as a fallback, WebRTC for P2P media — and remember all of them are
**stateful**, needing a **pub/sub backplane** to scale across servers.

## Self-test

```quiz
{
  "question": "For one-way, server-to-client real-time updates (e.g. a live notifications feed), the simplest fit is:",
  "options": ["WebSockets", "Server-Sent Events (SSE)", "WebRTC", "Short polling forever"],
  "answer": 1,
  "explanation": "SSE streams events server→client over one long-lived HTTP connection with auto-reconnect — simpler than WebSockets when the client never sends."
}
```

```quiz
{
  "question": "Scaling real-time (e.g. WebSocket) servers requires a pub/sub backplane because:",
  "options": [
    "Connections are stateless",
    "Each client's connection lives on one specific server, so messages must be fanned out to reach whichever server holds the recipient",
    "WebSockets can't use TCP",
    "It encrypts messages"
  ],
  "answer": 1,
  "explanation": "Real-time connections are stateful/sticky to a server; a backplane (Redis Pub/Sub, NATS, or managed realtime infra) routes messages across the fleet to the right connection."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Real-time communication — key terms", "cards": [
  { "front": "Client-pull (HTTP's limit)", "back": "Normal HTTP: the server can't speak unless asked. The client must repeatedly request updates — real-time techniques work around this to enable server-initiated push." },
  { "front": "Short polling", "back": "Client re-requests on a timer. Simple and works everywhere, but wasteful and laggy since most responses are empty. Fine only for infrequent updates." },
  { "front": "Long polling", "back": "The request is held open until data arrives (or it times out), then the client re-polls. Gives near-real-time delivery over plain HTTP; used as a fallback when sockets are unavailable." },
  { "front": "SSE (Server-Sent Events)", "back": "One long-lived HTTP stream pushing events server → client, with built-in auto-reconnect. One-way only — great for feeds, notifications, dashboards, and LLM token streaming." },
  { "front": "WebSockets", "back": "A persistent, full-duplex TCP connection: after the upgrade handshake both sides send anytime with low overhead. Best for chat, games, and collaboration; heavier to scale." },
  { "front": "WebRTC", "back": "Direct browser-to-browser media over UDP for ultra-low latency, with servers only for signaling/NAT traversal. Used for video/voice calls and screen sharing." },
  { "front": "Pub/sub backplane", "back": "A shared broker (Redis Pub/Sub, NATS) that fans a message across all connection servers, so any server can reach whichever server holds the recipient's stateful connection." }
] }
```

## Key takeaways

- HTTP is **client-pull**; real-time techniques add **server push**: **short/long polling**, **SSE**
  (one-way stream), **WebSockets** (full-duplex), **WebRTC** (P2P media).
- Choose by **directionality/interactivity**: SSE for server→client push, WebSockets for interactive
  two-way, polling as fallback, WebRTC for low-latency P2P media.
- Real-time connections are **long-lived and stateful** — they need a **pub/sub backplane** (e.g. Redis
  Pub/Sub, NATS, or managed realtime infra) to scale across many connection-holding servers. (Kafka is a
  durable event *log*, not ideal for ephemeral per-socket routing — use it for durable pipelines.)
- WebSockets aren't a universal default — they're heavier; don't use them where SSE/polling suffices.

## Up next

That completes messaging & streaming. Distributed, async systems are hard to debug — so next we make
them observable. Next module: **Observability Fundamentals**.
