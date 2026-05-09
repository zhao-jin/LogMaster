import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Theme = "dark" | "light";

export interface Settings {
  theme: Theme;
  fontSize: number;          // px
  lineHeight: number;        // px
  tabSize: number;           // spaces
  followTailDefault: boolean;
  showLineNumbers: boolean;
  searchMaxHits: number;
  /** Tail throttle (frontend hint; backend is fixed for now) */
  tailIntervalMs: number;
  /** Right-side panel width in px (rules / bookmarks). */
  sidePanelWidth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontSize: 13,
  lineHeight: 20,
  tabSize: 4,
  followTailDefault: true,
  showLineNumbers: true,
  searchMaxHits: 5000,
  tailIntervalMs: 33,
  sidePanelWidth: 380,
};

interface SettingsState extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: "logmaster:settings",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (state) => ({ ...DEFAULT_SETTINGS, ...(state as object) }),
    }
  )
);
