---
title: "TCP — Transmission Control Protocol"
slug: tcp
level: foundations
module: networking-fundamentals
order: 8
reading_time_min: 15
concepts: [tcp, handshake, reliability, ordering, flow-control, congestion-control]
use_cases: []
prerequisites: [ip-addressing]
status: published
---

# TCP — Transmission Control Protocol

## Hook — a motivating scenario

You download a 1 GB file over a flaky train Wi-Fi. Packets drop, arrive out of order, and the
connection stutters — yet the file lands **byte-perfect**. You never wrote retry logic. Something
underneath turned an unreliable network into a reliable stream. That something is TCP, and knowing
how it works explains both why your downloads are correct and why a new connection has a startup cost.

## Mental model — a phone call, not a postcard

IP alone is like mailing postcards: they might arrive, in any order, or not at all. TCP layers a
**phone call** on top — first you both say hello and confirm you can hear each other (the
handshake), then you talk in order, and if a word is missed you ask for it again. TCP gives you a
**reliable, ordered byte stream** over an unreliable packet network.

## Build it up — the three-way handshake

Before any data flows, both sides synchronize with a **three-way handshake** to agree they're ready
and on starting sequence numbers. Step through it:

```sequence
{
  "title": "TCP three-way handshake (connection setup)",
  "actors": ["Client", "Server"],
  "steps": [
    { "from": "Client", "to": "Server", "label": "SYN (let's talk, seq=x)" },
    { "from": "Server", "to": "Client", "label": "SYN-ACK (ok, seq=y, ack=x+1)" },
    { "from": "Client", "to": "Server", "label": "ACK (great, seq=x+1, ack=y+1)" },
    { "from": "Client", "to": "Server", "label": "data flows" }
  ]
}
```

That round trip is why a fresh connection has a **setup cost** (one round trip before any data). It's
also why we reuse connections (keep-alive, connection pools) instead of opening a new one per request.

Once connected, TCP guarantees:
- **Ordering** — each byte has a sequence number; the receiver reassembles in order even if packets
  arrive scrambled.
- **Reliability** — the receiver **ACK**s what it got; unACKed data is retransmitted.
- **Flow control** — the receiver advertises how much it can accept so a fast sender doesn't swamp a
  slow receiver.
- **Congestion control** — TCP backs off when the network is congested, then ramps up — sharing
  bandwidth fairly (and why throughput "warms up").

```reveal
{
  "prompt": "Why does TCP throughput often start slow and speed up over the first moments of a transfer?",
  "answer": "Congestion control (slow start): TCP doesn't know the network's capacity, so it begins conservatively and ramps the send rate up until it sees loss, then backs off. This protects the network and probes for available bandwidth — so big transfers accelerate after the first round trips."
}
```

## In the wild

- **HTTP (1.1/2) runs over TCP**, so every web request inherits TCP's reliability — and its
  handshake cost. HTTPS adds a *further* TLS handshake on top (next chapters).
- **Connection reuse** (keep-alive, pooling) avoids paying the handshake per request; opening a new
  TCP+TLS connection per call is a classic latency bug.
- **Head-of-line blocking:** because TCP enforces order, one lost packet stalls everything behind it
  — a key motivation for HTTP/3 moving to UDP-based QUIC.
- **A "connection"** is real state on both ends (buffers, sequence numbers); servers have limits on
  concurrent connections, which is why connection management matters at scale.

## Common misconception — "TCP guarantees delivery, so messages can't be lost"

TCP guarantees a lot, but not magic.

```reveal
{
  "prompt": "Your app writes a message to a TCP socket and the write succeeds, then the server crashes. Is the message guaranteed delivered and processed?",
  "answer": "No. A successful write only means the data entered your OS's send buffer — not that the peer received it, and certainly not that the application processed it. TCP recovers from packet loss while the connection lives, but a crash, a reset, or a half-open connection can still lose in-flight data. Application-level acknowledgements are needed for true end-to-end delivery guarantees."
}
```

TCP gives reliable, ordered delivery **while the connection is healthy** — it is not an
application-level guarantee that the other side received *and acted on* your message. That's why
systems add their own acknowledgements, retries, and idempotency (later chapters).

## Self-test

```quiz
{
  "question": "What is the purpose of TCP's three-way handshake?",
  "options": [
    "To encrypt the connection",
    "To establish a connection and agree on starting sequence numbers before data flows",
    "To compress the data",
    "To look up the server's IP"
  ],
  "answer": 1,
  "explanation": "SYN → SYN-ACK → ACK synchronizes both sides and their sequence numbers before any data is sent."
}
```

```quiz
{
  "question": "Which guarantee does TCP provide that raw IP does not?",
  "options": [
    "Faster delivery",
    "Encryption",
    "Reliable, in-order byte delivery (with retransmission)",
    "Shorter routes"
  ],
  "answer": 2,
  "explanation": "TCP adds ordering, acknowledgements/retransmission, flow and congestion control on top of best-effort IP."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "TCP — key terms", "cards": [ { "front": "Three-way handshake", "back": "SYN → SYN-ACK → ACK exchange that synchronizes both sides and their starting sequence numbers before any data flows, costing one round trip of setup." }, { "front": "Reliable, ordered byte stream", "back": "TCP's core guarantee: bytes arrive in order with no loss while the connection is healthy, built over best-effort IP." }, { "front": "ACK and retransmission", "back": "The receiver acknowledges what it got; any unACKed data is retransmitted, recovering from packet loss while the connection lives." }, { "front": "Flow control", "back": "The receiver advertises how much it can accept so a fast sender doesn't swamp a slow receiver." }, { "front": "Congestion control (slow start)", "back": "TCP begins conservatively and ramps the send rate until it sees loss, then backs off — sharing bandwidth fairly and causing throughput 'warm-up'." }, { "front": "Head-of-line blocking", "back": "Because TCP enforces order, one lost packet stalls everything queued behind it — a key motivation for HTTP/3's UDP-based QUIC." } ] }
```

## Key takeaways

- TCP turns unreliable packets into a **reliable, ordered byte stream** via sequence numbers, ACKs,
  and retransmission.
- The **three-way handshake** (SYN/SYN-ACK/ACK) costs one round trip up front — reuse connections to
  avoid paying it per request.
- **Flow + congestion control** make TCP share the network fairly and explain "warm-up" throughput;
  strict ordering causes **head-of-line blocking**.
- TCP's guarantees hold **only while the connection is healthy** — true delivery needs
  application-level acks/idempotency.

## Up next

TCP's reliability isn't free. Sometimes you'd trade it for raw speed. Next: **UDP**, the fast,
connectionless alternative.
