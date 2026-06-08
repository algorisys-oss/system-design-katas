# Use Cases

End-to-end **"Design X"** system-design walkthroughs — the bootcamp-famous designs (rate limiter,
Uber, YouTube, ChatGPT backend, …) that compose the concept chapters (`content/`) into real systems.

- **Catalog & roadmap:** [catalog.md](catalog.md) (the full list + concept ↔ use-case matrix).
- Each walkthrough is a single `NN-<slug>.md` here, using the chapter frontmatter with
  `level: use-cases` and a theme `module:`. The app surfaces them as the **Use Cases** section
  (after Advanced); the backend (`backend/main.go`) and static-API generator
  (`scripts/gen-static-api.mjs`) load this folder alongside `content/`.
- Format follows the capstone recipe (see `content/02-advanced/49-capstone-payment-system.md`):
  requirements → estimation → API → architecture → deep dives → trade-offs → scaling → self-test →
  recap → concepts exercised. Authoring conventions: see ../plan.md §4 and
  [../meta/style-guide.md](../meta/style-guide.md).
- Validate a file: `node scripts/validate-chapter.mjs use-cases/NN-<slug>.md`; check cross-links:
  `node scripts/check-prereqs.mjs`.
