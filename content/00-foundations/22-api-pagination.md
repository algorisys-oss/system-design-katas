---
title: "API Pagination"
slug: api-pagination
level: foundations
module: apis-and-the-web
order: 22
reading_time_min: 13
concepts: [pagination, offset, cursor, keyset, performance, consistency]
use_cases: []
prerequisites: [api-path-and-query-params, rest-api-fundamentals]
status: published
---

# API Pagination

## Hook — a motivating scenario

`GET /events` worked great in testing with 50 rows. In production the table has 40 million rows, and
that endpoint now tries to load all of them into memory, serialize a 2 GB JSON response, and times
out — taking the database down with it. The fix isn't a bigger server; it's never returning an
unbounded list. That's **pagination**: returning results in bounded chunks.

## Mental model — reading a book page by page

You don't read a 900-page book by holding all pages open at once; you read a page, then turn to the
next. Pagination does the same for data: return a **page** of N items plus a way to ask for the
**next** page. The two common ways to say "where am I" are **offset** ("skip the first 200") and
**cursor** ("continue after this item").

## Build it up — offset vs cursor pagination

```compare
{
  "options": [
    { "label": "Offset / page", "points": ["?limit=20&offset=200 (or page=11)", "Simple; can jump to any page", "Slow on deep pages (DB skips offset rows)", "Items shift if data changes (dupes/skips)"] },
    { "label": "Cursor / keyset", "points": ["?limit=20&after=<cursor>", "Fast at any depth (uses an index)", "Stable under inserts/deletes", "No arbitrary page jumps; sequential"] }
  ]
}
```

**Offset** is intuitive (`page=2`) but has two flaws at scale:
1. **Deep pages are slow** — `OFFSET 1000000` makes the database walk and discard a million rows.
2. **Shifting results** — if items are inserted/deleted between requests, offsets slide, so you can
   see duplicates or miss items across pages.

**Cursor (keyset)** pagination fixes both: instead of "skip N," it says "give me items *after this
value*" (e.g. `WHERE id > last_seen_id ORDER BY id LIMIT 20`), which uses an index directly — fast at
any depth — and is stable because it anchors to a real item, not a position.

One catch: keyset pagination needs a **unique, totally-ordered** sort key. If you paginate by a
non-unique column (e.g. `created_at` with duplicate timestamps), `WHERE created_at > last` can
silently skip or duplicate rows at the tie boundary. The fix is a composite tiebreaker — add a unique
column like `id` as a secondary key and compare the tuple:
`ORDER BY created_at, id` with `WHERE (created_at, id) > (last_ts, last_id)`.

```reveal
{
  "prompt": "A feed adds new posts constantly. Why does cursor pagination avoid the 'I keep seeing the same post twice while scrolling' bug that offset pagination causes?",
  "answer": "With offset, 'page 2 = skip 20' shifts when new posts are inserted at the top: an item that was #20 becomes #21, so it appears again on the next page. Cursor pagination says 'give me posts after post X' — it anchors to a specific item, so new inserts don't shift your position. You continue exactly where you left off regardless of changes."
}
```

## In the wild

- **Infinite-scroll feeds** (Twitter/X, Slack, GitHub) use **cursor** pagination — stable and fast on
  huge, changing datasets.
- **Admin tables / "page 1..N" UIs** often use **offset** for the convenience of jumping to a page,
  accepting the deep-page cost on smaller datasets.
- **Always cap `limit`** server-side (e.g. max 100) so a client can't request a million rows.
- **Return pagination metadata**: a `next` cursor/link (and sometimes total count, though counts are
  expensive on huge tables — often omitted or approximate).

## Common misconception — "just add LIMIT/OFFSET and pagination is solved"

Offset works until the data is big or changing — exactly when it matters.

```reveal
{
  "prompt": "Offset pagination feels fine in tests. Why does OFFSET 500000 LIMIT 20 crawl in production even with an index?",
  "answer": "OFFSET still requires the database to locate and skip all the preceding rows before returning your 20 — it can't jump directly to row 500,000. So cost grows with the offset (O(offset)), making deep pages progressively slower. Keyset/cursor pagination uses a WHERE on an indexed column (WHERE id > last LIMIT 20), which the index can seek to directly — constant-ish cost at any depth. Same need, very different scaling."
}
```

Offset is fine for small or shallow cases, but for large/changing datasets cursor pagination is the
scalable, correct default. Either way, the non-negotiable rule is: **never return an unbounded list.**

## Self-test

```quiz
{
  "question": "For an infinite-scroll feed over millions of constantly-changing items, the best pagination is:",
  "options": [
    "Offset/page — easy to jump pages",
    "Cursor/keyset — fast at any depth and stable under inserts",
    "No pagination; return everything",
    "Random sampling"
  ],
  "answer": 1,
  "explanation": "Cursor pagination is index-driven (fast at any depth) and anchored to an item (stable as data changes)."
}
```

```quiz
{
  "question": "Why is deep offset pagination (large OFFSET) slow?",
  "options": [
    "It encrypts each row",
    "The database must scan and discard all the skipped rows before returning the page",
    "It opens a new connection per page",
    "Offsets aren't allowed in SQL"
  ],
  "answer": 1,
  "explanation": "OFFSET N makes the DB walk past N rows each time, so cost grows with depth — unlike index-seek keyset pagination."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "API pagination — key terms", "cards": [ { "front": "Pagination", "back": "Returning results in bounded chunks (pages) instead of one unbounded list, so an endpoint never tries to load and serialize an entire huge table at once." }, { "front": "Offset pagination", "back": "Says 'skip the first N rows' (e.g. limit=20&offset=200 or page=11). Simple and lets you jump to any page, but slow on deep pages and unstable when data changes." }, { "front": "Cursor / keyset pagination", "back": "Says 'give me items after this value' (WHERE id > last_seen_id ORDER BY id LIMIT 20). Index-driven, fast at any depth, and stable under inserts/deletes." }, { "front": "Why deep offset is slow", "back": "OFFSET N makes the database locate and discard all N preceding rows before returning the page, so cost grows with depth (O(offset)) — even with an index." }, { "front": "Shifting results", "back": "With offset, inserts/deletes between requests slide positions, so you can see duplicate items or skip items across pages. Cursor avoids this by anchoring to a real item." }, { "front": "Pagination metadata", "back": "What the response returns to continue: a next cursor/link, and sometimes a total count — though counts are expensive on huge tables and are often omitted or approximate." } ] }
```

## Key takeaways

- **Never return unbounded lists** — paginate into bounded pages and cap `limit` server-side.
- **Offset/page**: simple and jumpable, but slow on deep pages and unstable under inserts/deletes.
- **Cursor/keyset**: index-driven (fast at any depth) and stable under change — the default for large
  or live datasets.
- Return a **next cursor/link** in the response; be wary of expensive total-count queries on huge
  tables.

## Up next

APIs change over time without breaking existing clients. Next: **API Versioning**.
