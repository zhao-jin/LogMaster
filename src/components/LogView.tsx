import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Bookmark } from "lucide-react";
import { readLines, readLinesByIndices } from "../lib/ipc";
import { useAppStore, type BookmarkEntry } from "../store/app";
import { useSettingsStore } from "../store/settings";
import { LineContextMenu, type LineMenuTarget } from "./LineContextMenu";

// Larger chunks → fewer cache-miss boundaries while scrolling, and much
// fewer IPC calls overall. Rust read is O(n), so 2000 is still well
// under 10ms for typical log lines.
const CHUNK = 2000;

// Cap the cache to avoid unbounded memory growth on huge files. We keep
// the most recently TOUCHED chunks and evict the rest. 200 chunks @ 2000
// lines/chunk = 400k lines of decoded text in memory.
const MAX_CACHED_CHUNKS = 200;

// Pseudo-text used as a "ghost" placeholder when a row's chunk hasn't
// arrived yet. We pre-compute a long string of block characters at varied
// densities so each row visually looks like "code that's still loading"
// instead of an empty/blank row. Width per row is randomized so the
// silhouette resembles real log lines (some short, some long).
const GHOST_CHARS = "▆▇█▇▆▅▆▇█▆▇▆▅▇█▇▆█▇▆▅▆▇█▇▆▅▆▇█▇▆▅▇█▇▆▅▆▇█▇▆▅▆▇▆▅▇█▇▆";
function ghostFor(viewIdx: number): string {
  // Deterministic length per row so the same row keeps the same width
  // when it briefly disappears and reappears in the viewport.
  const seed = (viewIdx * 2654435761) >>> 0; // Knuth multiplicative hash
  const len = 18 + (seed % 60); // 18..78 chars
  return GHOST_CHARS.slice(0, len);
}

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
function touchAndCache(id: string, chunkIdx: number, lines: string[]) {
  const c = getCache(id);
  // delete-then-set bumps insertion order → Map preserves LRU order.
  if (c.has(chunkIdx)) c.delete(chunkIdx);
  c.set(chunkIdx, lines);
  // Evict oldest if over budget.
  while (c.size > MAX_CACHED_CHUNKS) {
    const oldest = c.keys().next().value;
    if (oldest === undefined) break;
    c.delete(oldest);
  }
}
export function clearFileCache(id: string) {
  fileCache.delete(id);
}

interface Props {
  fileId: string;
  lineCount: number;
  followTail: boolean;
  visibleLines: Uint32Array | null; // when non-null, use view projection
  bookmarks: BookmarkEntry[];      // sorted by line
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
  const [menu, setMenu] = useState<LineMenuTarget | null>(null);

  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const showLineNumbers = useSettingsStore((s) => s.showLineNumbers);

  // Subscribe to the raw rules array (stable identity unless rules actually
  // change), then filter in a memo. If we filtered inside the selector the
  // array reference would change every render and trigger re-renders of
  // LogView on *any* store write.
  const allRules = useAppStore((s) => s.rules);
  const rules = useMemo(
    () => allRules.filter((r) => r.enabled && r.highlight && r.pattern.length > 0),
    [allRules]
  );

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
    overscan: 200,
  });

  // Track which chunks are currently being fetched so concurrent effect runs
  // don't queue duplicate IPC calls for the same chunk.
  const inflight = useRef<Map<string, Set<number>>>(new Map());
  function getInflight(): Set<number> {
    let s = inflight.current.get(fileId);
    if (!s) {
      s = new Set();
      inflight.current.set(fileId, s);
    }
    return s;
  }

  // Coalesce re-renders caused by chunk-fill. When many chunks resolve in
  // the same frame we only bump React state once. Without this, each chunk
  // return triggered a full LogView re-render (hundreds of DOM nodes),
  // which during drag-scroll on Webview2 produced the "flashing blank".
  const forcePending = useRef(false);
  function scheduleForce() {
    if (forcePending.current) return;
    forcePending.current = true;
    requestAnimationFrame(() => {
      forcePending.current = false;
      force((n) => n + 1);
    });
  }

  // Imperative prefetch: load any missing chunks for the currently-visible
  // virtual range. Called from the scroll handler (rAF-coalesced) and from
  // the items-changed effect.
  const prefetchVisible = useRef<() => void>(() => {});
  prefetchVisible.current = () => {
    const its = virtualizer.getVirtualItems();
    if (its.length === 0) return;
    const first = its[0].index;
    const last = its[its.length - 1].index;
    // Prefetch one chunk on each side too so that small mouse-wheel ticks
    // never reveal an unloaded edge.
    const firstChunk = Math.max(0, Math.floor(first / CHUNK) - 1);
    const lastChunk = Math.floor(last / CHUNK) + 1;
    const cache = getCache(fileId);
    const flight = getInflight();
    const totalChunks = Math.ceil(totalRows / CHUNK);
    const toLoad: number[] = [];
    for (let c = firstChunk; c <= Math.min(lastChunk, totalChunks - 1); c++) {
      if (!cache.has(c) && !flight.has(c)) toLoad.push(c);
    }
    if (toLoad.length === 0) return;
    for (const c of toLoad) {
      flight.add(c);
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
          touchAndCache(fileId, c, lines);
        } catch (e) {
          console.error("readLines failed", e);
          touchAndCache(fileId, c, []);
        } finally {
          flight.delete(c);
          scheduleForce();
        }
      })();
    }
  };

  // rAF-coalesce scroll-triggered prefetches so we do at most one scan
  // per frame, regardless of how many scroll events fire.
  const rafPending = useRef(false);
  function requestPrefetch() {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      prefetchVisible.current();
    });
  }
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    function onScroll() {
      // Report scroll position via getState() — NOT a subscription — so we
      // don't re-render LogView every time the store broadcasts.
      const its = virtualizer.getVirtualItems();
      if (its.length > 0) {
        const first = its[0].index;
        const last = its[its.length - 1].index;
        const topPhys = visibleLines ? visibleLines[first] ?? 0 : first;
        const botPhys = visibleLines ? visibleLines[last] ?? topPhys : last;
        useAppStore.getState().setScrollPosition(topPhys, botPhys);
      }
      requestPrefetch();
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => prefetchVisible.current());
    });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [virtualizer, visibleLines]);

  // Initial prefetch on mount / when data shape changes. No longer calls
  // setScrollPosition from the render path.
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    prefetchVisible.current();
  }, [fileId, totalRows, visibleLines]);

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
  const bookmarkMap = useMemo(() => {
    const m = new Map<number, BookmarkEntry>();
    for (const b of bookmarks) m.set(b.line, b);
    return m;
  }, [bookmarks]);

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto font-mono bg-bg"
      style={{
        fontSize: `${fontSize}px`,
        lineHeight: `${lineHeight}px`,
        // Hint the compositor that this element's contents will change
        // rapidly. Prevents the entire scroll container from being
        // re-painted on every scroll tick.
        contain: "strict",
      }}
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
          const bookmark = bookmarkMap.get(physIdx);
          const isBookmarked = !!bookmark;
          const isSearchHit =
            currentSearchHit && currentSearchHit.line === physIdx;

          return (
            <div
              key={vi.key}
              className="absolute left-0 right-0 flex hover:bg-bg-hover/40"
              style={{
                transform: `translateY(${vi.start}px)`,
                height: `${vi.size}px`,
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  physLine: physIdx,
                  text: text ?? "",
                  isBookmarked,
                });
              }}
            >
              <button
                onClick={() => onToggleBookmark(physIdx)}
                className="group/gutter shrink-0 w-6 flex items-center justify-center hover:bg-bg-hover"
                title={
                  bookmark
                    ? `${bookmark.name} (line ${physIdx + 1}) — click to remove`
                    : `Add bookmark (line ${physIdx + 1})`
                }
              >
                <Bookmark
                  className={
                    "w-3.5 h-3.5 " +
                    (bookmark
                      ? ""
                      : "text-fg-subtle/30 group-hover/gutter:text-brand group-hover/gutter:fill-brand/40")
                  }
                  style={
                    bookmark
                      ? { color: bookmark.color, fill: bookmark.color }
                      : undefined
                  }
                />
              </button>

              {showLineNumbers && (
                <div
                  className={
                    "shrink-0 text-right pr-3 pl-1 select-none border-r border-border " +
                    (isSearchHit ? "text-fg bg-brand/20" : "text-fg-subtle")
                  }
                  style={{ width: lineNumWidth }}
                >
                  {physIdx + 1}
                </div>
              )}

              <div
                className={
                  "flex-1 min-w-0 pl-3 pr-2 overflow-hidden whitespace-pre " +
                  (text === undefined ? "select-none" : "text-fg") +
                  (isSearchHit ? " bg-brand/10" : "")
                }
                style={
                  text === undefined ? { color: "#334155" } : undefined
                }
              >
                {text === undefined ? (
                  // Ghost row: a row of dim block characters that looks like
                  // a "code line still loading", so the viewport never shows
                  // empty/blank rows during fast drag-scroll. The content
                  // swaps to real text in-place once the chunk arrives —
                  // the row never disappears or flashes.
                  <span aria-hidden="true">{ghostFor(viewIdx)}</span>
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

      <LineContextMenu
        target={menu}
        onClose={() => setMenu(null)}
        onToggleBookmark={onToggleBookmark}
      />
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
