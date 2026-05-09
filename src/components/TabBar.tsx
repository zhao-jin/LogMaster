import { X, FileText, Radio } from "lucide-react";
import { useAppStore } from "../store/app";
import { cn } from "../lib/utils";
import { closeFile, stopTail } from "../lib/ipc";
import { clearFileCache } from "./LogView";

export function TabBar() {
  const { tabs, activeId, setActive, removeTab } = useAppStore();

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center bg-bg-panel border-b border-border overflow-x-auto">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
              "border-r border-border whitespace-nowrap",
              "transition-colors",
              active
                ? "bg-bg text-fg border-b-2 border-b-brand"
                : "text-fg-muted hover:bg-bg-hover/50 hover:text-fg"
            )}
            title={t.path}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="max-w-[220px] truncate">{t.name}</span>
            {t.tailing && (
              <Radio className="w-3 h-3 text-accent animate-pulse" />
            )}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  if (t.tailing) await stopTail(t.id);
                  await closeFile(t.id);
                } catch {
                  /* ignore */
                }
                clearFileCache(t.id);
                removeTab(t.id);
              }}
              className={cn(
                "ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100",
                "hover:bg-bg-elevated transition-opacity",
                active && "opacity-100"
              )}
              aria-label="Close tab"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
