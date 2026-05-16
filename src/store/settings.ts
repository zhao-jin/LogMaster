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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontSize: 13,
  lineHeight: 20,
  fontFamily: "Consolas, 'Courier New', monospace",
  tabSize: 4,
  followTailDefault: true,
  showLineNumbers: true,
  searchMaxHits: 5000,
  tailIntervalMs: 33,
  sidePanelWidth: 380,
  leftPanelWidth: 280,
  leftPanelOpen: true,
  wordWrap: false,
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
        // Merge loaded settings with defaults (graceful migration)
        set({ ...DEFAULT_SETTINGS, ...result });
      }
    } catch (e) {
      console.error("LogMaster: failed to load settings", e);
    }
  },
}));
