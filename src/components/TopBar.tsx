import {
  Bookmark,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  ChevronDown as ChevDown,
  Command as CommandIcon,
  FileX,
  FolderOpen,
  FolderTree,
  History,
  Minus,
  PanelLeft,
  Radio,
  RadioTower,
  Regex,
  Search,
  Settings,
  Settings2,
  Square,
  Copy as RestoreIcon,
  Trash2,
  Globe,
  WholeWord,
  WrapText,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
  Eraser,
} from "lucide-react";
import {
  Dropdown,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Submenu,
} from "./DropdownMenu";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/app";
import { useRecentStore } from "../store/recent";
import { useSettingsStore } from "../store/settings";
import { openDialog, openFolderDialog } from "../lib/dialog";
import {
  closeFile,
  openFile,
  startTail,
  stopTail,
} from "../lib/ipc";
import {
  closeWindow,
  isMaximized,
  minimizeWindow,
  onResizeListen,
  toggleMaximize,
} from "../lib/window";
import { clearFileCache } from "./LogView";
import { cn } from "../lib/utils";

interface Props {
  onOpenSettings: () => void;
  onOpenFolderBrowser: (path: string) => void;
  onOpenCmd: () => void;
  onToggleRules: () => void;
  onToggleBookmarks: () => void;
  onToggleLeft: () => void;
  leftOpen: boolean;
  hitCount: number;
  hitIndex: number;
  onPrevHit: () => void;
  onNextHit: () => void;
  hasShowOnlyFilter: boolean;
  onClearShowOnly: () => void;
  hasBaseLine: boolean;
  onClearView: () => void;
}

export function TopBar({
  onOpenSettings,
  onOpenFolderBrowser,
  onOpenCmd,
  onToggleRules,
  onToggleBookmarks,
  onToggleLeft,
  leftOpen,
  hitCount,
  hitIndex,
  onPrevHit,
  onNextHit,
  hasShowOnlyFilter,
  onClearShowOnly,
  hasBaseLine,
  onClearView,
}: Props) {
  const {
    addTab,
    tabs,
    activeId,
    updateTab,
    removeTab,
    searchQuery,
    setSearch,
    searchIsRegex,
    setSearchRegex,
    searchCaseSensitive,
    setSearchCase,
    searchWholeWord,
    setSearchWholeWord,
  } = useAppStore();
  const recent = useRecentStore();
  const { fontSize, wordWrap, set: setSetting } = useSettingsStore();

  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    isMaximized().then(setMaximized).catch(() => {});
    let unlisten: (() => void) | undefined;
    onResizeListen(() => {
      isMaximized().then(setMaximized).catch(() => {});
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const active = tabs.find((t) => t.id === activeId);

  async function doOpenFile() {
    const p = await openDialog();
    if (!p) return;
    await openByPath(p);
  }

  async function openByPath(path: string) {
    try {
      const info = await openFile(path);
      addTab(info);
      recent.pushFile({ path: info.path, name: info.name });
    } catch (e) {
      console.error(e);
      alert(`Failed to open: ${e}`);
    }
  }

  async function doOpenFolder() {
    const p = await openFolderDialog();
    if (!p) return;
    const name = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
    recent.pushFolder({ path: p, name });
    onOpenFolderBrowser(p);
  }

  async function doCloseFile() {
    if (!active) return;
    try {
      if (active.tailing) await stopTail(active.id);
      await closeFile(active.id);
    } catch {
      /* ignore */
    }
    clearFileCache(active.id);
    removeTab(active.id);
  }

  async function doCloseAll() {
    for (const t of [...tabs]) {
      try {
        if (t.tailing) await stopTail(t.id);
        await closeFile(t.id);
      } catch {
        /* ignore */
      }
      clearFileCache(t.id);
      removeTab(t.id);
    }
  }

  async function handleToggleTail() {
    if (!active) return;
    try {
      if (active.tailing) {
        await stopTail(active.id);
        updateTab(active.id, { tailing: false, followTail: false });
      } else {
        await startTail(active.id);
        updateTab(active.id, { tailing: true, followTail: true });
      }
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="flex items-center h-9 px-2 bg-bg-panel border-b border-border gap-1 select-none">
      {/* Brand (drag region) */}
      <div
        className="flex items-center gap-1.5 px-1.5 mr-1 shrink-0"
        data-tauri-drag-region
      >
        <Zap className="w-4 h-4 text-accent" />
        <span className="text-sm font-semibold text-fg">LogMaster</span>
      </div>

      {/* Toggle file explorer */}
      <ToggleBtn
        active={leftOpen}
        onClick={onToggleLeft}
        title="Toggle file explorer (Ctrl+B)"
      >
        <PanelLeft className="w-4 h-4" />
      </ToggleBtn>

      {/* File menu */}
      <Dropdown
        trigger={
          <button className="px-2 py-1 text-sm text-fg-muted hover:text-fg hover:bg-bg-hover rounded transition-colors cursor-pointer flex items-center gap-1">
            File <ChevronDown className="w-3 h-3" />
          </button>
        }
      >
        <MenuItem
          icon={<FolderOpen className="w-4 h-4" />}
          shortcut="Ctrl+O"
          onSelect={doOpenFile}
        >
          Open File…
        </MenuItem>
        <MenuItem
          icon={<FolderTree className="w-4 h-4" />}
          onSelect={doOpenFolder}
        >
          Open Folder…
        </MenuItem>
        <Submenu label="Open Recent" icon={<History className="w-4 h-4" />}>
          {recent.files.length === 0 && recent.folders.length === 0 && (
            <div className="px-3 py-2 text-xs text-fg-subtle">
              No recent items
            </div>
          )}
          {recent.files.length > 0 && <MenuLabel>Files</MenuLabel>}
          {recent.files.slice(0, 10).map((r) => (
            <MenuItem
              key={"f-" + r.path}
              icon={<FolderOpen className="w-4 h-4" />}
              onSelect={() => openByPath(r.path)}
            >
              <span className="truncate">{r.name}</span>
              <span className="text-fg-subtle text-xs ml-2 truncate">
                {short(r.path)}
              </span>
            </MenuItem>
          ))}
          {recent.folders.length > 0 && <MenuLabel>Folders</MenuLabel>}
          {recent.folders.slice(0, 10).map((r) => (
            <MenuItem
              key={"d-" + r.path}
              icon={<FolderTree className="w-4 h-4" />}
              onSelect={() => onOpenFolderBrowser(r.path)}
            >
              <span className="truncate">{r.name}</span>
              <span className="text-fg-subtle text-xs ml-2 truncate">
                {short(r.path)}
              </span>
            </MenuItem>
          ))}
          {(recent.files.length > 0 || recent.folders.length > 0) && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 className="w-4 h-4" />}
                onSelect={() => recent.clear()}
              >
                Clear Recent
              </MenuItem>
            </>
          )}
        </Submenu>
        <MenuSeparator />
        <MenuItem
          icon={<X className="w-4 h-4" />}
          shortcut="Ctrl+W"
          disabled={!active}
          onSelect={doCloseFile}
        >
          Close File
        </MenuItem>
        <MenuItem
          icon={<FileX className="w-4 h-4" />}
          disabled={tabs.length === 0}
          onSelect={doCloseAll}
        >
          Close All
        </MenuItem>
      </Dropdown>

      {/* Settings as icon-only button */}
      <button
        type="button"
        onClick={onOpenSettings}
        title="Preferences (Ctrl+,)"
        className="px-2 h-7 rounded text-sm text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors cursor-pointer flex items-center gap-1"
      >
        <Settings className="w-4 h-4" />
      </button>

      <Sep />

      {/* Search (wider) */}
      <div className="flex items-center gap-0.5 flex-1 min-w-[280px]">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            className="input w-full pl-7 pr-16 h-7"
            placeholder="Find in file... (Ctrl+F)"
            data-role="search-input"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.shiftKey) onPrevHit();
                else onNextHit();
              } else if (e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {searchQuery && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-subtle tabular-nums">
              {hitCount === 0 ? "0/0" : `${hitIndex + 1}/${hitCount}`}
            </span>
          )}
        </div>
        <IconBtn onClick={onPrevHit} disabled={hitCount === 0} title="Previous match (Shift+Enter)">
          <ChevronUp className="w-4 h-4" />
        </IconBtn>
        <IconBtn onClick={onNextHit} disabled={hitCount === 0} title="Next match (Enter / F3)">
          <ChevDown className="w-4 h-4" />
        </IconBtn>
        <ToggleBtn
          active={searchCaseSensitive}
          onClick={() => setSearchCase(!searchCaseSensitive)}
          title="Match case (Alt+C)"
        >
          <CaseSensitive className="w-4 h-4" />
        </ToggleBtn>
        <ToggleBtn
          active={searchWholeWord}
          onClick={() => setSearchWholeWord(!searchWholeWord)}
          title="Match whole word (Alt+W)"
        >
          <WholeWord className="w-4 h-4" />
        </ToggleBtn>
        <ToggleBtn
          active={searchIsRegex}
          onClick={() => setSearchRegex(!searchIsRegex)}
          title="Use regular expression (Alt+R)"
        >
          <Regex className="w-4 h-4" />
        </ToggleBtn>
      </div>

      <Sep />

      <ToggleBtn
        active={hasBaseLine}
        onClick={onClearView}
        disabled={!active}
        title={
          hasBaseLine
            ? "View cleared — click to restore from file top"
            : "Clear view — hide everything above the last visible line"
        }
        label="Clear"
      >
        <Eraser className="w-4 h-4" />
      </ToggleBtn>

      <ToggleBtn
        active={!!active?.tailing}
        onClick={handleToggleTail}
        disabled={!active}
        title="Toggle tail (live follow)"
        label="Tail"
        accent={active?.tailing ? "accent" : undefined}
      >
        {active?.tailing ? (
          <RadioTower className="w-4 h-4" />
        ) : (
          <Radio className="w-4 h-4" />
        )}
      </ToggleBtn>

      <ToggleBtn
        active={wordWrap}
        onClick={() => setSetting("wordWrap", !wordWrap)}
        title="Word wrap"
        label="Wrap"
      >
        <WrapText className="w-4 h-4" />
      </ToggleBtn>

      <IconBtn
        onClick={() => setSetting("fontSize", Math.max(10, fontSize - 1))}
        disabled={fontSize <= 10}
        title={`Decrease font size (current: ${fontSize}px)`}
      >
        <ZoomOut className="w-4 h-4" />
      </IconBtn>

      <IconBtn
        onClick={() => setSetting("fontSize", Math.min(24, fontSize + 1))}
        disabled={fontSize >= 24}
        title={`Increase font size (current: ${fontSize}px)`}
      >
        <ZoomIn className="w-4 h-4" />
      </IconBtn>

      <IconBtn onClick={onToggleBookmarks} title="Bookmarks">
        <Bookmark className="w-4 h-4" />
      </IconBtn>

      <IconBtn
        onClick={onClearShowOnly}
        disabled={!hasShowOnlyFilter}
        title="Show all lines — turn off every 'Show only' filter"
      >
        <Globe className="w-4 h-4" />
      </IconBtn>

      <IconBtn onClick={onToggleRules} title="Highlight & filter rules" label="Rules">
        <Settings2 className="w-4 h-4" />
      </IconBtn>

      <IconBtn onClick={onOpenCmd} title="Command palette (Ctrl+Shift+P)">
        <CommandIcon className="w-4 h-4" />
      </IconBtn>

      {/* Drag region filler — also lets the user grab between the right group
          and the window controls. */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* Window controls */}
      <div className="flex items-center -mr-2">
        <WinBtn onClick={() => minimizeWindow()} title="Minimize">
          <Minus className="w-3.5 h-3.5" />
        </WinBtn>
        <WinBtn onClick={() => toggleMaximize()} title={maximized ? "Restore" : "Maximize"}>
          {maximized ? (
            <RestoreIcon className="w-3 h-3" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </WinBtn>
        <WinBtn onClick={() => closeWindow()} title="Close" danger>
          <X className="w-3.5 h-3.5" />
        </WinBtn>
      </div>
    </div>
  );
}

function WinBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "w-11 h-9 flex items-center justify-center transition-colors cursor-pointer text-fg-muted",
        danger ? "hover:bg-danger hover:text-white" : "hover:bg-bg-hover hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="h-5 w-px bg-border mx-0.5 shrink-0" />;
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "shrink-0 flex items-center gap-1 px-2 h-7 rounded text-sm transition-colors cursor-pointer",
        "text-fg-muted hover:text-fg hover:bg-bg-hover",
        "disabled:text-fg-subtle disabled:hover:bg-transparent disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      )}
    >
      {children}
      {label && <span>{label}</span>}
    </button>
  );
}

function ToggleBtn({
  children,
  onClick,
  title,
  active,
  disabled,
  label,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  active: boolean;
  disabled?: boolean;
  label?: string;
  accent?: "accent";
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "shrink-0 flex items-center gap-1 px-2 h-7 rounded text-sm transition-colors cursor-pointer",
        active
          ? accent === "accent"
            ? "bg-accent/15 text-accent"
            : "bg-brand/15 text-brand"
          : "text-fg-muted hover:text-fg hover:bg-bg-hover",
        "disabled:text-fg-subtle disabled:hover:bg-transparent disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      )}
    >
      {children}
      {label && <span>{label}</span>}
    </button>
  );
}

function short(p: string): string {
  if (p.length <= 36) return p;
  return "…" + p.slice(p.length - 33);
}
