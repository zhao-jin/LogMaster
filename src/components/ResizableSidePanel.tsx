import { useEffect, useRef } from "react";
import { useSettingsStore } from "../store/settings";
import { cn } from "../lib/utils";

interface Props {
  open: boolean;
  children: React.ReactNode;
}

const MIN_W = 240;
const MAX_W = 800;

/**
 * Right-side panel container with a draggable resizer on its left edge.
 * Width is persisted in settings store.
 */
export function ResizableSidePanel({ open, children }: Props) {
  const width = useSettingsStore((s) => s.sidePanelWidth);
  const setWidth = useSettingsStore((s) => s.set);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX; // dragging left = wider
      const next = Math.max(MIN_W, Math.min(MAX_W, startW.current + delta));
      setWidth("sidePanelWidth", next);
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
      className="relative shrink-0 flex border-l border-border"
      style={{ width: `${width}px` }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={(e) => {
          dragging.current = true;
          startX.current = e.clientX;
          startW.current = width;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onDoubleClick={() => setWidth("sidePanelWidth", 380)}
        title="Drag to resize · double-click to reset"
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 -ml-0.5 z-10",
          "cursor-col-resize hover:bg-brand/40 transition-colors"
        )}
      />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
