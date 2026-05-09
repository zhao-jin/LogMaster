import { create } from "zustand";
import type { FileInfo, Rule } from "../lib/ipc";

export interface Tab extends FileInfo {
  tailing: boolean;
  followTail: boolean;
  /** Visible physical-line indices after filter. null = show all. */
  visibleLines: Uint32Array | null;
  /** Physical line numbers bookmarked by user (sorted asc). */
  bookmarks: number[];
  /** Current target physical line (used for scrollToLine). */
  scrollTo: number | null;
}

interface AppState {
  tabs: Tab[];
  activeId: string | null;
  rules: Rule[];
  filterEnabled: boolean;
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

  addRule: (r: Rule) => void;
  updateRule: (id: string, patch: Partial<Rule>) => void;
  removeRule: (id: string) => void;

  toggleBookmark: (tabId: string, physLine: number) => void;
  clearBookmarks: (tabId: string) => void;
  setScrollTo: (tabId: string, line: number | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tabs: [],
  activeId: null,
  rules: defaultRules(),
  filterEnabled: false,
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

  addRule: (r) => set((s) => ({ rules: [...s.rules, normalizeRule(r)] })),
  updateRule: (id, patch) =>
    set((s) => ({
      rules: s.rules.map((r) =>
        r.id === id ? normalizeRule({ ...r, ...patch }) : r
      ),
    })),
  removeRule: (id) =>
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),

  toggleBookmark: (tabId, physLine) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const i = t.bookmarks.indexOf(physLine);
        const next =
          i >= 0
            ? t.bookmarks.filter((_, j) => j !== i)
            : [...t.bookmarks, physLine].sort((a, b) => a - b);
        return { ...t, bookmarks: next };
      }),
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
