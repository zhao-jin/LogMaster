import { Bookmark, Copy, Hash, X, Globe } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
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

  // Position exactly at the cursor first; clamp into the viewport only if it
  // would overflow, using the menu's real measured size (runs before paint so
  // there's no visible jump and no detached "(0,0) flash").
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !target) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = target.x;
    let top = target.y;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [target]);

  if (!target) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[70] min-w-[220px] py-1 bg-bg-panel border border-border rounded-md shadow-2xl"
      style={{ left: target.x, top: target.y }}
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
