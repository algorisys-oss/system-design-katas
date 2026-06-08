---
title: "Integration Testing"
slug: integration-testing
level: intermediate
module: reliability-and-testing
order: 34
reading_time_min: 13
concepts: [integration-testing, real-dependencies, test-containers, contract-testing, mocks]
use_cases: []
prerequisites: [testing-fundamentals-for-systems]
status: published
---

# Integration Testing

## Hook — a motivating scenario

Every unit test is green, code review is clean, you deploy — and it instantly breaks: the SQL query
has a typo the mock never noticed, the other service changed a field name, and the config points at the
wrong queue. Units verify *pieces*; none of them verified the pieces actually *work together*. That gap
is exactly what **integration testing** fills — and in distributed systems, it's where most real bugs
live.

## Mental model — test the seams, with real dependencies

**Integration tests** verify that **multiple components work together** across their boundaries — a
service with its **real database**, two services over the network, code with a real message broker or
cache. Unit tests mock those boundaries; integration tests exercise them for real, catching the
**seam bugs** mocks hide: bad queries, serialization mismatches, wrong wiring/config, and contract
drift between services.

```reveal
{
  "prompt": "A repository function has passing unit tests (with a mocked DB) but fails in production with a SQL error. Why didn't the unit test catch it, and what would?",
  "answer": "The unit test mocked the database, so it only verified that the code calls the mock as expected — it never executed the actual SQL against a real database engine, so a syntax error, wrong column name, type mismatch, or constraint violation slips through (the mock happily returns whatever you told it to). An integration test would run the function against a real database (e.g. a throwaway Postgres in a container), executing the actual query and schema, and would immediately surface the SQL error, the missing column, or the constraint problem. The general lesson: mocks verify interactions with a boundary but can't validate the boundary's real behavior; to test 'does my code use the database/another service correctly,' you must include the real dependency. That's the integration layer's whole purpose — exercise the seams that unit tests stub out."
}
```

## Build it up — real dependencies vs mocks, and how

The defining choice is **real vs mocked dependencies**:
- **Use real (or realistic) dependencies** for the thing under integration — a real database, real
  broker, real cache — typically spun up **ephemerally** (e.g. Docker/**Testcontainers**, an in-memory
  or throwaway instance) and torn down per test run. This catches real query/serialization/wiring bugs.
- **Still mock at the edges** you don't control or that are slow/costly (third-party payment APIs,
  email providers) — you don't want your CI calling Stripe. The art is mocking the *external* world
  while using *real* internal dependencies.

The trade vs unit tests: integration tests are **slower** (start a DB, do I/O) and a bit more
**setup-heavy**, so you have *some*, not thousands (recall the pyramid).

```reveal
{
  "prompt": "Why run integration tests against a real (containerized) database instead of an in-memory fake or a heavily-mocked one?",
  "answer": "Because the point is to validate behavior against the actual dependency, and fakes/mocks diverge from production in exactly the ways that cause bugs. A different in-memory database (e.g. H2 standing in for Postgres) has different SQL dialects, types, constraints, transaction/isolation behavior, and functions — so tests can pass on the fake and fail on real Postgres (or vice versa), giving false confidence. A real, throwaway containerized instance of the SAME engine/version you run in production exercises your real schema, migrations, queries, indexes, and constraints, catching dialect issues, query errors, and migration problems before deploy. Tools like Testcontainers make spinning up and tearing down a real DB per test run cheap and isolated. You accept slower tests for fidelity — which is the whole reason integration tests exist. Mock the external/slow/uncontrolled stuff; use the real thing for the dependency you're actually integrating with."
}
```

How much of the boundary you make real is a dial — from fully mocked to fully real:

```tradeoff
{ "title": "How much of the dependency should an integration test make real?", "axis": { "left": "Mostly mocked (fast)", "right": "Real dependencies (high fidelity)" }, "steps": [ { "label": "Mocked boundary", "detail": "Stub the DB/broker/service. Fast and easy, but only verifies you call the mock as expected — query, serialization, wiring, and contract bugs slip through." }, { "label": "In-memory / different fake", "detail": "Cheaper than real, but a fake engine (e.g. H2 for Postgres) diverges in dialect, types, constraints, and isolation — tests can pass on the fake yet fail in production." }, { "label": "Real, same engine (Testcontainers)", "detail": "Throwaway containerized instance of the production engine/version exercises real schema, migrations, queries, and constraints — catching the seam bugs, at the cost of slower, setup-heavier tests." } ] }
```

## Build it up — contract testing for services

When two **independently-deployed services** integrate, a special problem appears: service A and B can
each pass their own tests, then break in production because B changed a field A relied on (recall API
versioning). **Contract tests** (e.g. Pact) verify that the **consumer's expectations** and the
**provider's API** still agree — without spinning up both services together. They catch interface drift
early, in each service's own pipeline.

## In the wild

- **Testcontainers** (real DBs/brokers in Docker per test run) is the standard for high-fidelity
  integration tests; cloud emulators (LocalStack) stand in for cloud services.
- **Contract testing (Pact, consumer-driven contracts)** guards microservice interfaces between
  independently-deployed services.
- Integration tests typically run in **CI** (a bit slower than unit, still per-PR or pre-merge), with
  ephemeral dependencies spun up and torn down.
- They're the **highest-value layer for distributed systems**, where most bugs are in the interactions.

## Common misconception — "if all my unit tests pass, the system works"

Units verify pieces in isolation; systems break at the **seams** units mock away.

```reveal
{
  "prompt": "Why can a service with 100% passing unit tests still be fundamentally broken when deployed?",
  "answer": "Because unit tests deliberately isolate the code under test by mocking its collaborators (database, other services, broker, config), so they verify each piece's internal logic but NOT how the pieces actually connect. Real systems break at those seams: a query that's wrong against the real schema, a serialization/field-name mismatch with another service, a misconfigured connection string or queue name, an incompatible API change in a dependency, transaction/isolation behavior, migration issues — none of which a mocked boundary exercises. The mocks encode your assumptions, and the bug is usually that an assumption was wrong. So a fully green unit suite says 'each part works as I imagined the others behave,' not 'the parts work together against reality.' You need integration tests (real dependencies) and contract tests (service agreements) to validate the connections — which is exactly where distributed-system defects concentrate."
}
```

Integration tests validate the **seams** — code against **real internal dependencies** (DB, broker,
peer services), mocking only the **external** world — and **contract tests** guard service interfaces.
Green unit tests prove the pieces, not the whole.

## Self-test

```quiz
{
  "question": "Integration tests primarily catch bugs that unit tests miss because they:",
  "options": [
    "Run faster",
    "Exercise components together against real dependencies (DB, broker, peer services), catching seam/wiring/query bugs",
    "Test the UI only",
    "Require 100% coverage"
  ],
  "answer": 1,
  "explanation": "Units mock boundaries; integration tests use real dependencies, surfacing query/serialization/config/contract bugs at the seams."
}
```

```quiz
{
  "question": "For two independently-deployed services, the test type that prevents 'B changed a field A relied on' breakage is:",
  "options": [
    "More unit tests",
    "Contract testing (verifying consumer expectations match the provider's API)",
    "Load testing",
    "Chaos testing"
  ],
  "answer": 1,
  "explanation": "Contract tests verify the consumer/provider agreement so interface drift between independently-deployed services is caught early."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Integration testing — key terms", "cards": [ { "front": "Integration test", "back": "A test that verifies multiple components work together across their boundaries — e.g. a service with its real database, broker, or cache — catching the seam bugs mocks hide." }, { "front": "Seam bugs", "back": "Defects at the boundaries between components: bad queries, serialization/field-name mismatches, wrong wiring or config, and contract drift — exactly what unit tests mock away." }, { "front": "Real vs mocked dependencies", "back": "The defining integration choice: use real internal dependencies (DB, broker, cache) for fidelity, but mock the external/slow/uncontrolled world (third-party APIs)." }, { "front": "Testcontainers", "back": "Tooling that spins up real DBs/brokers in Docker ephemerally per test run and tears them down, giving high-fidelity integration tests against the production engine." }, { "front": "Contract testing (Pact)", "back": "Verifies that a consumer's expectations and the provider's API still agree, catching interface drift between independently-deployed services early in each pipeline." }, { "front": "Why not an in-memory fake?", "back": "A different engine (e.g. H2 for Postgres) diverges in SQL dialect, types, constraints, and isolation, so tests can pass on the fake but fail on the real database." } ] }
```

## Key takeaways

- **Integration tests** verify **components working together** across boundaries (service + real DB,
  service ↔ service), catching the **seam bugs** unit mocks hide.
- Use **real internal dependencies** (often via **Testcontainers/ephemeral instances**); **mock only
  the external/slow/uncontrolled** world (third-party APIs).
- For independently-deployed services, **contract tests** guard the **API agreement** against drift.
- They're slower than units (have *some*, per the pyramid) but the **highest-value layer for
  distributed systems** — green units ≠ working system.

## Up next

Above integration sits the full user-journey test. Next: **End-to-End Testing**.
