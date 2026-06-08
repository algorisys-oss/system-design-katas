---
title: "Logging"
slug: logging
level: intermediate
module: observability
order: 29
reading_time_min: 13
concepts: [structured-logging, log-levels, aggregation, correlation-id, sampling, pii]
use_cases: []
prerequisites: [observability-fundamentals]
status: published
---

# Logging

## Hook — a motivating scenario

It's 3 a.m., a service is misbehaving, and you SSH into a box to `tail` the logs — except there are 20
boxes, the logs are unstructured prose you can't filter, half the lines are `print("here")` debug
spam, and you can't tell which lines belong to the failing request. Logging *exists* but isn't
*useful*. Good logging is the difference between "grep and pray" and answering precise questions in
seconds.

## Mental model — queryable event records, not console spam

A **log** is a timestamped record of a discrete event. The shift that makes logs useful at scale is
from **unstructured text** ("User 5 failed to checkout") to **structured logs** — machine-parseable
key/value (usually JSON) you can filter, aggregate, and correlate:

```json
{ "ts": "...", "level": "error", "event": "checkout_failed",
  "user_id": 5, "order_id": 123, "reason": "payment_timeout", "trace_id": "abc123" }
```

Now you can ask "all `checkout_failed` with `reason=payment_timeout` in the last hour" instead of
grepping prose.

## Build it up — levels, aggregation, correlation

- **Log levels** convey severity and control volume: `DEBUG` (dev detail) < `INFO` (normal events) <
  `WARN` (something off) < `ERROR` (a failure) < `FATAL`. Run production around INFO/WARN; crank to
  DEBUG temporarily when investigating. Levels let you filter signal from noise.
- **Centralized aggregation:** ship logs off the boxes into a searchable store (ELK/OpenSearch, Loki,
  Splunk) so you query *across all services/instances* in one place — essential once you have more
  than one server (the 20-box problem).
- **Correlation IDs:** include the **trace/request ID** (from observability fundamentals) in every log
  line, so you can pull *all* logs for one request across all services — turning scattered lines into a
  coherent story.

```reveal
{
  "prompt": "Why are structured (JSON) logs with a trace_id dramatically more useful than well-written prose log messages?",
  "answer": "Because they're queryable and correlatable at scale. Structured logs let you filter and aggregate by field — 'count errors grouped by reason', 'all events for user_id=5', 'p99 of a logged duration' — across millions of lines and many services, which is impossible with free-text prose you can only grep imprecisely. Adding a trace_id ties every line of a single request together across services, so you can reconstruct exactly what happened to that one request end-to-end (and pivot to it from a trace or metric alert). Prose messages, however nicely worded, force humans to read line-by-line and can't be machine-aggregated or reliably joined across services. Structure + correlation turn logs from a narrative you scroll into a dataset you can ask questions of."
}
```

## Build it up — what (not) to log, and cost

- **Don't log secrets/PII** — passwords, tokens, full card numbers, personal data. Logs are widely
  accessible and retained; leaking PII into them is a real security/compliance incident (recall the
  no-secrets-in-URLs idea).
- **Volume costs money and hides signal** — logging everything is expensive to store/index and buries
  the important lines. Log meaningful events at appropriate levels; **sample** high-volume logs.
- **Log the useful context** — IDs, the operation, the outcome, durations — not `here`/`got to line
  42`. Each line should answer a question someone will actually ask.
- **Logs vs metrics:** don't compute aggregates by counting log lines when a metric is cheaper and
  purpose-built (e.g. request rate). Use logs for *detail*, metrics for *trends*.

```reveal
{
  "prompt": "A team logs every request and response body at DEBUG in production 'to be safe.' What problems does this cause?",
  "answer": "Several. Cost/performance: massive log volume is expensive to ship, store, and index, and the logging itself adds latency/CPU. Signal-to-noise: the genuinely important error lines drown in a flood of routine detail, making incidents harder, not easier, to debug. Security/compliance: full request/response bodies almost certainly capture secrets and PII (tokens, passwords, personal data), creating a serious leak in a broadly-accessible, long-retained store. Wrong tool: counting requests by scanning logs is far costlier than a simple metric. The fix: log meaningful events at sensible levels (INFO/WARN/ERROR in prod, DEBUG only temporarily/when investigating), redact/avoid secrets and PII, sample high-volume logs, capture useful structured context (IDs, outcomes, durations) instead of full bodies, and use metrics for aggregate trends. 'Log everything to be safe' is expensive, noisy, and unsafe."
}
```

## In the wild

- **Structured logging libraries** (zap, zerolog, pino, structlog) + central aggregation (ELK/
  OpenSearch, Loki, Splunk, Datadog) are the standard stack.
- **Trace IDs in logs** enable pivoting between the three pillars (metric → trace → logs).
- **Retention tiers** (recall hot/warm/cold): recent logs hot and searchable, old logs compressed/
  archived for cost.
- **PII redaction/scrubbing** in the logging pipeline is standard practice; access to logs is
  controlled.

## Common misconception — "more logs = better debugging"

Useful logging is about **signal and structure**, not volume.

```reveal
{
  "prompt": "Why doesn't logging more lines make a system easier to debug, and what actually does?",
  "answer": "More lines mostly add noise, cost, and latency — the critical error gets buried among thousands of routine lines, storage/indexing bills balloon, and you risk leaking secrets/PII. What actually helps: structured logs (queryable key/values) so you can filter/aggregate precisely; appropriate log levels so production stays at signal level (and DEBUG is on-demand); centralized aggregation so you search across all services at once; correlation/trace IDs so you can pull one request's full story; and logging meaningful events with useful context rather than everything. Debuggability comes from being able to ask precise questions and correlate across pillars — quality and structure — not from sheer quantity. Often the fix for poor debuggability is logging less but better, plus adding metrics and traces."
}
```

Effective logging = **structured, leveled, centralized, correlated** records of **meaningful** events
— with **no secrets/PII** and **controlled volume**. Quantity without structure is noise (and cost).

## Self-test

```quiz
{
  "question": "The biggest practical upgrade for logs in a multi-service system is:",
  "options": [
    "Logging more verbosely everywhere",
    "Structured (JSON) logs with trace/correlation IDs, shipped to centralized search",
    "Writing logs only to local files",
    "Removing all log levels"
  ],
  "answer": 1,
  "explanation": "Structure + correlation IDs + central aggregation make logs queryable and joinable across services — the key to debugging at scale."
}
```

```quiz
{
  "question": "Which should you NOT put in logs?",
  "options": [
    "Request/trace IDs",
    "Operation names and outcomes",
    "Secrets and PII (passwords, tokens, card numbers, personal data)",
    "Error reasons and durations"
  ],
  "answer": 2,
  "explanation": "Logs are widely accessible and retained; secrets/PII in logs are a security/compliance leak — redact or omit them."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Logging — key terms", "cards": [
  { "front": "Structured log", "back": "A machine-parseable key/value (usually JSON) event record you can filter, aggregate, and correlate — unlike free-text prose you can only grep imprecisely." },
  { "front": "Log levels", "back": "Severity tiers controlling volume: DEBUG < INFO < WARN < ERROR < FATAL. Run production around INFO/WARN; crank to DEBUG temporarily when investigating." },
  { "front": "Centralized aggregation", "back": "Shipping logs off the boxes into a searchable store (ELK/OpenSearch, Loki, Splunk) so you query across all services and instances in one place." },
  { "front": "Correlation / trace ID", "back": "A request ID included in every log line, so you can pull all logs for one request across services and reconstruct its full story end-to-end." },
  { "front": "Sampling", "back": "Keeping only a fraction of high-volume logs to control cost and noise, since logging everything is expensive to store/index and buries important lines." },
  { "front": "PII redaction", "back": "Scrubbing secrets and personal data (passwords, tokens, card numbers) from logs, which are widely accessible and retained — leaking them is a security/compliance incident." }
] }
```

## Key takeaways

- Prefer **structured logs** (queryable key/values) over prose; include **log levels** and a
  **trace/correlation ID** in every line.
- **Centralize** logs into searchable storage so you query **across all services/instances** (not
  `tail` on boxes).
- **Never log secrets/PII**, and **control volume** (sensible levels + sampling) — quantity buries
  signal and costs money.
- Logs are for **detail**; use **metrics** for trends — and correlate across the three pillars.

## Up next

For trends and alerting, you need numbers over time. Next: **Metrics & Key System Metrics**.
