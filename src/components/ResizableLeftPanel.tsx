import { useEffect, useRef } from "react";
import { useSettingsStore } from "../store/settings";
import { cn } from "../lib/utils";

interface Props {
  open: boolean;
  children: React.ReactNode;
}

const MIN_W = 200;
const MAX_W = 640;
const DEFAULT_W = 280;

/**
 * Left-side panel container with a draggable resizer on its right edge.
 * Width persisted in settings store. Mirror of ResizableSidePanel but on
 * the opposite side.
 */
export function ResizableLeftPanel({ open, children }: Props) {
  const width = useSettingsStore((s) => s.leftPanelWidth);
  const setWidth = useSettingsStore((s) => s.set);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current; // dragging right = wider
      const next = Math.max(MIN_W, Math.min(MAX_W, startW.current + delta));
      setWidth("leftPanelWidth", next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setWidth]);

  if (!open) return null;

  return (
    <div
      className="relative shrink-0 flex border-r border-border"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      {/* Drag handle on the right edge */}
      <div
        onMouseDown={(e) => {
          dragging.current = true;
          startX.current = e.clientX;
          startW.current = width;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onDoubleClick={() => setWidth("leftPanelWidth", DEFAULT_W)}
        title="Drag to resize · double-click to reset"
        className={cn(
          "absolute right-0 top-0 bottom-0 w-1 -mr-0.5 z-10",
          "cursor-col-resize hover:bg-brand/40 transition-colors"
        )}
      />
    </div>
  );
}
