---
title: "TCP vs UDP"
slug: tcp-vs-udp
level: foundations
module: networking-fundamentals
order: 10
reading_time_min: 12
concepts: [tcp, udp, trade-offs, protocol-selection]
use_cases: []
prerequisites: [tcp, udp]
status: published
---

# TCP vs UDP

## Hook — a motivating scenario

You're designing two features for the same product: a **file upload** and a **live cursor** showing
where teammates are pointing in a shared document. Same app, same network — but the right transport
for each is opposite. Pick wrong and either your files corrupt or your cursors lag. Choosing between
TCP and UDP is one of the most common "it depends" decisions in system design; here's how to make it
quickly.

## Mental model — the registered letter vs the postcard blast

- **TCP = registered mail with tracking.** Guaranteed to arrive, in order, with proof — but slower
  and with overhead (signatures, handshakes).
- **UDP = a blast of postcards.** Cheap and instant; some may not arrive, and order isn't promised.

Neither is "better." You pick based on a single question: **is a late-but-correct delivery worth
waiting for, or is fresh-and-fast more valuable than complete?**

```compare
{
  "options": [
    { "label": "TCP", "points": ["Reliable + ordered (retransmits)", "Connection + handshake (setup cost)", "Flow & congestion control", "Best when correctness/completeness matters"] },
    { "label": "UDP", "points": ["Best-effort, may drop/reorder", "Connectionless, no setup", "Minimal overhead, low latency", "Best when freshness/speed matters"] }
  ]
}
```

## Build it up — the decision rule

Ask, in order:

1. **Does every byte need to arrive, exactly and in order?** (files, web pages, payments, APIs) →
   **TCP**.
2. **Is stale data useless, and is low latency king?** (live video/voice, games, telemetry) →
   **UDP**.
3. **Need both speed *and* reliability?** → use a protocol that builds reliability over UDP
   (**QUIC/HTTP/3**, WebRTC data channels) rather than fighting TCP's head-of-line blocking.

Map common features to the right transport:

```match
{
  "prompt": "Match each use case to the transport that fits best.",
  "pairs": [
    { "left": "File download / REST API", "right": "TCP (must be complete & ordered)" },
    { "left": "Live video call", "right": "UDP (freshness over completeness)" },
    { "left": "DNS lookup", "right": "UDP (small, fast, app-retried)" },
    { "left": "Database connection", "right": "TCP (reliable, ordered stream)" }
  ]
}
```

```reveal
{
  "prompt": "For the shared-document app: which transport for the file upload, and which for the live cursor positions?",
  "answer": "File upload → TCP: every byte must arrive correctly and in order, and a few hundred ms of latency is fine. Live cursors → UDP-style (e.g. WebRTC): a cursor position from 300 ms ago is worthless; you want the latest, and dropping a stale update is harmless. Same app, opposite choices, driven by 'completeness vs freshness'."
}
```

## In the wild

- **The web** runs on TCP (HTTP/1.1, HTTP/2) — correctness matters. **HTTP/3** moves to QUIC over
  **UDP** to kill head-of-line blocking and cut handshake latency, while keeping reliability per-stream.
  The payoff is concrete: TCP needs a **1-RTT** handshake, and full **TLS 1.2** adds **2 more RTTs**
  before any data flows; QUIC folds transport + **TLS 1.3** setup into **1 RTT** (and **0-RTT** on
  resumption).
- **Databases, message queues, SSH** → TCP (ordered, reliable streams).
- **Games, VoIP, live streaming, DNS** → UDP (low latency, loss-tolerant). DNS uses UDP for small
  queries but falls back to **TCP** for large responses (the truncated/TC bit triggers a retry) and
  for zone transfers; DoT/DoH run over TCP too.
- **Load balancers** distinguish **L4 (TCP/UDP)** vs **L7 (HTTP)** routing — the transport choice
  shapes what infrastructure can inspect.

## Common misconception — "TCP is always the safe default"

TCP's guarantees can actively hurt the wrong workload.

```reveal
{
  "prompt": "Why can TCP be the *wrong* choice for a real-time multiplayer game, even though it's 'more reliable'?",
  "answer": "TCP's in-order guarantee means one lost packet blocks all newer packets until it's retransmitted (head-of-line blocking) — adding latency spikes exactly when the network is lossy. For a game, you'd rather drop a stale position and use the newest one. 'More reliable' here translates to 'more laggy'. Reliability isn't free; match it to the need."
}
```

"Safe default" depends on the workload. For request/response correctness, TCP is right. For
real-time freshness, its very guarantees are a liability.

## Self-test

```quiz
{
  "question": "You're choosing a transport for a payments API. Which fits and why?",
  "options": [
    "UDP — lowest latency",
    "TCP — every byte must arrive correctly and in order",
    "Either works identically",
    "Neither; payments don't use IP"
  ],
  "answer": 1,
  "explanation": "Payments need complete, ordered, reliable delivery — TCP's guarantees are exactly what's required."
}
```

```quiz
{
  "question": "HTTP/3 uses QUIC over UDP primarily to:",
  "options": [
    "Avoid encryption",
    "Get reliability without TCP's head-of-line blocking and with fewer handshake round trips",
    "Reduce server CPU only",
    "Drop reliability entirely"
  ],
  "answer": 1,
  "explanation": "QUIC rebuilds reliability per-stream over UDP, avoiding TCP's ordering stall and cutting setup latency."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "TCP vs UDP — key terms", "cards": [ { "front": "TCP", "back": "Connection-oriented transport with a handshake: reliable, ordered delivery via retransmits, plus flow and congestion control. Best when correctness and completeness matter." }, { "front": "UDP", "back": "Connectionless, best-effort transport: minimal overhead and low latency, but packets may drop or reorder. Best when freshness and speed beat completeness." }, { "front": "The core decision rule", "back": "Choose by completeness vs freshness: TCP when every byte must arrive in order; UDP when low, predictable latency beats re-delivering stale data." }, { "front": "Head-of-line blocking", "back": "TCP's in-order guarantee means one lost packet blocks all newer packets until it's retransmitted, adding latency spikes on lossy networks." }, { "front": "QUIC / HTTP/3", "back": "Builds reliability per-stream over UDP, avoiding TCP's head-of-line blocking and cutting handshake round trips. The answer when you need both speed and reliability." }, { "front": "L4 vs L7 routing", "back": "Load balancers distinguish L4 (TCP/UDP) from L7 (HTTP) routing; the transport choice shapes what infrastructure can inspect." } ] }
```

## Key takeaways

- Choose by **completeness vs freshness**: TCP when every byte must arrive in order; UDP when low,
  predictable latency beats re-delivering stale data.
- TCP costs a **handshake + ordering** (and head-of-line blocking); UDP costs **guarantees** (you add
  what you need).
- "Need both" → **QUIC/HTTP/3** (reliability per-stream over UDP), not TCP brute force.
- There's **no universal default** — the workload decides.

## Up next

We've addressed machines and moved bytes reliably. But you typed a *name*, not an address. Next:
**DNS**, the internet's phone book.
