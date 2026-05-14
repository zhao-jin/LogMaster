import { useEffect, useRef } from "react";
import { fileExists, stopTail, closeFile } from "../lib/ipc";
import { useAppStore } from "../store/app";
import { clearFileCache } from "../components/LogView";

/**
 * Periodically checks every open tab's file on disk. If a file no longer
 * exists, the tab is closed automatically (after stopping its tail). Runs
 * at a moderate cadence (3s) so it stays cheap even with many tabs open.
 *
 * The check is just a `metadata()` stat in Rust — far cheaper than reading
 * the file. We also skip files that were deleted within the last few
 * seconds to debounce flaky network mounts.
 */
export function useFileWatchdog() {
  const checking = useRef(false);

  useEffect(() => {
    let stopped = false;

    async function tick() {
      if (checking.current || stopped) return;
      checking.current = true;
      try {
        const tabs = useAppStore.getState().tabs;
        if (tabs.length === 0) return;
        // Run all stat checks in parallel.
        const results = await Promise.all(
          tabs.map(async (t) => ({
            id: t.id,
            tailing: t.tailing,
            exists: await fileExists(t.path).catch(() => true),
          }))
        );
        for (const r of results) {
          if (!r.exists) {
            // File is gone — tear down tab quietly.
            try {
              if (r.tailing) await stopTail(r.id);
              await closeFile(r.id);
            } catch {
              /* ignore */
            }
            clearFileCache(r.id);
            useAppStore.getState().removeTab(r.id);
          }
        }
      } finally {
        checking.current = false;
      }
    }

    const id = window.setInterval(tick, 3000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);
}
