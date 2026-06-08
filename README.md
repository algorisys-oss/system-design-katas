# System Design — Interactive Course

A breadth-first, highly interactive system design course. Content is plain Markdown
(`content/`), served by a Go/Fiber backend and rendered by a React frontend. No database yet —
reader progress lives in the browser.

See plan.md for the curriculum strategy and CLAUDE.md for working
conventions.

## Curriculum

**142 chapters across three levels** — all authored, accuracy-reviewed, and published:

| Level | Chapters | Modules |
|-------|----------|---------|
| `content/00-foundations/`  | 52 | computing/networking/storage fundamentals, APIs, databases, caching, foundations of system design |
| `content/01-intermediate/` | 40 | architecture & services, replication & partitioning, caching patterns, messaging & streaming, observability, reliability & testing, capstones |
| `content/02-advanced/`     | 50 | correctness & consensus, replication & anti-entropy, distributed transactions, storage internals, global scale, resilience, operability & patterns, capstones |
| `use-cases/`               | 23 | end-to-end **"Design X"** walkthroughs: rate limiter, Uber, YouTube, Dropbox, web crawler, e-commerce flash-sale, Google Docs, ad aggregator, ticketing, **+ AI-era** (LLM serving, RAG/vector DB, recommendation, feature store) |

Each level ends with end-to-end **capstones** (URL shortener; news feed, chat; distributed KV
store, payment system), and the **Use Cases** section adds 23 standalone interview-style "Design X"
walkthroughs that compose the concepts (see [use-cases/catalog.md](use-cases/catalog.md)). Every
chapter ships ≥1 interactive element built from the catalog below.

## Layout

```
content/{00-foundations,01-intermediate,02-advanced}/   # lowercase-hyphenated, NN-ordered Markdown
use-cases/                # 23 "Design X" walkthroughs (loaded as a 4th "Use Cases" section) + catalog.md
meta/                     # style-guide.md (incl. interactive directive spec), concept-map, glossary
assets/diagrams/          # diagram sources/exports
backend/                  # Go + Fiber content API (no DB)
frontend/                 # React + React Router 7 + Zustand + zen-ui
scripts/                  # validate-chapter.mjs, check-prereqs.mjs
```

## Run it

**Backend** (serves the content API from `../content`):

```bash
cd backend
go mod tidy        # fetches Fiber + yaml (first run, needs network)
go run .           # listens on :8080; auto-reloads content on change
```

The backend watches `content/` and hot-reloads on any `.md` change (no restart needed). Disable
with `SD_WATCH=0`; tune the poll interval with `SD_WATCH_MS` (default 1000). Levels are ordered
Foundations → Intermediate → Advanced (a `levelRank`, not alphabetical).

**Frontend** (Vite dev server, proxies `/api` → :8080):

```bash
cd frontend
bun install        # or npm install
bun run dev        # http://localhost:5173
```

> The frontend consumes the in-house **zen-ui** library
> ([github.com/Algorisys-Technologies/zen-ui](https://github.com/Algorisys-Technologies/zen-ui),
> branch `main`) by aliasing it (Vite + tsconfig) straight to its built `dist/` in the local
> clone — no install/link. Build zen-ui's lib
> first if its `dist/` is stale: in the zen-ui repo run `bun run build:lib`. To fix a component,
> edit it in the zen-ui source and rebuild — the fix flows here. See plan.md §11.4.
>
> Note: if port 5173 is taken, set a free one — `bun run dev --port 5180 --strictPort`.

## Interactivity

Authors compose interactives/diagrams inline as fenced JSON blocks (no per-chapter code). Built-in
catalog:

- **Interactions** (`frontend/src/interactions/`): `quiz`, `reveal`, `stepper`, `match`, `compare`, `calc`
- **Diagrams** (`frontend/src/diagrams/`, all custom themed SVG — no Mermaid/external libs):
  `layers`, `ladder`, `flow`, `sequence`, `ring`

## Authoring

Add a chapter as a Markdown file under the appropriate `content/<level>/` folder with the
frontmatter and recipe in [meta/style-guide.md](meta/style-guide.md). Add interactivity inline with
fenced blocks. The fully-authored reference chapter is
[content/00-foundations/00-how-computers-work.md](content/00-foundations/00-how-computers-work.md).

Validate before publishing:

```bash
node scripts/validate-chapter.mjs content/02-advanced/00-logical-clocks-and-vector-clocks.md
node scripts/check-prereqs.mjs       # repo-wide: every prerequisite slug resolves
```

## Deploy to GitHub Pages (static)

GitHub Pages is static-only, so there's no Go backend there: the content API is **pre-rendered to
JSON** and the SPA fetches that. One script does everything (build with the Pages subpath + static
mode, generate the JSON, add the SPA `404.html` fallback + `.nojekyll`, and force-push to `gh-pages`):

```bash
scripts/publish-gh-pages.sh           # build + publish to this repo's gh-pages branch
scripts/publish-gh-pages.sh --build   # build only (then preview locally)

scripts/gh-deploy.sh                  # build + deploy to the OSS repo's Pages
scripts/gh-deploy.sh --build          # build only
```

`gh-deploy.sh` targets the public OSS repo
(**https://algorisys-oss.github.io/system-design-katas/**) — same pipeline, different remote
(`PAGES_REMOTE`). The `gh-pages` branch holds only the built site (SPA + pre-rendered JSON), so the
deployed site is inherently LLM-free regardless of which remote you push to.

Then in GitHub: **Settings → Pages → Source = branch `gh-pages`, folder `/` (root)**. Site lands at
`https://<user-or-org>.github.io/system-design-katas/`.

- Runs **locally** (not CI) because the frontend aliases the in-house zen-ui clone's `dist/`, which
  isn't on npm — build the zen-ui lib first (`bun run build:lib` in the clone). Override its path with
  `ZEN_UI_DIST`.
- Config via env: `PAGES_BASE` (default `/system-design-katas/`), `PAGES_BRANCH` (default `gh-pages`).
- The static JSON generator ([scripts/gen-static-api.mjs](scripts/gen-static-api.mjs)) mirrors the Go
  API's shape/ordering, so the same frontend works against the live API (dev / real server, `base=/`)
  or static files (`VITE_STATIC=1`). Moving to a real server later just means dropping the static mode.

## Status

Content-complete: all **142 chapters** (Foundations 52 + Intermediate 40 + Advanced 50) plus **23
"Design X" use-case walkthroughs** — all authored, validated, and accuracy-reviewed. The full
interaction catalog (incl. `tradeoff`, `flashcards`) is built and used throughout. Frontend
(collapsible level/module sidebar showing Foundations → Intermediate → Advanced → Use Cases,
progress, search) and Go/Fiber content API (serving `content/` + `use-cases/`) are working. No
database — reader progress is client-side (Zustand + localStorage). Pending/optional: deployment.
