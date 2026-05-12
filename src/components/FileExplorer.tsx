import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  X,
  FilePlus,
} from "lucide-react";
import { listDir, openFile, type DirEntryInfo } from "../lib/ipc";
import { openDialog, openFolderDialog } from "../lib/dialog";
import { useAppStore } from "../store/app";
import { useRecentStore } from "../store/recent";
import { cn } from "../lib/utils";

/* ------------------------------------------------------------------ */
/*  Left-side File Explorer                                           */
/*                                                                    */
/*  Two sections:                                                     */
/*   1. "Open Files"  — current tabs, click to activate               */
/*   2. "Folders"     — persistent folder roots, tree expand/collapse */
/*                                                                    */
/*  All tree state is local (per LogMaster session). Folder roots     */
/*  themselves persist via useRecentStore.                             */
/* ------------------------------------------------------------------ */

export function FileExplorer() {
  return (
    <aside className="h-full flex flex-col bg-bg-panel text-sm">
      <header className="flex items-center gap-1 px-2 h-9 border-b border-border shrink-0">
        <FolderOpen className="w-4 h-4 text-brand" />
        <span className="text-sm font-semibold text-fg">Explorer</span>
      </header>

      <div className="flex-1 overflow-auto">
        <OpenFilesSection />
        <FoldersSection />
      </div>
    </aside>
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

function FoldersSection() {
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
}

function FolderTreeNode({
  path,
  name,
  depth,
  isRoot = false,
  onRemoveRoot,
}: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<DirEntryInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const es = await listDir(path);
      // Folders first, then files; each alphabetic.
      es.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(es);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (expanded && entries === null && !loading) {
      load();
    }
  }, [expanded, entries, loading, load]);

  return (
    <div>
      <FolderRow
        name={name}
        depth={depth}
        expanded={expanded}
        isRoot={isRoot}
        loading={loading}
        onClick={() => setExpanded((v) => !v)}
        onRefresh={load}
        onRemoveRoot={onRemoveRoot}
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
              />
            ) : (
              <FileNodeRow
                key={e.path}
                path={e.path}
                name={e.name}
                depth={depth + 1}
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
  onRefresh,
  onRemoveRoot,
}: {
  name: string;
  depth: number;
  expanded: boolean;
  isRoot: boolean;
  loading: boolean;
  title: string;
  onClick: () => void;
  onRefresh: () => void;
  onRemoveRoot?: () => void;
}) {
  return (
    <div
      onClick={onClick}
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
  path,
  name,
  depth,
}: {
  path: string;
  name: string;
  depth: number;
}) {
  const addTab = useAppStore((s) => s.addTab);
  const setActive = useAppStore((s) => s.setActive);
  const tabs = useAppStore((s) => s.tabs);
  const pushFile = useRecentStore((s) => s.pushFile);
  const [busy, setBusy] = useState(false);

  const alreadyOpenId = useMemo(
    () => tabs.find((t) => t.path === path)?.id,
    [tabs, path]
  );

  const open = useCallback(async () => {
    if (alreadyOpenId) {
      setActive(alreadyOpenId);
      return;
    }
    setBusy(true);
    try {
      const info = await openFile(path);
      addTab(info);
      pushFile({ path: info.path, name: info.name });
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [alreadyOpenId, setActive, path, addTab, pushFile]);

  return (
    <div
      onDoubleClick={open}
      onClick={open}
      title={path}
      className={cn(
        "flex items-center gap-1 pr-2 py-0.5 cursor-pointer select-none",
        alreadyOpenId
          ? "text-fg bg-brand/10"
          : "text-fg-muted hover:bg-bg-hover hover:text-fg"
      )}
      style={{ paddingLeft: indent(depth) }}
    >
      {/* invisible chevron slot keeps file-name alignment flush with siblings */}
      <span className="w-3 h-3 shrink-0" />
      <FileText
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          alreadyOpenId ? "text-brand" : "text-fg-subtle"
        )}
      />
      <span className="flex-1 truncate text-xs">{name}</span>
      {busy && (
        <RefreshCw className="w-3 h-3 shrink-0 animate-spin text-fg-subtle" />
      )}
    </div>
  );
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

/** 8px per depth level — compact IDE-like indentation. */
function indent(depth: number) {
  return `${8 + depth * 12}px`;
}
