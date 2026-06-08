#!/usr/bin/env node
// Generate the static content API as plain JSON files, mirroring the Go/Fiber
// backend's responses, so the app can run on a static host (e.g. GitHub Pages)
// with no server. Produces:
//   <outDir>/curriculum.json            (LevelNode[])
//   <outDir>/chapters/<slug>.json       (Chapter = meta + body)
//
// Usage: node scripts/gen-static-api.mjs [outDir]
//   outDir defaults to frontend/dist/api
//
// The JSON shape MUST match frontend/src/api/types.ts (camelCase keys), and the
// ordering MUST match backend/main.go (levelRank, then chapter order; modules in
// first-seen order within a level).

import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONTENT = resolve(ROOT, "content");
const OUT = resolve(process.argv[2] ?? resolve(ROOT, "frontend/dist/api"));

const LEVEL_DIRS = ["00-foundations", "01-intermediate", "02-advanced"];
const USE_CASES_DIR = resolve(ROOT, "use-cases"); // sibling of content/
function levelRank(level) {
  return { foundations: 0, intermediate: 1, advanced: 2, "use-cases": 3 }[level] ?? 99;
}

// --- minimal frontmatter parser (matches our simple, hand-authored YAML) -----
function parseFrontmatter(raw, file) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const body = raw.slice(m[0].length);
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!mm) continue;
    const [, key, rawVal] = mm;
    let val = rawVal.trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, "");
    }
    fm[key] = val;
  }
  return { fm, body };
}

function toMeta(fm) {
  // mirror Go json tags (camelCase); arrays default to [] not null
  return {
    title: fm.title ?? "",
    slug: fm.slug ?? "",
    level: fm.level ?? "",
    module: fm.module ?? "",
    order: Number(fm.order ?? 0),
    readingTimeMin: Number(fm.reading_time_min ?? 0),
    concepts: Array.isArray(fm.concepts) ? fm.concepts : [],
    useCases: Array.isArray(fm.use_cases) ? fm.use_cases : [],
    prerequisites: Array.isArray(fm.prerequisites) ? fm.prerequisites : [],
    status: fm.status ?? "",
  };
}

// --- load all chapters -------------------------------------------------------
const chapters = [];
for (const dir of LEVEL_DIRS) {
  let files;
  try {
    files = readdirSync(join(CONTENT, dir));
  } catch {
    continue;
  }
  for (const f of files) {
    if (!f.endsWith(".md") || f.toLowerCase() === "readme.md") continue;
    const path = join(CONTENT, dir, f);
    const raw = readFileSync(path, "utf8");
    const { fm, body } = parseFrontmatter(raw, path);
    const meta = toMeta(fm);
    if (!meta.slug) throw new Error(`${path}: missing slug`);
    chapters.push({ ...meta, body });
  }
}
// use-cases/ (sibling of content/) — same frontmatter, level "use-cases"
try {
  for (const f of readdirSync(USE_CASES_DIR)) {
    const lc = f.toLowerCase();
    if (!f.endsWith(".md") || lc === "readme.md" || lc === "catalog.md") continue;
    const path = join(USE_CASES_DIR, f);
    const { fm, body } = parseFrontmatter(readFileSync(path, "utf8"), path);
    const meta = toMeta(fm);
    if (!meta.slug) throw new Error(`${path}: missing slug`);
    chapters.push({ ...meta, body });
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e; // ok if use-cases/ not present yet
}

// sort: levelRank, then order (matches backend/main.go)
chapters.sort((a, b) => {
  const r = levelRank(a.level) - levelRank(b.level);
  return r !== 0 ? r : a.order - b.order;
});

// --- build curriculum (first-seen level/module order, like the Go store) -----
const levelOrder = [];
const levels = new Map(); // level -> Map(module -> {module, chapters:[]})
for (const ch of chapters) {
  if (!levels.has(ch.level)) {
    levels.set(ch.level, new Map());
    levelOrder.push(ch.level);
  }
  const mods = levels.get(ch.level);
  if (!mods.has(ch.module)) mods.set(ch.module, { module: ch.module, chapters: [] });
  // chapters in the curriculum carry meta only (no body)
  const { body, ...meta } = ch;
  mods.get(ch.module).chapters.push(meta);
}
const curriculum = levelOrder.map((level) => ({
  level,
  modules: [...levels.get(level).values()],
}));

// --- write -------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "chapters"), { recursive: true });
writeFileSync(join(OUT, "curriculum.json"), JSON.stringify(curriculum));
for (const ch of chapters) {
  writeFileSync(join(OUT, "chapters", `${ch.slug}.json`), JSON.stringify(ch));
}

console.log(
  `✓ static API → ${OUT.replace(ROOT + "/", "")}  (${chapters.length} chapters, ${curriculum.length} levels)`,
);
