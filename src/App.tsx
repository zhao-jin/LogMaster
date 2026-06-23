import { TopBar } from "./components/TopBar";
import { TabBar } from "./components/TabBar";
import { LogView } from "./components/LogView";
import { StatusBar } from "./components/StatusBar";
import { RulesPanel } from "./components/RulesPanel";
import { BookmarksPanel } from "./components/BookmarksPanel";
import { ResizableSidePanel } from "./components/ResizableSidePanel";
import { ResizableLeftPanel } from "./components/ResizableLeftPanel";
import { FileExplorer } from "./components/FileExplorer";
import { CommandPalette } from "./components/CommandPalette";
import { FilterBanner } from "./components/FilterBanner";
import { SettingsPanel } from "./components/SettingsPanel";
import { FolderBrowser } from "./components/FolderBrowser";
import { Welcome } from "./components/Welcome";
import { useAppStore } from "./store/app";
import { useRecentStore } from "./store/recent";
import { useSettingsStore } from "./store/settings";
import { onTail, openFile } from "./lib/ipc";
import { openDialog } from "./lib/dialog";
import { useFilter } from "./hooks/useFilter";
import { useSearch } from "./hooks/useSearch";
import { useFileDrop } from "./hooks/useFileDrop";
import { useFileWatchdog } from "./hooks/useFileWatchdog";
import { closeFile, stopTail } from "./lib/ipc";
import { clearFileCache } from "./components/LogView";
import { useCallback, useEffect, useRef, useState } from "react";

type SidePanel = "rules" | "bookmarks" | null;

export default function App() {
  const { tabs, activeId, addTab, updateTab, removeTab, toggleBookmark, setScrollTo } =
    useAppStore();
  const recent = useRecentStore();
  const searchIsRegex = useAppStore((s) => s.searchIsRegex);
  const setSearchRegex = useAppStore((s) => s.setSearchRegex);
  const searchCaseSensitive = useAppStore((s) => s.searchCaseSensitive);
  const setSearchCase = useAppStore((s) => s.setSearchCase);
  const searchWholeWord = useAppStore((s) => s.searchWholeWord);
  const setSearchWholeWord = useAppStore((s) => s.setSearchWholeWord);
  const active = tabs.find((t) => t.id === activeId);

  const [side, setSide] = useState<SidePanel>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gotoLineOpen, setGotoLineOpen] = useState(false);
  const [folderBrowser, setFolderBrowser] = useState<string | null>(null);

  // Load settings from disk on mount (portable config support).
  useEffect(() => {
    useSettingsStore.getState().load();
  }, []);

  // Left-side file explorer — persisted open/closed state.
  const leftOpen = useSettingsStore((s) => s.leftPanelOpen);
  const setSetting = useSettingsStore((s) => s.set);
  const toggleLeft = useCallback(
    () => setSetting("leftPanelOpen", !leftOpen),
    [leftOpen, setSetting]
  );

  useFilter();
  const search = useSearch();
  const dropHover = useFileDrop();
  useFileWatchdog();

  // Listen for tail events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await onTail((e) => {
        updateTab(e.id, { line_count: e.new_line_count });
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [updateTab]);

  // When search hit changes, scroll to it
  useEffect(() => {
    if (!active || !search.current) return;
    setScrollTo(active.id, search.current.line);
  }, [search.index, search.current, active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJump = useCallback(
    (physLine: number) => {
      if (!active) return;
      setScrollTo(active.id, physLine);
    },
    [active?.id] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleNextBookmark = useCallback(() => {
    if (!active || active.bookmarks.length === 0) return;
    const current = active.scrollTo ?? -1;
    const next =
      active.bookmarks.find((b) => b.line > current) ?? active.bookmarks[0];
    setScrollTo(active.id, next.line);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrevBookmark = useCallback(() => {
    if (!active || active.bookmarks.length === 0) return;
    const current = active.scrollTo ?? Number.POSITIVE_INFINITY;
    const prev =
      [...active.bookmarks].reverse().find((b) => b.line < current) ??
      active.bookmarks[active.bookmarks.length - 1];
    setScrollTo(active.id, prev.line);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeActiveTab = useCallback(async () => {
    if (!active) return;
    try {
      if (active.tailing) await stopTail(active.id);
      await closeFile(active.id);
    } catch {
      /* ignore */
    }
    clearFileCache(active.id);
    removeTab(active.id);
  }, [active, removeTab]);

  // Global keybindings
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;

      // Block WebView's built-in Ctrl+F / Ctrl+P / Ctrl+G page-find UI / Ctrl+N new window.
      if (
        mod &&
        !e.altKey &&
        ["f", "g", "p", "b", "n"].includes(e.key.toLowerCase())
      ) {
        if (!(e.shiftKey && e.key.toLowerCase() === "p")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCmdOpen(true);
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setSide(null);
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleLeft();
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        closeActiveTab();
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        (async () => {
          const p = await openDialog();
          if (!p) return;
          try {
            const info = await openFile(p);
            addTab(info);
            recent.pushFile({ path: info.path, name: info.name });
          } catch (err) {
            console.error(err);
          }
        })();
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          'input[data-role="search-input"]'
        );
        input?.focus();
        input?.select();
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setGotoLineOpen(true);
      } else if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) search.prev();
        else search.next();
      } else if (e.altKey && !mod && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setSearchRegex(!searchIsRegex);
      } else if (e.altKey && !mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setSearchCase(!searchCaseSensitive);
      } else if (e.altKey && !mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        setSearchWholeWord(!searchWholeWord);
      } else if (mod && e.key === "F2") {
        e.preventDefault();
        if (active) {
          // Toggle bookmark on the topmost visible line by default; fall
          // back to search hit / scrollTo target if available.
          const { scrollTopLine } = useAppStore.getState();
          const line =
            active.scrollTo ??
            (search.current ? search.current.line : null) ??
            scrollTopLine;
          toggleBookmark(active.id, line);
        }
      } else if (e.key === "F2") {
        e.preventDefault();
        if (e.shiftKey) handlePrevBookmark();
        else handleNextBookmark();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [
    addTab,
    recent,
    search,
    active,
    toggleBookmark,
    handleNextBookmark,
    handlePrevBookmark,
    closeActiveTab,
    searchIsRegex,
    setSearchRegex,
    searchCaseSensitive,
    setSearchCase,
    searchWholeWord,
    setSearchWholeWord,
    toggleLeft,
    setSide,
  ]);

  return (
    <div className="h-full w-full flex flex-col bg-bg">
      <TopBar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFolderBrowser={(p) => setFolderBrowser(p)}
        onOpenCmd={() => setCmdOpen(true)}
        onToggleRules={() =>
          setSide((v) => (v === "rules" ? null : "rules"))
        }
        onToggleBookmarks={() =>
          setSide((v) => (v === "bookmarks" ? null : "bookmarks"))
        }
        onToggleLeft={toggleLeft}
        leftOpen={leftOpen}
        hitCount={search.hits.length}
        hitIndex={search.index}
        onNextHit={() => search.next()}
        onPrevHit={() => search.prev()}
        hasShowOnlyFilter={useAppStore.getState().rules.some((r) => r.filter === "in")}
        onClearShowOnly={() => {
          const { rules, updateRule } = useAppStore.getState();
          for (const r of rules) {
            if (r.filter === "in") updateRule(r.id, { filter: "none" });
          }
        }}
      />
      <TabBar />
      <div className="flex-1 flex min-h-0">
        <ResizableLeftPanel open={leftOpen}>
          <FileExplorer onOpenFolderBrowser={(p) => setFolderBrowser(p)} />
        </ResizableLeftPanel>
        <div className="flex-1 min-w-0 flex flex-col">
          <FilterBanner onOpenRules={() => setSide("rules")} />
          {active ? (
            <LogView
              key={active.id}
              fileId={active.id}
              lineCount={active.line_count}
              followTail={active.followTail}
              visibleLines={active.visibleLines}
              bookmarks={active.bookmarks}
              onToggleBookmark={(ln) => toggleBookmark(active.id, ln)}
              scrollTo={active.scrollTo}
              onScrollDone={() => setScrollTo(active.id, null)}
              currentSearchHit={search.current}
            />
          ) : (
            <Welcome />
          )}
        </div>
        <ResizableSidePanel open={side === "rules"}>
          <RulesPanel open={side === "rules"} onClose={() => setSide(null)} />
        </ResizableSidePanel>
        <ResizableSidePanel open={side === "bookmarks"}>
          <BookmarksPanel
            open={side === "bookmarks"}
            onClose={() => setSide(null)}
            onJump={handleJump}
          />
        </ResizableSidePanel>
      </div>
      <StatusBar tab={active} hitCount={search.hits.length} />
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onToggleRules={() =>
          setSide((v) => (v === "rules" ? null : "rules"))
        }
        onToggleBookmarks={() =>
          setSide((v) => (v === "bookmarks" ? null : "bookmarks"))
        }
        onToggleLeft={toggleLeft}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <FolderBrowser
        open={folderBrowser !== null}
        initialPath={folderBrowser}
        onClose={() => setFolderBrowser(null)}
      />
      <GotoLineDialog
        open={gotoLineOpen}
        onClose={() => setGotoLineOpen(false)}
        onJump={(line) => {
          if (!active) return;
          setScrollTo(active.id, line);
          setGotoLineOpen(false);
        }}
        lineCount={active?.line_count ?? 0}
      />

      {dropHover && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-brand/15 backdrop-blur-sm pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-brand/70 bg-bg-panel/90 px-10 py-8 shadow-2xl flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-brand/20 flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-8 h-8 text-brand"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <polyline points="9 15 12 12 15 15" />
              </svg>
            </div>
            <div className="text-base font-semibold text-fg">
              Drop to open log file
            </div>
            <div className="text-xs text-fg-subtle">
              Multiple files will open as separate tabs
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GotoLineDialog({
  open,
  onClose,
  onJump,
  lineCount,
}: {
  open: boolean;
  onClose: () => void;
  onJump: (line: number) => void;
  lineCount: number;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setValue("");
      return;
    }
    // Auto-focus and select on open
    const id = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 50);
    return () => clearTimeout(id);
  }, [open]);

  function handleSubmit() {
    const n = Number(value);
    if (n > 0 && n <= lineCount) {
      onJump(n - 1); // Convert to 0-based
    } else if (lineCount > 0) {
      onJump(Math.min(n - 1, Math.max(0, lineCount - 1)));
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] bg-black/40 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[380px] rounded-lg border border-border bg-bg-panel shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-fg">Go to Line</span>
          <span className="text-xs text-fg-subtle ml-auto">
            {lineCount > 0 ? `1 – ${lineCount}` : "no file"}
          </span>
        </div>
        <div className="p-4 flex gap-2">
          <input
            ref={ref}
            type="number"
            min={1}
            max={lineCount || undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              else if (e.key === "Escape") onClose();
            }}
            placeholder={`1${lineCount > 0 ? `–${lineCount}` : ""}`}
            className="input w-full h-9 tabular-nums"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!value || lineCount === 0}
            className="btn btn-primary px-3 h-9 text-sm shrink-0"
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}
