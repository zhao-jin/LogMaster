import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type Theme = "dark" | "light";

export interface Settings {
  theme: Theme;
  fontSize: number;          // px
  lineHeight: number;        // px
  fontFamily: string;        // CSS font-family
  tabSize: number;           // spaces
  followTailDefault: boolean;
  showLineNumbers: boolean;
  searchMaxHits: number;
  /** Tail throttle (frontend hint; backend is fixed for now) */
  tailIntervalMs: number;
  /** Right-side panel width in px (rules / bookmarks). */
  sidePanelWidth: number;
  /** Left-side panel (file explorer) width in px. */
  leftPanelWidth: number;
  /** Whether the left file-explorer panel is visible. */
  leftPanelOpen: boolean;
  /** Whether to wrap long lines (false = show horizontal scrollbar). */
  wordWrap: boolean;
  /** Interval (seconds) for refreshing file status (size, modified time, etc.).
   *  Files are merged into the list without changing sort order. */
  fileStatusRefreshIntervalSec: number;
  /** Interval (seconds) for re-sorting the file list by modified time.
   *  Independent from status refresh. */
  fileSortIntervalSec: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontSize: 14,
  lineHeight: 20,
  fontFamily: "'JetBrains Mono Nerd Font Mono Medium', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  tabSize: 4,
  followTailDefault: true,
  showLineNumbers: true,
  searchMaxHits: 5000,
  tailIntervalMs: 33,
  sidePanelWidth: 380,
  leftPanelWidth: 280,
  leftPanelOpen: true,
  wordWrap: false,
  fileStatusRefreshIntervalSec: 5,
  fileSortIntervalSec: 60,
};

interface SettingsState extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset: () => void;
  /** Call this once in App.tsx on mount to load from disk. */
  load: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...DEFAULT_SETTINGS,

  set: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);
    // Persist to disk (fire-and-forget; we don't want to block the UI).
    const state = { ...get() };
    // Remove methods before serializing
    const { set: _s, reset: _r, load: _l, ...payload } = state;
    invoke("save_settings", { settings: payload }).catch((e: any) =>
      console.error("LogMaster: failed to save settings", e)
    );
  },

  reset: () => {
    set({ ...DEFAULT_SETTINGS });
    const payload = { ...DEFAULT_SETTINGS };
    invoke("save_settings", { settings: payload }).catch((e: any) =>
      console.error("LogMaster: failed to save settings", e)
    );
  },

  load: async () => {
    try {
      const result = await invoke<Settings | null>("get_settings");
      if (result) {
        // Migrate old field name (folderRefreshIntervalSec → fileStatusRefreshIntervalSec)
        const migrated = { ...result } as any;
        if (
          migrated.folderRefreshIntervalSec !== undefined &&
          migrated.fileStatusRefreshIntervalSec === undefined
        ) {
          migrated.fileStatusRefreshIntervalSec = migrated.folderRefreshIntervalSec;
          delete (migrated as any).folderRefreshIntervalSec;
        }
        // Merge loaded settings with defaults (graceful migration)
        set({ ...DEFAULT_SETTINGS, ...migrated });
      }
    } catch (e) {
      console.error("LogMaster: failed to load settings", e);
    }
  },
}));
