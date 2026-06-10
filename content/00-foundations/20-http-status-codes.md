---
title: "HTTP Status Codes"
slug: http-status-codes
level: foundations
module: apis-and-the-web
order: 20
reading_time_min: 13
concepts: [status-codes, http, error-handling, api-design, idempotency-hint]
use_cases: []
prerequisites: [http-fundamentals, rest-api-fundamentals]
status: published
---

# HTTP Status Codes

## Hook — a motivating scenario

A mobile client retries failed requests automatically. The server starts returning `200 OK` with
`{"error": "not found"}` in the body for missing items. The client — checking only the status code —
treats every response as success, caches the "errors," and never retries the ones it should. One
wrong status code silently broke the whole error-handling contract. Status codes aren't decoration;
they're the **machine-readable outcome** every client, proxy, and cache relies on.

## Mental model — the first digit tells the story

A status code is a 3-digit number whose **first digit** is the category. Learn the five families and
you can interpret any code you've never seen:

```layers
{
  "title": "Status code families (by first digit)",
  "layers": [
    { "label": "1xx — Informational", "detail": "Interim responses (rare in app code), e.g. 100 Continue, 101 Switching Protocols.", "meta": "1xx" },
    { "label": "2xx — Success", "detail": "It worked. 200 OK, 201 Created, 204 No Content.", "meta": "2xx" },
    { "label": "3xx — Redirection", "detail": "Go elsewhere. 301 Moved Permanently (cacheable), 302 Found (temporary redirect), 304 Not Modified (caching).", "meta": "3xx" },
    { "label": "4xx — Client error", "detail": "You messed up the request. 400, 401, 403, 404, 409, 422, 429.", "meta": "4xx" },
    { "label": "5xx — Server error", "detail": "The server messed up. 500, 502, 503, 504.", "meta": "5xx" }
  ]
}
```

The critical split: **4xx = the client's fault** (don't blindly retry — fix the request); **5xx = the
server's fault** (often safe to retry, ideally with backoff).

## Build it up — the codes you'll actually use

```match
{
  "prompt": "Match each status code to its meaning.",
  "pairs": [
    { "left": "201 Created", "right": "Resource created (e.g. after POST)" },
    { "left": "400 Bad Request", "right": "Malformed/invalid request from client" },
    { "left": "401 Unauthorized", "right": "Not authenticated (who are you?)" },
    { "left": "403 Forbidden", "right": "Authenticated but not allowed" },
    { "left": "404 Not Found", "right": "Resource doesn't exist" },
    { "left": "429 Too Many Requests", "right": "Rate limited — slow down" },
    { "left": "500 Internal Server Error", "right": "Unhandled server-side failure" },
    { "left": "503 Service Unavailable", "right": "Server temporarily down/overloaded" }
  ]
}
```

Two frequently-confused pairs:
- **401 vs 403:** 401 = *not authenticated* (no/invalid credentials — log in). 403 = *authenticated
  but not authorized* (you're known, but not allowed).
- **400 vs 422:** 400 = malformed request; 422 = well-formed but semantically invalid (validation
  failed). (Many APIs just use 400.)

```reveal
{
  "prompt": "Why does returning 200 OK with an error message in the body (instead of a 4xx/5xx) cause problems?",
  "answer": "The whole ecosystem keys off the status code: clients decide success/retry, caches decide cacheability, monitoring counts error rates, load balancers detect unhealthy backends. A 200 says 'success', so clients won't retry real failures, caches may store errors, dashboards show 0% errors during an outage, and health checks stay green. The status code is the machine-readable contract — the body is for humans/details."
}
```

## In the wild

- **Retries & resilience** hinge on codes: retry 5xx/429 (with backoff + jitter), don't retry most
  4xx. Combined with idempotency (next chapters), this is how clients stay correct.
- **Caching:** `304 Not Modified` powers conditional requests (ETag/If-None-Match) to skip re-sending
  unchanged data; `301` vs `302` affects whether browsers cache the redirect.
- **Health & monitoring:** load balancers mark backends unhealthy on 5xx; alerting watches 5xx/4xx
  rates. Correct codes make systems observable and self-healing.
- **429 + Retry-After** tells clients exactly how long to wait — pairs with rate limiting.

## Common misconception — "404 means something is broken / 200 means everything's fine"

Codes describe the *outcome of this request*, not system health.

```reveal
{
  "prompt": "Is a high rate of 404s always a problem? Is a 200 always 'good'?",
  "answer": "Not necessarily. 404 is a normal answer to 'does this resource exist?' — checking for a not-yet-created item legitimately returns 404; it's a client-side 'not found', not a server failure. And a 200 can be 'bad' if it's masking an error in the body (the anti-pattern above). Judge health by the right codes: 5xx spikes signal server problems; 4xx patterns may be normal or indicate client/bug issues. Use codes for their defined meaning, not as a blunt good/bad signal."
}
```

A 404 is a valid, expected answer (the resource isn't there), and a 200 is only 'good' if it
honestly represents success. Use each code for its precise meaning so clients and monitoring behave
correctly.

## Self-test

```quiz
{
  "question": "A request has valid credentials but the user isn't allowed to access the resource. The correct status code is:",
  "options": ["401 Unauthorized", "403 Forbidden", "404 Not Found", "400 Bad Request"],
  "answer": 1,
  "explanation": "401 = not authenticated; 403 = authenticated but not authorized. Here the user is known but not permitted → 403."
}
```

```quiz
{
  "question": "A client should generally retry (with backoff) which category of response?",
  "options": [
    "4xx client errors",
    "5xx server errors and 429 (rate limited)",
    "2xx success",
    "3xx redirects"
  ],
  "answer": 1,
  "explanation": "5xx (server faults) and 429 (slow down) are typically retryable; most 4xx mean fix the request, don't retry."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "HTTP status codes — key terms", "cards": [
  { "front": "What does the first digit of a status code tell you?", "back": "The category: 1xx informational, 2xx success, 3xx redirection, 4xx client error, 5xx server error. Learn the five families to interpret any code." },
  { "front": "4xx vs 5xx", "back": "4xx = the client's fault (don't blindly retry — fix the request). 5xx = the server's fault (often safe to retry, ideally with backoff)." },
  { "front": "401 vs 403", "back": "401 Unauthorized = not authenticated (no/invalid credentials — log in). 403 Forbidden = authenticated but not allowed to access the resource." },
  { "front": "400 vs 422", "back": "400 Bad Request = malformed request. 422 = well-formed but semantically invalid (validation failed). Many APIs just use 400 for both." },
  { "front": "Why not return 200 OK with an error in the body?", "back": "The whole ecosystem keys off the status code: clients skip retries, caches store errors, dashboards show 0% errors during an outage, and health checks stay green." },
  { "front": "429 Too Many Requests + Retry-After", "back": "Rate-limited; slow down. Retry-After tells the client exactly how long to wait. Typically retryable, pairing with rate limiting." }
] }
```

## Key takeaways

- The **first digit** classifies the response: 2xx success, 3xx redirect, **4xx client error**, **5xx
  server error**.
- **4xx = your request is wrong (don't blindly retry); 5xx/429 = retry with backoff.**
- Know the everyday codes and the tricky pairs: **401 vs 403**, **400 vs 422**.
- The status code is a **machine-readable contract** for clients, caches, and monitoring — never fake
  a 200 over a real error.

## Up next

Requests carry inputs beyond the path. Next: **API Path & Query Parameters** — where data goes in a
request and why it matters.
