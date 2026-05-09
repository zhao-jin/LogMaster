import { Bookmark, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/app";
import { readLinesByIndices } from "../lib/ipc";

interface Props {
  open: boolean;
  onClose: () => void;
  onJump: (physLine: number) => void;
}

export function BookmarksPanel({ open, onClose, onJump }: Props) {
  const { tabs, activeId, clearBookmarks } = useAppStore();
  const active = tabs.find((t) => t.id === activeId);
  const bookmarks = active?.bookmarks ?? [];
  const [snippets, setSnippets] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !active || bookmarks.length === 0) {
      setSnippets([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await readLinesByIndices(active.id, bookmarks);
        if (!cancelled) setSnippets(r);
      } catch (e) {
        console.error("load bookmarks failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, active?.id, bookmarks]);

  if (!open) return null;

  return (
    <aside className="w-[340px] shrink-0 flex flex-col bg-bg-panel border-l border-border">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-brand" />
          Bookmarks
          <span className="text-xs text-fg-subtle font-normal">
            ({bookmarks.length})
          </span>
        </h3>
        <div className="flex items-center gap-1">
          <button
            className="btn"
            disabled={!active || bookmarks.length === 0}
            onClick={() => active && clearBookmarks(active.id)}
            title="Clear all bookmarks"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button className="btn" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        {bookmarks.length === 0 ? (
          <div className="p-4 text-sm text-fg-subtle">
            No bookmarks yet. Click the gutter next to a line number, or press{" "}
            <kbd className="px-1 py-0.5 rounded bg-bg-elevated border border-border text-xs">
              Ctrl+F2
            </kbd>{" "}
            to toggle a bookmark.
            <br />
            <br />
            Press{" "}
            <kbd className="px-1 py-0.5 rounded bg-bg-elevated border border-border text-xs">
              F2
            </kbd>{" "}
            to jump to the next bookmark.
          </div>
        ) : (
          <ul>
            {bookmarks.map((b, i) => (
              <li
                key={b}
                onClick={() => onJump(b)}
                className="flex items-start gap-2 px-3 py-2 hover:bg-bg-hover cursor-pointer border-b border-border/50 text-sm"
              >
                <span className="text-fg-subtle tabular-nums shrink-0 w-16 text-right">
                  L{b + 1}
                </span>
                <span className="font-mono text-xs text-fg truncate">
                  {snippets[i] ?? "…"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
