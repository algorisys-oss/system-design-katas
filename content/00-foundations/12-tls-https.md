---
title: "TLS & HTTPS"
slug: tls-https
level: foundations
module: networking-fundamentals
order: 12
reading_time_min: 15
concepts: [tls, https, encryption, certificates, public-key, handshake, mitm]
use_cases: []
prerequisites: [tcp, dns]
status: published
---

# TLS & HTTPS

## Hook — a motivating scenario

You log in to your bank over coffee-shop Wi-Fi. Dozens of strangers share that network and could, in
principle, read every packet you send. Yet your password and balance stay private — and you're sure
you're talking to your *actual* bank, not an impostor running a fake hotspot. Two guarantees,
delivered by one protocol layered onto TCP: **TLS** (and HTTPS = HTTP over TLS).

## Mental model — a sealed, signed envelope from a verified sender

Plain HTTP is a postcard: anyone handling it can read and alter it. TLS turns it into a **sealed
envelope** (encryption — only the recipient can read it) **from a verified sender** (authentication
— a trusted authority vouches it's really your bank). It also detects tampering (integrity). Privacy,
identity, integrity — all three.

## Build it up — keys and the handshake

TLS combines two ideas:

- **Asymmetric (public-key) crypto** for setup: the server has a **public key** (shareable) and a
  **private key** (secret). Anyone can encrypt with the public key, but only the private key can
  decrypt — used to securely agree on a shared secret.
- **Symmetric crypto** for the actual data: fast encryption with that shared secret, used for the
  rest of the session (asymmetric is slow, so it's only used to bootstrap). Each encrypted record
  also carries an **authentication tag (MAC)** derived from the session keys, so any modification in
  transit is detected and the connection is dropped — that's how TLS guarantees integrity.

The **certificate** ties it together: a Certificate Authority (CA) the browser trusts digitally
signs "this public key belongs to algoroq.io." Your browser ships with a list of trusted CAs and
checks the signature — that's how it knows the sender is genuine. This is what defeats a
**man-in-the-middle (MITM)** attack: an attacker on the network can relay traffic but can't present
a CA-signed certificate for your bank's domain, so the impersonation is caught.

```sequence
{
  "title": "TLS handshake (simplified)",
  "actors": ["Client", "Server"],
  "steps": [
    { "from": "Client", "to": "Server", "label": "ClientHello (TLS versions, ciphers)" },
    { "from": "Server", "to": "Client", "label": "ServerHello + certificate (public key)" },
    { "from": "Client", "to": "Client", "label": "verify cert against trusted CAs" },
    { "from": "Client", "to": "Server", "label": "key exchange → shared session secret" },
    { "from": "Client", "to": "Server", "label": "Finished (encrypted)" },
    { "from": "Server", "to": "Client", "label": "Finished (encrypted)" },
    { "from": "Client", "to": "Server", "label": "encrypted application data (HTTPS)" }
  ]
}
```

This handshake costs extra round trips **on top of** TCP's. A full **TLS 1.2** handshake adds about
**2 round trips**; **TLS 1.3** cut that to **1 round trip** (and **0-RTT** when resuming a prior
session). That's why HTTPS connections have a setup cost, and why connection reuse, TLS session
resumption, and HTTP/2/3 matter for performance.

```reveal
{
  "prompt": "Why use slow public-key crypto for the handshake but fast symmetric crypto for the actual data?",
  "answer": "Asymmetric crypto solves the hard problem — securely agreeing on a shared secret over an open channel without having met before — but it's computationally expensive. Once both sides share a secret, symmetric encryption is far faster for bulk data. TLS uses each where it's best: asymmetric to bootstrap trust, symmetric for the session."
}
```

## In the wild

- **HTTPS = HTTP over TLS.** The padlock means the connection is encrypted *and* the certificate
  validated — not that the site is trustworthy in intent.
- **Let's Encrypt** made free, automated certificates ubiquitous; modern infra auto-renews them.
- **TLS termination** often happens at a load balancer/CDN edge (decrypt there, talk plain HTTP to
  internal services on a trusted network) — a common architecture decision.
- **HSTS** forces browsers to always use HTTPS; **certificate expiry** is a classic outage cause
  (auto-renew + monitor).

## Common misconception — "the HTTPS padlock means the website is safe/legit"

TLS secures the *connection*, not the *intent*.

```reveal
{
  "prompt": "A phishing site has a valid HTTPS certificate and a padlock. Are you safe?",
  "answer": "No. TLS guarantees the connection is encrypted and that you're really talking to the domain on the certificate — it says nothing about whether that domain is honest. Anyone (including scammers) can get a free cert for a domain they control. The padlock means 'private connection to this domain', not 'this business is trustworthy'. Always check the domain name itself."
}
```

HTTPS protects against eavesdropping and impersonation *of a domain* — it does not vouch for the
site's honesty. Encryption ≠ trustworthiness.

## Self-test

```quiz
{
  "question": "What does a server's TLS certificate primarily establish?",
  "options": [
    "That the website's content is accurate",
    "That the public key belongs to the named domain (verified by a trusted CA)",
    "That the connection is fast",
    "That the server has no bugs"
  ],
  "answer": 1,
  "explanation": "A CA signs that a public key belongs to a domain, letting the client authenticate the server's identity."
}
```

```quiz
{
  "question": "Why does TLS use symmetric encryption for the bulk of the session data?",
  "options": [
    "It's the only kind that's secure",
    "It's much faster than asymmetric crypto, which is only needed to set up the shared secret",
    "It doesn't require any keys",
    "Browsers can't do asymmetric crypto"
  ],
  "answer": 1,
  "explanation": "Asymmetric crypto bootstraps a shared secret; symmetric crypto then encrypts data quickly."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "TLS & HTTPS — key terms", "cards": [
  { "front": "TLS", "back": "A protocol layered on TCP that gives a connection privacy (encryption), identity (authentication), and integrity (tamper detection). HTTPS is HTTP over TLS." },
  { "front": "Asymmetric (public-key) crypto", "back": "A public key (shareable) encrypts and only the matching private key (secret) decrypts. Used during setup to securely agree on a shared secret, but computationally slow." },
  { "front": "Symmetric crypto in TLS", "back": "Fast encryption using the shared secret agreed during the handshake. Used for the bulk of the session data because asymmetric crypto is too slow for it." },
  { "front": "Certificate", "back": "A Certificate Authority (CA) the browser trusts digitally signs that a public key belongs to a domain. The browser checks the signature to authenticate the server." },
  { "front": "TLS termination", "back": "Decrypting TLS at a load balancer or CDN edge, then talking plain HTTP to internal services over a trusted network — a common architecture decision." },
  { "front": "Padlock meaning", "back": "A private, encrypted connection to a verified domain — not proof the site is honest. Anyone, including scammers, can get a valid cert for a domain they control." }
] }
```

## Key takeaways

- **TLS** gives a connection three properties: **privacy** (encryption), **identity**
  (authentication via CA-signed certificates), and **integrity** (tamper detection). HTTPS = HTTP
  over TLS.
- It uses **asymmetric** crypto to agree on a secret, then fast **symmetric** crypto for the data.
- The **handshake adds round trips** atop TCP — reuse connections and use session resumption / HTTP/2/3.
- The **padlock means a private connection to a verified domain**, not that the site is honest.

## Up next

We have a secure, reliable channel. Now the language spoken over it: **HTTP Fundamentals** — methods,
headers, and the request/response model.
