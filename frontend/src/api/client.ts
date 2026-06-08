import type { Chapter, LevelNode } from "./types";

// In dev / behind the Go server, BASE_URL is "/" so we hit the live API at
// "/api/..." (proxied to :8080). For a static build (VITE_STATIC=1, e.g. GitHub
// Pages under "/system-design-katas/"), BASE_URL is the subpath and we fetch
// pre-generated JSON files (".json") produced by scripts/gen-static-api.mjs.
const STATIC = import.meta.env.VITE_STATIC === "1";
const BASE = `${import.meta.env.BASE_URL}api`;
const ext = STATIC ? ".json" : "";

export async function fetchCurriculum(): Promise<LevelNode[]> {
  const res = await fetch(`${BASE}/curriculum${ext}`);
  if (!res.ok) throw new Error(`curriculum: ${res.status}`);
  return res.json();
}

export async function fetchChapter(slug: string): Promise<Chapter> {
  const res = await fetch(`${BASE}/chapters/${slug}${ext}`);
  if (!res.ok) throw new Error(`chapter ${slug}: ${res.status}`);
  return res.json();
}
