---
title: "API Versioning"
slug: api-versioning
level: foundations
module: apis-and-the-web
order: 23
reading_time_min: 12
concepts: [versioning, breaking-changes, backward-compatibility, deprecation, api-evolution]
use_cases: []
prerequisites: [rest-api-fundamentals, data-serialization]
status: published
---

# API Versioning

## Hook — a motivating scenario

You rename a JSON field from `name` to `full_name` to be clearer. Clean change, ship it. Within
minutes, support lights up: a partner's integration, three old mobile app versions still in users'
pockets, and a scheduled job all broke — they expected `name`. You can't force everyone to update at
once. **Versioning** is how an API evolves without breaking the clients you don't control.

## Mental model — you can't recall what's already shipped

Once a client depends on your API's shape, that shape is a **contract**. Old mobile apps live on
phones for years; partners integrate once and rarely touch it. You can't update them on your
schedule. So changes fall into two kinds, and the distinction drives everything:

- **Non-breaking (additive):** add a new optional field, a new endpoint, a new optional param. Old
  clients ignore what they don't know → safe, no new version needed.
- **Breaking:** rename/remove a field, change a type, change required inputs or response shape, change
  status-code meaning → old clients break → needs a **new version**.

```reveal
{
  "prompt": "Why is *adding* a new optional field safe, but *renaming* a field a breaking change?",
  "answer": "Well-behaved clients ignore fields they don't recognize, so a new optional field is invisible to old code (forward-compatible — recall serialization). Renaming removes the old field that existing clients read by name, so their code gets null/undefined and breaks. Add = additive and safe; rename = remove + add = breaks readers of the old name."
}
```

## Build it up — where the version lives

When you must break, you run **multiple versions side by side** and migrate clients over time. Common
placements:

```compare
{
  "options": [
    { "label": "URL path versioning", "points": ["/v1/users, /v2/users", "Obvious, easy to route & cache", "Most common in practice", "Version is visible in every request"] },
    { "label": "Header versioning", "points": ["Accept: application/vnd.api.v2+json", "Keeps URLs clean/stable", "Harder to test/debug by hand", "Less visible; needs discipline"] }
  ]
}
```

URL versioning (`/v1/…`) is the most widespread because it's explicit and trivially routable. Header
versioning keeps URLs stable but is easier to get wrong. Two other placements you'll meet in the wild:
a **query parameter** (Azure famously uses `?api-version=2024-01-01`) or a **custom header**
(`X-API-Version: 2`) — so the URL-path-vs-Accept-header split isn't the whole menu. Whatever you
choose, the **process** matters more than the placement:

1. Ship `v2` alongside `v1` (don't delete `v1`).
2. **Announce deprecation** of `v1` with a timeline; signal it (e.g. a `Deprecation`/`Sunset` header,
   docs, emails).
3. Watch usage drop; support migration.
4. Retire `v1` only after usage is near zero (or the sunset date for unmaintained clients).

```reveal
{
  "prompt": "A startup versions every tiny change (v2, v3, v4… within a month). Why is that as bad as never versioning?",
  "answer": "Each version is a parallel code path you must maintain, test, and support — version sprawl multiplies maintenance and confuses clients about which to use. Prefer additive, non-breaking changes (no new version needed) and reserve a new version for genuinely breaking changes, batched. Versioning is a cost; minimize how often you pay it by designing for backward compatibility first."
}
```

How freely you cut new versions is itself a dial — between fast iteration and stable, low-maintenance contracts:

```tradeoff
{ "title": "How aggressively should you cut new API versions?", "axis": { "left": "Version freely (aggressive)", "right": "Version rarely (conservative)" }, "steps": [
  { "label": "Internal services", "detail": "You control both ends, so you can version aggressively and migrate callers yourself — breaking changes are cheaper to coordinate." },
  { "label": "Batch breaking changes", "detail": "Reserve a new version for genuinely breaking changes and group them, instead of bumping per tiny change — this avoids version sprawl." },
  { "label": "Additive-first design", "detail": "Prefer optional fields and tolerant readers so most evolution needs no new version at all — versioning is a cost you minimize." },
  { "label": "Public/partner APIs", "detail": "You can't force clients to update, so change conservatively: keep old versions alive for long, announced deprecation windows." }
] }
```

## In the wild

- **Most public APIs** use URL versioning (`/v1/`) and keep old versions alive for long, announced
  deprecation windows. **Stripe** uses date-stamped versions pinned per request (e.g.
  `Stripe-Version: 2020-08-27`) and keeps old versions working for years; **GitHub's** REST API pins
  versions via a header too (`X-GitHub-Api-Version: 2022-11-28`).
- **Design for additive change first** — optional fields, tolerant readers — so most evolution needs
  *no* new version.
- **Deprecation is a process, not a flip:** communicate, provide a window, monitor usage, then sunset.
- **Internal services** can version more aggressively (you control both ends) than **public/partner**
  APIs (you don't).

## Common misconception — "just version everything / versioning means I can change anything freely"

A new version is a maintenance burden, not a free pass.

```reveal
{
  "prompt": "Does putting an API behind /v1 mean you can later change v1's behavior however you want?",
  "answer": "No — clients are pinned to v1 precisely so it stays stable. Changing v1's behavior breaks them just as much as an unversioned change would. The point of versioning is that v1 is frozen (only non-breaking additions allowed) and breaking changes go into v2. The version label is a promise of stability for that version, not permission to mutate it."
}
```

Versioning lets you introduce breaking changes *without* breaking existing clients — by leaving the
old version stable. It's not license to change a live version; each version is a commitment to keep.

## Self-test

```quiz
{
  "question": "Which of these is a NON-breaking (no new version needed) change?",
  "options": [
    "Renaming a response field",
    "Adding a new optional field to the response",
    "Removing an endpoint",
    "Making an optional parameter required"
  ],
  "answer": 1,
  "explanation": "Adding an optional field is additive — old clients ignore it. The others break existing clients."
}
```

```quiz
{
  "question": "The healthiest way to retire an old API version is to:",
  "options": [
    "Delete it immediately when v2 ships",
    "Run it alongside the new version, announce a deprecation timeline, monitor usage, then sunset",
    "Never remove any version",
    "Silently start returning errors"
  ],
  "answer": 1,
  "explanation": "Run both, communicate deprecation with a window, watch usage fall, then retire — never break clients abruptly."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "API versioning — key terms", "cards": [
  { "front": "Non-breaking (additive) change", "back": "Adding an optional field, endpoint, or param. Old clients ignore what they don't recognize, so no new version is needed — safe by default." },
  { "front": "Breaking change", "back": "Rename/remove a field, change a type, make inputs required, or change response/status meaning. Old clients break, so it needs a new version." },
  { "front": "API as a contract", "back": "Once a client depends on your API's shape, that shape is a promise. Clients you don't control (old apps, partners) can't be updated on your schedule." },
  { "front": "URL path versioning", "back": "Version in the path (/v1/users, /v2/users). Explicit, easy to route and cache, visible in every request — the most common approach." },
  { "front": "Header versioning", "back": "Version in a header (Accept: application/vnd.api.v2+json). Keeps URLs clean but is less visible and harder to test/debug by hand." },
  { "front": "Deprecation process", "back": "Run the new version alongside the old, announce a sunset timeline (e.g. Deprecation/Sunset header), monitor usage drop, then retire — never break clients abruptly." }
] }
```

## Key takeaways

- A shipped API is a **contract** with clients you can't force to update — plan to evolve it carefully.
- **Additive changes are safe** (no version bump); **breaking changes** (rename/remove/retype/require)
  need a **new version**.
- **URL versioning (`/v1/`)** is the common, explicit default; header versioning keeps URLs clean but
  is trickier.
- Versioning is a **cost** — design for backward compatibility first, and deprecate via an announced,
  monitored process.

## Up next

APIs must also know *who* is calling and *what they're allowed to do*. Next: **Authentication vs
Authorization**.
