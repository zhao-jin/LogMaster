import { Bookmark, Copy, Hash, X, Globe } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

export interface LineMenuTarget {
  x: number;
  y: number;
  physLine: number;
  text: string;
  isBookmarked: boolean;
  viewIdx: number;
  viewportOffset?: number;
}

interface Props {
  target: LineMenuTarget | null;
  onClose: () => void;
  onToggleBookmark: (physLine: number) => void;
  onShowAllLinesAtThis?: (physLine: number, viewportOffset: number) => void;
}

export function LineContextMenu({ target, onClose, onToggleBookmark, onShowAllLinesAtThis }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

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

  // Clamp inside viewport
  const W = 220;
  const H = 180; // slightly taller to accommodate the new menu item
  const left = Math.min(target.x, window.innerWidth - W - 8);
  const top = Math.min(target.y, window.innerHeight - H - 8);

  return (
    <div
      ref={ref}
      className="fixed z-[70] min-w-[220px] py-1 bg-bg-panel border border-border rounded-md shadow-2xl"
      style={{ left, top }}
      role="menu"
    >
      {onShowAllLinesAtThis && target.viewportOffset !== undefined && (
        <>
          <Item
            icon={<Globe className="w-4 h-4 text-brand" />}
            onClick={() => {
              onShowAllLinesAtThis(target.physLine, target.viewportOffset!);
              onClose();
            }}
          >
            Show All Lines At This
          </Item>
          <div className="my-1 h-px bg-border" />
        </>
      )}

      <Item
        icon={<Bookmark className="w-4 h-4" />}
        shortcut="Ctrl+F2"
        onClick={() => {
          onToggleBookmark(target.physLine);
          onClose();
        }}
      >
        {target.isBookmarked ? "Remove bookmark" : "Add bookmark"}
      </Item>
      <Item
        icon={<Copy className="w-4 h-4" />}
        onClick={() => {
          navigator.clipboard.writeText(target.text).catch(() => {});
          onClose();
        }}
      >
        Copy line
      </Item>
      <Item
        icon={<Hash className="w-4 h-4" />}
        onClick={() => {
          navigator.clipboard
            .writeText(String(target.physLine + 1))
            .catch(() => {});
          onClose();
        }}
      >
        Copy line number ({target.physLine + 1})
      </Item>
      <div className="my-1 h-px bg-border" />
      <Item
        icon={<X className="w-4 h-4" />}
        onClick={onClose}
      >
        Close
      </Item>
    </div>
  );
}

function Item({
  children,
  icon,
  shortcut,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-fg",
        "hover:bg-bg-hover focus:bg-bg-hover focus:outline-none cursor-pointer transition-colors"
      )}
    >
      <span className="text-fg-muted">{icon}</span>
      <span className="flex-1 text-left truncate">{children}</span>
      {shortcut && (
        <kbd className="text-xs text-fg-subtle px-1.5 py-0.5 rounded bg-bg-elevated border border-border">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
