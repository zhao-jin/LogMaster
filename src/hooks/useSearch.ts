import { useEffect, useState } from "react";
import { searchFile, type SearchHit } from "../lib/ipc";
import { useAppStore } from "../store/app";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface SearchState {
  hits: SearchHit[];
  index: number; // current hit index, -1 = none
  setIndex: (i: number) => void;
  next: () => SearchHit | undefined;
  prev: () => SearchHit | undefined;
  current: SearchHit | undefined;
  loading: boolean;
}

export function useSearch(): SearchState {
  const activeId = useAppStore((s) => s.activeId);
  const q = useAppStore((s) => s.searchQuery);
  const isRegex = useAppStore((s) => s.searchIsRegex);
  const caseSensitive = useAppStore((s) => s.searchCaseSensitive);
  const wholeWord = useAppStore((s) => s.searchWholeWord);

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState<number>(-1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeId || !q) {
      setHits([]);
      setIndex(-1);
      return;
    }

    // Compose effective pattern: if whole-word is on, wrap with word
    // boundaries and promote to regex mode (escaping literal input first).
    let effective = q;
    let effectiveIsRegex = isRegex;
    if (wholeWord) {
      const core = isRegex ? q : escapeRegex(q);
      effective = `(?:^|\\b)(?:${core})(?:\\b|$)`;
      effectiveIsRegex = true;
    }

    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchFile(
          activeId,
          effective,
          effectiveIsRegex,
          caseSensitive,
          5000
        );
        if (cancelled) return;
        setHits(r);
        setIndex(r.length > 0 ? 0 : -1);
      } catch (e) {
        console.error("search failed", e);
        if (!cancelled) {
          setHits([]);
          setIndex(-1);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeId, q, isRegex, caseSensitive, wholeWord]);

  const current = index >= 0 && index < hits.length ? hits[index] : undefined;

  function next() {
    if (hits.length === 0) return undefined;
    const i = (index + 1) % hits.length;
    setIndex(i);
    return hits[i];
  }
  function prev() {
    if (hits.length === 0) return undefined;
    const i = (index - 1 + hits.length) % hits.length;
    setIndex(i);
    return hits[i];
  }

  return { hits, index, setIndex, next, prev, current, loading };
}
