---
title: "IP Addressing"
slug: ip-addressing
level: foundations
module: networking-fundamentals
order: 7
reading_time_min: 14
concepts: [ipv4, ipv6, ports, public-private-ip, nat, cidr]
use_cases: []
prerequisites: [how-the-internet-works, binary-and-data-representation]
status: published
---

# IP Addressing

## Hook — a motivating scenario

Your laptop, your phone, and your smart TV all browse the web at the same time over one home
connection — yet the internet sees them as a *single* address. Meanwhile your backend server has an
address the whole world can reach directly. Same internet, two completely different addressing
situations. Understanding why is the difference between "it works on my machine" and debugging a
production networking issue.

## Mental model — addresses and apartment numbers

An **IP address** is like a building's street address: it gets data to the right *machine*. But a
machine runs many programs at once, so we also need a **port** — like an apartment number — to reach
the right *program*. `142.250.72.46:443` means "this machine, the program listening on port 443"
(HTTPS). Address finds the host; port finds the service.

```reveal
{
  "prompt": "Two web requests from your laptop to two different sites use the same source IP. How does your machine keep their replies straight?",
  "answer": "By source port. Each outgoing connection uses a different ephemeral source port, so the OS can match each reply to the right connection/socket. An address+port pair on each end uniquely identifies a connection."
}
```

## Build it up — IPv4, the shortage, and IPv6

An **IPv4** address is 32 bits, written as four bytes: `192.168.0.1`. That's only ~4.3 billion
addresses (2³²) — fewer than there are people, let alone devices. The internet *ran out*.

Two fixes:
- **NAT (Network Address Translation):** your home router has one public IP; all your devices share
  it using private addresses internally (`192.168.x.x`, `10.x.x.x`). The router rewrites addresses
  and ports so many devices hide behind one public address — that's why your TV and phone look like
  one address to the world.
- **IPv6:** a 128-bit address (`2001:db8::1`), giving ~3.4×10³⁸ addresses — enough for every grain
  of sand to have billions. The long-term fix; adoption is gradual.

```compare
{
  "options": [
    { "label": "IPv4", "points": ["32 bits (~4.3 billion)", "Dotted decimal: 192.168.0.1", "Exhausted — needs NAT to stretch", "Still dominant in practice"] },
    { "label": "IPv6", "points": ["128 bits (~3.4×10^38)", "Hex, colon-separated: 2001:db8::1", "No practical shortage", "Adoption growing, coexists with IPv4"] }
  ]
}
```

**Public vs private.** Public IPs are globally routable (your server, a website). Private ranges are
reusable inside any local network and are *not* routable on the public internet — they only work
behind NAT. This is why your `localhost`/`192.168.x` service isn't reachable from outside without
port forwarding or a public address.

```reveal
{
  "prompt": "You deploy a service bound to 127.0.0.1 (localhost) on a cloud VM and can't reach it from your laptop. Why?",
  "answer": "127.0.0.1 only accepts connections from the machine itself. To accept external traffic, bind to 0.0.0.0 (all interfaces) and ensure the VM's public IP/firewall/security-group allows the port. Binding address and reachability are separate concerns."
}
```

## In the wild

- **CIDR notation** (`10.0.0.0/8`, `192.168.1.0/24`) describes address *ranges* — the `/n` says how
  many leading bits are the network part. You'll define these constantly as **subnets** in cloud VPCs.
- **Ports below 1024** are well-known (80 HTTP, 443 HTTPS, 22 SSH, 53 DNS); apps typically use higher
  ports.
- **NAT** is why peer-to-peer (video calls, gaming) needs tricks like STUN/TURN — devices behind NAT
  can't be directly addressed from outside.
- **Cloud security groups / firewalls** are essentially rules over (IP range, port) — the same
  address+port model, used for access control.

## Common misconception — "every device has its own public internet address"

Most devices don't — they share one via NAT.

```reveal
{
  "prompt": "If your phone and laptop both show source IP 203.0.113.7 to a website, are they the 'same' on the internet?",
  "answer": "To the public internet, that one public IP is the boundary — your router's. Internally each device has a distinct private IP, and the router uses NAT (rewriting ports) to tell their connections apart. The public sees one address; privately there are several."
}
```

A public IP usually identifies a *network boundary* (your router, a load balancer, a NAT gateway),
not a single device. Many devices hide behind it.

## Self-test

```quiz
{
  "question": "What does a port number identify?",
  "options": [
    "Which physical cable is used",
    "Which machine to deliver to",
    "Which program/service on a machine to deliver to",
    "The speed of the connection"
  ],
  "answer": 2,
  "explanation": "The IP address finds the host; the port selects which program/service (e.g. 443 → the HTTPS server)."
}
```

```quiz
{
  "question": "Why was NAT widely adopted?",
  "options": [
    "To make connections faster",
    "To let many devices share one scarce public IPv4 address",
    "To encrypt traffic",
    "To replace DNS"
  ],
  "answer": 1,
  "explanation": "IPv4 addresses are scarce; NAT lets a whole private network share a single public IP."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "IP addressing — key terms", "cards": [
  { "front": "IP address", "back": "A network address that locates a specific machine (host) so data can be delivered to it — like a building's street address." },
  { "front": "Port", "back": "A number that selects which program/service on a machine to deliver to — like an apartment number. E.g. 443 reaches the HTTPS server." },
  { "front": "IPv4", "back": "A 32-bit address written as dotted decimal (192.168.0.1). Only ~4.3 billion addresses, so it is exhausted and stretched with NAT." },
  { "front": "IPv6", "back": "A 128-bit address in hex, colon-separated (2001:db8::1), giving ~3.4×10^38 addresses. The long-term fix; adoption is gradual." },
  { "front": "NAT (Network Address Translation)", "back": "Lets many private devices share one public IP. The router rewrites addresses and ports so the world sees one address for the whole network." },
  { "front": "Public vs private IP", "back": "Public IPs are globally routable; private ranges (192.168.x.x, 10.x.x.x) are reusable inside any LAN and only work behind NAT, not on the public internet." },
  { "front": "CIDR notation", "back": "Describes address ranges like 10.0.0.0/8; the /n says how many leading bits are the network part. Used to define subnets in cloud VPCs." }
] }
```

## Key takeaways

- An **IP address** locates a machine; a **port** selects the program on it. A connection is
  identified by both ends' (IP, port).
- **IPv4** (32-bit, ~4.3B) is exhausted; **NAT** stretches it (many private devices behind one
  public IP), and **IPv6** (128-bit) is the long-term fix.
- **Public vs private** addresses and **bind address vs reachability** are common sources of "can't
  connect" bugs.
- **CIDR ranges** define subnets — the everyday vocabulary of cloud networking and firewalls.

## Up next

We can address a machine and a port — now we need a *conversation* over that connection. Next:
**TCP**, the protocol that makes data delivery reliable.
