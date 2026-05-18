import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  Copy,
  FileText,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Folder as FolderIcon,
  RefreshCw,
  Trash2,
  Eraser,
  X,
  ExternalLink,
  Pin,
} from "lucide-react";
import { listDir, openFile, deletePaths, type DirEntryInfo } from "../lib/ipc";
import { openDialog, openFolderDialog } from "../lib/dialog";
import { useAppStore } from "../store/app";
import { useRecentStore } from "../store/recent";
import { useSettingsStore } from "../store/settings";
import { cn, formatRelativeTime } from "../lib/utils";
import { closeFile, stopTail } from "../lib/ipc";
import { clearFileCache } from "./LogView";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/* ------------------------------------------------------------------ */
/*  Multi-select context                                              */
/*                                                                    */
/*  We keep the selection in a Set keyed by file path. Anchor is the  */
/*  last single-clicked file, used for shift-range selection within a */
/*  flat list. Range select only works among siblings of the same     */
/*  expanded directory (most natural UX), so we also track the anchor */
/*  list (an ordered list of paths from the same parent).             */
/* ------------------------------------------------------------------ */

interface SelectionCtx {
  selected: ReadonlySet<string>;
  isSelected: (path: string) => boolean;
  /** Apply a single-click selection. Modifier-aware. */
  click: (
    path: string,
    siblings: string[],
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ) => void;
  /** Replace selection with the single given path. */
  selectOnly: (path: string) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionCtx | null>(null);
function useSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("SelectionContext missing");
  return ctx;
}

/**
 * Counter that ticks periodically (controlled by `fileStatusRefreshIntervalSec`).
 * Expanded folder nodes subscribe to it and merge new/deleted files
 * and update file status without re-sorting the list. Collapsed nodes
 * don't read this value, so they cost nothing.
 *
 * New files are appended to the end of the list; the `SortEpochContext`
 * timer (controlled by `fileSortIntervalSec`) handles full re-sorting
 * by modified time.
 */
const StatusEpochContext = createContext<number>(0);

/**
 * Counter that ticks periodically (controlled by `fileSortIntervalSec`).
 * Expanded folder nodes subscribe to it and re-listDir with full
 * re-sort by modified time.
 * This is separate from `StatusEpochContext` so that normal refreshes
 * (which only merge changes) don't cause the list to re-sort.
 */
const SortEpochContext = createContext<number>(0);

interface MenuState {
  x: number;
  y: number;
  /** All files this menu acts on. For root folder: empty (root menu). */
  paths: string[];
  /** Path of the row that was right-clicked (for "Reveal" etc.) */
  primary: string;
  /** Whether the right-clicked row is a folder. */
  isFolder: boolean;
  /** Whether the right-clicked row is a workspace root. */
  isRoot: boolean;
  /** Refresh the directory the row belongs to. */
  onRefresh?: () => void;
  /** Remove a workspace root. */
  onRemoveRoot?: () => void;
  /** Reveal in folder browser modal (full path). */
  onReveal?: (path: string) => void;
}

/**
 * Pending delete request — the explorer surface lifts the confirmation
 * dialog up so that closing the context menu (which is what
 * `onRequestDelete` does first) doesn't unmount the dialog.
 */
interface ConfirmState {
  paths: string[];
  recursive: boolean;
  /** Human-readable summary line in the dialog body. */
  summary: string;
  /** Called after the delete completes (refresh listings). */
  afterRefresh?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Top-level explorer                                                */
/* ------------------------------------------------------------------ */

interface ExplorerProps {
  onOpenFolderBrowser?: (path: string) => void;
}

export function FileExplorer({ onOpenFolderBrowser }: ExplorerProps = {}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<{ path: string; siblings: string[] } | null>(null);

  const click = useCallback<SelectionCtx["click"]>((path, siblings, e) => {
    setSelected((prev) => {
      const mod = e.ctrlKey || e.metaKey;
      // Shift-range within siblings (same parent).
      if (e.shiftKey && anchor.current) {
        const list = anchor.current.siblings;
        const ai = list.indexOf(anchor.current.path);
        const bi = list.indexOf(path);
        if (ai >= 0 && bi >= 0) {
          const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
          const next = new Set(mod ? prev : []);
          for (let i = lo; i <= hi; i++) next.add(list[i]);
          return next;
        }
      }
      if (mod) {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        anchor.current = { path, siblings };
        return next;
      }
      // Plain click: replace selection.
      anchor.current = { path, siblings };
      return new Set([path]);
    });
  }, []);

  const selectOnly = useCallback((path: string) => {
    anchor.current = { path, siblings: [path] };
    setSelected(new Set([path]));
  }, []);

  const clear = useCallback(() => {
    anchor.current = null;
    setSelected(new Set());
  }, []);

  const ctx = useMemo<SelectionCtx>(
    () => ({
      selected,
      isSelected: (p) => selected.has(p),
      click,
      selectOnly,
      clear,
    }),
    [selected, click, selectOnly, clear]
  );

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  async function handleDelete(c: ConfirmState) {
    setConfirm(null);
    const results = await deletePaths(c.paths, c.recursive).catch((e) => {
      console.error("delete failed", e);
      return [] as { path: string; ok: boolean; error: string | null }[];
    });
    const deleted = new Set(results.filter((r) => r.ok).map((r) => r.path));
    const failed = results.filter((r) => !r.ok);

    // Close any open tabs whose file was deleted (best-effort: also try
    // to close tabs for files inside a deleted directory).
    const { tabs } = useAppStore.getState();
    for (const t of tabs) {
      const matches =
        deleted.has(t.path) ||
        c.paths.some(
          (p) =>
            deleted.has(p) &&
            t.path.toLowerCase().startsWith(p.toLowerCase() + "\\")
        );
      if (!matches) continue;
      try {
        if (t.tailing) await stopTail(t.id);
        await closeFile(t.id);
      } catch {
        /* ignore */
      }
      clearFileCache(t.id);
      useAppStore.getState().removeTab(t.id);
    }

    // Refresh the parent directory listing so the row disappears.
    c.afterRefresh?.();

    // Drop deleted paths from the selection.
    if (deleted.size > 0) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const p of deleted) next.delete(p);
        return next;
      });
    }

    if (failed.length > 0) {
      // Surface failures via a simple alert — rare path, used so the user
      // doesn't silently think the file was deleted when it wasn't (e.g.
      // permission denied, read-only, in use by another process despite
      // our shared open).
      const msg = failed
        .map((f) => `• ${f.path}\n   ${f.error}`)
        .join("\n");
      alert(`Could not delete ${failed.length} item(s):\n\n${msg}`);
    }
  }

  // Status epoch — bumps periodically so expanded folders merge
  // new/deleted files and update file status (size, modified time, etc.)
  // without re-sorting. Interval is user-configurable (default 5 s).
  const [statusEpoch, setStatusEpoch] = useState(0);
  const fileStatusRefreshIntervalSec = useSettingsStore(
    (s) => s.fileStatusRefreshIntervalSec
  );
  useEffect(() => {
    const sec = Math.max(1, fileStatusRefreshIntervalSec ?? 5);
    const id = window.setInterval(
      () => setStatusEpoch((n) => n + 1),
      sec * 1000
    );
    return () => window.clearInterval(id);
  }, [fileStatusRefreshIntervalSec]);

  // Sort epoch — bumps periodically to trigger a full re-sort
  // by modified time. Interval is user-configurable (default 60 s).
  const [sortEpoch, setSortEpoch] = useState(0);
  const fileSortIntervalSec = useSettingsStore(
    (s) => s.fileSortIntervalSec
  );
  useEffect(() => {
    const sec = Math.max(5, fileSortIntervalSec ?? 60);
    const id = window.setInterval(
      () => setSortEpoch((n) => n + 1),
      sec * 1000
    );
    return () => window.clearInterval(id);
  }, [fileSortIntervalSec]);

  // Tell the backend which workspace folders to watch for file add/delete.
  const recentFolders = useRecentStore((s) => s.folders);
  useEffect(() => {
    const paths = recentFolders.map((f) => f.path);
    if (paths.length === 0) return;
    invoke("watch_workspace_folders", { paths }).catch((e: unknown) =>
      console.error("LogMaster: failed to set workspace watchers:", e)
    );
  }, [recentFolders]);

  // Listen for real-time fs-change events from the backend watcher.
  // When a file is added/deleted, bump statusEpoch so all expanded
  // folders merge changes immediately (instead of waiting for the timer).
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    listen<{ dir_path: string }>("fs-change", () => {
      setStatusEpoch((n) => n + 1);
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });
    return () => {
      unlistenFn?.();
    };
  }, []);

  return (
    <SelectionContext.Provider value={ctx}>
      <StatusEpochContext.Provider value={statusEpoch}>
        <SortEpochContext.Provider value={sortEpoch}>
        <aside
          className="h-full flex flex-col bg-bg-panel text-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) clear();
          }}
        >
          <header className="flex items-center gap-1 px-2 h-9 border-b border-border shrink-0">
            <FolderOpen className="w-4 h-4 text-brand" />
            <span className="text-sm font-semibold text-fg">Explorer</span>
            {selected.size > 1 && (
              <span className="ml-auto text-[10px] text-brand tabular-nums">
                {selected.size} selected
              </span>
            )}
          </header>

          <div className="flex-1 overflow-auto">
            <OpenFilesSection />
            <FoldersSection
              onContextMenu={setMenu}
              onOpenInBrowser={onOpenFolderBrowser}
              onRequestDelete={setConfirm}
            />
          </div>

          <FileContextMenu
            target={menu}
            onClose={() => setMenu(null)}
            selectionPaths={Array.from(selected)}
            onRequestDelete={(c) => {
              setMenu(null);
              setConfirm(c);
            }}
          />

          <ConfirmDialog
            state={confirm}
            onCancel={() => setConfirm(null)}
            onConfirm={handleDelete}
          />
        </aside>
        </SortEpochContext.Provider>
      </StatusEpochContext.Provider>
    </SelectionContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 1: Open Files                                             */
/* ------------------------------------------------------------------ */

function OpenFilesSection() {
  const tabs = useAppStore((s) => s.tabs);
  const activeId = useAppStore((s) => s.activeId);
  const setActive = useAppStore((s) => s.setActive);
  const removeTab = useAppStore((s) => s.removeTab);
  const [collapsed, setCollapsed] = useState(false);

  const addTab = useAppStore((s) => s.addTab);
  const pushFile = useRecentStore((s) => s.pushFile);
  const handleOpenFile = useCallback(async () => {
    const p = await openDialog();
    if (!p) return;
    try {
      const info = await openFile(p);
      addTab(info);
      pushFile({ path: info.path, name: info.name });
    } catch (e) {
      console.error(e);
    }
  }, [addTab, pushFile]);

  return (
    <section className="border-b border-border">
      <SectionHeader
        title="Open Files"
        count={tabs.length}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        actions={
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleOpenFile();
            }}
            className="p-0.5 rounded text-fg-subtle hover:text-fg hover:bg-bg-hover"
            title="Open file…"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
        }
      />
      {!collapsed && (
        <div className="pb-1">
          {tabs.length === 0 ? (
            <EmptyHint text="No open files. Ctrl+O to open." />
          ) : (
            tabs.map((t) => (
              <div
                key={t.id}
                onClick={() => setActive(t.id)}
                className={cn(
                  "group flex items-center gap-1.5 pl-5 pr-2 py-0.5 cursor-pointer select-none",
                  t.id === activeId
                    ? "bg-brand/20 text-fg"
                    : "text-fg-muted hover:bg-bg-hover hover:text-fg"
                )}
                title={t.path}
              >
                <FileText className="w-3.5 h-3.5 shrink-0 text-fg-subtle" />
                <span className="flex-1 truncate text-xs">{t.name}</span>
                {t.tailing && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                    title="tailing"
                  />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(t.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover hover:text-danger text-fg-subtle"
                  title="Close tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 2: Folders (tree)                                         */
/* ------------------------------------------------------------------ */

interface FoldersSectionProps {
  onContextMenu: (m: MenuState) => void;
  onOpenInBrowser?: (path: string) => void;
  onRequestDelete: (c: ConfirmState) => void;
}

function FoldersSection({
  onContextMenu,
  onOpenInBrowser,
  onRequestDelete,
}: FoldersSectionProps) {
  const folders = useRecentStore((s) => s.folders);
  const removeFolder = useRecentStore((s) => s.removeFolder);
  const pushFolder = useRecentStore((s) => s.pushFolder);
  const [collapsed, setCollapsed] = useState(false);

  const handleAddFolder = useCallback(async () => {
    const p = await openFolderDialog();
    if (!p) return;
    const name = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
    pushFolder({ path: p, name });
  }, [pushFolder]);

  return (
    <section>
      <SectionHeader
        title="Folders"
        count={folders.length}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        actions={
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleAddFolder();
            }}
            className="p-0.5 rounded text-fg-subtle hover:text-fg hover:bg-bg-hover"
            title="Add folder to workspace"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        }
      />
      {!collapsed && (
        <div className="pb-2">
          {folders.length === 0 ? (
            <EmptyHint text="No folders. Click + to add one." />
          ) : (
            folders.map((f) => (
              <FolderTreeNode
                key={f.path}
                path={f.path}
                name={f.name}
                depth={0}
                isRoot
                onRemoveRoot={() => removeFolder(f.path)}
                onOpenInBrowser={onOpenInBrowser}
                onContextMenu={onContextMenu}
                onRequestDelete={onRequestDelete}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Tree node                                                          */
/* ------------------------------------------------------------------ */

interface FolderNodeProps {
  path: string;
  name: string;
  depth: number;
  isRoot?: boolean;
  onRemoveRoot?: () => void;
  onOpenInBrowser?: (path: string) => void;
  onContextMenu: (m: MenuState) => void;
  onRequestDelete: (c: ConfirmState) => void;
}

function FolderTreeNode({
  path,
  name,
  depth,
  isRoot = false,
  onRemoveRoot,
  onOpenInBrowser,
  onContextMenu,
  onRequestDelete,
}: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<DirEntryInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusEpoch = useContext(StatusEpochContext);
  const sortEpoch = useContext(SortEpochContext);

  // Track if a refresh is already in flight to coalesce overlapping ticks.
  const inflight = useRef(false);

  const load = useCallback(
    async (silent = false, replace = false, force = false) => {
      if (inflight.current && !force) return;
      inflight.current = true;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const es = await listDir(path);
        if (replace || entries === null) {
          // Full replace: re-sort by modified time.
          setEntries(es);
        } else {
          // Merge: preserve order of existing entries, append new ones.
          setEntries((prev) => {
            if (prev === null) return es;
            const prevPaths = new Set(prev.map((e) => e.path));
            const newPaths = new Set(es.map((e) => e.path));
            const kept = prev.filter((e) => newPaths.has(e.path));
            const added = es.filter((e) => !prevPaths.has(e.path));
            return [...kept, ...added];
          });
        }
        if (!silent) setError(null);
      } catch (e) {
        // Background refresh shouldn't replace good entries with an error.
        if (!silent) setError(String(e));
      } finally {
        inflight.current = false;
        if (!silent) setLoading(false);
      }
    },
    [path, entries]
  );

  // Initial load on first expand (full replace).
  useEffect(() => {
    if (expanded && entries === null && !loading) {
      load(false, true);
    }
  }, [expanded, entries, loading, load]);

  // Periodic background refresh — merge mode (don't re-sort).
  useEffect(() => {
    if (!expanded || entries === null) return;
    load(true, false);
      }, [statusEpoch, expanded, load]);

  // Sort timer — full replace with re-sort by modified time.
  useEffect(() => {
    if (!expanded || entries === null) return;
    load(true, true);
  }, [sortEpoch, expanded, load]);

  // Children files in display order — used as siblings for shift-range.
  const fileSiblings = useMemo(
    () => (entries ?? []).filter((e) => !e.is_dir).map((e) => e.path),
    [entries]
  );

  /**
   * Recursively walk the directory tree starting at `path` and collect
   * every regular-file path. Subdirectories are descended into so that
   * "clear directory" really empties the folder, but we never include
   * directory paths themselves — the folder skeleton is preserved.
   *
   * Errors on individual subdirs are swallowed (best-effort); the user
   * sees per-file failures via the post-delete summary alert.
   */
  const collectAllFiles = useCallback(
    async (root: string): Promise<string[]> => {
      const out: string[] = [];
      const stack: string[] = [root];
      while (stack.length > 0) {
        const dir = stack.pop()!;
        let es: DirEntryInfo[] = [];
        try {
          es = await listDir(dir);
        } catch {
          continue;
        }
        for (const e of es) {
          if (e.is_dir) stack.push(e.path);
          else out.push(e.path);
        }
      }
      return out;
    },
    []
  );

  const handleClear = useCallback(async () => {
    const files = await collectAllFiles(path);
    if (files.length === 0) {
      // Nothing to do — show a hint via the dialog so the user gets
      // explicit feedback rather than a silent no-op.
      onRequestDelete({
        paths: [],
        recursive: false,
        summary: `Folder "${name}" contains no files to delete.`,
        afterRefresh: () => load(false, true),
      });
      return;
    }
    onRequestDelete({
      paths: files,
      recursive: false,
      summary: `Delete ALL ${files.length} file(s) inside "${name}"? The folder itself will be kept.`,
      afterRefresh: () => load(false, true),
    });
  }, [collectAllFiles, path, name, onRequestDelete, load]);

  function handleContext(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu({
      x: e.clientX,
      y: e.clientY,
      paths: [],
      primary: path,
      isFolder: true,
      isRoot,
      onRefresh: () => load(false, true, true),
      onRemoveRoot: isRoot ? onRemoveRoot : undefined,
      onReveal: onOpenInBrowser,
    });
  }

  return (
    <div>
      <FolderRow
        name={name}
        depth={depth}
        expanded={expanded}
        isRoot={isRoot}
        loading={loading}
        onClick={() => setExpanded((v) => !v)}
        onContextMenu={handleContext}
        onRefresh={() => load(false, true, true)}
        onRemoveRoot={onRemoveRoot}
        onClear={handleClear}
        title={path}
      />
      {expanded && (
        <div>
          {error && (
            <div
              style={{ paddingLeft: indent(depth + 1) }}
              className="text-xs text-danger px-2 py-1 truncate"
              title={error}
            >
              {error}
            </div>
          )}
          {loading && !entries && (
            <div
              style={{ paddingLeft: indent(depth + 1) }}
              className="text-xs text-fg-subtle px-2 py-1"
            >
              Loading…
            </div>
          )}
          {entries && entries.length === 0 && (
            <div
              style={{ paddingLeft: indent(depth + 1) }}
              className="text-xs text-fg-subtle px-2 py-1 italic"
            >
              (empty)
            </div>
          )}
          {entries?.map((e) =>
            e.is_dir ? (
              <FolderTreeNode
                key={e.path}
                path={e.path}
                name={e.name}
                depth={depth + 1}
                onContextMenu={onContextMenu}
                onOpenInBrowser={onOpenInBrowser}
                onRequestDelete={onRequestDelete}
              />
            ) : (
              <FileNodeRow
                key={e.path}
                entry={e}
                depth={depth + 1}
                siblings={fileSiblings}
                onRefreshDir={() => load(false, true, true)}
                onContextMenu={onContextMenu}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function FolderRow({
  name,
  depth,
  expanded,
  isRoot,
  loading,
  title,
  onClick,
  onContextMenu,
  onRefresh,
  onRemoveRoot,
  onClear,
}: {
  name: string;
  depth: number;
  expanded: boolean;
  isRoot: boolean;
  loading: boolean;
  title: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRefresh: () => void;
  onRemoveRoot?: () => void;
  onClear?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={cn(
        "group flex items-center gap-1 pr-2 py-0.5 cursor-pointer select-none text-fg-muted hover:bg-bg-hover hover:text-fg",
        isRoot && "font-medium text-fg"
      )}
      style={{ paddingLeft: indent(depth) }}
    >
      <ChevronRight
        className={cn(
          "w-3 h-3 shrink-0 transition-transform",
          expanded && "rotate-90"
        )}
      />
      {expanded ? (
        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-brand" />
      ) : (
        <FolderIcon className="w-3.5 h-3.5 shrink-0 text-brand" />
      )}
      <span className="flex-1 truncate text-xs">{name}</span>
      {loading && (
        <RefreshCw className="w-3 h-3 shrink-0 animate-spin text-fg-subtle" />
      )}
      {expanded && !loading && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover text-fg-subtle"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
      {onClear && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover hover:text-danger text-fg-subtle"
          title="Delete all files inside this folder"
        >
          <Eraser className="w-3 h-3" />
        </button>
      )}
      {isRoot && onRemoveRoot && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemoveRoot();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover hover:text-danger text-fg-subtle"
          title="Remove from workspace"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function FileNodeRow({
  entry,
  depth,
  siblings,
  onRefreshDir,
  onContextMenu,
}: {
  entry: DirEntryInfo;
  depth: number;
  siblings: string[];
  onRefreshDir: () => void;
  onContextMenu: (m: MenuState) => void;
}) {
  const sel = useSelection();
  const tabs = useAppStore((s) => s.tabs);
  const setActive = useAppStore((s) => s.setActive);
  const addTab = useAppStore((s) => s.addTab);
  const pushFile = useRecentStore((s) => s.pushFile);
  const [busy, setBusy] = useState(false);

  const alreadyOpenId = useMemo(
    () => tabs.find((t) => t.path === entry.path)?.id,
    [tabs, entry.path]
  );
  const isSelected = sel.isSelected(entry.path);

  const open = useCallback(async () => {
    if (alreadyOpenId) {
      setActive(alreadyOpenId);
      return;
    }
    setBusy(true);
    try {
      const info = await openFile(entry.path);
      addTab(info);
      pushFile({ path: info.path, name: info.name });
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [alreadyOpenId, setActive, entry.path, entry.name, addTab, pushFile]);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    sel.click(entry.path, siblings, {
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
    });
  }

  function handleContext(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicking a row that isn't currently in the selection, replace
    // selection with just that row (matches OS file-manager UX).
    let paths = Array.from(sel.selected);
    if (!isSelected) {
      sel.selectOnly(entry.path);
      paths = [entry.path];
    }
    onContextMenu({
      x: e.clientX,
      y: e.clientY,
      paths,
      primary: entry.path,
      isFolder: false,
      isRoot: false,
      onRefresh: onRefreshDir,
    });
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={open}
      onContextMenu={handleContext}
      title={`${entry.path}\n${formatRelativeTime(entry.modified)}`}
      className={cn(
        "group flex items-center gap-1 pr-2 py-0.5 cursor-pointer select-none",
        isSelected
          ? "bg-brand/25 text-fg"
          : alreadyOpenId
          ? "text-fg bg-brand/10"
          : "text-fg-muted hover:bg-bg-hover hover:text-fg"
      )}
      style={{ paddingLeft: indent(depth) }}
    >
      {/* Invisible chevron slot keeps file names aligned with sibling folders */}
      <span className="w-3 h-3 shrink-0" />
      <FileText
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          alreadyOpenId ? "text-brand" : "text-fg-subtle"
        )}
      />
      <span className="flex-1 truncate text-xs">{entry.name}</span>
      {busy ? (
        <RefreshCw className="w-3 h-3 shrink-0 animate-spin text-fg-subtle" />
      ) : (
        <span className="text-[10px] text-fg-subtle tabular-nums shrink-0">
          {formatRelativeTime(entry.modified)}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Context menu                                                       */
/* ------------------------------------------------------------------ */

function FileContextMenu({
  target,
  onClose,
  selectionPaths,
  onRequestDelete,
}: {
  target: MenuState | null;
  onClose: () => void;
  /** Authoritative current selection — used because target may be stale */
  selectionPaths: string[];
  onRequestDelete: (c: ConfirmState) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const addTab = useAppStore((s) => s.addTab);
  const setActive = useAppStore((s) => s.setActive);
  const tabs = useAppStore((s) => s.tabs);
  const pushFile = useRecentStore((s) => s.pushFile);
  const removeFolder = useRecentStore((s) => s.removeFolder);

  useEffect(() => {
    if (!target) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [target, onClose]);

  if (!target) return null;

  // Use the latest selection if we right-clicked on a file row.
  const paths = target.isFolder
    ? []
    : selectionPaths.length > 0
    ? selectionPaths
    : [target.primary];
  const single = paths.length === 1 ? paths[0] : null;
  const multi = paths.length > 1;

  async function openOne(p: string) {
    const existing = tabs.find((t) => t.path === p);
    if (existing) {
      setActive(existing.id);
      return;
    }
    try {
      const info = await openFile(p);
      addTab(info);
      pushFile({ path: info.path, name: info.name });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleOpenAll() {
    onClose();
    // Sequential to keep the order in tabs predictable.
    for (const p of paths) {
      // eslint-disable-next-line no-await-in-loop
      await openOne(p);
    }
  }

  function copyPaths() {
    onClose();
    const text = paths.length > 0 ? paths.join("\n") : target?.primary ?? "";
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }

  function reveal() {
    onClose();
    if (target?.onReveal && target.primary) {
      // Find directory: if primary is a folder, reveal itself; if file,
      // reveal its parent.
      const p = target.isFolder
        ? target.primary
        : target.primary.replace(/[\\/][^\\/]*$/, "");
      target.onReveal(p);
    }
  }

  // Clamp inside viewport
  const W = 240;
  const itemCount = (target.isFolder ? 6 : multi ? 6 : 7) + 1;
  const H = itemCount * 30 + 16;
  const left = Math.min(target.x, window.innerWidth - W - 8);
  const top = Math.min(target.y, window.innerHeight - H - 8);

  return (
    <div
      ref={ref}
      className="fixed z-[70] min-w-[240px] py-1 bg-bg-panel border border-border rounded-md shadow-2xl"
      style={{ left, top }}
      role="menu"
    >
      {/* Folder-row menu */}
      {target.isFolder && (
        <>
          <MenuItem
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => {
              onClose();
              target.onRefresh?.();
            }}
          >
            Refresh
          </MenuItem>
          {target.onReveal && (
            <MenuItem
              icon={<ExternalLink className="w-4 h-4" />}
              onClick={reveal}
            >
              Open in folder browser…
            </MenuItem>
          )}
          <MenuItem
            icon={<Copy className="w-4 h-4" />}
            onClick={copyPaths}
          >
            Copy path
          </MenuItem>
          {target.isRoot && target.onRemoveRoot && (
            <>
              <Divider />
              <MenuItem
                icon={<Trash2 className="w-4 h-4 text-danger" />}
                danger
                onClick={() => {
                  onClose();
                  target.onRemoveRoot?.();
                }}
              >
                Remove from workspace
              </MenuItem>
            </>
          )}
          {!target.isRoot && (
            <>
              <Divider />
              <MenuItem
                icon={<Trash2 className="w-4 h-4 text-danger" />}
                danger
                onClick={() => {
                  const folderName =
                    target.primary.split(/[\\/]/).pop() ?? target.primary;
                  onRequestDelete({
                    paths: [target.primary],
                    recursive: true,
                    summary: `Delete folder "${folderName}" and ALL its contents?`,
                    afterRefresh: target.onRefresh,
                  });
                }}
              >
                Delete folder…
              </MenuItem>
            </>
          )}
        </>
      )}

      {/* File-row menu */}
      {!target.isFolder && (
        <>
          {multi ? (
            <MenuItem
              icon={<FolderOpen className="w-4 h-4" />}
              shortcut={`× ${paths.length}`}
              onClick={handleOpenAll}
            >
              Open all
            </MenuItem>
          ) : (
            <MenuItem
              icon={<FolderOpen className="w-4 h-4" />}
              shortcut="Dbl-click"
              onClick={() => {
                onClose();
                if (single) openOne(single);
              }}
            >
              Open
            </MenuItem>
          )}
          {single && target.onReveal && (
            <MenuItem
              icon={<ExternalLink className="w-4 h-4" />}
              onClick={reveal}
            >
              Reveal in folder browser…
            </MenuItem>
          )}
          <MenuItem
            icon={<Copy className="w-4 h-4" />}
            onClick={copyPaths}
          >
            {multi ? `Copy ${paths.length} paths` : "Copy path"}
          </MenuItem>
          <MenuItem
            icon={<Pin className="w-4 h-4" />}
            onClick={() => {
              onClose();
              for (const p of paths) {
                const name = p.split(/[\\/]/).pop() ?? p;
                pushFile({ path: p, name });
              }
            }}
          >
            {multi ? "Add to recent" : "Add to recent"}
          </MenuItem>
          <Divider />
          <MenuItem
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => {
              onClose();
              target.onRefresh?.();
            }}
          >
            Refresh
          </MenuItem>
          <MenuItem
            icon={<Trash2 className="w-4 h-4 text-danger" />}
            shortcut="Del"
            danger
            onClick={() => {
              const summary =
                paths.length === 1
                  ? `Delete "${paths[0].split(/[\\/]/).pop()}"?`
                  : `Delete ${paths.length} files?`;
              onRequestDelete({
                paths,
                recursive: false,
                summary,
                afterRefresh: target.onRefresh,
              });
            }}
          >
            {multi ? `Delete ${paths.length} files…` : "Delete…"}
          </MenuItem>
        </>
      )}
    </div>
  );

  function MenuItem({
    children,
    icon,
    shortcut,
    onClick,
    danger,
  }: {
    children: React.ReactNode;
    icon: React.ReactNode;
    shortcut?: string;
    onClick: () => void;
    danger?: boolean;
  }) {
    void removeFolder;
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-sm",
          danger ? "text-danger" : "text-fg",
          "hover:bg-bg-hover focus:bg-bg-hover focus:outline-none cursor-pointer"
        )}
      >
        <span className={danger ? "text-danger" : "text-fg-muted"}>{icon}</span>
        <span className="flex-1 text-left truncate">{children}</span>
        {shortcut && (
          <kbd className="text-xs text-fg-subtle px-1.5 py-0.5 rounded bg-bg-elevated border border-border">
            {shortcut}
          </kbd>
        )}
      </button>
    );
  }

  function Divider() {
    return <div className="my-1 h-px bg-border" />;
  }
}

/* ------------------------------------------------------------------ */
/*  Shared bits                                                        */
/* ------------------------------------------------------------------ */

function SectionHeader({
  title,
  count,
  collapsed,
  onToggle,
  actions,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div
      onClick={onToggle}
      className="sticky top-0 z-[1] flex items-center gap-1 px-2 py-1 bg-bg-panel cursor-pointer select-none text-fg-subtle hover:text-fg"
    >
      <ChevronRight
        className={cn(
          "w-3 h-3 shrink-0 transition-transform",
          !collapsed && "rotate-90"
        )}
      />
      <span className="text-[11px] uppercase tracking-wider font-semibold">
        {title}
      </span>
      <span className="text-[10px] text-fg-subtle tabular-nums">({count})</span>
      <div className="flex-1" />
      {actions}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="px-5 py-1.5 text-[11px] text-fg-subtle italic">{text}</div>
  );
}

function indent(depth: number) {
  return `${8 + depth * 12}px`;
}

/* ------------------------------------------------------------------ */
/*  Delete confirmation dialog                                         */
/* ------------------------------------------------------------------ */

function ConfirmDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState | null;
  onCancel: () => void;
  onConfirm: (c: ConfirmState) => void;
}) {
  // Escape closes; Enter confirms.
  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm(state!);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onCancel, onConfirm]);

  if (!state) return null;

  // Cap the preview list so dialogs stay manageable for huge selections.
  const previewLimit = 8;
  const previewPaths = state.paths.slice(0, previewLimit);
  const overflow = state.paths.length - previewPaths.length;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] max-w-[92vw] bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden"
        role="alertdialog"
      >
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-danger" />
          <span className="text-sm font-semibold text-fg">Confirm delete</span>
        </div>
        <div className="px-4 py-3 text-sm text-fg">
          <div>{state.summary}</div>
          <div className="mt-2 text-xs text-fg-subtle">
            This action is permanent and cannot be undone.
          </div>
          {state.paths.length > 0 && (
            <ul className="mt-3 max-h-[180px] overflow-auto text-xs font-mono text-fg-muted bg-bg/40 border border-border rounded p-2 space-y-0.5">
              {previewPaths.map((p) => (
                <li key={p} className="truncate" title={p}>
                  {p}
                </li>
              ))}
              {overflow > 0 && (
                <li className="text-fg-subtle italic">
                  …and {overflow} more
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-border bg-bg/40">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded text-fg-muted hover:text-fg hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onConfirm(state)}
            className="px-3 py-1.5 text-sm rounded bg-danger/15 text-danger hover:bg-danger hover:text-white border border-danger/40 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
