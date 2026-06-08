import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { Button, Badge } from "@algorisys/zen-ui-react";
import { fetchChapter } from "../api/client";
import type { Chapter as ChapterType } from "../api/types";
import { Markdown } from "../components/markdown";
import { useAppStore } from "../store/use-app-store";

export function Chapter() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [chapter, setChapter] = useState<ChapterType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const isComplete = useAppStore((s) => !!s.completed[slug]);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const markComplete = useAppStore((s) => s.markComplete);
  const flat = useAppStore((s) => s.flatChapters);

  const idx = flat.findIndex((c) => c.slug === slug);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;

  // Load chapter on slug change.
  useEffect(() => {
    setChapter(null);
    setError(null);
    setProgress(0);
    fetchChapter(slug)
      .then(setChapter)
      .catch((e) => setError(String(e)));
    window.scrollTo(0, 0);
  }, [slug]);

  // Track scroll progress; auto-mark complete when the reader reaches the end.
  useEffect(() => {
    function onScroll() {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const pct = max > 0 ? Math.min(100, Math.round((h.scrollTop / max) * 100)) : 100;
      setProgress(pct);
      if (pct >= 96 && slug) markComplete(slug);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [slug, markComplete]);

  // Keyboard: ←/→ navigate between chapters (ignored while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" && prev) navigate(`/learn/${prev.slug}`);
      if (e.key === "ArrowRight" && next) navigate(`/learn/${next.slug}`);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, navigate]);

  if (error) return <div className="content">Couldn’t load chapter: {error}</div>;
  if (!chapter) return <div className="content">Loading…</div>;

  return (
    <>
      <div className="read-progress" style={{ width: `${progress}%` }} aria-hidden="true" />
      <div className="content">
        <div className="topbar">
          <Badge variant="soft" color="primary">
            {chapter.readingTimeMin} min · {chapter.status}
          </Badge>
          <Badge variant="outline" color="info">
            {chapter.module}
          </Badge>
        </div>

        <Markdown>{chapter.body}</Markdown>

        <div style={{ marginTop: "2rem" }}>
          <Button
            color={isComplete ? "success" : "primary"}
            variant={isComplete ? "soft" : "solid"}
            onClick={() => toggleComplete(slug)}
          >
            {isComplete ? "✓ Completed" : "Mark complete"}
          </Button>
        </div>

        <nav className="chapter-nav">
          {prev ? (
            <Link to={`/learn/${prev.slug}`} className="chapter-nav-link prev">
              <span className="dir">← Previous</span>
              <span className="title">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={`/learn/${next.slug}`} className="chapter-nav-link next">
              <span className="dir">Next →</span>
              <span className="title">{next.title}</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </>
  );
}
