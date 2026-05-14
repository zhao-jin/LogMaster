import { X, FileText, Radio, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../store/app";
import { cn } from "../lib/utils";
import { closeFile, stopTail, reloadFile } from "../lib/ipc";
import { clearFileCache } from "./LogView";

export function TabBar() {
  const { tabs, activeId, setActive, removeTab, updateTab } = useAppStore();
  const [reloadingIds, setReloadingIds] = useState<Set<string>>(() => new Set());

  if (tabs.length === 0) return null;

  async function doReload(id: string) {
    setReloadingIds((s) => new Set(s).add(id));
    try {
      const newCount = await reloadFile(id);
      // Drop our chunk cache so the next reads see fresh content.
      clearFileCache(id);
      // Update tab so virtualizer knows the new line count, and reset
      // any stale scrollTo / visibleLines state so the user lands at
      // the top of the reloaded file (filter results recompute via
      // useFilter on the next tick because rules subscription fires).
      updateTab(id, {
        line_count: newCount,
        visibleLines: null,
        scrollTo: 0,
      });
    } catch (e) {
      console.error("reload failed", e);
    } finally {
      setReloadingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="flex items-center bg-bg-panel border-b border-border overflow-x-auto">
      {tabs.map((t) => {
        const active = t.id === activeId;
        const reloading = reloadingIds.has(t.id);
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
              onClick={(e) => {
                e.stopPropagation();
                if (!reloading) doReload(t.id);
              }}
              className={cn(
                "ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100",
                "hover:bg-bg-elevated transition-opacity",
                active && "opacity-100",
                reloading && "opacity-100"
              )}
              title="Reload file from disk"
              aria-label="Reload file"
            >
              <RefreshCw
                className={cn("w-3 h-3", reloading && "animate-spin")}
              />
            </button>
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
                "p-0.5 rounded opacity-0 group-hover:opacity-100",
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
