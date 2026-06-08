// Validate a chapter Markdown file before commit:
//  - has frontmatter with required fields
//  - every fenced interaction/diagram block parses as JSON
//  - its type is actually implemented (else it would render as raw JSON)
//
// Usage: node scripts/validate-chapter.mjs content/00-foundations/NN-slug.md
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function registryKeys(file) {
  if (!existsSync(file)) return [];
  const src = readFileSync(file, "utf8");
  // Grab the object literal after "= {" up to the closing "};"
  const m = src.match(/=\s*{([\s\S]*?)};/);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)].map((x) => x[1]);
}

const implemented = new Set([
  ...registryKeys(resolve(ROOT, "frontend/src/interactions/index.tsx")),
  ...registryKeys(resolve(ROOT, "frontend/src/diagrams/index.tsx")),
]);

const file = process.argv[2];
if (!file) {
  console.error("usage: validate-chapter.mjs <file.md>");
  process.exit(2);
}
const raw = readFileSync(file, "utf8");
const errors = [];

// Frontmatter
const fm = raw.match(/^---\n([\s\S]*?)\n---/);
if (!fm) errors.push("missing frontmatter");
else {
  for (const key of ["title", "slug", "level", "module", "order", "status"]) {
    if (!new RegExp(`^${key}:`, "m").test(fm[1])) errors.push(`frontmatter missing: ${key}`);
  }
}

// Fenced blocks
const fence = /```([a-zA-Z][\w-]*)\n([\s\S]*?)```/g;
let block;
let interactiveCount = 0;
const KNOWN = new Set([
  "quiz", "reveal", "stepper", "match", "compare", "tradeoff", "calc", "flashcards",
  "diagram", "flow", "sequence", "layers", "ring", "ladder", "pipeline",
]);
while ((block = fence.exec(raw))) {
  const [, lang, body] = block;
  if (!KNOWN.has(lang)) continue; // plain code block (json/bash/etc.) — skip
  interactiveCount++;
  if (!implemented.has(lang)) {
    errors.push(`block "${lang}" is not implemented in the registry (would render raw JSON)`);
    continue;
  }
  try {
    JSON.parse(body.trim());
  } catch (e) {
    errors.push(`block "${lang}" has invalid JSON: ${e.message}`);
  }
}

const status = (fm && /^status:\s*published/m.test(fm[1])) ? "published" : "draft";
if (status === "published" && interactiveCount === 0) {
  errors.push("published chapter has no interactive element (need ≥1)");
}

if (errors.length) {
  console.error(`✗ ${file}`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ ${file} (${interactiveCount} interactive block(s), ${status})`);
