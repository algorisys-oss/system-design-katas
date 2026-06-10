---
title: "How the Internet Works & Protocol Layers"
slug: how-the-internet-works
level: foundations
module: networking-fundamentals
order: 6
reading_time_min: 9
concepts: [osi, tcp-ip, layers, packets, encapsulation, protocols]
use_cases: []
prerequisites: [latency-numbers]
status: published
---

# How the Internet Works & Protocol Layers

## Hook — a motivating scenario

You type `algoroq.io` and hit Enter. A fraction of a second later a page appears — having crossed
routers, undersea cables, and machines owned by a dozen companies, none of which coordinated in
advance. No central computer runs "the internet." So how does a request reliably find one specific
server among billions of devices and come back?

The answer is **layers** — a stack of protocols where each layer solves one problem and trusts the
layer below for the rest.

## Mental model — sending a letter through a postal system

To mail a letter you don't personally drive it across the country. You write the message, put it in
an envelope with an address, drop it in a box — and a *chain of services* (local post office,
sorting hubs, trucks, planes) each handles one step, trusting the others to do theirs.

The internet works the same way, as a stack of layers. Each layer **wraps** the data from the layer
above with its own "envelope" (headers) and hands it down — a process called **encapsulation**.

```layers
{
  "title": "The network stack (your data starts at the top)",
  "layers": [
    { "label": "Application (HTTP, DNS)", "detail": "What you actually want: 'GET this web page'. Speaks in requests and responses.", "meta": "L7" },
    { "label": "Transport (TCP / UDP)", "detail": "Delivers data between programs. TCP guarantees order & reliability; UDP is fast and best-effort.", "meta": "L4" },
    { "label": "Network (IP)", "detail": "Addresses and routes packets across networks using IP addresses. Finds a path, hop by hop.", "meta": "L3" },
    { "label": "Link (Ethernet / Wi-Fi)", "detail": "Moves bits across one physical hop — your device to the router, a cable between routers.", "meta": "L2/L1" }
  ]
}
```

## Build it up — packets, routing, and the journey of a request

Your data doesn't travel as one big blob. It's chopped into **packets** — small chunks, each
stamped with source and destination IP addresses. Routers pass each packet toward its destination
**hop by hop**, like postal hubs forwarding mail; packets can even take different routes and arrive
out of order (the transport layer reassembles them).

```flow
{
  "title": "Your request's journey to a server",
  "nodes": [
    { "label": "Your device", "detail": "Builds the request and hands it to the OS network stack." },
    { "label": "Home router", "detail": "Your local gateway to the internet (Wi-Fi/Ethernet → ISP)." },
    { "label": "ISP", "detail": "Your internet provider routes the packets toward the destination network." },
    { "label": "Internet routers", "detail": "Many hops across networks/backbones, each forwarding packets closer." },
    { "label": "Server", "detail": "Receives the packets, reassembles the request, and replies the same way back." }
  ],
  "note": "Click a hop. The reply retraces a path back — every round trip is this whole journey, twice."
}
```

The key idea: **each layer only talks to its peer on the other side** and uses the layer below as a
dumb pipe. HTTP doesn't know about cables; IP doesn't know about web pages. That separation is why
the internet can mix Wi-Fi, fiber, and satellite, and run HTTP, email, and video over the same wires.

```reveal
{
  "prompt": "Why split data into many small packets instead of sending one big stream?",
  "answer": "Packets can be routed independently (around congestion or failures), share links fairly with other traffic, and let only the lost pieces be retransmitted instead of the whole message. It also lets many conversations interleave over one wire."
}
```

## In the wild

- The practical model is **TCP/IP** (4 layers); the **OSI model** (7 layers) is the classic teaching
  reference. People say "layer 4" (transport) or "layer 7" (application) constantly — e.g. a "layer-7
  load balancer" routes by HTTP, a "layer-4" one by TCP/IP.
- **Encapsulation** is literal: an HTTP request is wrapped in a TCP segment, wrapped in an IP packet,
  wrapped in an Ethernet frame — headers added at each layer, stripped on the way up.
- **Routers operate at L3** (IP), **switches at L2** (link); this vocabulary shows up in every cloud
  networking console.
- Each layer is **swappable**: Wi-Fi vs Ethernet (L2), IPv4 vs IPv6 (L3), TCP vs UDP (L4) — the
  layers above don't care.

## Common misconception — "the internet is one big network / one computer"

There's no central server, and no single network.

```reveal
{
  "prompt": "If no one runs 'the internet,' how does a packet know the way to a server it's never seen?",
  "answer": "No single machine knows the whole path. Each router only knows its neighbors and which direction generally leads toward a destination (via routing tables/protocols like BGP). The packet is forwarded one hop at a time, each router making a local decision. The path emerges from many independent local choices — not a master map."
}
```

The internet is a *network of networks* cooperating through shared protocols. Its resilience comes
from that decentralization: hops can fail and packets just route around them.

## Self-test

```quiz
{
  "question": "Which layer is responsible for addressing and routing packets across networks?",
  "options": ["Application (L7)", "Transport (L4)", "Network/IP (L3)", "Link (L2)"],
  "answer": 2,
  "explanation": "The Network layer (IP) assigns addresses and routes packets hop-by-hop across networks."
}
```

```quiz
{
  "question": "A 'layer-7 load balancer' makes routing decisions based on:",
  "options": [
    "IP addresses and TCP ports only",
    "Application data like HTTP paths, headers, and cookies",
    "Physical cable type",
    "Disk usage"
  ],
  "answer": 1,
  "explanation": "Layer 7 is the application layer, so it can route by HTTP details (path, host, headers) — unlike a layer-4 (TCP/IP) balancer."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "How the internet works — key terms", "cards": [
  { "front": "Encapsulation", "back": "Each layer wraps the data from the layer above in its own headers (envelope) and hands it down; headers are stripped on the way back up." },
  { "front": "Packet", "back": "A small chunk of your data stamped with source and destination IP addresses, routed independently and reassembled at the destination." },
  { "front": "Hop-by-hop routing", "back": "Routers forward each packet one step at a time toward its destination; no router knows the whole path, only its neighbors and the rough direction." },
  { "front": "TCP/IP vs OSI", "back": "TCP/IP is the practical 4-layer model; OSI is the classic 7-layer teaching reference. Both stack app, transport, network, and link concerns." },
  { "front": "Layer 4 vs Layer 7", "back": "L4 (transport, TCP/IP) routes by IP and ports; L7 (application) routes by HTTP details like path, host, headers, and cookies." },
  { "front": "Network of networks", "back": "The internet has no central computer; independent networks cooperate via shared protocols, so failed hops just route around." }
] }
```

## Key takeaways

- The internet is a **network of networks** with no center; reliability comes from decentralized,
  hop-by-hop routing.
- It's built in **layers** (app → transport → network → link); each solves one problem and treats
  the layer below as a pipe (**encapsulation**).
- Data travels as **packets**, routed independently and reassembled at the destination.
- The **L4 vs L7** vocabulary (transport vs application) is everyday language for load balancers,
  proxies, and firewalls.

## Up next

Layer 3 routes by **IP address** — but what *is* an IP address, and why did we run out of them?
Next: **IP Addressing**.
