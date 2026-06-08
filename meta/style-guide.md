# Style Guide — Authoring System Design Chapters

Authoritative rules for writing chapters. See ../plan.md §3, §12 and
../CLAUDE.md for the bigger picture.

## Naming

All files and folders are `lowercase-hyphenated` (kebab-case). Exceptions: `CLAUDE.md`,
`README.md`, and tool-mandated names (`go.mod`, `package.json`).

## Chapter file

- One Markdown file per chapter under `content/<NN-level>/<NN-slug>.md`.
- Two-digit numeric prefix = order. The rest of the filename = slug.
- Frontmatter is required (see below).

```yaml
---
title: "Chapter Title"
slug: chapter-slug
level: foundations | intermediate | advanced
module: module-slug
order: 0
reading_time_min: 12
concepts: [tag, tag]
use_cases: [use-case-slug]
prerequisites: [chapter-slug]
status: draft | review | published
---
```

## Chapter recipe (section order)

1. **Hook** — concrete motivating scenario.
2. **Mental model** — one strong analogy.
3. **Build it up** — smallest correct version, then real complications.
4. **In the wild** — named systems + concrete numbers.
5. **Common misconception** — name and dismantle it.
6. **Self-test** — interactive (see directives).
7. **Key takeaways** — 3–5 bullets.
8. **Up next** — one-line bridge.

Voice: lead with *why* then *how*; one core idea per chapter; concrete numbers over hand-waving;
define jargon on first use.

## Interactive directives (the differentiator)

Interactivity is authored **inside the Markdown** as fenced code blocks whose language tag names
an interaction. The frontend renderer parses the JSON body and renders the matching zen-ui-backed
component. Authors never write React — they compose interactions from content.

> Keep interactions teaching, not decoration: the reader changes an input and sees the consequence.

### `quiz` — multiple choice with instant feedback
```` ```quiz ````
```json
{
  "question": "Which component holds an app while it is running?",
  "options": ["CPU", "RAM", "Disk", "GPU"],
  "answer": 1,
  "explanation": "RAM is the volatile working memory where running programs live."
}
```

### `reveal` — progressive reveal (think-then-check)
```` ```reveal ````
```json
{
  "prompt": "If adding one server evicts 75% of cache entries, what happens to the DB?",
  "answer": "A thundering herd of misses hits the DB at once — it can topple over."
}
```

### `stepper` — step-through walkthrough
```` ```stepper ````
```json
{
  "title": "Anatomy of opening a video",
  "steps": [
    { "title": "Click play", "body": "The mouse event reaches the CPU." },
    { "title": "Check RAM", "body": "CPU verifies the app is loaded in memory." }
  ]
}
```

### `tradeoff` — slide along a trade-off axis, see the consequence
```` ```tradeoff ````
```json
{
  "title": "Where do you sit on the consistency ↔ availability axis?",
  "axis": { "left": "Consistency", "right": "Availability" },
  "steps": [
    { "label": "Linearizable (CP)", "detail": "Every read sees the latest write; under partition, the minority side rejects requests. Costliest, simplest to reason about." },
    { "label": "Bounded staleness", "detail": "Reads lag by at most X — a tunable middle ground." },
    { "label": "Causal + session", "detail": "Cause→effect preserved per user; stays available. The pragmatic sweet spot." },
    { "label": "Eventual (AP)", "detail": "Always writable; replicas converge later. Fastest/most available, weakest guarantees." }
  ]
}
```
Poles (`axis`) are optional; `steps` are ordered positions, each shown with its `detail` when selected.

### `compare` — side-by-side option tabs
```` ```compare ````
```json
{
  "options": [
    { "label": "TCP", "points": ["Reliable, ordered", "Connection setup cost"] },
    { "label": "UDP", "points": ["Fast, connectionless", "May drop/reorder"] }
  ]
}
```

### `match` — drag-to-match exercise
```` ```match ````
```json
{
  "prompt": "Match each component to its role.",
  "pairs": [
    { "left": "CPU", "right": "Makes decisions" },
    { "left": "RAM", "right": "Working memory" }
  ]
}
```

### `calc` — back-of-the-envelope calculator
```` ```calc ````
```json
{
  "title": "Estimate daily writes",
  "inputs": [
    { "key": "dau", "label": "Daily active users", "default": 1000000 },
    { "key": "perUser", "label": "Writes per user/day", "default": 5 }
  ],
  "formula": "dau * perUser",
  "resultLabel": "Writes per day"
}
```

### `flashcards` — flip-and-navigate recall deck
```` ```flashcards ````
```json
{
  "title": "Caching — key terms",
  "cards": [
    { "front": "Cache hit ratio", "back": "Fraction of reads served from cache; the lever that decides if a cache helps." },
    { "front": "TTL", "back": "Time-to-live: how long a cached entry stays valid before expiry." },
    { "front": "Cache stampede", "back": "Many concurrent misses recompute the same key at once when it expires." }
  ]
}
```
Click a card (or it's keyboard-activatable) to flip front↔back; Prev/Next move through the deck.

> Implemented: `quiz`, `reveal`, `stepper`, `match`, `compare`, `calc`, `tradeoff`, `flashcards`
> (`frontend/src/interactions/`). The validator (`scripts/validate-chapter.mjs`) auto-detects the
> registry, so a registered block validates; an unregistered one is flagged.

## Diagrams

**All diagrams are custom themed SVG/React components — no Mermaid, no external diagram libs.**
Authored with the same fenced-directive pattern, mapped to components in `frontend/src/diagrams/`:

```` ```diagram ````  (or a typed variant: `flow`, `sequence`, `layers`, `ring`, `ladder`)
```json
{
  "type": "flow",
  "nodes": ["Client", "DNS", "Load Balancer", "Server", "DB"],
  "note": "The request path, hop by hop."
}
```

Rules: SVG uses `currentColor` + `var(--zen-*)` (never hard-coded colors) so it themes for free;
make it interactive (hover/step/toggle) where that teaches, static otherwise; include
`<title>`/`<desc>` and keyboard support for interactive diagrams. Build the catalog incrementally
as chapters need shapes. See plan.md §12.4.
