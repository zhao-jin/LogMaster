import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Cap the cache to avoid unbounded memory growth on huge files.
const MAX_CACHED_CHUNKS = 200;

/* ------------------------------------------------------------------ */
/*  Ghost rows — shown before a chunk has arrived so users never see  */
/*  a blank viewport during fast drag-scrolling.                      */
/* ------------------------------------------------------------------ */

const GHOST_CHARS =
  "▆▇█▇▆▅▆▇█▆▇▆▅▇█▇▆█▇▆▅▆▇█▇▆▅▆▇█▇▆▅▇█▇▆▅▆▇█▇▆▅▆▇▆▅▇█▇▆";
// Pre-compute a fixed pool of ghost strings (different lengths) and index
// by (viewIdx % POOL). Avoids a String.slice per row per frame.
const GHOST_POOL: string[] = (() => {
  const pool: string[] = [];
  const POOL = 32;
  for (let i = 0; i < POOL; i++) {
    const seed = (i * 2654435761) >>> 0;
    const len = 18 + (seed % 60);
    pool.push(GHOST_CHARS.slice(0, len));
  }
  return pool;
})();
function ghostFor(viewIdx: number): string {
  return GHOST_POOL[viewIdx & 31];
}

/* ------------------------------------------------------------------ */
/*  Chunk cache (module-global, per-file)                             */
/* ------------------------------------------------------------------ */

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
  if (c.has(chunkIdx)) c.delete(chunkIdx);
  c.set(chunkIdx, lines);
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
  visibleLines: Uint32Array | null;
  bookmarks: BookmarkEntry[];
  onToggleBookmark: (physLine: number) => void;
  scrollTo: number | null;
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
  const wordWrap = useSettingsStore((s) => s.wordWrap);

  const allRules = useAppStore((s) => s.rules);
  const rules = useMemo(
    () =>
      allRules.filter((r) => r.enabled && r.highlight && r.pattern.length > 0),
    [allRules]
  );

  const totalRows = visibleLines ? visibleLines.length : lineCount;

  // Cache invalidation strategy
  // ---------------------------
  // The chunk cache is keyed by chunkIdx in the *view* (post-filter)
  // index space. Two things can shift that mapping and force eviction:
  //
  //   1. The file changed (different fileId).
  //   2. Filter is toggled, OR the active filter rules produce a
  //      *different prefix* of visible lines (i.e. some entries near
  //      the start changed). This is rare in practice — useFilter
  //      re-runs on every tail tick and produces a Uint32Array that
  //      is monotonically extending: existing entries stay put, only
  //      the tail of the array gains new physical indices.
  //
  // So the only thing that *must* invalidate is "filter on/off" and
  // "filter rules changed". Identity of the visibleLines array on its
  // own does NOT mean the prefix changed — that's the bug we hit
  // before (entire cache wiped on every tail event during filter mode,
  // making the viewport flash to ghost rows).
  //
  // We sample a few sentinels (length, first, last) plus a "rules
  // signature" derived from the active filter rules. If any sentinel
  // shifts BACKWARD (length shrinks, or any prefix entry changes) we
  // assume the projection's history was rewritten and clear. Pure
  // tail growth keeps prefix sentinels stable -> cache survives.
  const filterSig = useAppStore((s) =>
    s.rules
      .filter(
        (r) => r.enabled && r.pattern.length > 0 && r.filter !== "none"
      )
      .map(
        (r) =>
          `${r.filter}|${r.is_regex ? "re" : "lit"}|${
            r.case_sensitive ? "cs" : "ci"
          }|${r.pattern}`
      )
      .join("\n")
  );

  const lastSnapshotRef = useRef<{
    fileId: string;
    filterSig: string;
    hasFilter: boolean;
    len: number;
    first: number;
    mid: number;
  } | null>(null);
  useEffect(() => {
    const cache = getCache(fileId);
    const hasFilter = !!visibleLines;
    const len = visibleLines ? visibleLines.length : lineCount;
    const first = visibleLines ? visibleLines[0] ?? 0 : 0;
    // Probe the middle of the projection too — catches cases where the
    // filter rule changed but length happens to be similar.
    const midIdx = Math.floor(len / 2);
    const mid = visibleLines ? visibleLines[midIdx] ?? 0 : midIdx;

    const prev = lastSnapshotRef.current;
    const fileChanged = !prev || prev.fileId !== fileId;
    const filterModeChanged =
      !prev || prev.hasFilter !== hasFilter || prev.filterSig !== filterSig;
    const prefixChanged =
      !!prev &&
      !fileChanged &&
      !filterModeChanged &&
      // Length went BACKWARDS — file truncated or filter dropped rows.
      (len < prev.len ||
        // Same/longer length, but a known prefix sentinel moved — projection
        // rewrote history.
        (prev.len > 0 && first !== prev.first) ||
        (prev.len > 0 && midIdx === Math.floor(prev.len / 2) && mid !== prev.mid));

    if (fileChanged || filterModeChanged || prefixChanged) {
      cache.clear();
    } else if (prev && len > prev.len) {
      // Pure append (no projection rewrite). Two chunks may now be stale:
      //
      //   1. The last "complete" chunk previously held only `prev.len -
      //      prev.lastChunkStart` rows; new appended rows extend it
      //      with more lines past its current array length.  The cached
      //      string[] is short, so accessing inner indices past its end
      //      yields undefined → ghost row.
      //
      //   2. In unfiltered mode only: the very last row of the previous
      //      tail might have been a partial line that's now been
      //      completed by new bytes, so its cached text is stale.
      const lastIdx = Math.max(0, prev.len - 1);
      const lastChunk = Math.floor(lastIdx / CHUNK);
      cache.delete(lastChunk);
    }

    lastSnapshotRef.current = { fileId, filterSig, hasFilter, len, first, mid };

    // After eviction the boundary chunk is missing; kick off a refetch
    // on the next frame so it doesn't stay as a ghost row. We always do
    // this on append, since prefetch is cheap (cache.has guard skips
    // already-present chunks).
    requestAnimationFrame(() => prefetchVisible.current());
  }, [fileId, lineCount, visibleLines, filterSig]);

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => lineHeight,
    // 120 ≈ 2 screens of buffer — enough to hide incoming-chunk latency
    // on mouse-wheel / trackpad, while keeping frame cost low during
    // drag-scroll (fewer row nodes to reconcile).
    overscan: 120,
  });

  const inflight = useRef<Map<string, Set<number>>>(new Map());
  function getInflight(): Set<number> {
    let s = inflight.current.get(fileId);
    if (!s) {
      s = new Set();
      inflight.current.set(fileId, s);
    }
    return s;
  }

  const forcePending = useRef(false);
  function scheduleForce() {
    if (forcePending.current) return;
    forcePending.current = true;
    requestAnimationFrame(() => {
      forcePending.current = false;
      force((n) => n + 1);
    });
  }

  const prefetchVisible = useRef<() => void>(() => {});
  prefetchVisible.current = () => {
    const its = virtualizer.getVirtualItems();
    if (its.length === 0) return;
    const first = its[0].index;
    const last = its[its.length - 1].index;
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
            const ids: number[] = new Array(endV - startV);
            for (let i = startV; i < endV; i++) ids[i - startV] = visibleLines[i];
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

  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    prefetchVisible.current();
  }, [fileId, totalRows, visibleLines]);

  useEffect(() => {
    if (!followTail || totalRows === 0) return;
    virtualizer.scrollToIndex(totalRows - 1, { align: "end" });
  }, [lineCount, followTail, virtualizer, totalRows]);

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

  // Stable handler — Row is memoized and we don't want to break that when
  // parent re-renders.
  const handleContextMenu = useCallback(
    (t: LineMenuTarget) => setMenu(t),
    []
  );

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto font-mono bg-bg"
      style={{
        fontSize: `${fontSize}px`,
        lineHeight: `${lineHeight}px`,
        contain: "strict",
      }}
      tabIndex={0}
    >
      <div
        className={"relative " + (wordWrap ? "w-full" : "inline-block")}
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
          const isSearchHit =
            !!currentSearchHit && currentSearchHit.line === physIdx;

          return (
            <Row
              key={vi.key}
              viewIdx={viewIdx}
              physIdx={physIdx}
              start={vi.start}
              size={vi.size}
              text={text}
              bookmark={bookmark}
              compiledRules={compiledRules}
              isSearchHit={isSearchHit}
              currentSearchHit={isSearchHit ? currentSearchHit : undefined}
              showLineNumbers={showLineNumbers}
              lineNumWidth={lineNumWidth}
              wordWrap={wordWrap}
              onToggleBookmark={onToggleBookmark}
              onContextMenu={handleContextMenu}
            />
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

/* ------------------------------------------------------------------ */
/*  Row — memoized. Re-renders ONLY when props it actually uses change.*/
/* ------------------------------------------------------------------ */

interface RowProps {
  viewIdx: number;
  physIdx: number;
  start: number;
  size: number;
  text: string | undefined;
  bookmark: BookmarkEntry | undefined;
  compiledRules: CompiledRule[];
  isSearchHit: boolean;
  currentSearchHit?: { col_start: number; col_end: number };
  showLineNumbers: boolean;
  lineNumWidth: number;
  wordWrap: boolean;
  onToggleBookmark: (physLine: number) => void;
  onContextMenu: (t: LineMenuTarget) => void;
}

const Row = memo(function Row({
  viewIdx,
  physIdx,
  start,
  size,
  text,
  bookmark,
  compiledRules,
  isSearchHit,
  currentSearchHit,
  showLineNumbers,
  lineNumWidth,
  wordWrap,
  onToggleBookmark,
  onContextMenu,
}: RowProps) {
  const isBookmarked = !!bookmark;
  return (
    <div
      className={
        "absolute left-0 flex hover:bg-bg-hover/40 " +
        (wordWrap ? "right-0" : "")
      }
      style={{
        transform: `translateY(${start}px)`,
        height: `${size}px`,
        // Let the compositor skip layout/paint for off-screen rows entirely.
        // Webview2 is Chromium-based, so content-visibility works here.
        contentVisibility: "auto",
        containIntrinsicSize: `${size}px`,
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu({
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
          (wordWrap
            ? "flex-1 min-w-0 pl-3 pr-2 overflow-hidden whitespace-pre-wrap "
            : "shrink-0 pl-3 pr-2 whitespace-pre ") +
          (text === undefined ? "select-none" : "text-fg") +
          (isSearchHit ? " bg-brand/10" : "")
        }
        style={text === undefined ? { color: "#334155" } : undefined}
      >
        {text === undefined ? (
          <span aria-hidden="true">{ghostFor(viewIdx)}</span>
        ) : compiledRules.length === 0 && !currentSearchHit ? (
          // Fast path: no highlighting required → emit raw text.
          text
        ) : (
          renderLine(text, compiledRules, currentSearchHit)
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

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
  // Fast path handled at the caller; if we reach here there's at least
  // one rule or a search hit.
  const spans: Span[] = [];
  for (const r of rules) {
    if (!r.re) continue;
    // Cheap pre-check: if the rule is a plain-text (non-regex) pattern we
    // could use indexOf as a shortcut, but new RegExp wraps both paths.
    // Keep RegExp.exec; only pay for rules whose source actually occurs.
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
