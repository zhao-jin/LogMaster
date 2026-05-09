import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useAppStore } from "../store/app";
import { useRecentStore } from "../store/recent";
import { openFile } from "../lib/ipc";

/**
 * Listen for OS-level file drops on the Tauri window. Drops of files are
 * opened as new tabs; folder drops are ignored (Open Folder UX is separate).
 *
 * Returns whether the cursor is currently over the drop zone, so the UI can
 * show a visual hint.
 */
export function useFileDrop(): boolean {
  const addTab = useAppStore((s) => s.addTab);
  const pushFile = useRecentStore((s) => s.pushFile);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await getCurrentWebview().onDragDropEvent(async (evt) => {
          const p = evt.payload;
          // Tauri 2 payload variants: "enter" | "over" | "drop" | "leave"
          // The actual event names use a `type` discriminator.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = (p as any).type as string;
          if (t === "enter" || t === "over") {
            setHovering(true);
            return;
          }
          if (t === "leave") {
            setHovering(false);
            return;
          }
          if (t === "drop") {
            setHovering(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const paths: string[] = (p as any).paths ?? [];
            for (const path of paths) {
              try {
                const info = await openFile(path);
                addTab(info);
                pushFile({ path: info.path, name: info.name });
              } catch (e) {
                console.error(`drop-open failed for ${path}:`, e);
              }
            }
          }
        });
      } catch (e) {
        // Tauri webview not available (e.g. running plain Vite preview).
        console.debug("drag-drop listener disabled:", e);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [addTab, pushFile]);

  return hovering;
}
