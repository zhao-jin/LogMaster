import { Bookmark, Copy, Hash, X, Globe } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

  const [coords, setCoords] = useState({ left: target?.x ?? 0, top: target?.y ?? 0 });

  useLayoutEffect(() => {
    if (!target || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const w = rect.width || 220;
    const h = rect.height || 140;
    const l = Math.min(target.x, window.innerWidth - w - 8);
    const t = Math.min(target.y, window.innerHeight - h - 8);
    setCoords({ left: l, top: t });
  }, [target]);

  if (!target) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[70] min-w-[220px] py-1 bg-bg-panel border border-border rounded-md shadow-2xl"
      style={{ left: coords.left, top: coords.top }}
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
