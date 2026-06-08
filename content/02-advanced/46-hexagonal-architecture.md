---
title: "Hexagonal Architecture"
slug: hexagonal-architecture
level: advanced
module: operability-and-patterns
order: 46
reading_time_min: 13
concepts: [hexagonal-architecture, ports-and-adapters, dependency-inversion, domain-isolation, testability, clean-architecture]
use_cases: []
prerequisites: [monoliths-vs-microservices, testing-fundamentals-for-systems, polyglot-persistence]
status: published
---

# Hexagonal Architecture

## Hook — a motivating scenario

Your core business logic — pricing rules, order validation — is tangled directly with SQL queries, HTTP
handlers, and a specific payment SDK. Swapping Postgres for another store, or testing the pricing logic
without spinning up a database and web server, is painful. The business rules (which rarely change) are
held hostage by infrastructure (which changes often). **Hexagonal architecture (ports & adapters)**
fixes this by **isolating the core domain from all external concerns** behind well-defined boundaries.

## Mental model — domain core in the center, infrastructure at the edges

**Hexagonal architecture** (a.k.a. **ports and adapters**, by Alistair Cockburn) puts the **business
logic (domain) at the center**, isolated from all external technology — databases, web frameworks,
message brokers, third-party APIs — which live at the **edges**. The core interacts with the outside
**only through abstract interfaces** called **ports**; concrete **adapters** implement those ports for
specific technologies. Crucially, **dependencies point *inward*** (infrastructure depends on the domain,
never the reverse — **dependency inversion**).

```layers
{
  "title": "Ports & adapters: dependencies point inward to the domain",
  "layers": [
    { "label": "Adapters (outer)", "detail": "Concrete tech: Postgres repo, HTTP controller, Kafka consumer, Stripe client — implement/call ports.", "meta": "edges" },
    { "label": "Ports (boundary)", "detail": "Abstract interfaces the domain defines: 'OrderRepository', 'PaymentGateway', 'NotificationSender'.", "meta": "boundary" },
    { "label": "Domain core (center)", "detail": "Pure business logic + rules. Knows NOTHING about DBs/HTTP/frameworks. Depends on nothing outward.", "meta": "center" }
  ],
  "note": "Dependencies point INWARD: adapters depend on the domain via ports; the domain depends on no infrastructure."
}
```

## Build it up — ports, adapters, and why it matters

- **Ports** are interfaces **owned by the domain** that express what it *needs* ("save an order", "charge
  a card") or *offers* — in **domain terms, not technology terms**.
- **Adapters** are the **technology-specific implementations**: a `PostgresOrderRepository` adapter
  implements the `OrderRepository` port; an `HttpController` adapter calls into the domain; a
  `StripePaymentAdapter` implements `PaymentGateway`. Two kinds: **driving** adapters (call the domain —
  HTTP, CLI, tests) and **driven** adapters (the domain calls them — DB, broker, external APIs).
- **The payoff:**
  - **Testability:** test the domain with **in-memory/mock adapters** — no database or web server needed
    (recall the test pyramid: fast, isolated unit/domain tests).
  - **Swappable infrastructure:** change Postgres → another DB, REST → gRPC, one broker → another, by
    **writing a new adapter** — the domain is untouched.
  - **Protected business logic:** the part that holds the real value (rules) doesn't churn when
    infrastructure does.

```reveal
{
  "prompt": "How does hexagonal architecture make the core domain logic both highly testable and independent of specific databases/frameworks?",
  "answer": "By inverting dependencies so the domain depends on abstractions it owns, never on concrete infrastructure. The domain defines ports — interfaces expressed in business terms (e.g. OrderRepository.save(order), PaymentGateway.charge(...)) — and contains pure business logic that calls those interfaces without knowing or caring how they're implemented. Concrete technology lives in adapters at the edges that implement the ports (a PostgresOrderRepository, a StripePaymentAdapter) or drive the domain (an HTTP controller, a CLI). Because dependencies point INWARD (adapters depend on the domain's interfaces; the domain depends on nothing outward), two big benefits follow. Testability: to test the domain you simply supply lightweight test adapters — in-memory or mock implementations of the ports (an in-memory OrderRepository, a fake PaymentGateway) — so you can exercise all the business rules and edge cases with fast, deterministic unit tests, with no database, web server, broker, or network involved. The domain has no infrastructure to spin up, so tests are quick and reliable (the base of the test pyramid). Independence from specific databases/frameworks: since the domain only references ports, swapping the underlying technology means writing a NEW adapter that implements the same port — change Postgres to another store, REST to gRPC, one message broker to another, or the payment provider — without touching the domain logic at all. The business rules (the high-value, slow-changing part) are insulated from infrastructure churn (the fast-changing, replaceable part). This is dependency inversion applied at the architectural level: instead of business logic calling concrete SQL/HTTP/SDK code (which would couple it to those technologies and require real infrastructure to test), the concrete code conforms to interfaces the domain dictates. The result is a core that's pure, framework-agnostic, easy to reason about, fast to test, and stable across infrastructure changes — which is exactly the goal of hexagonal architecture (and the related clean/onion architectures)."
}
```

## Build it up — relation to other ideas, and pitfalls

- **Same family as Clean / Onion architecture and DDD:** all share **dependency inversion toward a pure
  domain core** with infrastructure at the edges; "hexagonal" just emphasizes the **ports/adapters**
  framing (the hexagon shape implies "many sides/adapters", not exactly six).
- **It composes with everything you've learned:** the domain core stays the same while adapters handle
  **polyglot persistence** (recall — swap stores), **API styles** (REST/gRPC/GraphQL adapters), and
  **messaging** (broker adapters) — and it's what makes a service cleanly **extractable** during
  **strangler-fig** migration (recall — the domain isn't tangled with infrastructure).
- **Pitfall — over-engineering:** the indirection (ports/adapters, mapping between domain and infra
  models) is **overhead**; for **simple CRUD** apps it can be needless ceremony. It pays off where there's
  **substantial business logic** worth protecting and **multiple/changing** integrations.

```reveal
{
  "prompt": "When is hexagonal architecture worth its indirection, and when is it over-engineering?",
  "answer": "It's worth the indirection when you have substantial, valuable business logic to protect and/or multiple or changing external integrations — the situations where isolating the domain pays off. Strong signals: rich domain rules (pricing, eligibility, order workflows, financial calculations) that you want to test thoroughly and fast without infrastructure, and that you don't want churning every time infrastructure changes; multiple adapters for the same concern (e.g. several payment providers, multiple data stores via polyglot persistence, REST + gRPC + messaging entry points) where a stable port with swappable adapters is genuinely useful; long-lived, critical systems where infrastructure WILL change over time (DB migrations, framework upgrades, new channels) and you want those changes confined to adapters; and systems you intend to evolve or extract incrementally (strangler-fig migrations are far easier when the domain isn't tangled with infrastructure). In these cases the ports/adapters indirection buys testability (fast domain tests with in-memory adapters), swappability (new adapter instead of rewriting logic), and protection of high-value rules from infrastructure churn — clearly outweighing the overhead. It's over-engineering when the application is mostly simple CRUD with thin or no real business logic — where the 'domain' is basically moving data between the database and the API. There, the ports/adapters layers, the interfaces, and the mapping between domain models and infrastructure models add ceremony and boilerplate for little benefit: you're abstracting a database you'll likely never swap and logic that's trivial to test directly, so the indirection just slows development and obscures simple code. For such apps, a straightforward layered approach (or even framework-native patterns) is simpler and adequate. The decision mirrors other 'powerful but heavy' patterns (CQRS, event sourcing, polyglot persistence): adopt hexagonal where domain complexity, integration multiplicity, and longevity justify the structure; default to something simpler when the system is small and infrastructure-stable. Match the architecture to the amount of business logic worth isolating and the likelihood/number of changing integrations — not to a desire for 'clean' layers everywhere."
}
```

How much ports/adapters indirection to adopt is itself a dial, set by how much business logic and integration churn you have:

```tradeoff
{
  "title": "How much hexagonal indirection should you adopt?",
  "axis": { "left": "Direct (minimal indirection)", "right": "Full ports & adapters (max isolation)" },
  "steps": [
    { "label": "Simple CRUD, thin logic", "detail": "Mostly moving data between DB and API. Ports/adapters and domain-to-infra mapping are needless ceremony; a straightforward layered approach is simpler and adequate." },
    { "label": "Some real rules, one DB", "detail": "Enough logic to test directly, but infrastructure is stable. Light separation may help, yet full ports/adapters can still be more overhead than payoff." },
    { "label": "Rich domain, changing integrations", "detail": "Substantial business rules plus multiple/changing integrations (polyglot persistence, REST/gRPC, brokers). Stable ports with swappable adapters earn their keep." },
    { "label": "Critical, long-lived, evolving", "detail": "High-value rules to protect from infrastructure churn, plus strangler-fig extraction. Full isolation gives fast domain tests and confines change to adapters." }
  ]
}
```

## In the wild

- **Hexagonal / Clean / Onion architecture** and **DDD** are widely used for services with significant
  business logic; frameworks and templates exist across languages (Spring, .NET, Go).
- **The domain core + ports** make services **highly testable** (in-memory adapters — recall test
  pyramid) and **infrastructure-agnostic** (swap DBs/brokers/API styles via adapters — recall polyglot,
  API styles).
- It underpins **clean microservice boundaries** and makes services **extractable** in
  **strangler-fig**/monolith-decomposition (recall).
- **Pitfall:** unnecessary for simple CRUD — apply where domain complexity justifies it.

## Common misconception — "it's just adding interfaces / always use clean architecture"

The point is **dependency inversion isolating a pure domain**, and it's **overkill for simple CRUD** —
not a universal mandate.

```reveal
{
  "prompt": "Why is 'hexagonal architecture is just sprinkling interfaces everywhere' a misunderstanding, and why isn't it a universal best practice?",
  "answer": "It's a misunderstanding because the essence isn't 'have interfaces' — it's the DIRECTION of dependencies and the ISOLATION of a pure domain. Hexagonal architecture specifically arranges things so that all dependencies point inward toward a domain core that contains the business logic and knows nothing about databases, web frameworks, brokers, or external SDKs; the domain DEFINES the interfaces (ports) it needs in business terms, and infrastructure (adapters) conforms to them. You can add interfaces all day and still have it wrong — e.g. if the domain imports/depends on infrastructure types, if ports are defined in technology terms rather than domain terms, or if business logic leaks into adapters — none of which achieves the isolation. The point is dependency inversion (concrete infrastructure depends on domain abstractions, never the reverse) producing a framework-agnostic, independently-testable core; interfaces are merely the mechanism. As for universality: it's not a best practice to apply everywhere because the isolation and indirection have real costs (ports/adapters, mapping between domain and infrastructure models, more layers and boilerplate). Those costs are justified when there's substantial business logic to protect and test, and multiple or changing integrations to swap — but for simple CRUD apps with thin logic, the architecture adds ceremony that obscures trivial code and slows development while abstracting a database you'll likely never replace and logic you could test directly. Like CQRS, event sourcing, and polyglot persistence, it's a powerful pattern for specific situations (rich domains, long-lived critical systems, many adapters, incremental extraction), not a default to impose on every project. So the two errors are: thinking it's just 'use interfaces' (missing that it's dependency inversion isolating a pure domain) and thinking it should always be used (ignoring that it's overkill for simple CRUD). Apply it deliberately where domain complexity and integration churn make domain isolation valuable; choose simpler structures otherwise."
}
```

**Hexagonal architecture (ports & adapters)** isolates a **pure domain core** from infrastructure:
the domain defines **ports** (abstract, business-term interfaces) and tech-specific **adapters**
implement them, with **dependencies pointing inward** (dependency inversion). The payoff is
**testability** (in-memory adapters), **swappable infrastructure** (new adapter, untouched domain), and
**protected business logic**. It's the same family as **Clean/Onion/DDD** — and **overkill for simple
CRUD**.

## Self-test

```quiz
{
  "question": "In hexagonal (ports & adapters) architecture, dependencies point:",
  "options": [
    "From the domain outward to the database and frameworks",
    "Inward — infrastructure adapters depend on the domain (via ports the domain defines); the domain depends on no infrastructure",
    "In both directions equally",
    "From the database to the network"
  ],
  "answer": 1,
  "explanation": "Dependency inversion: the domain core defines ports and knows nothing about tech; adapters implement those ports — so infra depends on the domain, not vice versa."
}
```

```quiz
{
  "question": "The main payoff of isolating the domain behind ports/adapters is:",
  "options": [
    "Faster network calls",
    "Testability (test the domain with in-memory adapters) and swappable infrastructure (change DB/broker/API style by writing a new adapter)",
    "It removes the need for a database",
    "It guarantees strong consistency"
  ],
  "answer": 1,
  "explanation": "A pure, infrastructure-agnostic domain can be unit-tested without real infra, and technologies swap by replacing adapters — the business logic stays untouched."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Hexagonal architecture — key terms", "cards": [
  { "front": "Hexagonal architecture (ports & adapters)", "back": "Pattern that isolates a pure domain core from all external technology, which lives at the edges as adapters; the core interacts with the outside only through abstract interfaces (ports)." },
  { "front": "Port", "back": "An abstract interface owned by the domain, expressed in business terms (e.g. OrderRepository, PaymentGateway), describing what the domain needs or offers — not technology." },
  { "front": "Adapter", "back": "A technology-specific implementation at the edge. Driving adapters call the domain (HTTP, CLI, tests); driven adapters are called by it (DB, broker, external APIs)." },
  { "front": "Dependency inversion (here)", "back": "Dependencies point inward: infrastructure adapters depend on the domain via ports, and the domain depends on no infrastructure — so concrete tech conforms to interfaces the domain defines." },
  { "front": "Main payoff", "back": "Testability (test the domain with in-memory/mock adapters, no DB or web server), swappable infrastructure (new adapter, untouched domain), and protected, stable business logic." },
  { "front": "When it's over-engineering", "back": "Simple CRUD apps with thin logic, where ports/adapters and model mapping add ceremony abstracting a database you'll never swap. Apply where domain complexity and changing integrations justify it." }
] }
```

## Key takeaways

- **Hexagonal architecture (ports & adapters)** puts a **pure domain core** at the center, isolated from
  infrastructure, which lives at the **edges** as **adapters**.
- The domain defines **ports** (abstract, business-term interfaces); **adapters** implement them for
  specific tech — and **dependencies point inward** (dependency inversion: infra depends on domain, not
  vice versa).
- Payoff: **testability** (in-memory/mock adapters — no DB/web server), **swappable infrastructure** (new
  adapter, untouched domain), and **protected, stable business logic**.
- Same family as **Clean/Onion/DDD**; composes with **polyglot persistence, API styles, messaging, and
  strangler-fig extraction** — but it's **overkill for simple CRUD**.

## Up next

A pattern for serving different client types well. Next: **Backend for Frontend (BFF)**.
