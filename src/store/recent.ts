import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: number;
}

interface RecentState {
  files: RecentEntry[];
  folders: RecentEntry[];
  pushFile: (e: Omit<RecentEntry, "openedAt">) => void;
  pushFolder: (e: Omit<RecentEntry, "openedAt">) => void;
  removeFile: (path: string) => void;
  removeFolder: (path: string) => void;
  clear: () => void;
}

const MAX = 15;

export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      files: [],
      folders: [],
      pushFile: (e) =>
        set((s) => ({
          files: [
            { ...e, openedAt: Date.now() },
            ...s.files.filter((x) => x.path !== e.path),
          ].slice(0, MAX),
        })),
      pushFolder: (e) =>
        set((s) => ({
          folders: [
            { ...e, openedAt: Date.now() },
            ...s.folders.filter((x) => x.path !== e.path),
          ].slice(0, MAX),
        })),
      removeFile: (path) =>
        set((s) => ({ files: s.files.filter((x) => x.path !== path) })),
      removeFolder: (path) =>
        set((s) => ({ folders: s.folders.filter((x) => x.path !== path) })),
      clear: () => set({ files: [], folders: [] }),
    }),
    {
      name: "logmaster:recent",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);
