import { useEffect, useMemo } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { Sidebar } from "./components/sidebar";
import { useCurriculum } from "./components/use-curriculum";
import { useAppStore, type FlatChapter } from "./store/use-app-store";
import { Home } from "./pages/home";
import { Chapter } from "./pages/chapter";

export function App() {
  const { curriculum, error, loading } = useCurriculum();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setFlatChapters = useAppStore((s) => s.setFlatChapters);

  // Flatten curriculum → ordered chapter list for prev/next + progress.
  const flat = useMemo<FlatChapter[]>(
    () =>
      curriculum.flatMap((lvl) =>
        lvl.modules.flatMap((mod) =>
          mod.chapters.map((ch) => ({
            slug: ch.slug,
            title: ch.title,
            module: ch.module,
          })),
        ),
      ),
    [curriculum],
  );
  useEffect(() => setFlatChapters(flat), [flat, setFlatChapters]);

  if (loading) return <div className="content">Loading curriculum…</div>;
  if (error)
    return (
      <div className="content">
        Couldn’t reach the content API: {error}
        <br />
        Is the backend running on :8080?
      </div>
    );

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <div className={`shell${sidebarOpen ? "" : " closed"}`}>
        <Sidebar curriculum={curriculum} />
        <main className="main-col">
          <div className="appbar">
            <button
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              title="Toggle sidebar"
            >
              {sidebarOpen ? "⟨" : "☰"}
            </button>
            <span className="appbar-brand">system-design</span>
            <ProgressPill />
          </div>
          <Routes>
            <Route path="/" element={<Home curriculum={curriculum} />} />
            <Route path="/learn/:slug" element={<Chapter />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

// Small overall-progress indicator in the app bar.
function ProgressPill() {
  const total = useAppStore((s) => s.flatChapters.length);
  const done = useAppStore(
    (s) => s.flatChapters.filter((c) => s.completed[c.slug]).length,
  );
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <span className="appbar-progress" title={`${done} of ${total} chapters complete`}>
      <span className="appbar-progress-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      {done}/{total}
    </span>
  );
}
