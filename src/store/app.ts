import { create } from "zustand";
import type { FileInfo, Rule } from "../lib/ipc";

export interface BookmarkEntry {
  id: string;
  line: number;     // physical line index (0-based)
  name: string;     // user-editable label
  color: string;    // hex color, used for gutter icon
}

export interface Tab extends FileInfo {
  tailing: boolean;
  followTail: boolean;
  /** Visible physical-line indices after filter. null = show all. */
  visibleLines: Uint32Array | null;
  /** Bookmarks (sorted by line asc). */
  bookmarks: BookmarkEntry[];
  /** Counter used to generate "Bookmark N" default labels. Monotonic per tab. */
  bookmarkCounter: number;
  /** Current target physical line (used for scrollToLine). */
  scrollTo: number | null;
}

interface AppState {
  tabs: Tab[];
  activeId: string | null;
  rules: Rule[];
  filterEnabled: boolean;
  /** Whether active filter-in rules combine with OR (any match) or AND
   *  (all must match). Excludes are always OR. */
  filterCombineMode: "or" | "and";
  searchQuery: string;
  searchIsRegex: boolean;
  searchCaseSensitive: boolean;
  searchWholeWord: boolean;
  /** Top-most visible physical line index (0-based) of active view */
  scrollTopLine: number;
  /** Bottom-most visible physical line index (0-based) of active view */
  scrollBottomLine: number;

  addTab: (t: FileInfo) => void;
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;

  setSearch: (q: string) => void;
  setSearchRegex: (v: boolean) => void;
  setSearchCase: (v: boolean) => void;
  setSearchWholeWord: (v: boolean) => void;
  setScrollPosition: (top: number, bottom: number) => void;

  setFilterEnabled: (v: boolean) => void;
  setFilterCombineMode: (v: "or" | "and") => void;

  addRule: (r: Rule) => void;
  updateRule: (id: string, patch: Partial<Rule>) => void;
  removeRule: (id: string) => void;
  setRules: (rules: Rule[]) => void;

  toggleBookmark: (tabId: string, physLine: number) => void;
  renameBookmark: (tabId: string, bookmarkId: string, name: string) => void;
  recolorBookmark: (tabId: string, bookmarkId: string, color: string) => void;
  clearBookmarks: (tabId: string) => void;
  setScrollTo: (tabId: string, line: number | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tabs: [],
  activeId: null,
  rules: defaultRules(),
  filterEnabled: false,
  filterCombineMode: "or",
  searchQuery: "",
  searchIsRegex: false,
  searchCaseSensitive: false,
  searchWholeWord: false,
  scrollTopLine: 0,
  scrollBottomLine: 0,

  addTab: (t) =>
    set((s) => {
      if (s.tabs.find((x) => x.id === t.id)) {
        return { activeId: t.id };
      }
      return {
        tabs: [
          ...s.tabs,
          {
            ...t,
            tailing: false,
            followTail: false,
            visibleLines: null,
            bookmarks: [],
            bookmarkCounter: 0,
            scrollTo: null,
          },
        ],
        activeId: t.id,
      };
    }),

  removeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((x) => x.id !== id);
      const activeId =
        s.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeId;
      return { tabs, activeId };
    }),

  setActive: (id) => set({ activeId: id }),

  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  setSearch: (q) => set({ searchQuery: q }),
  setSearchRegex: (v) => set({ searchIsRegex: v }),
  setSearchCase: (v) => set({ searchCaseSensitive: v }),
  setSearchWholeWord: (v) => set({ searchWholeWord: v }),
  setScrollPosition: (top, bottom) =>
    set((s) =>
      s.scrollTopLine === top && s.scrollBottomLine === bottom
        ? s
        : { scrollTopLine: top, scrollBottomLine: bottom }
    ),

  setFilterEnabled: (v) => set({ filterEnabled: v }),
  setFilterCombineMode: (v) => set({ filterCombineMode: v }),

  addRule: (r) => set((s) => ({ rules: [...s.rules, normalizeRule(r)] })),
  updateRule: (id, patch) =>
    set((s) => ({
      rules: s.rules.map((r) =>
        r.id === id ? normalizeRule({ ...r, ...patch }) : r
      ),
    })),
  removeRule: (id) =>
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
  setRules: (rules) => set({ rules: rules.map(normalizeRule) }),

  toggleBookmark: (tabId, physLine) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const existing = t.bookmarks.findIndex((b) => b.line === physLine);
        if (existing >= 0) {
          return {
            ...t,
            bookmarks: t.bookmarks.filter((_, i) => i !== existing),
          };
        }
        const nextCounter = t.bookmarkCounter + 1;
        const newEntry: BookmarkEntry = {
          id: "bm-" + Math.random().toString(36).slice(2, 8),
          line: physLine,
          name: `Bookmark ${nextCounter}`,
          color: pickBookmarkColor(t.bookmarks.length),
        };
        const next = [...t.bookmarks, newEntry].sort(
          (a, b) => a.line - b.line
        );
        return { ...t, bookmarks: next, bookmarkCounter: nextCounter };
      }),
    })),

  renameBookmark: (tabId, bookmarkId, name) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id !== tabId
          ? t
          : {
              ...t,
              bookmarks: t.bookmarks.map((b) =>
                b.id === bookmarkId ? { ...b, name } : b
              ),
            }
      ),
    })),

  recolorBookmark: (tabId, bookmarkId, color) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id !== tabId
          ? t
          : {
              ...t,
              bookmarks: t.bookmarks.map((b) =>
                b.id === bookmarkId ? { ...b, color } : b
              ),
            }
      ),
    })),

  clearBookmarks: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, bookmarks: [] } : t
      ),
    })),

  setScrollTo: (tabId, line) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, scrollTo: line } : t
      ),
    })),
}));

/**
 * Cycle through a curated palette so consecutive bookmarks are visually
 * distinct in the gutter.
 */
const BOOKMARK_PALETTE = [
  "#3b82f6", // brand blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];
function pickBookmarkColor(existingCount: number): string {
  return BOOKMARK_PALETTE[existingCount % BOOKMARK_PALETTE.length];
}

/**
 * Normalize a rule, providing safe defaults for new fields. This protects
 * against HMR/state shape mismatches when the schema evolves.
 */
function normalizeRule(r: Rule): Rule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyR = r as any;
  return {
    ...r,
    highlight: typeof r.highlight === "boolean" ? r.highlight : true,
    filter:
      r.filter === "in" || r.filter === "out" || r.filter === "none"
        ? r.filter
        : anyR.action === "filter_in"
        ? "in"
        : anyR.action === "filter_out"
        ? "out"
        : "none",
  };
}

function defaultRules(): Rule[] {
  return [
    {
      id: "r-error",
      name: "ERROR",
      pattern: "\\b(ERROR|ERR|FATAL|Exception)\\b",
      is_regex: true,
      case_sensitive: false,
      highlight: true,
      filter: "none",
      fg: "#fecaca",
      bg: "#7f1d1d",
      bold: true,
      enabled: true,
    },
    {
      id: "r-warn",
      name: "WARN",
      pattern: "\\b(WARN|WARNING)\\b",
      is_regex: true,
      case_sensitive: false,
      highlight: true,
      filter: "none",
      fg: "#fde68a",
      bg: "#78350f",
      bold: false,
      enabled: true,
    },
    {
      id: "r-info",
      name: "INFO",
      pattern: "\\b(INFO)\\b",
      is_regex: true,
      case_sensitive: false,
      highlight: true,
      filter: "none",
      fg: "#bae6fd",
      bold: false,
      enabled: true,
    },
    {
      id: "r-debug",
      name: "DEBUG",
      pattern: "\\b(DEBUG|TRACE)\\b",
      is_regex: true,
      case_sensitive: false,
      highlight: true,
      filter: "none",
      fg: "#a7f3d0",
      bold: false,
      enabled: true,
    },
  ];
}
