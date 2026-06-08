---
title: "UDP — User Datagram Protocol"
slug: udp
level: foundations
module: networking-fundamentals
order: 9
reading_time_min: 12
concepts: [udp, datagram, connectionless, best-effort, real-time, quic]
use_cases: []
prerequisites: [tcp]
status: published
---

# UDP — User Datagram Protocol

## Hook — a motivating scenario

On a video call, the network hiccups and you see a half-second of blocky pixels — then it's fine.
The app didn't freeze waiting to re-fetch those lost frames; it just moved on. If that call had used
TCP's "retransmit everything in order," you'd get a frozen, ever-growing delay instead. Real-time
media deliberately chooses a protocol that would rather *drop* data than wait for it. That's UDP.

## Mental model — shouting across a room

TCP is a phone call (connect, confirm, retransmit). UDP is **shouting a message across a room**: you
just send it. No setup, no confirmation, no guarantee it was heard — but it's instant and you can
fire off many messages without ceremony. Each UDP message is a self-contained **datagram**.

## Build it up — what UDP drops, and why that's a feature

UDP keeps only the bare minimum from the transport layer: addressing (ports) and a checksum. It
**drops** everything that makes TCP heavy:

- **No handshake** — send immediately (no round-trip setup cost).
- **No ordering** — datagrams may arrive in any order.
- **No retransmission** — lost datagrams stay lost; the app decides whether to care.
- **No congestion/flow control** — fast, but it won't politely back off on its own.

For real-time data, this is exactly right: a video frame or game position from 200 ms ago is
**useless** — you want the *next* one, not a re-sent stale one. Trading reliability for low,
predictable latency is the whole point.

```reveal
{
  "prompt": "Why would retransmitting a lost packet actually make a live video call worse?",
  "answer": "By the time the retransmission arrives (another round trip later), that frame is stale — the conversation has moved on. Waiting for it (TCP's head-of-line blocking) freezes everything newer behind it. Dropping it and showing the next fresh frame keeps the call live. Freshness beats completeness for real-time media."
}
```

If an app needs *some* reliability over UDP, it builds just what it needs on top — which is exactly
what modern protocols do.

## In the wild

- **DNS** uses UDP for its quick request/response (small, fast, retried by the app if needed).
- **Live video/voice (VoIP), online games** use UDP (often via RTP/WebRTC) — low latency, loss-tolerant.
- **QUIC / HTTP/3** runs over UDP and rebuilds reliability + ordering *per-stream* in user space,
  avoiding TCP's head-of-line blocking and cutting handshake round trips. The future of web transport
  is UDP-based.
- **Metrics/logs** sometimes use UDP (e.g. statsd) — losing a few data points is acceptable for speed.

## Common misconception — "UDP is unreliable, so it's only for unimportant data"

"Best-effort" isn't "low value."

```reveal
{
  "prompt": "HTTP/3 carries critical web traffic over UDP. How can that be reliable if UDP isn't?",
  "answer": "QUIC (HTTP/3) adds reliability, ordering, and congestion control *in the application layer* on top of UDP — but per-stream, so one lost packet doesn't block unrelated streams (no TCP-style head-of-line blocking). UDP gives a minimal, flexible base; you layer exactly the guarantees you want. 'UDP is unreliable' means the transport doesn't impose guarantees — not that you can't build them."
}
```

UDP is a flexible foundation: it imposes nothing, so you add precisely the guarantees your use case
needs (and nothing more). That's why cutting-edge transports build on it.

## Self-test

```quiz
{
  "question": "Which is NOT something UDP provides?",
  "options": [
    "Port-based addressing",
    "A basic checksum",
    "Guaranteed, in-order delivery",
    "Connectionless datagrams"
  ],
  "answer": 2,
  "explanation": "UDP is best-effort and connectionless — no ordering or retransmission guarantees (that's TCP)."
}
```

```quiz
{
  "question": "Real-time video calls favor UDP mainly because:",
  "options": [
    "It encrypts data automatically",
    "Low, predictable latency matters more than re-delivering stale frames",
    "It guarantees every frame arrives",
    "It uses less bandwidth than any alternative"
  ],
  "answer": 1,
  "explanation": "For live media, a late re-sent frame is useless; UDP avoids waiting and keeps latency low."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "UDP — key terms", "cards": [
  { "front": "UDP", "back": "User Datagram Protocol: a connectionless, best-effort transport that sends self-contained datagrams with no handshake, ordering, or retransmission — fast and low-latency." },
  { "front": "Datagram", "back": "A self-contained UDP message that is just sent — no connection setup, no confirmation, and no guarantee it was received." },
  { "front": "What UDP keeps vs drops", "back": "Keeps only addressing (ports) and a checksum. Drops the handshake, ordering, retransmission, and congestion/flow control that make TCP heavy." },
  { "front": "Best-effort", "back": "The transport imposes no delivery guarantees — lost datagrams stay lost. It means no built-in guarantees, not low-value data." },
  { "front": "Freshness vs completeness", "back": "For real-time media a re-sent stale frame is useless; UDP drops loss and shows the next fresh frame instead of waiting, keeping latency low." },
  { "front": "QUIC / HTTP/3", "back": "Runs over UDP and rebuilds reliability, ordering, and congestion control per-stream in user space, avoiding TCP's head-of-line blocking and cutting handshake round trips." }
] }
```

## Key takeaways

- UDP is **connectionless, best-effort**: no handshake, ordering, or retransmission — just fast,
  self-contained datagrams.
- It trades reliability for **low, predictable latency** — ideal for real-time media, gaming, and DNS.
- "Unreliable" means **no built-in guarantees**, not low value — apps layer exactly what they need
  (e.g. **QUIC/HTTP/3** builds reliability per-stream over UDP).
- Choosing UDP vs TCP is choosing **freshness vs completeness**.

## Up next

We've met both transport protocols. Now the head-to-head: when to pick which. Next: **TCP vs UDP**.
