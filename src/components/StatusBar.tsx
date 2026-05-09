import { Activity, FileText, Filter, Hash, Ruler } from "lucide-react";
import type { Tab } from "../store/app";
import { useAppStore } from "../store/app";
import { formatBytes, formatNumber } from "../lib/utils";

export function StatusBar({
  tab,
  hitCount,
}: {
  tab: Tab | undefined;
  hitCount: number;
}) {
  const filterEnabled = useAppStore((s) => s.filterEnabled);
  const activeFilterCount = useAppStore(
    (s) =>
      s.rules.filter(
        (r) => r.enabled && r.pattern.length > 0 && r.filter !== "none"
      ).length
  );
  const scrollTopLine = useAppStore((s) => s.scrollTopLine ?? 0);
  const scrollBottomLine = useAppStore((s) => s.scrollBottomLine ?? 0);

  if (!tab) {
    return (
      <div className="h-6 flex items-center px-3 text-xs bg-bg-panel border-t border-border text-fg-subtle">
        LogMaster ready — Ctrl+O to open a file
      </div>
    );
  }

  const total = tab.line_count;
  const visible = tab.visibleLines ? tab.visibleLines.length : total;
  const filtered = tab.visibleLines && visible !== total;

  // Visible-vs-total ratio for the filter info chip.
  const visiblePct =
    total === 0 ? 0 : Math.round((visible / total) * 1000) / 10; // 1 decimal

  // Scroll percent against the underlying file (physical line space).
  const scrollPct =
    total <= 1
      ? 100
      : Math.min(100, Math.round((scrollBottomLine / (total - 1)) * 100));

  return (
    <div className="h-6 flex items-center gap-3 px-3 text-xs bg-bg-panel border-t border-border text-fg-muted overflow-hidden">
      <span className="flex items-center gap-1 shrink-0">
        <FileText className="w-3 h-3" />
        <span className="text-fg truncate max-w-[260px]">{tab.name}</span>
      </span>
      <span className="flex items-center gap-1 shrink-0">
        <Ruler className="w-3 h-3" />
        {formatBytes(tab.size)}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        <Hash className="w-3 h-3" />
        {formatNumber(total)} lines
      </span>
      {filterEnabled && (
        <span
          className={
            "flex items-center gap-1 shrink-0 " +
            (filtered ? "text-brand" : "text-fg-subtle")
          }
          title={
            filtered
              ? `${formatNumber(visible)} of ${formatNumber(total)} lines visible`
              : "Filter is enabled but no rule is active"
          }
        >
          <Filter className="w-3 h-3" />
          {activeFilterCount} rule{activeFilterCount === 1 ? "" : "s"}
          {filtered &&
            ` · ${formatNumber(visible)} / ${formatNumber(total)} (${visiblePct}%)`}
        </span>
      )}
      {hitCount > 0 && (
        <span className="text-warn shrink-0">
          {formatNumber(hitCount)} hits
        </span>
      )}
      <span className="shrink-0">{tab.encoding}</span>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-3 shrink-0">
        {tab.tailing && (
          <span className="flex items-center gap-1 text-accent">
            <Activity className="w-3 h-3 animate-pulse" />
            tailing{tab.followTail ? " · follow" : ""}
          </span>
        )}
        <span
          className="tabular-nums"
          title={`Visible lines ${formatNumber(scrollTopLine + 1)}–${formatNumber(
            scrollBottomLine + 1
          )} of ${formatNumber(total)}`}
        >
          Ln {formatNumber(scrollTopLine + 1)}
        </span>
        <span className="tabular-nums text-fg" title="Scroll position">
          {scrollPct}%
        </span>
      </div>
    </div>
  );
}
