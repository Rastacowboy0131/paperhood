"use client";

// Server-side watchlist state, shared by the screener and trade page.
// Only active when signed in; anonymous users see no stars.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function useWatchlist() {
  const { address } = useAuth();
  const [watched, setWatched] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!address) {
      setWatched({});
      setLoaded(false);
      return;
    }
    let alive = true;
    api
      .watchlist()
      .then((r) => {
        if (!alive) return;
        const map: Record<string, boolean> = {};
        for (const w of r.watchlist) map[w.token.toLowerCase()] = true;
        setWatched(map);
        setLoaded(true);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [address]);

  const toggle = useCallback((token: string) => {
    const t = token.toLowerCase();
    setWatched((prev) => {
      const on = !prev[t];
      const next = { ...prev };
      if (on) next[t] = true;
      else delete next[t];
      // Fire and forget; revert on failure.
      (on ? api.addWatch(t) : api.removeWatch(t)).catch(() => {
        setWatched((p) => {
          const undo = { ...p };
          if (on) delete undo[t];
          else undo[t] = true;
          return undo;
        });
      });
      return next;
    });
  }, []);

  return { signedIn: !!address, watched, loaded, toggle };
}
