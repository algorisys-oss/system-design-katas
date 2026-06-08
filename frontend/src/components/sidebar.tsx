import { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router";
import type { LevelNode } from "../api/types";
import { useAppStore } from "../store/use-app-store";

const LEVEL_LABELS: Record<string, string> = {
  foundations: "Foundations",
  intermediate: "Intermediate",
  advanced: "Advanced",
  "use-cases": "Use Cases",
};

const MODULE_LABELS: Record<string, string> = {
  // Foundations
  "computing-fundamentals": "Computing Fundamentals",
  "networking-fundamentals": "Networking Fundamentals",
  "storage-fundamentals": "Storage Fundamentals",
  "apis-and-the-web": "APIs & the Web",
  "database-fundamentals": "Database Fundamentals",
  "caching-fundamentals": "Caching Fundamentals",
  "foundations-of-system-design": "Foundations of System Design",
  // Intermediate
  "architecture-and-services": "Architecture & Services",
  "replication-and-partitioning": "Replication & Partitioning",
  "caching-patterns": "Caching Patterns",
  "messaging-and-streaming": "Messaging & Streaming",
  observability: "Observability",
  "reliability-and-testing": "Reliability & Testing",
  "intermediate-capstones": "Capstones",
  // Advanced
  "correctness-and-consensus": "Distributed Correctness & Consensus",
  "replication-and-anti-entropy": "Replication & Anti-Entropy",
  "distributed-transactions": "Distributed Transactions & Eventing",
  "storage-internals": "Storage Internals & Data Architecture",
  "global-scale": "Global Scale & Topology",
  resilience: "Resilience & Failure at Scale",
  "operability-and-patterns": "Operability & Architecture Patterns",
  "advanced-capstones": "Capstones",
  // Use Cases
  "core-building-blocks": "Core Building Blocks",
  "large-scale-systems": "Large-Scale Systems",
  "real-time-and-data-intensive": "Real-Time & Data-Intensive",
  "correctness-and-booking": "Correctness & Booking",
  "ai-systems": "Modern AI Systems",
};

export function Sidebar({ curriculum }: { curriculum: LevelNode[] }) {
  const completed = useAppStore((s) => s.completed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const location = useLocation();
  const activeSlug = location.pathname.startsWith("/learn/")
    ? location.pathname.slice("/learn/".length)
    : "";
  const [query, setQuery] = useState("");

  const allModules = useMemo(
    () => curriculum.flatMap((lvl) => lvl.modules),
    [curriculum],
  );
  const activeModule = useMemo(
    () => allModules.find((m) => m.chapters.some((c) => c.slug === activeSlug))?.module,
    [allModules, activeSlug],
  );
  const activeLevel = useMemo(
    () =>
      curriculum.find((lvl) =>
        lvl.modules.some((m) => m.chapters.some((c) => c.slug === activeSlug)),
      )?.level,
    [curriculum, activeSlug],
  );
  const firstLevel = curriculum[0]?.level;

  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [openedLevels, setOpenedLevels] = useState<Record<string, boolean>>({});
  const searching = query.trim().length > 0;
  const q = query.trim().toLowerCase();

  function isOpen(mod: string) {
    if (searching) return true;
    if (mod in opened) return opened[mod];
    return mod === activeModule;
  }
  // A level is open if searching, the user toggled it, the active chapter is in
  // it, or (on the home page with no active level) it's the first level.
  function isLevelOpen(level: string) {
    if (searching) return true;
    if (level in openedLevels) return openedLevels[level];
    return activeLevel ? level === activeLevel : level === firstLevel;
  }
  function onNavigate() {
    if (window.matchMedia("(max-width: 900px)").matches) toggleSidebar();
  }

  return (
    <nav className="sidebar">
      <h2>
        <NavLink to="/" onClick={onNavigate}>System Design</NavLink>
      </h2>

      <input
        className="sidebar-search"
        type="search"
        placeholder="Search chapters…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search chapters"
      />

      {curriculum.map((level) => {
        // Hide a level entirely if a search matches none of its chapters.
        const levelHasMatch =
          !q ||
          level.modules.some((m) =>
            m.chapters.some((c) => c.title.toLowerCase().includes(q)),
          );
        if (!levelHasMatch) return null;
        const levelOpen = isLevelOpen(level.level);
        const levelChapters = level.modules.flatMap((m) => m.chapters);
        const levelDone = levelChapters.filter((c) => completed[c.slug]).length;
        return (
          <div key={level.level} className="sidebar-level">
            <button
              className={`level-title${level.level === activeLevel ? " active" : ""}`}
              onClick={() =>
                setOpenedLevels((o) => ({ ...o, [level.level]: !levelOpen }))
              }
              aria-expanded={levelOpen}
            >
              <span className="caret">{levelOpen ? "▾" : "▸"}</span>
              <span className="label">{LEVEL_LABELS[level.level] ?? level.level}</span>
              <span className="count">{levelDone}/{levelChapters.length}</span>
            </button>
            {levelOpen && level.modules.map((mod) => {
              const chapters = q
                ? mod.chapters.filter((c) => c.title.toLowerCase().includes(q))
                : mod.chapters;
              if (q && chapters.length === 0) return null;
              const open = isOpen(mod.module);
              const doneCount = mod.chapters.filter((c) => completed[c.slug]).length;
              return (
                <div key={mod.module} className="sidebar-module">
                  <button
                    className={`module-title${mod.module === activeModule ? " active" : ""}`}
                    onClick={() => setOpened((o) => ({ ...o, [mod.module]: !open }))}
                    aria-expanded={open}
                  >
                    <span className="caret">{open ? "▾" : "▸"}</span>
                    <span className="label">{MODULE_LABELS[mod.module] ?? mod.module}</span>
                    <span className="count">{doneCount}/{mod.chapters.length}</span>
                  </button>
                  {open &&
                    chapters.map((ch) => (
                      <NavLink
                        key={ch.slug}
                        to={`/learn/${ch.slug}`}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `chapter-link${isActive ? " active" : ""}`
                        }
                      >
                        <span className="done">{completed[ch.slug] ? "✓" : "•"}</span>
                        <span>{ch.title}</span>
                      </NavLink>
                    ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
