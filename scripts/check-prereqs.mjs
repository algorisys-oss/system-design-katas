#!/usr/bin/env node
// Repo-wide prerequisite-slug checker.
// Collects every chapter's `slug` and every `prerequisites: [...]` entry across
// all content levels, and reports any prerequisite that doesn't match a real slug.
// Usage: node scripts/check-prereqs.mjs   (exit 1 if any broken reference)

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "content/00-foundations",
  "content/01-intermediate",
  "content/02-advanced",
  "use-cases",
];

function field(text, name) {
  const m = text.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : "";
}

const files = [];
for (const root of ROOTS) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    continue;
  }
  for (const f of entries) {
    if (f.endsWith(".md")) files.push(join(root, f));
  }
}

const slugs = new Set();
const records = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const slug = field(text, "slug");
  const pre = (text.match(/^prerequisites:\s*\[(.*)\]/m) || [])[1] || "";
  const prereqs = pre
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (slug) slugs.add(slug);
  records.push({ file, slug, prereqs });
}

let broken = 0;
for (const r of records) {
  const bad = r.prereqs.filter((p) => !slugs.has(p));
  if (bad.length) {
    broken++;
    console.error(`✗ ${r.file}  →  unknown prerequisite slug(s): ${bad.join(", ")}`);
  }
}

if (broken) {
  console.error(`\n${broken} file(s) reference prerequisite slugs that don't exist.`);
  process.exit(1);
}
console.log(`✓ all prerequisite slugs resolve (${records.length} chapters, ${slugs.size} slugs)`);
