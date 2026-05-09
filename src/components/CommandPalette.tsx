import { Command } from "cmdk";
import { useEffect } from "react";
import {
  FolderOpen,
  Radio,
  Settings2,
  Bookmark,
  Filter,
  X,
} from "lucide-react";
import { openDialog } from "../lib/dialog";
import { openFile, startTail, stopTail } from "../lib/ipc";
import { useAppStore } from "../store/app";

interface Props {
  open: boolean;
  onClose: () => void;
  onToggleRules: () => void;
  onToggleBookmarks: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onToggleRules,
  onToggleBookmarks,
}: Props) {
  const { addTab, tabs, activeId, updateTab, filterEnabled, setFilterEnabled } =
    useAppStore();
  const active = tabs.find((t) => t.id === activeId);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleOpen() {
    onClose();
    const p = await openDialog();
    if (!p) return;
    const info = await openFile(p);
    addTab(info);
  }

  async function handleTail() {
    onClose();
    if (!active) return;
    if (active.tailing) {
      await stopTail(active.id);
      updateTab(active.id, { tailing: false, followTail: false });
    } else {
      await startTail(active.id);
      updateTab(active.id, { tailing: true, followTail: true });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[12vh]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[90vw] bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden"
      >
        <Command label="Command palette" className="bg-transparent">
          <div className="flex items-center border-b border-border px-3">
            <Command.Input
              className="flex-1 bg-transparent outline-none py-3 text-sm text-fg placeholder:text-fg-subtle"
              placeholder="Type a command..."
              autoFocus
            />
            <button className="btn" onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <Command.List className="max-h-[360px] overflow-auto p-1">
            <Command.Empty className="px-3 py-6 text-sm text-fg-subtle text-center">
              No results.
            </Command.Empty>
            <Command.Group
              heading="Actions"
              className="text-xs text-fg-subtle px-2 py-1"
            >
              <Item
                icon={<FolderOpen className="w-4 h-4" />}
                shortcut="Ctrl+O"
                onSelect={handleOpen}
              >
                Open file…
              </Item>
              <Item
                icon={<Radio className="w-4 h-4" />}
                onSelect={handleTail}
              >
                {active?.tailing ? "Stop tail" : "Start tail (follow file)"}
              </Item>
              <Item
                icon={<Filter className="w-4 h-4" />}
                onSelect={() => {
                  onClose();
                  setFilterEnabled(!filterEnabled);
                }}
              >
                {filterEnabled ? "Disable filter view" : "Enable filter view"}
              </Item>
              <Item
                icon={<Settings2 className="w-4 h-4" />}
                onSelect={() => {
                  onClose();
                  onToggleRules();
                }}
              >
                Toggle highlight & filter rules
              </Item>
              <Item
                icon={<Bookmark className="w-4 h-4" />}
                shortcut="F2"
                onSelect={() => {
                  onClose();
                  onToggleBookmarks();
                }}
              >
                Toggle bookmarks panel
              </Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function Item({
  children,
  icon,
  shortcut,
  onSelect,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer text-sm text-fg
                 data-[selected=true]:bg-bg-hover data-[selected=true]:text-fg"
    >
      <span className="text-fg-muted">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && (
        <kbd className="text-xs text-fg-subtle px-1.5 py-0.5 rounded bg-bg-elevated border border-border">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}
