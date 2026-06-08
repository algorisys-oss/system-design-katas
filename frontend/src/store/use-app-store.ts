import { create } from "zustand";
import { persist } from "zustand/middleware";

// Global app state. No backend persistence yet (no DB) — reader progress and
// theme live in localStorage. When users/sessions land, sync this server-side.
export interface FlatChapter {
  slug: string;
  title: string;
  module: string;
}

interface AppState {
  completed: Record<string, boolean>;
  markComplete: (slug: string) => void;
  toggleComplete: (slug: string) => void;
  isComplete: (slug: string) => boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  // Flat, ordered chapter list (set once the curriculum loads) — powers
  // prev/next navigation and progress. Not persisted (rebuilt each load).
  flatChapters: FlatChapter[];
  setFlatChapters: (chapters: FlatChapter[]) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      completed: {},
      markComplete: (slug) =>
        set((s) => ({ completed: { ...s.completed, [slug]: true } })),
      toggleComplete: (slug) =>
        set((s) => ({
          completed: { ...s.completed, [slug]: !s.completed[slug] },
        })),
      isComplete: (slug) => !!get().completed[slug],
      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      flatChapters: [],
      setFlatChapters: (chapters) => set({ flatChapters: chapters }),
    }),
    {
      name: "system-design-progress",
      // Only persist progress + sidebar preference, not the (re-derived) chapter list.
      partialize: (s) => ({ completed: s.completed, sidebarOpen: s.sidebarOpen }),
    },
  ),
);
