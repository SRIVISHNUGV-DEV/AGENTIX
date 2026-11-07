"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchJSON } from "./api";

/**
 * Fetches `path` on mount (and when `deps` change) and returns { data, loading, error, refetch }.
 * Why it exists: most read-only sections need the same load/error/refetch shape without re-implementing it.
 * @param path - GET path, or null to disable fetching (loading becomes false, data stays null).
 * @param deps - Extra values that trigger a refetch; they are spread into the effect deps, so unstable values refetch in a loop.
 * @returns `{ data: T | null, loading, error: string | null, refetch }`; on failure `data` keeps its previous (possibly null) value and `error` holds the thrown message.
 * @throws Never — fetch errors are captured into `error`.
 * Maps to: REST GET `path` via fetchJSON.
 * Side effects: network I/O on mount and on every `deps` change.
 */
export function useApi<T>(path: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Re-runs the fetch for the current path and resets loading/error first.
   * Why it exists: refresh buttons and post-mutation reloads need a stable manual trigger.
   * @returns void; a null path just clears loading and does nothing.
   * @throws Never — fetch errors land in `error` state.
   * Maps to: internal — useApi.
   * Side effects: network I/O.
   */
  const refetch = useCallback(() => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetchJSON<any>(path)
      .then(setData)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => { refetch(); }, [refetch, ...deps]);

  return { data, loading, error, refetch };
}
