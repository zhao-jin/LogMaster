import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Bookmark } from "lucide-react";
import { readLines, readLinesByIndices } from "../lib/ipc";
import { useAppStore } from "../store/app";
import { useSettingsStore } from "../store/settings";

const CHUNK = 500;

// LRU-ish per-file chunk cache: chunkIdx -> lines[]
// NB: chunkIdx is based on *view* indices (not physical) so we key per-tab+view.
const fileCache = new Map<string, Map<number, string[]>>();
function getCache(id: string) {
  let c = fileCache.get(id);
  if (!c) {
    c = new Map();
    fileCache.set(id, c);
  }
  return c;
}
export function clearFileCache(id: string) {
  fileCache.delete(id);
}

interface Props {
  fileId: string;
  lineCount: number;
  followTail: boolean;
  visibleLines: Uint32Array | null; // when non-null, use view projection
  bookmarks: number[];              // physical line numbers
  onToggleBookmark: (physLine: number) => void;
  scrollTo: number | null;          // physical line to jump to
  onScrollDone: () => void;
  currentSearchHit?: { line: number; col_start: number; col_end: number };
}

export function LogView({
  fileId,
  lineCount,
  followTail,
  visibleLines,
  bookmarks,
  onToggleBookmark,
  scrollTo,
  onScrollDone,
  currentSearchHit,
}: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [, force] = useState(0);

  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const showLineNumbers = useSettingsStore((s) => s.showLineNumbers);

  const setScrollPosition = useAppStore(
    (s) => s.setScrollPosition ?? (() => {})
  );

  const rules = useAppStore((s) =>
    s.rules.filter((r) => r.enabled && r.highlight && r.pattern.length > 0)
  );
  const searchHitsByLine = useAppStore((s) => s as unknown as never); // placeholder; see App.tsx-provided hits
  void searchHitsByLine;

  const totalRows = visibleLines ? visibleLines.length : lineCount;

  // Invalidate cache when projection changes (filter toggled or re-filtered).
  const cacheKey = useMemo(
    () => `${fileId}::${visibleLines ? visibleLines.length : "all"}::${lineCount}`,
    [fileId, visibleLines, lineCount]
  );
  useEffect(() => {
    getCache(fileId).clear();
  }, [cacheKey, fileId]);

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => lineHeight,
    overscan: 60,
  });

  // Prefetch chunks covering visible range, and report scroll position.
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    if (items.length === 0) {
      setScrollPosition(0, 0);
      return;
    }
    const first = items[0].index;
    const last = items[items.length - 1].index;

    // Report scroll position in terms of physical line indices.
    const topPhys = visibleLines ? visibleLines[first] ?? 0 : first;
    const botPhys = visibleLines
      ? visibleLines[last] ?? topPhys
      : last;
    setScrollPosition(topPhys, botPhys);

    const firstChunk = Math.floor(first / CHUNK);
    const lastChunk = Math.floor(last / CHUNK);
    const cache = getCache(fileId);
    const toLoad: number[] = [];
    for (let c = firstChunk; c <= lastChunk; c++) {
      if (!cache.has(c)) toLoad.push(c);
    }
    if (toLoad.length === 0) return;
    let cancelled = false;
    // Load chunks in parallel — each one re-renders as soon as it's ready.
    for (const c of toLoad) {
      (async () => {
        const startV = c * CHUNK;
        const endV = Math.min(startV + CHUNK, totalRows);
        try {
          let lines: string[];
          if (visibleLines) {
            const ids: number[] = [];
            for (let i = startV; i < endV; i++) ids.push(visibleLines[i]);
            lines = await readLinesByIndices(fileId, ids);
          } else {
            const r = await readLines(fileId, startV, endV);
            lines = r.lines;
          }
          if (cancelled) return;
          cache.set(c, lines);
          force((n) => n + 1);
        } catch (e) {
          console.error("readLines failed", e);
          if (!cancelled) {
            cache.set(c, []);
            force((n) => n + 1);
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [items, fileId, totalRows, visibleLines]);

  // Follow tail: scroll to bottom when line count grows
  useEffect(() => {
    if (!followTail || totalRows === 0) return;
    virtualizer.scrollToIndex(totalRows - 1, { align: "end" });
  }, [lineCount, followTail, virtualizer, totalRows]);

  // External scrollTo (jump to physical line)
  useEffect(() => {
    if (scrollTo == null) return;
    let viewIdx: number;
    if (visibleLines) {
      // Binary search on Uint32Array
      viewIdx = binarySearch(visibleLines, scrollTo);
      if (viewIdx < 0) viewIdx = Math.max(0, -viewIdx - 1);
    } else {
      viewIdx = scrollTo;
    }
    virtualizer.scrollToIndex(viewIdx, { align: "center" });
    onScrollDone();
  }, [scrollTo, visibleLines, virtualizer, onScrollDone]);

  const compiledRules = useMemo(() => {
    return rules.map((r) => {
      let re: RegExp | null = null;
      try {
        const src = r.is_regex ? r.pattern : escapeRegex(r.pattern);
        re = new RegExp(src, r.case_sensitive ? "g" : "gi");
      } catch {
        re = null;
      }
      return { ...r, re };
    });
  }, [rules]);

  const lineNumWidth = Math.max(4, String(lineCount).length) * 8 + 16;
  const bookmarkSet = useMemo(() => new Set(bookmarks), [bookmarks]);

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto font-mono bg-bg"
      style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` }}
      tabIndex={0}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {items.map((vi) => {
          const viewIdx = vi.index;
          const physIdx = visibleLines ? visibleLines[viewIdx] : viewIdx;
          const chunkIdx = Math.floor(viewIdx / CHUNK);
          const inner = viewIdx % CHUNK;
          const cache = getCache(fileId);
          const chunk = cache.get(chunkIdx);
          const text = chunk?.[inner];
          const isBookmarked = bookmarkSet.has(physIdx);
          const isSearchHit =
            currentSearchHit && currentSearchHit.line === physIdx;

          return (
            <div
              key={vi.key}
              className="absolute left-0 right-0 flex hover:bg-bg-hover/40 transition-colors"
              style={{
                transform: `translateY(${vi.start}px)`,
                height: `${vi.size}px`,
              }}
            >
              {/* Bookmark gutter */}
              <button
                onClick={() => onToggleBookmark(physIdx)}
                className="shrink-0 w-5 flex items-center justify-center hover:bg-bg-hover transition-colors"
                title={
                  isBookmarked
                    ? `Remove bookmark (line ${physIdx + 1})`
                    : `Add bookmark (line ${physIdx + 1})`
                }
              >
                {isBookmarked ? (
                  <Bookmark className="w-3 h-3 text-brand fill-brand" />
                ) : (
                  <span className="w-3 h-3" />
                )}
              </button>

              {/* Line number */}
              {showLineNumbers && (
                <div
                  className={
                    "shrink-0 text-right pr-3 pl-1 select-none border-r border-border " +
                    (isSearchHit
                      ? "text-fg bg-brand/20"
                      : "text-fg-subtle")
                  }
                  style={{ width: lineNumWidth }}
                >
                  {physIdx + 1}
                </div>
              )}

              {/* Content */}
              <div
                className={
                  "flex-1 min-w-0 pl-3 pr-2 overflow-hidden whitespace-pre text-fg " +
                  (isSearchHit ? "bg-brand/10" : "")
                }
              >
                {text === undefined ? (
                  <span className="text-fg-subtle italic">…</span>
                ) : (
                  renderLine(
                    text,
                    compiledRules,
                    isSearchHit ? currentSearchHit : undefined
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function binarySearch(arr: Uint32Array, target: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = arr[mid];
    if (v === target) return mid;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -(lo + 1);
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type CompiledRule = {
  id: string;
  fg?: string;
  bg?: string;
  bold: boolean;
  re: RegExp | null;
};

interface Span {
  start: number;
  end: number;
  style: React.CSSProperties;
  kind: "rule" | "search";
}

function renderLine(
  text: string,
  rules: CompiledRule[],
  currentHit?: { col_start: number; col_end: number }
) {
  const spans: Span[] = [];
  for (const r of rules) {
    if (!r.re) continue;
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        r.re.lastIndex++;
        continue;
      }
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        style: {
          color: r.fg,
          backgroundColor: r.bg,
          fontWeight: r.bold ? 600 : undefined,
          borderRadius: 2,
          padding: "0 1px",
        },
        kind: "rule",
      });
    }
  }

  if (currentHit) {
    spans.push({
      start: currentHit.col_start,
      end: currentHit.col_end,
      style: {
        backgroundColor: "#fde047",
        color: "#0b1220",
        borderRadius: 2,
        fontWeight: 700,
      },
      kind: "search",
    });
  }

  if (spans.length === 0) return text;

  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  const out: React.ReactNode[] = [];
  let cursor = 0;
  let lastEnd = 0;
  for (const s of spans) {
    if (s.start < lastEnd) continue;
    if (s.start > cursor) out.push(text.slice(cursor, s.start));
    out.push(
      <span key={`${s.start}-${s.end}-${s.kind}`} style={s.style}>
        {text.slice(s.start, s.end)}
      </span>
    );
    cursor = s.end;
    lastEnd = s.end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
