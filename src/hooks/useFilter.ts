import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store/app";
import { filterLines, type FilterRuleDto } from "../lib/ipc";

const DEBOUNCE_MS = 50;

/**
 * Recomputes the visible-line projection for the active tab whenever
 * filter-related state changes (debounced).
 */
export function useFilter() {
  const activeId = useAppStore((s) => s.activeId);
  const rules = useAppStore((s) => s.rules);
  const filterEnabled = useAppStore((s) => s.filterEnabled);
  const filterCombineMode = useAppStore((s) => s.filterCombineMode);
  const lineCount = useAppStore(
    (s) => s.tabs.find((t) => t.id === s.activeId)?.line_count ?? 0
  );
  const updateTab = useAppStore((s) => s.updateTab);

  // Stable signature: only meaningful filter-affecting fields.
  const sig = useMemo(() => {
    return (
      filterCombineMode +
      "\n" +
      rules
        .filter(
          (r) => r.enabled && r.pattern.length > 0 && r.filter !== "none"
        )
        .map(
          (r) =>
            `${r.filter}|${r.is_regex ? "re" : "lit"}|${
              r.case_sensitive ? "cs" : "ci"
            }|${r.pattern}`
        )
        .join("\n")
    );
  }, [rules, filterCombineMode]);

  // Track the latest in-flight request so we can ignore stale results.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!activeId) return;

    if (!filterEnabled) {
      updateTab(activeId, { visibleLines: null });
      return;
    }

    const active: FilterRuleDto[] = rules
      .filter((r) => r.enabled && r.pattern.length > 0 && r.filter !== "none")
      .map((r) => ({
        pattern: r.pattern,
        is_regex: r.is_regex,
        case_sensitive: r.case_sensitive,
        action: r.filter === "in" ? "filter_in" : "filter_out",
      }));

    if (active.length === 0) {
      updateTab(activeId, { visibleLines: null });
      return;
    }

    const seq = ++requestSeq.current;
    let timer: number | null = window.setTimeout(async () => {
      timer = null;
      const t0 = performance.now();
      try {
        const res = await filterLines(activeId, active, filterCombineMode);
        // Stale guard: a newer request superseded us.
        if (seq !== requestSeq.current) return;
        const t1 = performance.now();

        // Avoid an extra copy: if backend returned a number[] we can construct
        // Uint32Array directly. (Tauri 2 IPC returns plain arrays.)
        const u32 =
          res instanceof Uint32Array
            ? res
            : new Uint32Array(res as unknown as number[]);
        updateTab(activeId, { visibleLines: u32 });
        const t2 = performance.now();
        // eslint-disable-next-line no-console
        console.debug(
          `[filter] mode=${filterCombineMode} rules=${active.length} hits=${u32.length}/${lineCount}  rust+ipc=${(
            t1 - t0
          ).toFixed(1)}ms  store=${(t2 - t1).toFixed(1)}ms`
        );
      } catch (e) {
        if (seq !== requestSeq.current) return;
        console.error("filter failed", e);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timer != null) {
        clearTimeout(timer);
        // bump seq so any in-flight request becomes stale
        requestSeq.current++;
      }
    };
  }, [activeId, sig, filterEnabled, filterCombineMode, lineCount, rules, updateTab]);
}
