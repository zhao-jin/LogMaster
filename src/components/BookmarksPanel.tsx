import { Bookmark, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore, type BookmarkEntry } from "../store/app";
import { readLinesByIndices } from "../lib/ipc";
import { cn } from "../lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onJump: (physLine: number) => void;
}

export function BookmarksPanel({ open, onClose, onJump }: Props) {
  const { tabs, activeId, clearBookmarks, renameBookmark, recolorBookmark } =
    useAppStore();
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
        const r = await readLinesByIndices(
          active.id,
          bookmarks.map((b) => b.line)
        );
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
    <aside className="h-full flex flex-col bg-bg-panel">
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
          <button className="btn" onClick={onClose} title="Close panel (Ctrl+N)">
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
            to toggle one.
            <br />
            <br />
            <kbd className="px-1 py-0.5 rounded bg-bg-elevated border border-border text-xs">
              F2
            </kbd>{" "}
            jumps to the next bookmark.
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {bookmarks.map((b, i) => (
              <Row
                key={b.id}
                bookmark={b}
                snippet={snippets[i]}
                onJump={() => onJump(b.line)}
                onRename={(name) =>
                  active && renameBookmark(active.id, b.id, name)
                }
                onRecolor={(color) =>
                  active && recolorBookmark(active.id, b.id, color)
                }
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

const SWATCHES = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#fde047",
  "#94a3b8",
];

function Row({
  bookmark,
  snippet,
  onJump,
  onRename,
  onRecolor,
}: {
  bookmark: BookmarkEntry;
  snippet: string | undefined;
  onJump: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [draft, setDraft] = useState(bookmark.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  useEffect(() => {
    setDraft(bookmark.name);
  }, [bookmark.name]);

  function commit() {
    const v = draft.trim();
    if (v && v !== bookmark.name) onRename(v);
    setEditing(false);
  }

  return (
    <li className="px-2 py-2 hover:bg-bg-hover/50 transition-colors group">
      <div className="flex items-start gap-2">
        {/* Color swatch + palette */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPaletteOpen((v) => !v);
            }}
            title="Change color"
            className="w-4 h-4 rounded-sm border border-border/50 hover:scale-110 transition-transform cursor-pointer"
            style={{ backgroundColor: bookmark.color }}
          />
          {paletteOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setPaletteOpen(false)}
              />
              <div className="absolute z-40 top-5 left-0 bg-bg-elevated border border-border rounded-md shadow-2xl p-2 grid grid-cols-5 gap-1">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      onRecolor(c);
                      setPaletteOpen(false);
                    }}
                    className={cn(
                      "w-5 h-5 rounded-sm border cursor-pointer hover:scale-110 transition-transform",
                      bookmark.color === c
                        ? "border-fg ring-1 ring-brand"
                        : "border-border/50"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={bookmark.color}
                  onChange={(e) => onRecolor(e.target.value)}
                  className="col-span-5 mt-1 w-full h-6 bg-transparent border-0 cursor-pointer"
                  title="Pick custom color"
                />
              </div>
            </>
          )}
        </div>

        {/* Name + line */}
        <div className="flex-1 min-w-0" onClick={onJump}>
          <div className="flex items-center gap-2">
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") {
                    setDraft(bookmark.name);
                    setEditing(false);
                  }
                }}
                className="input flex-1 h-6 text-xs px-1 py-0"
              />
            ) : (
              <span
                className="text-sm text-fg truncate cursor-pointer"
                title={`Jump to line ${bookmark.line + 1}`}
              >
                {bookmark.name}
              </span>
            )}
            <span className="text-fg-subtle text-xs tabular-nums shrink-0">
              L{bookmark.line + 1}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              className="opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-fg cursor-pointer transition-opacity"
              title="Rename"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
          <div className="font-mono text-xs text-fg-muted truncate mt-0.5 cursor-pointer">
            {snippet ?? "…"}
          </div>
        </div>
      </div>
    </li>
  );
}
