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
      // Ignore right-button presses: a right-click that lands outside this
      // menu will fire its own `contextmenu` which reopens the menu at the
      // new spot. Closing here first creates a race that can swallow the
      // reopen, making right-clicks appear to "do nothing".
      if (e.button === 2) return;
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Defer binding by one frame so the very `mousedown` that opened this
    // menu (and the following right-click sequence) can't immediately close it.
    let bound = false;
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
      bound = true;
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      if (bound) document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [target, onClose]);

  // Synchronous viewport clamp — no measurement, no layout effect, so React
  // owns the style entirely (no stale DOM-overwrite race). Menu geometry is
  // known a priori: width = 220 (min-w), items are ~32px, separators ~9px,
  // container py-1 = 8px top+bottom.
  if (!target) return null;

  const showShowAll = onShowAllLinesAtThis && target.viewportOffset !== undefined;
  const W = 220;
  const ITEM_H = 32;
  const SEP_H = 9;
  const CONTAINER_PAD = 8;
  const itemCount = 4; // bookmark, copy line, copy line#, close
  const sepCount = showShowAll ? 2 : 1; // show-all divider + close divider
  const H = CONTAINER_PAD + (showShowAll ? ITEM_H + SEP_H : 0) + itemCount * ITEM_H + sepCount * SEP_H;
  const margin = 8;
  const left = Math.max(margin, Math.min(target.x, window.innerWidth - W - margin));
  const top = Math.max(margin, Math.min(target.y, window.innerHeight - H - margin));

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
