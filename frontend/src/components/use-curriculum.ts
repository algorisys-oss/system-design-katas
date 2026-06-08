import { useEffect, useState } from "react";
import { fetchCurriculum } from "../api/client";
import type { LevelNode } from "../api/types";

// Loads the curriculum tree once. No caching layer needed yet (no DB / small payload).
export function useCurriculum() {
  const [curriculum, setCurriculum] = useState<LevelNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurriculum()
      .then(setCurriculum)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return { curriculum, error, loading };
}
